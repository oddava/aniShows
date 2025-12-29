#!/bin/bash
set -e

BACKUP_DIR="/backups"
TIMESTAMP=$1

if [ -z "$TIMESTAMP" ]; then
    echo "Usage: $0 <TIMESTAMP>"
    echo "Available backups:"
    ls -1 "$BACKUP_DIR"
    exit 1
fi

# Find the backup directory matching the timestamp
TARGET_DIR=$(find "$BACKUP_DIR" -maxdepth 1 -name "${TIMESTAMP}-*" | head -n 1)

if [ -z "$TARGET_DIR" ]; then
    echo "Error: Backup with timestamp $TIMESTAMP not found."
    exit 1
fi

echo "Restoring from $TARGET_DIR..."

# 1. Restore Database
if [ -f "$TARGET_DIR/db_dump.sql.gz" ]; then
    echo "Restoring PostgreSQL database..."
    # Drop and recreate schema to ensure clean slate? Or just rely on dump being clean?
    # Usually clean restore is safer.
    # But for safety, let's just restore on top or drop public schema.
    # pg_dump usually includes drop statements if configured, but default one might not.
    # Let's assume standard restore.
    # Clear current database
    echo "Cleaning existing database..."
    PGPASSWORD=$POSTGRES_PASSWORD psql -h db -U $POSTGRES_USER -d $POSTGRES_DB -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

    echo "Restoring PostgreSQL database..."
    gunzip -c "$TARGET_DIR/db_dump.sql.gz" | PGPASSWORD=$POSTGRES_PASSWORD psql -h db -U $POSTGRES_USER -d $POSTGRES_DB
    local_status=$?
    if [ $local_status -ne 0 ]; then
        echo "Error: Database restore failed."
        exit $local_status
    fi
else
    echo "Warning: db_dump.sql.gz not found in backup."
fi

# 2. Restore MinIO Data
if [ -f "$TARGET_DIR/minio_data.tar.gz" ]; then
    echo "Restoring MinIO data..."
    # Clear existing data?
    rm -rf /minio_data/*
    tar -xzf "$TARGET_DIR/minio_data.tar.gz" -C /minio_data
else
    echo "Warning: minio_data.tar.gz not found in backup."
fi

echo "Restore completed successfully."
