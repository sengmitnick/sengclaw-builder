import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isPortableExecutable, signingPayloadName} from './windows-pe.mjs';

if (process.platform !== 'win32') throw Error('Windows runner required.');
const preflight = process.argv[2] === '--preflight';
const target = process.argv[2];
if (!preflight && (!target || !existsSync(target) || !isPortableExecutable(readFileSync(target)))) {
  throw Error('Expected an existing PE executable supplied by Tauri.');
}
for (const key of ['ES_USERNAME', 'ES_PASSWORD', 'CREDENTIAL_ID', 'ES_TOTP_SECRET']) {
  if (!process.env[key]?.trim()) throw Error(`Missing signing secret: ${key}`);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(process.env.RUNNER_TEMP, 'hub-windows-signing');
mkdirSync(runtime, {recursive: true});
const stage = mkdtempSync(path.join(runtime, 'object-'));
try {
  const input = path.join(stage, 'input');
  const output = path.join(stage, 'output');
  mkdirSync(input);
  mkdirSync(output);
  // actions/core requires command files to exist before exportVariable/setOutput.
  writeFileSync(path.join(stage, 'action-output'), '');
  writeFileSync(path.join(stage, 'action-env'), '');
  const basename = signingPayloadName(target);
  if (!preflight) copyFileSync(target, path.join(input, basename));
  const result = spawnSync(process.execPath, [path.join(root, 'signing-adapter/dist/index.js')], {
    cwd: runtime, encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024,
    env: {...process.env,
      INPUT_COMMAND: preflight ? '--version' : 'batch_sign', INPUT_USERNAME: process.env.ES_USERNAME,
      INPUT_PASSWORD: process.env.ES_PASSWORD, INPUT_CREDENTIAL_ID: process.env.CREDENTIAL_ID,
      INPUT_TOTP_SECRET: process.env.ES_TOTP_SECRET, INPUT_DIR_PATH: input,
      INPUT_OUTPUT_PATH: output, INPUT_OVERRIDE: 'true', INPUT_MALWARE_BLOCK: 'true',
      INPUT_ENVIRONMENT_NAME: 'PROD', INPUT_CLEAN_LOGS: 'true',
      INPUT_JVM_MAX_MEMORY: '1024M', INPUT_SIGNING_METHOD: 'v1',
      // Keep the adapter's verbose command/output out of public logs and job outputs.
      GITHUB_OUTPUT: path.join(stage, 'action-output'), GITHUB_ENV: path.join(stage, 'action-env'),
    },
  });
  const signed = path.join(output, basename);
  if (result.status !== 0 || (!preflight && !existsSync(signed))) {
    // Expose only redacted error annotations, never command lines or full transcripts.
    let diagnostics = `${result.stdout || ''}\n${result.stderr || ''}`;
    for (const key of ['ES_USERNAME', 'ES_PASSWORD', 'CREDENTIAL_ID', 'ES_TOTP_SECRET']) {
      diagnostics = diagnostics.split(process.env[key]).join('[REDACTED]');
    }
    const errors = diagnostics.split(/\r?\n/).filter(line => /::error::/.test(line))
      .filter(line => !/-(username|password|totp_secret|credential_id)=/.test(line))
      .map(line => line.replace(/^.*::error::/, '').slice(0, 500)).slice(-3);
    const failure = JSON.stringify({
      file: path.basename(target), exit: result.status, error: result.error?.code, errors,
    });
    writeFileSync(path.join(runtime, 'failure.json'), failure);
    if (preflight) console.error(failure);
    // Never print the adapter command line, captured output, or credentials.
    throw Error(`SSL.com signing failed for ${path.basename(target)} (exit ${result.status}). No unsigned fallback.`);
  }
  if (preflight) {
    console.log('SSL.com signing tool startup: PASS.');
    process.exitCode = 0;
  } else {
  const checked = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
    '$s=Get-AuthenticodeSignature -LiteralPath $env:HUB_SIGNED_FILE; if ($s.Status -ne "Valid" -or !$s.TimeStamperCertificate) { exit 1 }'],
  {encoding: 'utf8', env: {...process.env, HUB_SIGNED_FILE: signed}});
  if (checked.status !== 0) throw Error(`Invalid or untimestamped signature: ${path.basename(target)}`);
  copyFileSync(signed, target);
  console.log(`Verified Authenticode signature: ${path.basename(target)}`);
  }
} finally {
  rmSync(stage, {recursive: true, force: true});
}
