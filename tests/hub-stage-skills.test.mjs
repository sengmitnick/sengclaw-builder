import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function implementation() {
  let module;
  try { module = await import('../scripts/hub-stage-skills.mjs'); }
  catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
  assert.ok(module, 'A fixed, digest-verified offline Skill input is required before Hub signing.');
  return module;
}
const input = {assetId: '12345', expectedSha: sha256('archive'), token: 'synthetic-build-token'};

test('Skill input download uses only this repository asset API and a pinned digest', async () => {
  const {downloadSkillAsset} = await implementation();
  const calls = [];
  const bytes = await downloadSkillAsset(input, async (url, options) => {
    calls.push([url, options]); return new Response('archive');
  });
  assert.equal(bytes.toString(), 'archive');
  assert.equal(calls[0][0], 'https://api.github.com/repos/sengmitnick/sengclaw-builder/releases/assets/12345');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer synthetic-build-token');
  assert.equal(calls[0][1].redirect, 'manual');
});

test('GitHub asset redirect does not send the repository token to storage', async () => {
  const {downloadSkillAsset} = await implementation();
  const calls = [];
  await downloadSkillAsset(input, async (url, options) => {
    calls.push([url, options]);
    return calls.length === 1 ? new Response(null, {status: 302,
      headers: {location: 'https://release-assets.githubusercontent.com/allowed/signed'}}) : new Response('archive');
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1][1].headers?.Authorization, undefined);
  assert.equal(calls[1][1].redirect, 'error');
});

test('bad selectors, digest, status and foreign redirects fail without leaking credentials', async () => {
  const {downloadSkillAsset} = await implementation();
  for (const change of [{assetId: '../other'}, {assetId: '0'}, {expectedSha: 'latest'}, {token: ''}]) {
    let called = false;
    await assert.rejects(downloadSkillAsset({...input, ...change}, async () => {
      called = true; return new Response('archive');
    }));
    assert.equal(called, false);
  }
  for (const response of [new Response('changed'), new Response('secret error body', {status: 403}),
    new Response(null, {status: 302, headers: {location: 'https://foreign.invalid/steal'}})]) {
    let called = 0;
    await assert.rejects(downloadSkillAsset(input, async () => {called++; return response;}),
      error => !String(error).includes(input.token) && !String(error).includes('secret error body'));
    assert.equal(called, 1);
  }
});

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hub-stage-skills-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const archive = path.join(root, 'input.zip');
  const made = spawnSync('python3', ['-c',
    "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('product/fixture','product'); z.writestr('development/fixture','development'); z.close()", archive]);
  assert.equal(made.status, 0, made.stderr?.toString());
  return {root, hubRoot: path.join(root, 'hub'), bytes: readFileSync(archive)};
}

test('staging validates both locked role packages and selects only the requested role', async t => {
  const {stageSkillPackages} = await implementation();
  const f = fixture(t); const verified = [];
  const result = await stageSkillPackages({...input, hubRoot: f.hubRoot, edition: 'development',
    expectedSha: sha256(f.bytes), pythonExecutable: 'python3'}, {
    fetcher: async () => new Response(f.bytes),
    validator: (packageRoot, edition, lockPath) => {
      assert.equal(readFileSync(path.join(packageRoot, 'fixture'), 'utf8'), edition);
      assert.equal(lockPath, path.join(f.hubRoot, 'desktop/skills.lock.json'));
      verified.push(edition);
    },
  });
  assert.deepEqual(verified, ['product', 'development']);
  assert.equal(result, path.join(f.hubRoot, '.runtime/skill-packages/development'));
});

test('a pre-existing staging directory or invalid edition cannot be overwritten', async t => {
  const {stageSkillPackages} = await implementation();
  const f = fixture(t); const output = path.join(f.hubRoot, '.runtime/skill-packages');
  mkdirSync(output, {recursive: true}); writeFileSync(path.join(output, 'owned'), 'preserve');
  let called = false;
  for (const edition of ['product', 'administrator']) {
    await assert.rejects(stageSkillPackages({...input, hubRoot: f.hubRoot, edition}, {
      fetcher: async () => {called = true; return new Response(f.bytes);}, validator: () => {},
    }));
  }
  assert.equal(called, false);
  assert.equal(readFileSync(path.join(output, 'owned'), 'utf8'), 'preserve');
});

test('workflow stages the locked input before signing on each platform', () => {
  const workflow = readFileSync(new URL('../.github/workflows/hub-desktop.yml', import.meta.url), 'utf8');
  assert.match(workflow, /skill_package_asset_id:[\s\S]*?required: true/);
  assert.match(workflow, /skill_package_sha256:[\s\S]*?required: true/);
  assert.equal((workflow.match(/run: node scripts\/hub-stage-skills.mjs/g) || []).length, 2);
  assert.equal((workflow.match(/GITHUB_TOKEN: \$\{\{ github.token \}\}/g) || []).length, 2);
  assert.doesNotMatch(workflow, /secrets\.(?:SKILLS_DEPLOY_KEY|GITHUB_PAT)/);
});

test('draft input access is granted only to the two trusted manual signing jobs', () => {
  const workflow = readFileSync(new URL('../.github/workflows/hub-desktop.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.equal((workflow.match(/^    permissions:\n      contents: write$/gm) || []).length, 2);
  for (const name of ['macos', 'windows']) {
    const section = workflow.split(`\n  ${name}:\n`)[1].split(/\n  [a-z][a-z0-9_-]*:\n/)[0];
    assert.match(section, /github\.repository == 'sengmitnick\/sengclaw-builder'/);
    assert.match(section, /github\.ref == 'refs\/heads\/main'/);
    assert.match(section, /^    permissions:\n      contents: write$/m);
  }
  assert.doesNotMatch(workflow, /pull_request:|workflow_call:|^  push:/m);
});

test('asset failures report only the safe HTTP status without response contents or headers', async () => {
  const {downloadSkillAsset} = await implementation();
  for (const status of [403, 404]) {
    await assert.rejects(downloadSkillAsset(input, async () => new Response(`secret-body ${input.token}`, {
      status, headers: {location: 'https://release-assets.githubusercontent.com/private?signature=secret'},
    })), error => error.message === `Skill asset is unavailable (HTTP ${status}).`);
  }
});
