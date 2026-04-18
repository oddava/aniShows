#!/usr/bin/env bash
set -euo pipefail

echo "Checking for unapplied migrations..."
python manage.py migrate --check --noinput

exec "$@"
