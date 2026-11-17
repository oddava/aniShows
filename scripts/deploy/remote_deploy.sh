#!/usr/bin/env bash
#
# Runs ON THE VPS, sent over SSH by .github/workflows/deploy.yml:
#   ssh vps bash -s -- <app_dir> <commit> < scripts/deploy/remote_deploy.sh
#
# 1. checks the server's checkout has no local edits to tracked files
# 2. fetches and checks out <commit> (detached), so the compose files,
#    Caddyfile and deploy script match the images built from that commit
# 3. runs ./deploy-prod.sh with BACKEND_TAG/FRONTEND_TAG=sha-<7 chars>, which
#    pulls the images, backs the database up before any migration, migrates,
#    rolls web one replica at a time, copies the frontend, reloads Caddy and
#    runs the smoke tests: liveness and readiness, the SPA, https through the
#    host proxy's loopback port without a redirect, and PUBLIC_BASE_URL when
#    set (static files are collected in the image build)
# The workflow then checks the public health endpoint from outside.
#
# .env, backups-data/ and the Docker volumes are untracked and never touched.
# Registry access: the server is logged in to ghcr.io once (docs/deploy/DEPLOY.md).

set -euo pipefail
# Never wait for a password prompt: the server reads the repo with a deploy key
# (or anonymously when public).
export GIT_TERMINAL_PROMPT=0

APP_DIR="${1:?usage: remote_deploy.sh <app_dir> <commit>}"
COMMIT="${2:?usage: remote_deploy.sh <app_dir> <commit>}"

log() { echo "[remote-deploy] $*"; }
die() { echo "[remote-deploy] ERROR: $*" >&2; exit 1; }

[[ "$COMMIT" =~ ^[0-9a-fA-F]{7,40}$ ]] || die "commit must be a hex SHA (7-40 characters), got '$COMMIT'"
cd "$APP_DIR" 2>/dev/null || die "VPS_APP_DIR '$APP_DIR' does not exist (clone the repo there first: docs/deploy/DEPLOY.md)"
[ -d .git ] || die "$APP_DIR is not a git checkout"
[ -f .env ] || die "$APP_DIR/.env is missing (copy .env.production.example and fill it in)"

# Local edits to tracked files would be silently mixed into the release.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    git status --short --untracked-files=no >&2
    die "tracked files are modified on the server; commit or discard them first"
fi

previous="$(git rev-parse HEAD)"
log "fetching from origin"
git fetch --quiet --tags origin
if ! git rev-parse --verify --quiet "${COMMIT}^{commit}" >/dev/null; then
    # A commit not on any fetched branch (a full SHA can be fetched directly).
    git fetch --quiet origin "$COMMIT" 2>/dev/null || true
fi
target="$(git rev-parse --verify --quiet "${COMMIT}^{commit}")" \
    || die "commit $COMMIT is not in origin"
short="${target:0:7}"

log "checking out ${target} (was ${previous})"
git checkout --quiet --detach "$target"

status=0
# stdin is this script itself (ssh ... bash -s): never let a child read it.
BACKEND_TAG="sha-${short}" FRONTEND_TAG="sha-${short}" ./deploy-prod.sh </dev/null || status=$?
if [ "$status" -ne 0 ]; then
    echo >&2
    echo "[remote-deploy] deploy-prod.sh failed (exit $status). Its output above has the rollback recipe." >&2
    echo "[remote-deploy] The checkout is now ${target}; the previous one was ${previous}:" >&2
    echo "[remote-deploy]   cd $APP_DIR && git checkout --detach ${previous}" >&2
    exit "$status"
fi

log "deployed ${target}"
