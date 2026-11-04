import {execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
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
const config = path.join(runtime, 'signing.json');
// Tauri signs after binary patching and before embedding, including the uninstaller.
writeFileSync(config, JSON.stringify({bundle: {windows: {signCommand: {
  cmd: process.execPath,
  args: [path.join(root, 'scripts/hub-windows-sign.mjs'), '%1'],
}}}}));
execFileSync(process.execPath, [path.join(desktop, 'node_modules/@tauri-apps/cli/tauri.js'),
  'bundle', '--bundles', 'nsis', '--config', 'src-tauri/tauri.windows.conf.json',
  '--config', config], {cwd: desktop, stdio: 'inherit'});
execFileSync(process.execPath, [path.join(desktop, 'scripts/verify-bundle.mjs')],
  {cwd: desktop, stdio: 'inherit'});
