# ReplyBot Web Production Deployment Design

**Date:** 2026-10-10

## Goal

Publish the ReplyBot website and License service as a production container built by GitHub Actions and run it as a new Dokploy application at `https://reply.sengclaw.com`.

## Repository and trust boundaries

- `sengmitnick/replybot` remains private and contains the website source and Dockerfile. It does not host GitHub Actions.
- `sengmitnick/sengclaw-builder` remains public and owns the auditable image build workflow.
- A dedicated read-only GitHub Deploy Key gives Builder access only to the private ReplyBot repository. No broad personal access token is required.
- GitHub's ephemeral workflow token may push only the resulting image to GHCR. Runtime database and administrator credentials never enter the image or either repository.
- The Production License private key is created later by the running website and persists only in the Dokploy `/data` volume.

## Build and image lifecycle

The Builder exposes a manual `ReplyBot Web Image` workflow with a ReplyBot ref input. It checks out the requested private source revision without downloading desktop Git LFS payloads, runs the web tests and type check, then builds the production Dockerfile on Linux AMD64.

Successful builds publish a private `ghcr.io/sengmitnick/replybot-web` image with both an immutable source-commit tag and the rolling `production` tag. Dokploy tracks `production` for normal releases while the immutable tag provides rollback evidence.

The web Docker context excludes desktop recovery bundles, Chromium, models, local outputs, and secrets. The runtime image contains only the deployed website package and runs as the unprivileged Node user.

## Dokploy topology

Dokploy runs one `replybot-web` application from the existing GitHub Container Registry integration. It does not create another database.

The application receives the existing `reply` PostgreSQL internal connection URL through `DATABASE_URL`. It listens on container port `4174`, uses secure cookies, and mounts a dedicated persistent volume at `/data`. `/data` contains the administrator-password file when applicable and both License signing keypairs; PostgreSQL contains License issuance history.

The public domain routes HTTPS traffic for `reply.sengclaw.com` to port `4174`. DNS must publish an A record for `reply.sengclaw.com` pointing to the Dokploy server at `119.28.113.40` before certificate issuance can succeed.

## Credentials

- `REPLYBOT_DEPLOY_KEY`: Builder repository secret containing the private half of the dedicated read-only Deploy Key.
- `DATABASE_URL`: Dokploy environment variable copied from the existing PostgreSQL service's internal connection URL.
- `REPLYBOT_WEB_ADMIN_PASSWORD`: randomly generated production administrator password stored in Dokploy and the local macOS login keychain, never in Git.
- `REPLYBOT_WEB_SECURE_COOKIE=1`: required because the public endpoint is HTTPS.

The website can start while the License key directory is empty. Production License initialization happens only after HTTPS and administrator login have been verified.

## Failure behavior and rollback

- Missing source access, failed tests, or a failed image build prevents GHCR publication.
- Missing database or administrator variables makes the website fail closed at startup.
- Dokploy keeps the application on the previous image until a new image has been published and deployed successfully.
- A failed release can be rolled back by selecting the previous immutable image tag without changing the PostgreSQL or `/data` volumes.
- The database and `/data` volume must be backed up together after Production License initialization.

## Acceptance criteria

1. Builder tests prove the web workflow is manual, has least-privilege permissions, checks out ReplyBot through the dedicated Deploy Key, runs verification, and publishes both image tags.
2. The optimized ReplyBot Docker image builds successfully without desktop payloads and its `/api/health` endpoint succeeds against PostgreSQL.
3. GHCR contains the private ReplyBot web image produced by the successful workflow.
4. Dokploy runs one healthy `replybot-web` instance using the existing `reply` PostgreSQL service and a persistent `/data` volume.
5. `https://reply.sengclaw.com/api/health`, the homepage, and `/admin` work over HTTPS after DNS propagation.
6. No Production License signing key is initialized as part of deployment.
