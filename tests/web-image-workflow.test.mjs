import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

test("web image workflow is manual, least-privilege, verified, and immutable", () => {
  const source = read(".github/workflows/replybot-web.yml");

  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /pull_request:/);
  assert.doesNotMatch(source, /^  push:/m);
  assert.match(source, /contents: read/);
  assert.match(source, /packages: write/);
  assert.match(source, /runs-on: ubuntu-24\.04/);
  assert.match(source, /platforms: linux\/amd64/);
  assert.match(source, /services:/);
  assert.match(source, /image: postgres:16-alpine/);
  assert.match(source, /REPLYBOT_TEST_DATABASE_URL: postgresql:\/\/replybot:ci-only@127\.0\.0\.1:5432\/replybot_test/);
  assert.match(source, /repository: \$\{\{ vars\.REPLYBOT_REPOSITORY \}\}/);
  assert.match(source, /ssh-key: \$\{\{ secrets\.REPLYBOT_DEPLOY_KEY \}\}/);
  assert.match(source, /lfs: false/);
  assert.match(source, /pnpm test/);
  assert.match(source, /pnpm typecheck/);
  assert.match(source, /pnpm web:build/);
  assert.match(source, /version: 11\.28\.4/);
  assert.match(source, /docker\/setup-buildx-action@v4/);
  assert.match(source, /docker\/login-action@v4/);
  assert.match(source, /docker\/build-push-action@v7/);
  assert.match(source, /ghcr\.io\/sengmitnick\/replybot-web:production/);
  assert.match(source, /ghcr\.io\/sengmitnick\/replybot-web:sha-\$\{\{ steps\.source\.outputs\.short_sha \}\}/);
  assert.match(source, /provenance: mode=max/);
});
