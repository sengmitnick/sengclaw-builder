# AGENTS.md

This repository is the public, auditable release control plane for ReplyBot. It does not contain the private ReplyBot source tree or any signing credential.

## Working rules

- Keep workflows manual and fail closed. Never add a `pull_request` trigger to a job that can access release secrets.
- Never commit Apple `.p8`/`.p12` files, access tokens, keychain files, License private keys, staged Production public keys, or generated artifacts.
- Treat `sengmitnick/replybot` as a private input. Builder access must be read-only and scoped to that repository.
- Production License private keys remain only on the deployed License service. Builder receives only the public key and its expected fingerprint.
- Run `node --test tests/*.test.mjs`, `bash -n scripts/*.sh`, and workflow YAML parsing before each push.
- Do not trigger a signed build or publish a Release without explicit user confirmation.
- Code comments are written in English. User-facing documentation may be Chinese.

