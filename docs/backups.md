# Backup and Restore

## What Is Backed Up

Each backup directory now includes:

- `postgres.dump`: PostgreSQL custom-format dump (`pg_dump -Fc`)
- `minio_data.tar.gz`: media/object storage snapshot from `/minio_data`
- `runtime_env.snapshot`: environment snapshot from the backup container (for migration reference)
- `backup_manifest.env`: metadata (type, timestamp, DB target, sizes, hashes)
- `checksums.sha256`: integrity checks for artifacts

Backups are created atomically in a temp directory and moved into place only after success.
Media backups are staged through an internal `rsync` snapshot before archiving, so active uploads no longer abort the job with `tar: file changed as we read it`.
`runtime_env.snapshot` can contain secrets; store backups securely.

## Commands

If you changed backup scripts locally, rebuild the backup service first:

```bash
docker compose build backup
docker compose up -d backup
```

```bash
# create manual backup
make backup

# list backups with metadata
make backups

# export one backup as a portable bundle in backups-data/exports/
make backup-export TIMESTAMP=YYYYMMDD_HHMMSS

# list exported bundles
make exports

# import portable bundle into local backups-data
make backup-import FILE=your-backup.portable.tar.gz

# verify a backup (checksums + test restore into temp DB, no production changes)
make verify-backup TIMESTAMP=YYYYMMDD_HHMMSS

# full restore (DB + media)
make restore TIMESTAMP=YYYYMMDD_HHMMSS FORCE=1

# restore DB only
make restore-db-only TIMESTAMP=YYYYMMDD_HHMMSS FORCE=1

# restore media only
make restore-media-only TIMESTAMP=YYYYMMDD_HHMMSS FORCE=1
```

You can also pass full backup folder names (e.g. `20260315_141122-manual`) as `TIMESTAMP`.

## Restore Safety Model

Restore now performs these steps:

1. Resolve backup folder and validate required files.
2. Validate checksums (or compatibility-check legacy backups).
3. Test-restore DB dump into a temporary database.
4. Create an automatic `pre-restore` snapshot for rollback safety.
5. Restore into a staging database, then swap DB names instead of dropping schema first.
6. Restore media archive.

The previous production DB is retained with a `rollback_*` database name after restore.

## Migration to Another Server

1. Copy backup folder(s) from `backups-data/`.
2. Copy `.env` (or provide equivalent env vars) to the new server.
3. Start containers and ensure DB/MinIO services are healthy.
4. Verify backup first:

```bash
make verify-backup TIMESTAMP=...
```

5. Run restore:

```bash
make restore TIMESTAMP=... FORCE=1
```

## Portable Server-to-Server Transfer

On source server:

```bash
make backup
make backup-export TIMESTAMP=...
make exports
```

Copy bundle files to destination server:

```bash
scp backups-data/exports/<bundle>.tar.gz backups-data/exports/<bundle>.tar.gz.sha256 user@target:/path/to/aniShows/backups-data/exports/
```

On destination server:

```bash
make backup-import FILE=<bundle>.tar.gz
make verify-backup TIMESTAMP=<imported-backup-dir>
make restore TIMESTAMP=<imported-backup-dir> FORCE=1
```

## Retention

Retention is configurable through env vars in the backup container:

- `BACKUP_RETENTION_DAILY_DAYS` (default `7`)
- `BACKUP_RETENTION_WEEKLY_DAYS` (default `28`)
- `BACKUP_RETENTION_MANUAL_DAYS` (default `0`, keep forever)
- `BACKUP_RETENTION_PRE_RESTORE_DAYS` (default `14`)

Media backup performance is also configurable:

- `BACKUP_MEDIA_COMPRESS_LEVEL` (default `1`) lowers CPU overhead for large image-heavy archives while keeping `tar.gz` compatibility
- `BACKUP_MEDIA_RSYNC_PASSES` (default `2`) controls how many sync passes are used to settle the staged media snapshot before it is archived
