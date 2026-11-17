"""backups/shell/backup.sh upload_offsite and fetch_offsite.sh, with a fake rclone.

BACKUP_REMOTE empty: a clear log line, no error. Set: upload, verify, and
prune only this script's own dated directories older than the retention.
"""

import os
import shutil
import subprocess
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

from django.test import SimpleTestCase

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKUP_SH = REPO_ROOT / "backups" / "shell" / "backup.sh"
FETCH_SH = REPO_ROOT / "backups" / "shell" / "fetch_offsite.sh"

# A local-directory "remote": remote:path maps to $FAKE_REMOTE_ROOT/path.
FAKE_RCLONE = r"""#!/usr/bin/env bash
echo "$*" >> "$RCLONE_LOG"
resolve() { local p="${1#*:}"; echo "$FAKE_REMOTE_ROOT/${p}"; }
cmd="$1"; shift
args=()
for a in "$@"; do case "$a" in --*) ;; *) args+=("$a") ;; esac; done
case "$cmd" in
    copy) [ -n "${FAKE_RCLONE_FAIL_COPY:-}" ] && exit 1
          src="${args[0]}"; dst="${args[1]}"
          [[ "$src" == *:* ]] && src="$(resolve "$src")"
          [[ "$dst" == *:* ]] && dst="$(resolve "$dst")"
          mkdir -p "$dst" && cp -a "$src"/. "$dst"/ ;;
    check) exit 0 ;;
    lsf) [ -n "${FAKE_RCLONE_FAIL_LSF:-}" ] && exit 1
         d="$(resolve "${args[-1]}")"; [ -d "$d" ] || exit 0
         for x in "$d"/*/; do [ -d "$x" ] && basename "$x" | sed 's:$:/:'; done ;;
    purge) rm -rf "$(resolve "${args[-1]}")" ;;
esac
"""


@unittest.skipUnless(shutil.which("bash"), "bash is required")
class OffsiteUploadTests(SimpleTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        rclone = self.bin / "rclone"
        rclone.write_text(FAKE_RCLONE)
        rclone.chmod(0o755)
        self.remote_root = self.tmp / "remote"
        (self.remote_root / "bucket").mkdir(parents=True)
        self.log = self.tmp / "rclone.log"
        self.backups = self.tmp / "backups"
        self.backups.mkdir()

    def _env(self, **extra: str) -> dict[str, str]:
        return {
            **os.environ,
            "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            "RCLONE_LOG": str(self.log),
            "FAKE_REMOTE_ROOT": str(self.remote_root),
            "BACKUP_DIR": str(self.backups),
            "POSTGRES_DB": "db",
            "POSTGRES_USER": "u",
            "POSTGRES_PASSWORD": "p",
            **extra,
        }

    def _upload(self, name: str, **extra: str):
        backup = self.backups / name
        backup.mkdir()
        (backup / "postgres.dump").write_text("dump")
        script = f'source "{BACKUP_SH.as_posix()}"; CURRENT_BACKUP_DIR="$1"; upload_offsite'
        return subprocess.run(  # noqa: S603 - fixed interpreter, our own script
            ["bash", "-c", script, "_", str(backup)],  # noqa: S607
            env=self._env(**extra),
            capture_output=True,
            text=True,
            timeout=30,
        )

    @staticmethod
    def _dated(days_ago: int, kind: str = "daily") -> str:
        day = datetime.now(UTC) - timedelta(days=days_ago)
        return f"{day:%Y%m%d}_030000-{kind}"

    def test_an_empty_remote_is_skipped_with_a_log_line(self):
        result = self._upload(self._dated(0), BACKUP_REMOTE="")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Off-site upload skipped: BACKUP_REMOTE is empty", result.stdout)
        self.assertFalse(self.log.exists())  # rclone never ran

    def test_upload_verifies_and_prunes_only_old_dated_copies(self):
        bucket = self.remote_root / "bucket"
        old, recent = self._dated(40), self._dated(5)
        for name in (old, recent, "unrelated-data"):
            (bucket / name).mkdir()
        today = self._dated(0, "manual")

        result = self._upload(today, BACKUP_REMOTE="offsite:bucket", BACKUP_REMOTE_KEEP_DAYS="30")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((bucket / today / "postgres.dump").exists())
        self.assertFalse((bucket / old).exists())
        self.assertTrue((bucket / recent).exists())
        self.assertTrue((bucket / "unrelated-data").exists())
        calls = self.log.read_text()
        self.assertIn(f"check --one-way {self.backups / today} offsite:bucket/{today}", calls)

    def test_a_failed_upload_fails_the_run_and_keeps_the_local_backup(self):
        name = self._dated(0)
        result = self._upload(name, BACKUP_REMOTE="offsite:bucket", FAKE_RCLONE_FAIL_COPY="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("off-site upload to offsite:bucket failed", result.stderr)
        self.assertTrue((self.backups / name / "postgres.dump").exists())

    def test_a_failed_listing_skips_pruning_without_failing(self):
        result = self._upload(
            self._dated(0), BACKUP_REMOTE="offsite:bucket", FAKE_RCLONE_FAIL_LSF="1"
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("old off-site copies were not pruned", result.stdout)

    def _fetch(self, *args: str, **extra: str):
        return subprocess.run(  # noqa: S603 - fixed interpreter, our own script
            ["bash", str(FETCH_SH), *args],  # noqa: S607
            env=self._env(**extra),
            capture_output=True,
            text=True,
            timeout=30,
        )

    def test_fetch_lists_and_downloads_the_newest_copy(self):
        bucket = self.remote_root / "bucket"
        older, newer = self._dated(3), self._dated(1)
        for name in (older, newer):
            (bucket / name).mkdir()
            (bucket / name / "postgres.dump").write_text(name)
            subprocess.run(
                ["bash", "-c", "sha256sum postgres.dump > checksums.sha256"],  # noqa: S607
                cwd=bucket / name,
                check=True,
            )

        listed = self._fetch(BACKUP_REMOTE="offsite:bucket")
        self.assertEqual(listed.stdout.split(), [older, newer])

        fetched = self._fetch("latest", BACKUP_REMOTE="offsite:bucket")
        self.assertEqual(fetched.returncode, 0, fetched.stderr)
        self.assertEqual(fetched.stdout.strip(), newer)
        self.assertEqual((self.backups / newer / "postgres.dump").read_text(), newer)
        self.assertEqual(list(self.backups.glob(".tmp-fetch-*")), [])

    def test_fetch_refuses_a_corrupt_download_and_an_unset_remote(self):
        bucket = self.remote_root / "bucket"
        name = self._dated(1)
        (bucket / name).mkdir()
        (bucket / name / "postgres.dump").write_text("tampered")
        (bucket / name / "checksums.sha256").write_text(f"{'0' * 64}  postgres.dump\n")

        corrupt = self._fetch(name, BACKUP_REMOTE="offsite:bucket")
        self.assertNotEqual(corrupt.returncode, 0)
        self.assertIn("checksum mismatch", corrupt.stderr)
        self.assertFalse((self.backups / name).exists())

        unset = self._fetch("latest", BACKUP_REMOTE="")
        self.assertNotEqual(unset.returncode, 0)
        self.assertIn("BACKUP_REMOTE is empty", unset.stderr)
