# Backup and Restore

## What Is Backed Up

Each backup directory now includes:

- `postgres.dump`: PostgreSQL custom-format dump (`pg_dump -Fc`)
- `minio_data.tar.gz`: media/object storage snapshot from `/minio_data`
- `backup_manifest.env`: metadata (type, timestamp, DB target, sizes, hashes)
- `checksums.sha256`: integrity checks for artifacts

Backups are created atomically in a temp directory and moved into place only after success.
Media backups are staged through an internal `rsync` snapshot before archiving, so active uploads no longer abort the job with `tar: file changed as we read it`.
Every dump is checked with `pg_restore --list` right after it is written, so a truncated archive
fails the backup, not the restore.

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

Counted, not dated: each kind keeps its newest copies, the new one included.

- `BACKUP_KEEP` (dev default `1`, production template `7`): regular backups (`manual`, `daily`, `weekly`)
- `BACKUP_KEEP_PRE_MIGRATE` (default `3`): database-only dumps `deploy-prod.sh` takes before a schema change
- pre-restore snapshots use `BACKUP_KEEP` too; `exports/`, `imported-env/` and `*-imported` backups are never rotated
- `BACKUP_SCHEDULE` (default `0 3 * * *`, container time): the daily cron line

Each regular backup is a full DB dump plus a media archive: size the disk for `BACKUP_KEEP` of them.

Media backup performance is also configurable:

- `BACKUP_MEDIA_COMPRESS_LEVEL` (default `1`) lowers CPU overhead for large image-heavy archives while keeping `tar.gz` compatibility
- `BACKUP_MEDIA_RSYNC_PASSES` (default `2`) controls how many sync passes are used to settle the staged media snapshot before it is archived

## Production (docker-compose.prod.yml)

The production `backup` service dumps whichever Postgres the app uses: `POSTGRES_HOST` follows
`DB_HOST`, and `PGSSLMODE` follows `DB_SSLMODE`, so an external/shared server works the same way.
The `/minio_data` volume is the bundled MinIO's; with external object storage set
`BACKUP_INCLUDE_MEDIA=0` and back the bucket up at the provider.

```bash
make prod-backup                     # backup now (DB + media, off-site too when configured)
make prod-verify-backup              # restore the newest backup into a throwaway DB and check the app
make prod-verify-backup TIMESTAMP=20261116_030000
```

`prod-verify-backup` (`scripts/deploy/verify_backup.sh`) starts a temporary Postgres on the
compose network, restores the dump, runs `manage.py check`, lists unapplied migrations and counts
users, then removes the container. It never touches the live database and needs no CREATEDB right
on a shared server. (`make verify-backup` is the dev stack's in-container check.)

`restore.sh` restores into a staging database and swaps names, so on an external server the role
needs CREATEDB. Without it, restore the dump directly as the owner:
`pg_restore --clean --if-exists --no-owner -d <db> postgres.dump`, with web, celery and beat stopped.

### Off-site copies

Backups on the same disk as the database do not survive the host. Set `BACKUP_REMOTE` to an
[rclone](https://rclone.org) remote path and configure the remote with `RCLONE_CONFIG_<NAME>_*`
variables in `.env` (no config file needed). After every successful backup the container copies
the directory there, verifies it (`rclone check`), and deletes remote copies older than
`BACKUP_REMOTE_KEEP_DAYS` (default 30). A failed upload keeps the local backup and fails the run.
With `BACKUP_REMOTE` unset nothing is uploaded.

Hetzner Object Storage (S3):

```env
BACKUP_REMOTE=offsite:anishows-backups
RCLONE_CONFIG_OFFSITE_TYPE=s3
RCLONE_CONFIG_OFFSITE_PROVIDER=Other
RCLONE_CONFIG_OFFSITE_ENDPOINT=https://fsn1.your-objectstorage.com
RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=<key>
RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=<secret>
```

Hetzner Storage Box (SFTP): `RCLONE_CONFIG_OFFSITE_TYPE=sftp`, `..._HOST=<user>.your-storagebox.de`,
`..._USER=<user>`, `..._PORT=23`, `..._PASS=<output of rclone obscure>`; `BACKUP_REMOTE=offsite:anishows`.

Use a bucket/user that can write only this prefix, and turn on versioning or object lock on the
bucket if the provider offers it (a compromised host can otherwise delete its own off-site copies).
The cron job reads these variables from `/app/cron.env` (0600), written when the container starts:
after changing them, `docker compose -f docker-compose.prod.yml up -d backup`.
