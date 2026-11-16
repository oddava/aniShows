#!/usr/bin/env bash
#
# Remove this project's old images on a shared host. Candidates are only images
# labelled app.anishows.component (backend, frontend, backup); kept are the
# current and previous release (KEEP_REFS, KEEP_IDS), the local rollback tag,
# and every image any container on the host uses. Other projects' images are
# never candidates. Called by deploy-prod.sh after a successful deploy.
#
#   KEEP_REFS="ghcr.io/oddava/anishows-backend:sha-abc ..." KEEP_IDS="sha256:..." \
#       scripts/deploy/prune_images.sh

set -euo pipefail

declare -A keep=()
ref="" id=""
for ref in ${KEEP_REFS:-} ghcr.io/oddava/anishows-backend:rollback; do
    if id="$(docker image inspect --format '{{.Id}}' "$ref" 2>/dev/null)" && [ -n "$id" ]; then
        keep["$id"]=1
    fi
done
for id in ${KEEP_IDS:-}; do
    keep["$id"]=1
done
while IFS= read -r id; do
    [ -n "$id" ] && keep["$id"]=1
done < <(docker ps -aq | xargs -r docker inspect --format '{{.Image}}' 2>/dev/null || true)

removed=0
while IFS= read -r id; do
    [ -n "$id" ] || continue
    [ -n "${keep[$id]:-}" ] && continue
    if docker rmi -f "$id" >/dev/null 2>&1; then
        echo "    removed ${id:7:12}"
        removed=$((removed + 1))
    fi
done < <(docker images --no-trunc -q --filter label=app.anishows.component | sort -u)
docker image prune -f --filter label=app.anishows.component >/dev/null 2>&1 || true
echo "    ${removed} old image(s) removed; kept ${#keep[@]} in use or current/previous"
