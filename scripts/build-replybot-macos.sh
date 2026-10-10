#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
builder_root="$(cd "${script_dir}/.." && pwd)"
# shellcheck source=lib.sh
source "${script_dir}/lib.sh"

[[ "$(uname -s)" == "Darwin" ]] || die "ReplyBot macOS releases must run on macOS"
[[ "$(uname -m)" == "arm64" ]] || die "ReplyBot macOS releases require an Apple Silicon runner"

for command_name in base64 file hdiutil node pnpm security shasum xcrun; do
  require_command "$command_name"
done

require_env BUILD_CERTIFICATE_BASE64
require_env P12_PASSWORD
require_env KEYCHAIN_PASSWORD
require_env APPLE_SIGNING_IDENTITY
require_env APPLE_API_KEY_BASE64
require_env APPLE_API_KEY_ID
require_env APPLE_API_ISSUER
require_env PRODUCTION_LICENSE_PUBLIC_KEY_BASE64
require_env PRODUCTION_LICENSE_PUBLIC_KEY_SHA256

app_dir="${REPLYBOT_APP_DIR:-${builder_root}/replybot}"
assets_dir="${REPLYBOT_ASSETS_DIR:-${builder_root}/assets}"
[[ -f "${app_dir}/package.json" ]] || die "ReplyBot source is missing: ${app_dir}"
[[ -f "${app_dir}/apps/desktop/forge.config.js" ]] || die "ReplyBot Forge configuration is missing"

temporary_root="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/sengclaw-builder.XXXXXX")"
certificate_path="${temporary_root}/replybot-developer-id.p12"
keychain_path="${temporary_root}/replybot-signing.keychain-db"
api_key_path="${temporary_root}/AuthKey_${APPLE_API_KEY_ID}.p8"
production_public_key_path="${temporary_root}/production-license-public.pem"
keychain_created=0

cleanup() {
  if [[ "$keychain_created" == "1" ]]; then
    security delete-keychain "$keychain_path" >/dev/null 2>&1 || true
  fi
  find "$temporary_root" -type f -exec chmod u+w {} + 2>/dev/null || true
  rm -rf "$temporary_root"
}
trap cleanup EXIT

decode_base64_env BUILD_CERTIFICATE_BASE64 "$certificate_path"
decode_base64_env APPLE_API_KEY_BASE64 "$api_key_path"
decode_base64_env PRODUCTION_LICENSE_PUBLIC_KEY_BASE64 "$production_public_key_path"
chmod 600 "$certificate_path" "$api_key_path"
chmod 644 "$production_public_key_path"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$keychain_path"
keychain_created=1
security set-keychain-settings -lut 21600 "$keychain_path"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$keychain_path"
security import "$certificate_path" -P "$P12_PASSWORD" -A -t cert -f pkcs12 -k "$keychain_path"
security set-key-partition-list -S apple-tool:,apple: -k "$KEYCHAIN_PASSWORD" "$keychain_path"
security list-keychains -d user -s "$keychain_path"
security find-identity -v -p codesigning "$keychain_path"

mkdir -p "$assets_dir"

pushd "$app_dir" >/dev/null
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm web:build
pnpm verify:recovery

REPLYBOT_RELEASE=1 \
APPLE_SIGNING_IDENTITY="$APPLE_SIGNING_IDENTITY" \
APPLE_API_KEY_PATH="$api_key_path" \
APPLE_API_KEY_ID="$APPLE_API_KEY_ID" \
APPLE_API_ISSUER="$APPLE_API_ISSUER" \
REPLYBOT_PRODUCTION_PUBLIC_KEY="$production_public_key_path" \
REPLYBOT_PRODUCTION_PUBLIC_KEY_SHA256="$PRODUCTION_LICENSE_PUBLIC_KEY_SHA256" \
  pnpm --filter @replybot/desktop make --arch=arm64

release_version="$(node -p "require('./apps/desktop/package.json').version")"
source_dmg="$(find apps/desktop/out/make -type f -name '*.dmg' -print -quit)"
[[ -n "$source_dmg" && -f "$source_dmg" ]] || die "Forge did not produce a DMG"
artifact_path="${assets_dir}/ReplyBot-${release_version}-arm64.dmg"
cp "$source_dmg" "$artifact_path"
popd >/dev/null

REPLYBOT_SOURCE_DIR="$app_dir" "${script_dir}/verify-replybot-macos.sh" "$artifact_path"
printf 'ReplyBot release artifact: %s\n' "$artifact_path"
