"""Fail when ``mypy .`` reports more errors than the recorded ceiling.

The codebase is not type-clean; the ceiling stops it getting worse. Run from the
repo root with the dev dependencies (mypy and the django/drf stubs from
``uv.lock``), e.g. ``uv run python scripts/check_mypy_ceiling.py`` or, in the
backend image, ``python scripts/check_mypy_ceiling.py``.

When a change fixes errors, lower ``CEILING`` to the new count in the same
commit (the script says so). Raising it needs a reason in the commit message.
"""

import re
import subprocess
import sys

# Measured on release/anishows-rc with mypy 1.19.1 (uv.lock), `python -m mypy .`,
# the [tool.mypy] config in pyproject.toml.
CEILING = 307
_SUMMARY = re.compile(r"Found (\d+) errors? in \d+ files?")


def main() -> int:
    result = subprocess.run(  # noqa: S603 - fixed interpreter and arguments
        [sys.executable, "-m", "mypy", "."], capture_output=True, text=True, check=False
    )
    output = result.stdout + result.stderr
    if result.returncode == 0 and "Success" in output:
        count = 0
    else:
        match = _SUMMARY.search(output)
        if match is None:
            print(output)
            print("Could not read mypy's summary line (did mypy crash?).", file=sys.stderr)
            return 2
        count = int(match.group(1))

    if count > CEILING:
        print(output)
        print(f"mypy: {count} errors, above the ceiling of {CEILING}.", file=sys.stderr)
        return 1
    print(f"mypy: {count} errors (ceiling {CEILING}).")
    if count < CEILING:
        print(f"Lower CEILING in scripts/check_mypy_ceiling.py to {count}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
