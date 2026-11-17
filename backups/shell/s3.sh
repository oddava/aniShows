#!/usr/bin/env bash
# Sourced by backup.sh and restore.sh: the rclone remote "s3src" for the media
# bucket, configured only through environment (RCLONE_CONFIG_S3SRC_*, like the
# off-site remote) from the same AWS_* values the app uses. Path-style
# addressing, and no bucket creation or listing of buckets: the app's user is
# scoped to its bucket. Every media operation addresses
# s3src:$AWS_STORAGE_BUCKET_NAME and nothing else, so other buckets on the
# same server are never read or changed.

s3_media_env() {
    : "${AWS_S3_ENDPOINT_URL:?AWS_S3_ENDPOINT_URL is required for the media bucket}"
    : "${AWS_STORAGE_BUCKET_NAME:?AWS_STORAGE_BUCKET_NAME is required for the media bucket}"
    : "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required for the media bucket}"
    : "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required for the media bucket}"
    # A bare bucket name: a "/" would aim a sync at a prefix, a wildcard-ish
    # value at something else.
    if ! [[ "$AWS_STORAGE_BUCKET_NAME" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then
        echo "Error: AWS_STORAGE_BUCKET_NAME '$AWS_STORAGE_BUCKET_NAME' is not a plain bucket name." >&2
        return 1
    fi
    export RCLONE_CONFIG_S3SRC_TYPE=s3
    export RCLONE_CONFIG_S3SRC_PROVIDER=Other
    export RCLONE_CONFIG_S3SRC_ENDPOINT="$AWS_S3_ENDPOINT_URL"
    export RCLONE_CONFIG_S3SRC_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID"
    export RCLONE_CONFIG_S3SRC_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY"
    export RCLONE_CONFIG_S3SRC_FORCE_PATH_STYLE=true
    export RCLONE_CONFIG_S3SRC_REGION="${AWS_S3_REGION_NAME:-us-east-1}"
    export RCLONE_CONFIG_S3SRC_NO_CHECK_BUCKET=true
}
