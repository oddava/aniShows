#!/bin/bash
set -e
set -o pipefail

BACKUP_DIR="/backups"
INPUT_REF=$1
DB_HOST="${POSTGRES_HOST:-db}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_NAME="${POSTGRES_DB}"
DB_USER="${POSTGRES_USER}"
DB_PASSWORD="${POSTGRES_PASSWORD}"

if [ -z "$INPUT_REF" ]; then
    echo "Usage: $0 <TIMESTAMP_OR_BACKUP_DIR>"
    echo "Available backups:"
    ls -1 "$BACKUP_DIR"
    exit 1
fi

# Resolve target directory:
# 1) Accept exact directory names (e.g. 20260312_112656-manual)
# 2) Accept bare timestamps (e.g. 20260312_112656 -> first matching suffix)
if [ -d "$BACKUP_DIR/$INPUT_REF" ]; then
    TARGET_DIR="$BACKUP_DIR/$INPUT_REF"
else
    TARGET_DIR=$(find "$BACKUP_DIR" -maxdepth 1 -type d -name "${INPUT_REF}-*" | sort | head -n 1)
fi

if [ -z "$TARGET_DIR" ]; then
    echo "Error: Backup with reference '$INPUT_REF' not found."
    exit 1
fi

echo "Restoring from $TARGET_DIR..."

# 1. Restore Database
if [ -f "$TARGET_DIR/db_dump.sql.gz" ]; then
    echo "Restoring PostgreSQL database..."
    echo "Cleaning existing database..."
    PGPASSWORD="$DB_PASSWORD" psql \
        -v ON_ERROR_STOP=1 \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

    echo "Restoring PostgreSQL database..."
    gunzip -c "$TARGET_DIR/db_dump.sql.gz" | PGPASSWORD="$DB_PASSWORD" psql \
        -v ON_ERROR_STOP=1 \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME"
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
