"""The media half of backups/shell/backup.sh and restore.sh, with a fake rclone.

Media lives in an S3 bucket (the host's RustFS), not in a volume the backup
container mounts: backup_media syncs the bucket into a staging directory and
tars it; restore_media unpacks to a temporary directory and syncs only into
s3src:$AWS_STORAGE_BUCKET_NAME. The fake maps ``s3src:<bucket>`` to a directory
and records the arguments and the RCLONE_CONFIG_S3SRC_* environment it got.
"""

import os
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

from django.test import SimpleTestCase

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKUP_SH = REPO_ROOT / "backups" / "shell" / "backup.sh"
RESTORE_SH = REPO_ROOT / "backups" / "shell" / "restore.sh"
EXPORT_SH = REPO_ROOT / "backups" / "shell" / "export.sh"
ENTRYPOINT_SH = REPO_ROOT / "backups" / "entrypoint.sh"

FAKE_RCLONE = r"""#!/usr/bin/env bash
echo "$*" >> "$RCLONE_LOG"
env | grep '^RCLONE_CONFIG_S3SRC_' | sort >> "$RCLONE_ENV_LOG"
resolve() {
    case "$1" in
        s3src:*) echo "$FAKE_BUCKETS/${1#s3src:}" ;;
        *) echo "$1" ;;
    esac
}
cmd="$1"; shift
args=()
for a in "$@"; do case "$a" in --*) ;; *) args+=("$a") ;; esac; done
case "$cmd" in
    sync)
        [ -n "${FAKE_RCLONE_FAIL_SYNC:-}" ] && { echo "rclone: dial tcp: lookup rustfs" >&2; exit 1; }
        src="$(resolve "${args[0]}")"; dst="$(resolve "${args[1]}")"
        mkdir -p "$dst"
        find "$dst" -mindepth 1 -delete
        cp -a "$src"/. "$dst"/ ;;
esac
"""

SAFE_ENV_KEYS = {
    "POSTGRES_DB": "db",
    "POSTGRES_USER": "u",
    "POSTGRES_PASSWORD": "p",
    "AWS_S3_ENDPOINT_URL": "http://rustfs:9000",
    "AWS_STORAGE_BUCKET_NAME": "anishows-media",
    "AWS_ACCESS_KEY_ID": "anishows",
    "AWS_SECRET_ACCESS_KEY": "s3-secret",
    "AWS_S3_REGION_NAME": "us-east-1",
}


def _posix(path: Path) -> str:
    """The path as the shell sees it: on Windows (Git Bash) a drive path becomes /c/x, which tar
    does not mistake for a host:path; a no-op on Linux, where CI and production run.
    """
    text = path.as_posix()
    if os.name == "nt" and len(text) > 1 and text[1] == ":":
        text = f"/{text[0].lower()}{text[2:]}"
    return text


