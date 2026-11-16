#!/usr/bin/env bash
#
# `docker compose` for the production stack, in the mode .env selects. Use it
# for every manual command on the server instead of a bare
# `docker compose -f docker-compose.prod.yml`: Caddy's site address, trusted
# peers and HSTS header depend on CADDY_MODE, and a bare call would recreate
# Caddy with the public-mode defaults (a redirect loop behind the tunnel).
#
#   scripts/deploy/compose.sh ps
#   scripts/deploy/compose.sh logs -f web
#   scripts/deploy/compose.sh exec web python manage.py createsuperuser
#   scripts/deploy/compose.sh up -d --no-deps cloudflared
#
# Run from the repo root (where .env is).

set -euo pipefail

[ -f docker-compose.prod.yml ] || { echo "Run from the repo root (docker-compose.prod.yml not found)" >&2; exit 1; }
# shellcheck source=scripts/deploy/env.sh
source scripts/deploy/env.sh
load_deployed_state
load_env_file .env
resolve_deploy_mode
# Other gaps only warn here (deploy-prod.sh refuses them); an unset
# TRUSTED_PROXY_CIDRS makes Compose itself refuse every command.
while IFS= read -r problem; do
    [ -n "$problem" ] && warn "edge not configured: $problem"
done < <(edge_config_problems)
exec "${COMPOSE[@]}" "$@"
