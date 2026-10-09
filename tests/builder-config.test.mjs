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

test("macOS verifier checks identity, architecture, trust, notarization, and checksum", () => {
  const source = read("scripts/verify-replybot-macos.sh");

  assert.match(source, /hdiutil verify/);
  assert.match(source, /CFBundleIdentifier/);
  assert.match(source, /com\.sengclaw\.reply/);
  assert.match(source, /Mach-O 64-bit executable arm64/);
  assert.match(source, /codesign --verify --deep --strict/);
  assert.match(source, /spctl --assess/);
  assert.match(source, /stapler validate/);
  assert.match(source, /shasum -a 256/);
});
