import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

if (process.platform !== 'win32') throw Error('Windows runner required.');
for (const key of ['ES_USERNAME', 'ES_PASSWORD', 'CREDENTIAL_ID', 'ES_TOTP_SECRET']) {
  if (!process.env[key]?.trim()) throw Error(`Missing signing secret: ${key}`);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const desktop = path.join(root, 'hub/desktop');
const runtime = path.join(process.env.RUNNER_TEMP, 'hub-windows-signing');
mkdirSync(runtime, {recursive: true});
const release = path.join(desktop, 'src-tauri/target/release');
const executables = [
  'sengclaw-hub-desktop.exe',
  'hub-sidecar.exe',
  'meegle.exe',
  'lark-cli.exe',
];
try {
  for (const name of executables) {
    const target = path.join(release, name);
    if (!existsSync(target)) throw Error(`Missing portable executable: ${name}`);
    execFileSync(process.execPath, [path.join(root, 'scripts/hub-windows-sign.mjs'), target],
      {cwd: root, stdio: 'inherit'});
  }
  execFileSync(process.execPath, [path.join(desktop, 'scripts/verify-bundle.mjs')],
    {cwd: desktop, stdio: 'inherit'});
  execFileSync(process.execPath, [path.join(desktop, 'scripts/package-windows-portable.mjs')],
    {cwd: desktop, stdio: 'inherit'});
} catch {
  const failure = path.join(runtime, 'failure.json');
  if (existsSync(failure)) console.error(readFileSync(failure, 'utf8'));
  throw Error('Signed Windows portable packaging failed; no archive will be uploaded.');
}
