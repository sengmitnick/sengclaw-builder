# ReplyBot Web Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use box:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the private ReplyBot website source into a versioned GHCR image with GitHub Actions and deploy one healthy production instance to Dokploy at `reply.sengclaw.com`.

**Architecture:** The public Builder uses a repository-scoped read-only Deploy Key to check out private ReplyBot source, validates the web package, and publishes immutable plus rolling Linux AMD64 image tags. Dokploy pulls the private image through its existing GHCR registry, injects the existing PostgreSQL internal URL and administrator credential, and persists License signing keys on an independent `/data` volume.

**Tech Stack:** GitHub Actions, Docker Buildx, GHCR, Node.js 22, pnpm 11, PostgreSQL 16, Dokploy, Traefik/Let's Encrypt, Vitest.

---

### Task 1: Specify the Builder web-image workflow with a failing test

**Files:**
- Create: `tests/web-image-workflow.test.mjs`
- Create: `.github/workflows/replybot-web.yml`
- Modify: `.github/workflows/replybot-macos.yml`
- Modify: `README.md`

- [ ] **Step 1: Write a static test for the production contract**

Create a Node test that reads `.github/workflows/replybot-web.yml` and requires: `workflow_dispatch`, no pull-request or push trigger, `contents: read`, `packages: write`, Linux AMD64, `REPLYBOT_DEPLOY_KEY`, private checkout with `lfs: false`, `pnpm test`, `pnpm typecheck`, Docker Buildx, GHCR login, and both `production` and source-SHA tags. Extend the macOS workflow assertion to require the same Deploy Key instead of a personal token.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/web-image-workflow.test.mjs
```

Expected: FAIL because `.github/workflows/replybot-web.yml` does not exist.

- [ ] **Step 3: Implement the minimal manual workflow**

Create a workflow that checks out Builder, checks out `${{ vars.REPLYBOT_REPOSITORY }}` at the requested ref through `${{ secrets.REPLYBOT_DEPLOY_KEY }}`, installs Node 22 and pnpm 11.25.0, runs ReplyBot tests/typecheck/web build, logs in to `ghcr.io` using `${{ github.actor }}` and `${{ secrets.GITHUB_TOKEN }}`, then builds `replybot/apps/web/Dockerfile` and pushes:

```text
ghcr.io/sengmitnick/replybot-web:production
ghcr.io/sengmitnick/replybot-web:sha-<ReplyBot short SHA>
```

Use repository permissions `contents: read` and `packages: write`, `linux/amd64`, provenance, and build-cache export/import. Update the macOS private checkout to use the same read-only Deploy Key and document the new workflow and image contract.

- [ ] **Step 4: Verify GREEN and workflow syntax**

Run:

```bash
node --test tests/*.test.mjs
bash -n scripts/*.sh
ruby -e "require 'yaml'; Dir['.github/workflows/*.yml'].each { |f| YAML.load_file(f); puts \"#{f}: ok\" }"
```

Expected: all tests pass and both workflow files parse.

- [ ] **Step 5: Commit Builder changes**

```bash
git add .github README.md tests
git commit -m "ci: publish ReplyBot web image"
```

### Task 2: Optimize and verify the ReplyBot web Docker image

**Files:**
- Modify: `/Users/seng/Documents/GitHub/replybot/apps/web/src/server/deployment.test.ts`
- Modify: `/Users/seng/Documents/GitHub/replybot/apps/web/Dockerfile`
- Modify: `/Users/seng/Documents/GitHub/replybot/.dockerignore`
- Modify: `/Users/seng/Documents/GitHub/replybot/README.md`

- [ ] **Step 1: Extend the deployment test**

Require the Docker context to exclude the desktop app, recovered bundles, models, and Chromium. Require the Dockerfile to install only the web package and its workspace dependencies, build the web package, deploy only production files, run as `node`, expose `4174`, and persist runtime data under `/data`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm vitest run apps/web/src/server/deployment.test.ts
```

Expected: FAIL because desktop payload exclusions and filtered installation are absent.

- [ ] **Step 3: Implement the optimized Docker boundary**

Add explicit desktop/LFS/output exclusions to `.dockerignore`. Update the Dockerfile build stage to copy workspace manifests first, install only `@replybot/web...`, copy only `apps/web` and `packages/shared`, build the web package, and deploy production dependencies to `/opt/replybot-web`. Preserve the unprivileged runtime image, `/data`, and port `4174`.

- [ ] **Step 4: Run unit and production build verification**

Run:

```bash
pnpm vitest run apps/web/src/server/deployment.test.ts
pnpm test
pnpm typecheck
pnpm web:build
docker build --platform linux/amd64 -f apps/web/Dockerfile -t replybot-web:deployment-check .
```

Expected: all commands exit zero and the Docker build context does not transfer desktop payloads.

- [ ] **Step 5: Run the container against disposable PostgreSQL**

Start an isolated PostgreSQL container and the built image on a temporary Docker network using generated credentials, wait for `http://127.0.0.1:<temporary-port>/api/health`, verify an HTTP 200 response, then remove the disposable containers and network while retaining no production data.

- [ ] **Step 6: Commit ReplyBot changes**

```bash
git add .dockerignore apps/web/Dockerfile apps/web/src/server/deployment.test.ts README.md
git commit -m "build: optimize ReplyBot web container"
```

### Task 3: Configure least-privilege GitHub access and publish the image

**Files:**
- No repository files; GitHub repository settings only.

- [ ] **Step 1: Create a dedicated read-only Deploy Key**

Generate an Ed25519 keypair in a temporary directory, add the public key to `sengmitnick/replybot` without write access, upload the private key as the `REPLYBOT_DEPLOY_KEY` Builder repository secret, and securely delete the temporary key material after GitHub confirms both operations.

- [ ] **Step 2: Push both repositories and verify remote commits**

Push ReplyBot `main` and Builder `main`, then compare each local `HEAD` with `git ls-remote origin refs/heads/main`.

- [ ] **Step 3: Dispatch the web-image workflow**

Run:

```bash
gh workflow run replybot-web.yml --repo sengmitnick/sengclaw-builder -f ref=main
```

Wait for completion and inspect the job logs. Expected: tests pass and both GHCR tags are published. Do not dispatch the macOS signing workflow.

### Task 4: Create the Dokploy production application

**Files:**
- No repository files; Dokploy configuration only.

- [ ] **Step 1: Create a new application**

In project `sengclaw`, environment `production`, create application `replybot-web` from the existing GitHub Container Registry using image `ghcr.io/sengmitnick/replybot-web:production` and container port `4174`.

- [ ] **Step 2: Configure runtime environment without exposing secrets**

Copy the existing `reply` PostgreSQL service's internal connection URL into `DATABASE_URL`. Generate a strong administrator password, store it in the macOS login keychain under service `ReplyBot Production Admin`, and paste it into `REPLYBOT_WEB_ADMIN_PASSWORD`. Set:

```text
NODE_ENV=production
REPLYBOT_WEB_HOST=0.0.0.0
REPLYBOT_WEB_PORT=4174
REPLYBOT_WEB_DATA_DIR=/data
REPLYBOT_WEB_SECURE_COOKIE=1
```

- [ ] **Step 3: Add persistence and domain routing**

Mount a named persistent volume at `/data`. Add `reply.sengclaw.com`, HTTPS, and container port `4174`. Do not initialize any License key.

- [ ] **Step 4: Deploy and inspect logs**

Deploy the application and verify startup migrations, database connection, and the health-check response. If image pull fails, verify the existing Dokploy GHCR registry credential has `read:packages` access to `sengmitnick/replybot-web` before changing application settings.

### Task 5: Complete DNS and production verification

**Files:**
- No repository files; DNS and live endpoint verification only.

- [ ] **Step 1: Publish DNS**

Create DNS record `A reply.sengclaw.com 119.28.113.40`. Wait until an external DNS-over-HTTPS resolver returns that address.

- [ ] **Step 2: Verify the live service**

Confirm `https://reply.sengclaw.com/api/health` returns HTTP 200, the homepage loads, `/admin` accepts the stored administrator password, the certificate is valid, and Dokploy reports one running replica.

- [ ] **Step 3: Record the remaining License bootstrap**

Report that the website is online but Production License keys remain uninitialized. The next separately confirmed operation is to initialize `production`, back up `/data`, and copy only the public key and fingerprint into the macOS Builder environment.
