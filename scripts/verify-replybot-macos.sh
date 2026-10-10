#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${script_dir}/lib.sh"

[[ $# -eq 1 ]] || die "usage: $0 /path/to/ReplyBot.dmg"
dmg_path="$1"
[[ -f "$dmg_path" ]] || die "DMG not found: ${dmg_path}"

for command_name in codesign file find grep hdiutil node shasum spctl xcrun; do
  require_command "$command_name"
done

mount_path="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/replybot-dmg.XXXXXX")"
smoke_root="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/replybot-smoke.XXXXXX")"
device=""
smoke_pid=""
cleanup() {
  if [[ -n "$smoke_pid" ]] && kill -0 "$smoke_pid" 2>/dev/null; then
    kill -TERM "$smoke_pid" 2>/dev/null || true
    wait "$smoke_pid" 2>/dev/null || true
  fi
  if [[ -n "$device" ]]; then
    hdiutil detach "$device" -quiet || true
  fi
  rm -rf "$smoke_root"
  rmdir "$mount_path" 2>/dev/null || true
}
trap cleanup EXIT

hdiutil verify "$dmg_path"
device="$(hdiutil attach -readonly -nobrowse -mountpoint "$mount_path" "$dmg_path" | awk '/^\/dev\// { print $1; exit }')"
[[ -n "$device" ]] || die "DMG did not attach"

app_path="${mount_path}/ReplyBot.app"
[[ -d "$app_path" ]] || die "ReplyBot.app is missing from the DMG"

bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "${app_path}/Contents/Info.plist")"
[[ "$bundle_id" == "com.sengclaw.reply" ]] || die "unexpected bundle identifier: ${bundle_id}"

executable_description="$(file "${app_path}/Contents/MacOS/ReplyBot")"
[[ "$executable_description" == *"Mach-O 64-bit executable arm64"* ]] || die "ReplyBot executable is not arm64"

codesign --verify --deep --strict --verbose=2 "$app_path"
spctl --assess --type execute --verbose=4 "$app_path"
xcrun stapler validate "$app_path"

source_dir="${REPLYBOT_SOURCE_DIR:-${script_dir}/../replybot}"
asar_cli="${source_dir}/node_modules/@electron/asar/bin/asar.js"
[[ -f "$asar_cli" ]] || die "Electron ASAR CLI is missing: ${asar_cli}"

asar_list="${smoke_root}/app-asar.txt"
node "$asar_cli" list "${app_path}/Contents/Resources/app.asar" > "$asar_list"
for runtime_manifest in \
  /node_modules/better-sqlite3/package.json \
  /node_modules/@huggingface/transformers/package.json \
  /node_modules/@lancedb/lancedb/package.json \
  /node_modules/whatsapp-web.js/package.json; do
  grep -Fq "$runtime_manifest" "$asar_list" || die "Packaged runtime dependency is missing: ${runtime_manifest}"
done

unpacked_root="${app_path}/Contents/Resources/app.asar.unpacked/node_modules"
better_sqlite_binary="$(find "$unpacked_root" -type f -path '*/better-sqlite3/prebuilds/darwin-arm64.node' -print -quit)"
[[ -n "$better_sqlite_binary" ]] || die "better-sqlite3 arm64 binary is not unpacked"
lancedb_binary="$(find "$unpacked_root" -type f -path '*/@lancedb/lancedb-darwin-arm64/lancedb.darwin-arm64.node' -print -quit)"
[[ -n "$lancedb_binary" ]] || die "LanceDB arm64 binary is not unpacked"

smoke_log="${smoke_root}/replybot.log"
"${app_path}/Contents/MacOS/ReplyBot" --user-data-dir="${smoke_root}/user-data" > "$smoke_log" 2>&1 &
smoke_pid=$!
for ((attempt = 0; attempt < 20; attempt += 1)); do
  if ! kill -0 "$smoke_pid" 2>/dev/null; then
    wait "$smoke_pid" || true
    sed -n '1,200p' "$smoke_log" >&2
    die "Packaged ReplyBot exited during startup smoke test"
  fi
  sleep 0.5
done

if grep -Eiq "Cannot find module|Uncaught Exception|JavaScript error occurred" "$smoke_log"; then
  sed -n '1,200p' "$smoke_log" >&2
  die "Packaged ReplyBot reported a main-process startup error"
fi

kill -TERM "$smoke_pid"
wait "$smoke_pid" 2>/dev/null || true
smoke_pid=""

shasum -a 256 "$dmg_path" > "${dmg_path}.sha256"

printf 'Verified signed and notarized ReplyBot DMG: %s\n' "$dmg_path"
