"""scripts/deploy/remote_deploy.sh: what deploy.yml runs on the VPS over SSH.

A throwaway "origin" repo and a server-side clone stand in for GitHub and the
VPS; a fake deploy-prod.sh records the image tags it was given.
"""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from django.test import SimpleTestCase

REPO_ROOT = Path(__file__).resolve().parents[3]
REMOTE_SCRIPT = REPO_ROOT / "scripts" / "deploy" / "remote_deploy.sh"

FAKE_DEPLOY = """#!/usr/bin/env bash
echo "fake deploy output"
echo "tags=$BACKEND_TAG/$FRONTEND_TAG head=$(git rev-parse HEAD)" > "$DEPLOY_RECORD"
# The caller's deploy lock is inherited on fd 8 (deploy-prod.sh skips taking it).
if [ "${DEPLOY_LOCK_HELD:-}" = 1 ] && { : >&8; } 2>/dev/null; then echo "lock=inherited" >> "$DEPLOY_RECORD"; fi
# stdin must not be the remote script (ssh ... bash -s).
if read -r -t 1 line; then echo "stdin was readable: $line" >> "$DEPLOY_RECORD"; fi
exit "${FAKE_DEPLOY_STATUS:-0}"
"""


def _git(cwd: Path, *args: str) -> str:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@example.com",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@example.com",
    }
    return subprocess.run(  # noqa: S603 - fixed program, test-controlled arguments
        ["git", "-c", "init.defaultBranch=main", *args],  # noqa: S607
        cwd=cwd,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


@unittest.skipUnless(shutil.which("bash") and shutil.which("git"), "bash and git are required")
class RemoteDeployScriptTests(SimpleTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.origin = self.tmp / "origin"
        self.origin.mkdir()
        _git(self.origin, "init", "-q")
        # Committed WITHOUT the exec bit: the script must not depend on it.
        (self.origin / "deploy-prod.sh").write_text(FAKE_DEPLOY)
        (self.origin / "deploy-prod.sh").chmod(0o644)
        (self.origin / "README").write_text("v1\n")
        _git(self.origin, "add", ".")
        _git(self.origin, "commit", "-qm", "v1")
        self.first = _git(self.origin, "rev-parse", "HEAD")

        self.server = self.tmp / "server"
        _git(self.tmp, "clone", "-q", str(self.origin), str(self.server))
        (self.server / ".env").write_text("CADDY_MODE=proxy\n")  # untracked, never touched

        (self.origin / "README").write_text("v2\n")
        _git(self.origin, "commit", "-qam", "v2")
        self.second = _git(self.origin, "rev-parse", "HEAD")
        self.record = self.tmp / "record"

    def _run(self, commit: str, app_dir: Path | None = None, **env: str):
        with REMOTE_SCRIPT.open("rb") as script:
            return subprocess.run(  # noqa: S603 - fixed interpreter, our own script
                ["bash", "-s", "--", str(app_dir or self.server), commit],  # noqa: S607
                stdin=script,
                env={**os.environ, "DEPLOY_RECORD": str(self.record), **env},
                capture_output=True,
                text=True,
                timeout=60,
            )

    def test_checks_out_the_commit_and_deploys_its_images(self):
        result = self._run(self.second)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        lines = self.record.read_text().splitlines()
        self.assertEqual(
            lines[0], f"tags=sha-{self.second[:7]}/sha-{self.second[:7]} head={self.second}"
        )
        if shutil.which("flock"):
            self.assertIn("lock=inherited", lines)
        self.assertTrue((self.server / ".env").exists())
        # The detached deploy's output is streamed back over SSH and kept on the server.
        self.assertIn("fake deploy output", result.stdout)
        kept = list((self.server / "backups-data" / "deploy-logs").glob("remote-*.out"))
        self.assertEqual(len(kept), 1)
        self.assertIn("fake deploy output", kept[0].read_text())

    @unittest.skipUnless(shutil.which("flock"), "flock is required")
    def test_a_held_deploy_lock_stops_before_the_checkout_moves(self):
        import fcntl

        lock_path = self.server / "backups-data" / ".deploy.lock"
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        before = _git(self.server, "rev-parse", "HEAD")
        with lock_path.open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)  # a manual deploy or restore
            result = self._run(self.second)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("deploy or restore is running", result.stderr)
        self.assertEqual(_git(self.server, "rev-parse", "HEAD"), before)
        self.assertFalse(self.record.exists())

    def test_a_rollback_to_a_short_sha_works(self):
        self._run(self.second)
        result = self._run(self.first[:7])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(f"head={self.first}", self.record.read_text())

    def test_local_edits_to_tracked_files_stop_the_deploy(self):
        (self.server / "README").write_text("edited on the server\n")
        result = self._run(self.second)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("tracked files are modified", result.stderr)
        self.assertFalse(self.record.exists())

    def test_bad_input_is_refused_before_anything_runs(self):
        for commit, app_dir, message in (
            ("main; rm -rf /", None, "hex SHA"),
            ("deadbeef", self.tmp / "missing", "does not exist"),
            ("deadbeef", None, "not in origin"),
        ):
            with self.subTest(commit=commit):
                result = self._run(commit, app_dir)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stderr)
        self.assertFalse(self.record.exists())

    def test_a_failed_deploy_names_the_previous_checkout(self):
        before = _git(self.server, "rev-parse", "HEAD")
        result = self._run(self.second, FAKE_DEPLOY_STATUS="3")
        self.assertEqual(result.returncode, 3)
        self.assertIn(f"git checkout --detach {before}", result.stderr)
