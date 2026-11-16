#!/usr/bin/env bash
#
# Migration-reversibility gate (overview section 7 policy, G7 spec "Migration
# plan"). On a scratch database: apply every migration, then for each app that
# gained migrations since BASE_REF, migrate it back to its leaf at BASE_REF and
# forward again. Fails on the first irreversible or broken step.
#
#   scripts/deploy/check_migrations_reversible.sh [BASE_REF]   # default revamp/base
#
# Runs inside a backend container whose settings point at a throwaway database
# (the test compose service does: TEST_DB_* + root.settings.test). From the
# repo root on the host:
#   docker compose -p anishows-check --profile test run --rm test \
#       bash scripts/deploy/check_migrations_reversible.sh revamp/base
# The script needs git (for BASE_REF) or MIGRATION_BASE_LEAVES="app:0001_x ...".
# Containers usually have no git: compute the leaves on the host and pass them:
#   leaves="$(scripts/deploy/check_migrations_reversible.sh --print-base-leaves revamp/base)"
#   docker compose ... run --rm -e MIGRATION_BASE_LEAVES="$leaves" test \
#       bash scripts/deploy/check_migrations_reversible.sh

set -euo pipefail

PRINT_ONLY=0
if [ "${1:-}" = "--print-base-leaves" ]; then
    PRINT_ONLY=1
    shift
fi
BASE_REF="${1:-revamp/base}"
MANAGE=(python manage.py)

log() { echo "[reversible] $*"; }
die() { echo "[reversible] FAIL: $*" >&2; exit 1; }

# Leaf migration of each app at BASE_REF: the highest-numbered file.
declare -A base_leaf=()
if [ -n "${MIGRATION_BASE_LEAVES:-}" ]; then
    for pair in $MIGRATION_BASE_LEAVES; do base_leaf["${pair%%:*}"]="${pair#*:}"; done
else
    command -v git >/dev/null || die "git not available; set MIGRATION_BASE_LEAVES"
    git rev-parse --verify --quiet "$BASE_REF" >/dev/null || die "unknown ref $BASE_REF"
    while IFS= read -r path; do
        app="$(basename "$(dirname "$(dirname "$path")")")"
        name="$(basename "$path" .py)"
        if [ -z "${base_leaf[$app]:-}" ] || [[ "$name" > "${base_leaf[$app]}" ]]; then
            base_leaf["$app"]="$name"
        fi
    done < <(git ls-tree -r --name-only "$BASE_REF" -- apps | grep -E '^apps/[^/]+/migrations/[0-9]{4}_.+\.py$')
fi

if [ "$PRINT_ONLY" = 1 ]; then
    for app in "${!base_leaf[@]}"; do printf '%s:%s ' "$app" "${base_leaf[$app]}"; done
    echo
    exit 0
fi

# Apps whose migration set differs from BASE_REF.
mapfile -t changed_apps < <(
    for dir in apps/*/migrations; do
        app="$(basename "$(dirname "$dir")")"
        current="$(find "$dir" -maxdepth 1 -name '[0-9][0-9][0-9][0-9]_*.py' -printf '%f\n' | sort | tail -n1)"
        current="${current%.py}"
        [ -n "$current" ] || continue
        [ "$current" != "${base_leaf[$app]:-zero}" ] && echo "$app"
    done | sort -u
)

log "applying every migration"
"${MANAGE[@]}" migrate --noinput >/dev/null

if [ "${#changed_apps[@]}" -eq 0 ]; then
    log "no app gained migrations since $BASE_REF: nothing to reverse"
    exit 0
fi

for app in "${changed_apps[@]}"; do
    target="${base_leaf[$app]:-zero}"
    log "$app: back to $target, then forward"
    "${MANAGE[@]}" migrate "$app" "$target" --noinput || die "$app cannot migrate back to $target"
    "${MANAGE[@]}" migrate --noinput >/dev/null || die "$app cannot migrate forward again"
done
"${MANAGE[@]}" migrate --check --noinput >/dev/null || die "unapplied migrations remain"
log "OK: ${changed_apps[*]} reverse and re-apply cleanly"
