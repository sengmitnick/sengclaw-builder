#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${script_dir}/lib.sh"

[[ $# -eq 1 ]] || die "usage: $0 /path/to/ReplyBot.dmg"
dmg_path="$1"
[[ -f "$dmg_path" ]] || die "DMG not found: ${dmg_path}"

for command_name in codesign file hdiutil shasum spctl xcrun; do
  require_command "$command_name"
done

mount_path="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/replybot-dmg.XXXXXX")"
device=""
cleanup() {
  if [[ -n "$device" ]]; then
    hdiutil detach "$device" -quiet || true
  fi
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
shasum -a 256 "$dmg_path" > "${dmg_path}.sha256"

printf 'Verified signed and notarized ReplyBot DMG: %s\n' "$dmg_path"

