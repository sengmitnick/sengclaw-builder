#!/usr/bin/env bash

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1"
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "required environment variable is missing: ${name}"
}

decode_base64_env() {
  local name="$1"
  local output_path="$2"
  local encoded="${!name:-}"

  [[ -n "$encoded" ]] || die "cannot decode empty environment variable: ${name}"
  if printf '%s' "$encoded" | base64 --decode > "$output_path" 2>/dev/null; then
    return 0
  fi
  printf '%s' "$encoded" | base64 -D > "$output_path"
}

