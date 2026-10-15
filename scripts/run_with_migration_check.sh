#!/usr/bin/env bash
set -euo pipefail

echo "Checking for unapplied migrations..."
if ! check_output=$(python manage.py migrate --check --noinput 2>&1); then
    echo "ERROR: refusing to start '$*': the migration check failed." >&2
    if [ -n "$check_output" ]; then
        echo "$check_output" >&2
    fi
    if pending=$(python manage.py showmigrations --plan 2>&1 | grep '^\[ \]'); then
        echo "Unapplied migrations:" >&2
        echo "$pending" >&2
        echo "Apply them with 'make migrate' (or 'python manage.py migrate'), then restart this service." >&2
    else
        echo "Could not list unapplied migrations; the database may be unreachable (see the output above)." >&2
    fi
    exit 1
fi

exec "$@"
