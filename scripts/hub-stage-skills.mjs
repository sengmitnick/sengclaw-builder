// Stage one immutable, authorized build input; this is not a client updater.
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repository = 'sengmitnick/sengclaw-builder';
const storageHosts = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
class SkillInputError extends Error {}

export async function downloadSkillAsset({assetId, expectedSha, token}, fetcher = fetch) {
  if (typeof assetId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(assetId) ||
      typeof expectedSha !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha) ||
      typeof token !== 'string' || !token) throw new SkillInputError('Invalid locked Skill asset input.');
  let response;
  try {
    response = await fetcher(`https://api.github.com/repos/${repository}/releases/assets/${assetId}`, {
      headers: {Accept: 'application/octet-stream', Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28'}, redirect: 'manual',
    });
    if (response.status === 302) {
      const target = new URL(response.headers.get('location'));
      if (target.protocol !== 'https:' || !storageHosts.has(target.hostname) || target.username || target.password) {
        throw new SkillInputError('Skill asset redirected outside GitHub storage.');
      }
      // Do not forward the repository token to the pre-signed storage URL.
      response = await fetcher(target.href, {redirect: 'error'});
    }
  } catch (error) {
    if (error instanceof SkillInputError) throw error;
    throw new SkillInputError('Skill asset download failed.');
  }
  if (response.status !== 200) throw new SkillInputError('Skill asset is unavailable.');
  let bytes;
  try { bytes = Buffer.from(await response.arrayBuffer()); }
  catch { throw new SkillInputError('Skill asset download failed.'); }
  if (bytes.length > 32 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== expectedSha) {
    throw new SkillInputError('Skill archive digest or size does not match the pinned input.');
  }
  return bytes;
}

export async function stageSkillPackages(options, {fetcher = fetch, validator} = {}) {
  const {hubRoot, edition, pythonExecutable = 'python'} = options;
  if (!['product', 'development'].includes(edition)) throw new SkillInputError('A fixed Skill edition is required.');
  const root = path.resolve(hubRoot);
  const output = path.join(root, '.runtime/skill-packages');
  if (existsSync(output)) throw new SkillInputError('Refusing to overwrite a Skill staging directory.');
  const bytes = await downloadSkillAsset(options, fetcher);
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'hub-locked-skills-'));
  try {
    const archive = path.join(temporary, 'role-skills.zip');
    writeFileSync(archive, bytes, {mode: 0o600, flag: 'wx'});
    const env = {...process.env};
    delete env.GITHUB_TOKEN;
    delete env.GH_TOKEN;
    const extract = spawnSync(pythonExecutable, [fileURLToPath(new URL('./hub-extract-skills.py', import.meta.url)),
      archive, output], {env, encoding: 'utf8'});
    if (extract.status !== 0) throw new SkillInputError('Locked Skill archive extraction failed.');
    const validate = validator ?? (await import(pathToFileURL(path.join(root, 'desktop/scripts/skills-package.mjs')).href))
      .validateSkillPackage;
    for (const role of ['product', 'development']) {
      validate(path.join(output, role), role, path.join(root, 'desktop/skills.lock.json'));
    }
    return path.join(output, edition);
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const packageRoot = await stageSkillPackages({assetId: process.env.SKILL_PACKAGE_ASSET_ID,
      expectedSha: process.env.SKILL_PACKAGE_SHA256, token: process.env.GITHUB_TOKEN,
      hubRoot: path.resolve('hub'), edition: process.env.SKILL_EDITION});
    if (!process.env.GITHUB_ENV || /[\r\n]/.test(packageRoot)) throw new SkillInputError('Missing build environment.');
    appendFileSync(process.env.GITHUB_ENV, `HUB_SKILL_PACKAGE_DIR=${packageRoot}\n`);
    console.log('Locked role Skill packages verified; selected package staged for this build.');
  } catch (error) {
    console.error(error instanceof SkillInputError ? error.message : 'Locked Skill package validation failed.');
    process.exitCode = 1;
  }
}