class _MediaScriptCase(SimpleTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        bin_dir = self.tmp / "bin"
        bin_dir.mkdir()
        rclone = bin_dir / "rclone"
        rclone.write_text(FAKE_RCLONE, newline="\n")
        rclone.chmod(0o755)
        self.bin = bin_dir
        self.buckets = self.tmp / "buckets"
        (self.buckets / "anishows-media" / "media" / "avatars").mkdir(parents=True)
        (self.buckets / "anishows-media" / "media" / "avatars" / "a.jpg").write_text("avatar")
        (self.buckets / "anishows-media" / "media" / "cover.webp").write_text("cover")
        (self.buckets / "other-bucket").mkdir()
        (self.buckets / "other-bucket" / "keep.txt").write_text("not ours")
        self.backups = self.tmp / "backups"
        self.backups.mkdir()
        self.log = self.tmp / "rclone.log"
        self.env_log = self.tmp / "rclone-env.log"

    def _env(self, **extra: str) -> dict[str, str]:
        env = {
            **os.environ,
            **SAFE_ENV_KEYS,
            "PATH": f"{_posix(self.bin)}:{os.environ['PATH']}"
            if os.name == "nt"
            else f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            "RCLONE_LOG": _posix(self.log),
            "RCLONE_ENV_LOG": _posix(self.env_log),
            "FAKE_BUCKETS": _posix(self.buckets),
            "BACKUP_DIR": _posix(self.backups),
            "BACKUP_INCLUDE_DB": "0",
        }
        env.update(extra)
        return {key: value for key, value in env.items() if value is not None}

    def _bash(self, script: str, arg: str = "", **extra: str):
        # The sourced scripts consume $1 (restore.sh shifts it), so the one
        # argument travels in the environment.
        return subprocess.run(  # noqa: S603 - fixed interpreter, our own scripts
            ["bash", "-c", script],  # noqa: S607
            env=self._env(ARG=arg, **extra),
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )


@unittest.skipUnless(shutil.which("bash"), "bash is required")
class BackupMediaTests(_MediaScriptCase):
    def _backup(self, **extra: str):
        work = self.backups / "work"
        work.mkdir(exist_ok=True)
        script = (
            f'source "{_posix(BACKUP_SH)}"; TIMESTAMP=20261117_030000; TYPE=manual; '
            'WORK_DIR="$ARG"; backup_media; write_manifest; trap - EXIT; echo done'
        )
        return self._bash(script, _posix(work), **extra), work

    def test_the_bucket_is_synced_to_staging_and_tarred(self):
        result, work = self._backup()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        archive = work / "media_data.tar.gz"
        with tarfile.open(archive) as tar:
            names = {name.removeprefix("./") for name in tar.getnames()}
        self.assertTrue({"media/avatars/a.jpg", "media/cover.webp"} <= names, names)
        self.assertFalse(any("other-bucket" in name or "keep.txt" in name for name in names))
        calls = self.log.read_text().splitlines()
        self.assertEqual(len(calls), 1)
        self.assertRegex(
            calls[0], r"^sync s3src:anishows-media .+\.tmp-media-stage-20261117_030000"
        )
        # The staging copy is gone and never part of the backup directory.
        self.assertEqual([p.name for p in self.backups.glob(".tmp-media-stage*")], [])
        self.assertEqual(
            sorted(p.name for p in work.iterdir()),
            ["backup_manifest.env", "checksums.sha256", "media_data.tar.gz"],
        )

    def test_the_remote_is_configured_from_the_app_s3_values_by_environment(self):
        result, _ = self._backup()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        seen = dict(line.split("=", 1) for line in self.env_log.read_text().splitlines())
        self.assertEqual(
            seen,
            {
                "RCLONE_CONFIG_S3SRC_TYPE": "s3",
                "RCLONE_CONFIG_S3SRC_PROVIDER": "Other",
                "RCLONE_CONFIG_S3SRC_ENDPOINT": "http://rustfs:9000",
                "RCLONE_CONFIG_S3SRC_ACCESS_KEY_ID": "anishows",
                "RCLONE_CONFIG_S3SRC_SECRET_ACCESS_KEY": "s3-secret",
                "RCLONE_CONFIG_S3SRC_FORCE_PATH_STYLE": "true",
                "RCLONE_CONFIG_S3SRC_REGION": "us-east-1",
                "RCLONE_CONFIG_S3SRC_NO_CHECK_BUCKET": "true",
            },
        )

    def test_the_manifest_uses_media_keys_and_the_checksums_cover_the_archive(self):
        result, work = self._backup()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        manifest = (work / "backup_manifest.env").read_text()
        self.assertIn("MEDIA_ARCHIVE_FILE=media_data.tar.gz", manifest)
        self.assertRegex(manifest, r"MEDIA_ARCHIVE_SHA256=[0-9a-f]{64}")
        self.assertRegex(manifest, r"MEDIA_ARCHIVE_SIZE_BYTES=[1-9][0-9]*")
        self.assertNotIn("MINIO", manifest)
        checks = subprocess.run(
            ["bash", "-c", "sha256sum -c checksums.sha256"],  # noqa: S607
            cwd=work,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(checks.returncode, 0, checks.stdout + checks.stderr)
        self.assertIn("media_data.tar.gz: OK", checks.stdout)

    def test_an_unreachable_bucket_fails_the_backup_and_leaves_no_staging(self):
        result, work = self._backup(FAKE_RCLONE_FAIL_SYNC="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("could not read the media bucket", result.stderr)
        self.assertIn("anishows-s3 network", result.stderr)
        self.assertFalse((work / "media_data.tar.gz").exists())
        self.assertEqual([p.name for p in self.backups.glob(".tmp-media-stage*")], [])

    def test_missing_s3_settings_fail_before_rclone_runs(self):
        for name in ("AWS_S3_ENDPOINT_URL", "AWS_SECRET_ACCESS_KEY", "AWS_STORAGE_BUCKET_NAME"):
            with self.subTest(name=name):
                result, _ = self._backup(**{name: ""})
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(name, result.stderr)
        self.assertFalse(self.log.exists())


@unittest.skipUnless(shutil.which("bash"), "bash is required")
class RestoreMediaTests(_MediaScriptCase):
    def _backup_dir(self, name: str = "20261117_030000-daily") -> Path:
        target = self.backups / name
        target.mkdir()
        return target

    def _archive(self, target: Path, archive_name: str, files: dict[str, str]) -> Path:
        content = self.tmp / f"content-{archive_name}"
        for rel, text in files.items():
            path = content / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        content.mkdir(exist_ok=True)
        out = target / archive_name
        with tarfile.open(out, "w:gz") as tar:
            tar.add(content, arcname=".")
        return out

    def _restore_media(self, target: Path, **extra: str):
        script = (
            f'source "{_posix(RESTORE_SH)}"; TARGET_DIR="$ARG"; load_artifacts; '
            "restore_media; echo restored"
        )
        return self._bash(script, _posix(target), RESTORE_SKIP_DB="1", **extra)

    def _bucket_files(self, bucket: str = "anishows-media") -> set[str]:
        root = self.buckets / bucket
        return {
            str(p.relative_to(root)).replace(os.sep, "/") for p in root.rglob("*") if p.is_file()
        }

    def test_the_archive_is_unpacked_and_synced_into_only_the_app_bucket(self):
        target = self._backup_dir()
        self._archive(
            target,
            "media_data.tar.gz",
            {"media/avatars/new.jpg": "new", "media/banner.png": "banner"},
        )
        result = self._restore_media(target)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        # sync makes the bucket match the backup (the old objects are gone) ...
        self.assertEqual(self._bucket_files(), {"media/avatars/new.jpg", "media/banner.png"})
        # ... and never touches another bucket.
        self.assertEqual(self._bucket_files("other-bucket"), {"keep.txt"})
        (call,) = self.log.read_text().splitlines()
        self.assertRegex(call, r"^sync .+\.tmp-media-restore\.[^ ]+ s3src:anishows-media$")
        self.assertEqual([p.name for p in self.backups.glob(".tmp-media-restore*")], [])

    def test_a_failed_sync_fails_the_restore(self):
        target = self._backup_dir()
        self._archive(target, "media_data.tar.gz", {"media/a.jpg": "a"})
        result = self._restore_media(target, FAKE_RCLONE_FAIL_SYNC="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("rclone could not write the media bucket", result.stderr)
        self.assertNotIn("restored", result.stdout)
        self.assertEqual([p.name for p in self.backups.glob(".tmp-media-restore*")], [])

    def test_an_empty_archive_does_not_empty_the_bucket(self):
        target = self._backup_dir()
        self._archive(target, "media_data.tar.gz", {})
        result = self._restore_media(target)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("refusing to empty the bucket", result.stderr)
        self.assertIn("media/cover.webp", self._bucket_files())
        self.assertFalse(self.log.exists())

    def test_a_bucket_name_with_a_path_is_refused(self):
        target = self._backup_dir()
        self._archive(target, "media_data.tar.gz", {"media/a.jpg": "a"})
        for bad in ("anishows-media/media", "other-bucket/..", "UPPER", "a"):
            with self.subTest(bucket=bad):
                result = self._restore_media(target, AWS_STORAGE_BUCKET_NAME=bad)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("not a plain bucket name", result.stderr)
        self.assertFalse(self.log.exists())

    def test_the_manifest_names_the_archive(self):
        target = self._backup_dir()
        self._archive(target, "media_data.tar.gz", {"media/a.jpg": "a"})
        (target / "backup_manifest.env").write_text("MEDIA_ARCHIVE_FILE=media_data.tar.gz\n")
        found = self._bash(
            f'source "{_posix(RESTORE_SH)}"; TARGET_DIR="$ARG"; find_media_archive', _posix(target)
        )
        self.assertEqual(found.stdout.strip(), "media_data.tar.gz")

    def test_a_legacy_backup_is_found_by_its_manifest_key_and_by_file_name(self):
        for manifest in ("MINIO_ARCHIVE_FILE=minio_data.tar.gz\n", None):
            with self.subTest(manifest=manifest):
                target = self._backup_dir(f"2026111{'6' if manifest else '5'}_030000-daily")
                self._archive(target, "minio_data.tar.gz", {"anishows-media/media/old.jpg": "old"})
                if manifest:
                    (target / "backup_manifest.env").write_text(manifest)
                found = self._bash(
                    f'source "{_posix(RESTORE_SH)}"; TARGET_DIR="$ARG"; find_media_archive',
                    _posix(target),
                )
                self.assertEqual(found.stdout.strip(), "minio_data.tar.gz")

    def test_a_legacy_archive_of_plain_files_restores_its_bucket_directory(self):
        target = self._backup_dir()
        self._archive(
            target,
            "minio_data.tar.gz",
            {"anishows-media/media/old.jpg": "old", "other-bucket/x.txt": "x"},
        )
        result = self._restore_media(target)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self._bucket_files(), {"media/old.jpg"})
        self.assertEqual(self._bucket_files("other-bucket"), {"keep.txt"})

    def test_a_legacy_minio_data_directory_is_refused_with_guidance(self):
        # MinIO's own layout: <bucket>/<object>/xl.meta, not the object bytes.
        target = self._backup_dir()
        self._archive(
            target,
            "minio_data.tar.gz",
            {"anishows-media/media/old.jpg/xl.meta": "binary"},
        )
        result = self._restore_media(target)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("xl.meta", result.stderr)
        self.assertIn("--skip-media", result.stderr)
        self.assertIn("media/cover.webp", self._bucket_files())
        self.assertFalse(self.log.exists())

    def test_no_archive_is_an_error(self):
        target = self._backup_dir()
        result = self._restore_media(target)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("No media archive found", result.stderr)


class NoVolumeLeftoversTests(SimpleTestCase):
    """Nothing in the backup scripts reads the removed minio_data volume."""

    def test_the_scripts_do_not_use_the_minio_volume(self):
        for path in (BACKUP_SH, RESTORE_SH, EXPORT_SH):
            with self.subTest(script=path.name):
                text = path.read_text(encoding="utf-8")
                self.assertNotIn("/minio_data", text)
                self.assertNotIn("rsync", text)
                self.assertNotIn("minioadmin", text)

    def test_the_cron_environment_carries_the_s3_settings(self):
        text = ENTRYPOINT_SH.read_text(encoding="utf-8")
        for name in (
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_STORAGE_BUCKET_NAME",
            "AWS_S3_ENDPOINT_URL",
            "AWS_S3_REGION_NAME",
        ):
            self.assertIn(name, text)
