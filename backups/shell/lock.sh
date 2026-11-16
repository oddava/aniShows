# shellcheck shell=bash
#
# The one lock shared by backup.sh and restore.sh, across every container that
# mounts the backups directory (the backup daemon, deploy-prod.sh's
# `compose run` pre-migrate dump, manual `exec` runs). It is an flock on a
# file in that mount, so the kernel releases it when the holder dies
# (SIGKILL, OOM, a recreated container): there is no stale lock to reclaim.
# The lock stays on file descriptor 9 until the process exits; a child run
# with BACKUP_SKIP_LOCK=1 (restore.sh's pre-restore snapshot) inherits it.

BACKUP_LOCK_FILE="${BACKUP_DIR:-/backups}/.backup.flock"

# acquire_backup_lock <seconds to wait, 0 = fail at once>
acquire_backup_lock() {
    local wait="${1:-0}" waited=0
    exec 9>>"$BACKUP_LOCK_FILE"
    while ! flock -n 9; do
        if [ "$waited" -ge "$wait" ]; then
            echo "Error: Another backup/restore operation is currently running (lock: $BACKUP_LOCK_FILE)." >&2
            exit 1
        fi
        if [ "$waited" -eq 0 ]; then
            echo "Waiting up to ${wait}s for the running backup/restore to finish..." >&2
        fi
        sleep 5
        waited=$((waited + 5))
    done
}
