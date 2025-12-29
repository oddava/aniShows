#!/bin/bash
set -e
set -o pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups"
TYPE=${1:-manual} # manual, daily, weekly

echo "[$(date)] Starting $TYPE backup..."

# Create directory for this backup
CURRENT_BACKUP_DIR="$BACKUP_DIR/$TIMESTAMP-$TYPE"
mkdir -p "$CURRENT_BACKUP_DIR"

# 1. Backup Database
echo "Backing up PostgreSQL database..."
PGPASSWORD=$POSTGRES_PASSWORD pg_dump -h db -U $POSTGRES_USER -d $POSTGRES_DB --clean --if-exists | gzip > "$CURRENT_BACKUP_DIR/db_dump.sql.gz"

# 2. Backup MinIO Data
echo "Backing up MinIO data..."
# create tar of minio_data directory, excluding .minio.sys
tar -czf "$CURRENT_BACKUP_DIR/minio_data.tar.gz" -C /minio_data --exclude='.minio.sys' .

echo "[$(date)] Backup completed successfully at $CURRENT_BACKUP_DIR"

# Cleanup old backups
# Keep daily backups for 7 days
if [ "$TYPE" == "daily" ]; then
    find "$BACKUP_DIR" -maxdepth 1 -name "*daily" -mtime +7 -exec rm -rf {} +
fi

# Keep weekly backups for 4 weeks
if [ "$TYPE" == "weekly" ]; then
    find "$BACKUP_DIR" -maxdepth 1 -name "*weekly" -mtime +28 -exec rm -rf {} +
fi
