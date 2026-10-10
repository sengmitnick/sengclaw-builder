import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

test("macOS build script validates every release input and builds arm64", () => {
  const source = read("scripts/build-replybot-macos.sh");
  const requiredVariables = [
    "BUILD_CERTIFICATE_BASE64",
    "P12_PASSWORD",
    "KEYCHAIN_PASSWORD",
    "APPLE_SIGNING_IDENTITY",
    "APPLE_API_KEY_BASE64",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER",
    "PRODUCTION_LICENSE_PUBLIC_KEY_BASE64",
    "PRODUCTION_LICENSE_PUBLIC_KEY_SHA256"
  ];

  for (const variable of requiredVariables) {
    assert.match(source, new RegExp(`require_env ${variable}`));
  }
  assert.match(source, /REPLYBOT_RELEASE=1/);
  assert.match(source, /pnpm test/);
  assert.match(source, /pnpm typecheck/);
  assert.match(source, /pnpm web:build/);
  assert.match(source, /pnpm verify:recovery/);
  assert.match(source, /make --arch=arm64/);
});

test("macOS verifier checks identity, runtime dependencies, startup, notarization, and checksum", () => {
  const source = read("scripts/verify-replybot-macos.sh");

  assert.match(source, /hdiutil verify/);
  assert.match(source, /CFBundleIdentifier/);
  assert.match(source, /com\.sengclaw\.reply/);
  assert.match(source, /Mach-O 64-bit executable arm64/);
  assert.match(source, /codesign --verify --deep --strict/);
  assert.match(source, /spctl --assess/);
  assert.match(source, /stapler validate/);
  assert.match(source, /@electron\/asar\/bin\/asar\.js/);
  assert.match(source, /grep -Fq \"\$runtime_manifest\"/);
  assert.doesNotMatch(source, /grep -Fqx \"\$runtime_manifest\"/);
  assert.match(source, /statFile/);
  assert.match(source, /ELECTRON_RUN_AS_NODE=1/);
  assert.match(source, /better-sqlite3/);
  assert.match(source, /app\.asar\.unpacked/);
  assert.match(source, /find \"\$unpacked_root\" -type f -path/);
  assert.match(source, /--user-data-dir/);
  assert.match(source, /--type=renderer/);
  assert.match(source, /Cannot find module/);
  assert.match(source, /ERR_FILE_NOT_FOUND/);
  assert.match(source, /ERR_DLOPEN_FAILED/);
  assert.match(source, /ReplyBot startup failed/);
  assert.match(source, /pwd -P/);
  assert.match(source, /shasum -a 256/);
  assert.match(source, /basename \"\$dmg_path\"/);
});

test("macOS workflow is manual, isolated, and checks out private ReplyBot with LFS", () => {
  const source = read(".github/workflows/replybot-macos.yml");

  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /pull_request:/);
  assert.doesNotMatch(source, /^\s+push:/m);
  assert.match(source, /contents: read/);
  assert.match(source, /runs-on: macos-15/);
  assert.match(source, /environment: macos-release/);
  assert.match(source, /repository: \$\{\{ vars\.REPLYBOT_REPOSITORY \}\}/);
  assert.match(source, /ssh-key: \$\{\{ secrets\.REPLYBOT_DEPLOY_KEY \}\}/);
  assert.match(source, /lfs: true/);
  assert.match(source, /path: replybot/);
  assert.match(source, /postgresql@16/);
  assert.match(source, /version: 11\.28\.4/);
  assert.match(source, /scripts\/build-replybot-macos\.sh/);
  assert.match(source, /actions\/upload-artifact@v6/);
});
