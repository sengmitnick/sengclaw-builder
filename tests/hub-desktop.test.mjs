import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/hub-desktop.yml', import.meta.url), 'utf8');
test('Hub jobs run directly in Builder, not in a private caller', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /workflow_call:|pull_request:|^  push:/m);
  assert.match(workflow, /github.repository == 'sengmitnick\/sengclaw-builder'/);
  assert.match(workflow, /runs-on: macos-15/);
  assert.match(workflow, /runs-on: windows-2022/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /options: \[seng, finloop, both\]/);
  assert.equal((workflow.match(/matrix:\n\s+enterprise:/g) || []).length, 2);
});
test('Hub source access is dedicated and pinned to main ancestry', () => {
  assert.equal((workflow.match(/repository: sengmitnick\/sengclaw-hub/g) || []).length, 2);
  assert.equal((workflow.match(/secrets.HUB_DEPLOY_KEY/g) || []).length, 2);
  assert.equal((workflow.match(/git merge-base --is-ancestor/g) || []).length, 2);
  assert.match(workflow, /\^\[a-f0-9\]\{40\}\$/);
  assert.equal((workflow.match(/persist-credentials: false/g) || []).length, 5);
  assert.doesNotMatch(workflow, /REPLYBOT_DEPLOY_KEY|secrets: inherit/);
});
test('Windows signs through a pinned adapter with isolated release secrets', () => {
  const windows = workflow.split('  windows:')[1];
  assert.match(windows, /environment: windows-release/);
  for (const key of ['ES_USERNAME', 'ES_PASSWORD', 'CREDENTIAL_ID', 'ES_TOTP_SECRET']) {
    assert.match(windows, new RegExp(`secrets\\.${key}`));
  }
  assert.match(windows, /ref: b7f8ff36fc0de8690fbbab8e5b4421d29802f747/);
  assert.match(windows, /npm run build/);
  assert.match(windows, /Verify Windows CLI UTF-8 boundary[\s\S]*python -m unittest tests\.test_environments -v/);
  assert.match(windows, /hub-windows-release.mjs/);
  assert.match(windows, /verify-hub-windows-portable.ps1/);
  assert.match(windows, /windows-portable\/\*\.zip/);
  assert.doesNotMatch(windows, /nsis|msi/i);
  assert.match(windows, /Hub-\$\{\{ matrix\.enterprise \}\}-\$\{\{ matrix\.edition \}\}-windows-signed-/);
  assert.doesNotMatch(windows, /continue-on-error|unsigned|@develop/);
  assert.ok(windows.indexOf('tests.test_environments') < windows.indexOf('hub-windows-sign.mjs --preflight'));
  assert.ok(windows.indexOf('verify-hub-windows-portable.ps1') < windows.indexOf('actions/upload-artifact'));
});
test('Portable executables are signed before ZIP creation and fail closed', () => {
  const release = readFileSync(new URL('../scripts/hub-windows-release.mjs', import.meta.url), 'utf8');
  const sign = readFileSync(new URL('../scripts/hub-windows-sign.mjs', import.meta.url), 'utf8');
  const verify = readFileSync(new URL('../scripts/verify-hub-windows-portable.ps1', import.meta.url), 'utf8');
  for (const executable of ['sengclaw-hub-desktop.exe', 'hub-sidecar.exe', 'meegle.exe', 'lark-cli.exe']) {
    assert.match(release, new RegExp(executable.replaceAll('.', '\\.')));
  }
  assert.ok(release.indexOf('hub-windows-sign.mjs') < release.indexOf('package-windows-portable.mjs'));
  assert.match(sign, /result.status !== 0 \|\| \(!preflight && !existsSync\(signed\)\)/);
  assert.match(sign, /INPUT_MALWARE_BLOCK: 'true'/);
  assert.match(sign, /writeFileSync\(path.join\(stage, 'action-output'\), ''\)/);
  assert.match(sign, /writeFileSync\(path.join\(stage, 'action-env'\), ''\)/);
  assert.match(sign, /TimeStamperCertificate/);
  assert.doesNotMatch(sign, /console\.(log|error)\(result|stdio: 'inherit'/);
  assert.match(verify, /Expand-Archive/);
  assert.match(verify, /tauri\.\$enterprise\.\$edition\.conf\.json/);
  assert.match(verify, /\$overlay\.productName/);
  assert.match(verify, /package_type = 'portable-zip'/);
  assert.match(verify, /Signer mismatch/);
  assert.match(verify, /customer_machine_ui_acceptance = 'not yet verified'/);
});
test('Each enterprise build receives only its fixed package key and selected secret', () => {
  assert.equal((workflow.match(/HUB_ENTERPRISE_KEY: \$\{\{ matrix\.enterprise \}\}/g) || []).length, 4);
  assert.match(workflow, /secrets\.HUB_ENTERPRISE_CONFIG_SENG_JSON/);
  assert.match(workflow, /secrets\.HUB_ENTERPRISE_CONFIG_FINLOOP_JSON/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /Hub-\$\{\{ matrix\.enterprise \}\}-\$\{\{ matrix\.edition \}\}-macos-/);
  assert.match(workflow, /Hub-\$\{\{ matrix\.enterprise \}\}-\$\{\{ matrix\.edition \}\}-windows-signed-/);
});

test('both platforms isolate each edition through compilation, signing and receipt verification', () => {
  assert.match(workflow, /edition:[\s\S]*?options: \[product, development, both\]/);
  assert.equal((workflow.match(/edition: \$\{\{ fromJSON/g) || []).length, 2);
  assert.equal((workflow.match(/HUB_CLIENT_EDITION: \$\{\{ matrix\.edition \}\}/g) || []).length, 4);
  const windows = workflow.split('  windows:')[1];
  assert.match(windows, /npm run build/);
  assert.doesNotMatch(windows, /npx tauri build/);
  const verify = readFileSync(new URL('../scripts/verify-hub-windows-portable.ps1', import.meta.url), 'utf8');
  assert.match(verify, /edition = \$edition/);
  assert.match(verify, /bundle_id = \$overlay\.identifier/);
});
test('Mac reuses existing Builder environment; Windows receives no Apple keys', () => {
  assert.match(workflow, /environment: macos-release/);
  assert.match(workflow, /secrets.BUILD_CERTIFICATE_BASE64/);
  assert.match(workflow, /secrets.APPLE_API_KEY_BASE64/);
  assert.match(workflow, /HUB_APPLE_TEAM_ID: 87WNRG9285/);
  assert.doesNotMatch(workflow.split('  windows:')[1], /APPLE_|P12_|macos-release/);
  assert.doesNotMatch(workflow, /python-version: '3.12.14'/);
});
test('Public downloads require opt-in and exclude failed candidates and broad paths', () => {
  assert.match(workflow, /upload_installers:[\s\S]*?default: false/);
  assert.equal((workflow.match(/if: success\(\) && inputs.upload_installers/g) || []).length, 2);
  assert.doesNotMatch(workflow, /gh release create/);
  assert.match(workflow, /hub\/\.runtime\/releases\/\*\/release.json/);
  assert.doesNotMatch(workflow, /notary-log.json|secrets.HUB_NOTARY|path: hub\/\.runtime\s*$/m);
});
