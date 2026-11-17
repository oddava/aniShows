#!/bin/bash
set -euo pipefail

echo "Starting Backup Service..."

# Cron jobs do not inherit the container environment reliably, so hand the
# backup settings (database, retention, off-site rclone remote) to the job
# through a private file.
ENV_FILE=/app/cron.env
umask 077
: >"$ENV_FILE"
while IFS= read -r name; do
    case "$name" in
        POSTGRES_*|PGSSLMODE|PGSSLROOTCERT|PGHOST|PGPORT|BACKUP_*|RCLONE_*|TZ)
            # %q quotes anything (spaces, quotes, newlines) for bash to read back.
            printf 'export %s=%q\n' "$name" "${!name}" >>"$ENV_FILE" ;;
    esac
done < <(compgen -e)

# Daily backup at 03:00 (container time) unless BACKUP_SCHEDULE overrides it.
# Output goes to the container's stdout, so `docker logs` shows every run.
SCHEDULE="${BACKUP_SCHEDULE:-0 3 * * *}"
echo "$SCHEDULE bash -c '. $ENV_FILE && /app/shell/backup.sh daily' >> /proc/1/fd/1 2>&1" > /etc/crontabs/root

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
