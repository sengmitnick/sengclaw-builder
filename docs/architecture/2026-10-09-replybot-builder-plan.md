# SengClaw ReplyBot Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use box:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move ReplyBot macOS release automation into a public `sengclaw-builder` repository while publishing ReplyBot itself as a private, Git-LFS-backed source repository.

**Architecture:** The public builder manually checks out a requested ref from the private ReplyBot repository, starts PostgreSQL for integration tests, injects release-only credentials on an ephemeral Apple Silicon runner, and emits a verified DMG artifact. ReplyBot retains Forge packaging logic but contains no GitHub Actions; its oversized runtime assets are stored through Git LFS.

**Tech Stack:** Bash, Node.js 22 built-in test runner, GitHub Actions, pnpm 11, Git LFS, Electron Forge 7, PostgreSQL 16, Apple `codesign`/`notarytool`/`stapler`.

---

### Task 1: Create and publish the public builder skeleton

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `AGENTS.md`

- [ ] Add a `.gitignore` that excludes `assets/`, checked-out `replybot/`, temporary credentials, logs, and macOS metadata.
- [ ] Document the public-builder/private-source boundary, the two-phase License bootstrap, required Secrets, local validation, and manual build entry point.
- [ ] Add repository instructions that forbid committing credentials and require shell/static validation before publishing.
- [ ] Run `git diff --check` and verify no whitespace errors.
- [ ] Commit with `docs: add builder repository guidance`.
- [ ] Create public repository `sengmitnick/sengclaw-builder`, push `main`, and create the `macos-release` environment.

### Task 2: Add fail-closed builder validation with TDD

**Files:**
- Create: `tests/builder-config.test.mjs`
- Create: `scripts/lib.sh`
- Create: `scripts/build-replybot-macos.sh`
- Create: `scripts/verify-replybot-macos.sh`

- [ ] Write Node assertions requiring the build script to validate all Apple and License inputs, force `REPLYBOT_RELEASE=1`, run ReplyBot tests/build, and make only arm64; require the verification script to check DMG integrity, strict code signing, Gatekeeper, stapler, and SHA-256.
- [ ] Run `node --test tests/builder-config.test.mjs` and verify RED because the scripts do not exist.
- [ ] Implement shared error/command/environment validation in `scripts/lib.sh` without printing secret values.
- [ ] Implement `scripts/build-replybot-macos.sh` to validate the checked-out app, stage credentials under `RUNNER_TEMP`, import the P12 into a temporary keychain, materialize the Apple API key and Production public key, run tests and production builds, then call Forge for arm64.
- [ ] Implement `scripts/verify-replybot-macos.sh` to mount the DMG read-only, verify the app identity and arm64 executable, run `codesign`, `spctl`, and `stapler`, then generate a checksum.
- [ ] Run `bash -n scripts/*.sh` and `node --test tests/builder-config.test.mjs`; expect all checks to pass.
- [ ] Commit with `feat: add fail-closed ReplyBot macOS builder`.

### Task 3: Add the public GitHub Actions workflow with TDD

**Files:**
- Modify: `tests/builder-config.test.mjs`
- Create: `.github/workflows/replybot-macos.yml`

- [ ] Extend the test to require `workflow_dispatch`, reject `pull_request`, require `macos-15`, `macos-release`, private source checkout with LFS, PostgreSQL startup, pinned Node/pnpm setup, the builder script, artifact upload, and read-only repository permissions.
- [ ] Run the focused test and verify RED because the workflow does not exist.
- [ ] Implement a manual workflow with a required ReplyBot ref input, private checkout using `REPLYBOT_REPO_TOKEN`, LFS enabled, PostgreSQL 16, dependency installation, build/verification scripts, and DMG/checksum artifact upload.
- [ ] Parse the workflow as YAML and run the static test; expect both to pass.
- [ ] Commit with `ci: add ReplyBot macOS release workflow` and push builder `main`.

### Task 4: Prepare ReplyBot for a private remote and remove Actions

**Files:**
- Delete: `/Users/seng/Documents/GitHub/replybot/.github/workflows/release-macos.yml`
- Create: `/Users/seng/Documents/GitHub/replybot/.gitattributes`
- Modify: `/Users/seng/Documents/GitHub/replybot/README.md`

- [ ] Add Git LFS rules for the ONNX model and bundled Chromium executable.
- [ ] Remove the in-repository release workflow and update documentation to point to `sengmitnick/sengclaw-builder`.
- [ ] Confirm `.data`, `.env`, release staging, output directories, Apple credentials, and private License keys remain ignored.
- [ ] Scan tracked candidates for private-key and token patterns; stop if any credential is found.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm web:build`, and `pnpm verify:recovery` against PostgreSQL.
- [ ] Commit the complete recovered project as the initial ReplyBot source commit.

### Task 5: Publish private ReplyBot and verify cross-repository inputs

- [ ] Create private repository `sengmitnick/replybot` and push `main` including Git LFS objects.
- [ ] Confirm GitHub reports `sengmitnick/replybot` private and `sengmitnick/sengclaw-builder` public.
- [ ] Confirm ReplyBot has no workflow files and Builder has exactly the manual macOS workflow.
- [ ] Configure non-secret Builder variable `REPLYBOT_REPOSITORY=sengmitnick/replybot` if the workflow does not use a fixed repository name.
- [ ] Verify the `macos-release` environment exists without attempting a signed run before the user finishes Secrets.
- [ ] Report the exact remaining Secret names and the manual workflow command; do not trigger a release without explicit user confirmation.
