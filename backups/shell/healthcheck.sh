#!/usr/bin/env bash
# Docker healthcheck for the backup service: healthy while a scheduled or
# manual backup succeeded within BACKUP_MAX_AGE_HOURS (default 26), or while
# the container is younger than that (no backup has had a chance to run yet).
set -uo pipefail
max_age=$(( ${BACKUP_MAX_AGE_HOURS:-26} * 3600 ))
now="$(date +%s)"
marker="${BACKUP_DIR:-/backups}/.last-success"
if [ -f "$marker" ]; then
    last="$(cat "$marker" 2>/dev/null || echo 0)"
    [[ "$last" =~ ^[0-9]+$ ]] || last=0
    if [ $(( now - last )) -le "$max_age" ]; then
        exit 0
    fi
fi
started="$(stat -c %Y /proc/1 2>/dev/null || echo "$now")"
if [ $(( now - started )) -le "$max_age" ]; then
    exit 0
fi
echo "no successful backup in the last ${BACKUP_MAX_AGE_HOURS:-26}h (see docker logs)" >&2
exit 1
