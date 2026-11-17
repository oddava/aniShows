#!/usr/bin/env bash
#
# Runs ON THE VPS, sent over SSH by .github/workflows/deploy.yml:
#   ssh vps bash -s -- <app_dir> <commit> < scripts/deploy/remote_deploy.sh
#
# 1. checks the server's checkout has no local edits to tracked files, and
#    takes the deploy lock (backups-data/.deploy.lock, shared with
#    deploy-prod.sh and restore.sh) BEFORE touching the checkout
# 2. fetches and checks out <commit> (detached), so the compose files,
#    Caddyfile and deploy script match the images built from that commit
# 3. runs deploy-prod.sh (via bash: no exec bit needed) detached from the SSH
#    session (setsid + nohup, holding the lock it inherits), streaming its
#    output; if the runner's connection drops, the deploy still finishes, and
#    its log is in backups-data/deploy-logs/. With BACKEND_TAG/FRONTEND_TAG=
#    sha-<7 chars>, deploy-prod.sh
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

# The deploy lock, before the checkout moves: a manual deploy or restore in
# progress keeps its scripts and compose files. deploy-prod.sh inherits the
# lock (file descriptor 8, DEPLOY_LOCK_HELD=1) instead of taking it again.
mkdir -p backups-data/deploy-logs
if command -v flock >/dev/null 2>&1; then
    exec 8>>backups-data/.deploy.lock
    flock -n 8 || die "a deploy or restore is running on the server (backups-data/.deploy.lock); try again when it ends"
    export DEPLOY_LOCK_HELD=1
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

# Detached from this SSH session: a dropped connection (SIGHUP) must not kill
# the deploy mid-migration. stdin is this script itself (ssh ... bash -s), so
# the child reads /dev/null.
out="backups-data/deploy-logs/remote-$(date -u +%Y%m%dT%H%M%SZ)-${short}.out"
status_file="${out%.out}.status"
# The file exists before tail starts: GNU tail -f gives up on a missing file.
: >"$out"
# A target older than the lock hand-over (no DEPLOY_LOCK_HELD in its
# deploy-prod.sh) takes the lock itself: release ours, or it would refuse.
if ! grep -q DEPLOY_LOCK_HELD deploy-prod.sh; then
    unset DEPLOY_LOCK_HELD
    exec 8>&-
fi
detach=()
command -v setsid >/dev/null 2>&1 && detach=(setsid)
BACKEND_TAG="sha-${short}" FRONTEND_TAG="sha-${short}" STATUS_FILE="$status_file"     nohup "${detach[@]}" bash -c 'bash ./deploy-prod.sh; echo $? > "$STATUS_FILE"'     </dev/null >"$out" 2>&1 &
pid=$!
log "deploy-prod.sh is running detached (pid ${pid}); output: ${APP_DIR}/${out}"
tail -n +1 -f --pid="$pid" "$out" 2>/dev/null || true
while kill -0 "$pid" 2>/dev/null; do sleep 1; done
status="$(cat "$status_file" 2>/dev/null || echo 1)"
rm -f "$status_file"
if [ "$status" -ne 0 ]; then
    echo >&2
    echo "[remote-deploy] deploy-prod.sh failed (exit $status). Its output above has the rollback recipe." >&2
    echo "[remote-deploy] The checkout is now ${target}; the previous one was ${previous}:" >&2
    echo "[remote-deploy]   cd $APP_DIR && git checkout --detach ${previous}" >&2
    exit "$status"
fi

log "deployed ${target}"
