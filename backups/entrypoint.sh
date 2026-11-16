#!/bin/bash
set -euo pipefail

echo "Starting Backup Service..."

# Cron jobs do not inherit the container environment reliably, so hand the
# backup settings (database, retention, off-site rclone remote) to the job
# through a private file.
ENV_FILE=/app/cron.env
umask 077
export -p | grep -E '^declare -x (POSTGRES_|PG(SSL|HOST|PORT)|BACKUP_|RCLONE_|TZ=)' >"$ENV_FILE" || true

# Daily backup at 03:00 (container time) unless BACKUP_SCHEDULE overrides it.
SCHEDULE="${BACKUP_SCHEDULE:-0 3 * * *}"
# (export -p output is bash syntax, hence bash -c.)
echo "$SCHEDULE bash -c '. $ENV_FILE && /app/shell/backup.sh daily' >> /var/log/cron.log 2>&1" > /etc/crontabs/root

# Ensure scripts are executable
chmod +x /app/shell/*.sh

if [ -n "${BACKUP_REMOTE:-}" ]; then
    echo "Off-site copies go to ${BACKUP_REMOTE}."
else
    echo "BACKUP_REMOTE is unset: backups stay on this host only."
fi
echo "Backup scheduler started (${SCHEDULE})."
# Start cron in foreground (not exec'd: dcron cannot setpgid as PID 1)
crond -f -d 8
