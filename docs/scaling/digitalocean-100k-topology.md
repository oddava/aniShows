# DigitalOcean 100k Topology

## Reality Check

A single droplet (`2 vCPU / 8 GB RAM`) cannot sustain 100k active users for this stack in production.  
Use a multi-node topology.

## Target Topology (DigitalOcean)

1. Edge and routing:
- DigitalOcean Load Balancer (TLS termination)
- At least 3 app droplets behind LB

2. App tier:
- `web` + `daphne` on app droplets
- Caddy configured with multi-upstream `WEB_UPSTREAMS` / `WS_UPSTREAMS`

3. Worker tier:
- Separate worker droplets
- run `celery`, `celery_priority`, `celery_images`, `celery_analytics` independently

4. Data tier:
- Managed PostgreSQL (primary + read replica)
- Managed Redis (high availability)
- PgBouncer enabled between app and Postgres

5. Static/media:
- DigitalOcean Spaces + CDN for `/assets` and `/media`
- keep immutable caching for hashed assets

## Minimum Suggested Starting Capacity

- 3x app droplets: `4 vCPU / 8-16 GB`
- 2x worker droplets: `4 vCPU / 8 GB`
- Managed Postgres: CPU-optimized tier with read replica
- Managed Redis: dedicated plan with memory headroom > 2x peak working set

## App Configuration

Set these production env values:

- `DB_USE_PGBOUNCER=True`
- `DB_ENABLE_READ_REPLICA_ROUTING=True`
- `DB_REPLICA_HOSTS=<managed_pg_replica_host>`
- `REDIS_HOST=<managed_redis_host>`
- `REDIS_CACHE_MAX_CONNECTIONS=500`
- `REDIS_CHANNEL_LAYER_CAPACITY=3000`
- `GUNICORN_WORKERS=8` (adjust per droplet CPU/memory)
- `GUNICORN_BACKLOG=4096`
- `REQUEST_LOG_SUCCESS_SAMPLE_RATE=0.05`

For Caddy on each node:

- `WEB_UPSTREAMS="web:8000"`
- `WS_UPSTREAMS="daphne:8001"`

For multi-container single-node fallback:

- use `deploy-prod.sh` scale envs (`SCALE_WEB`, `SCALE_DAPHNE`, etc.)
- this is only transitional and not a 100k architecture

## Rollout Sequence

1. Move DB and Redis to managed services.
2. Split workers from web nodes.
3. Add at least 3 web/daphne droplets behind LB.
4. Enable CDN for static/media.
5. Run staged load test: 10k -> 25k -> 50k -> 100k.
6. Apply canary rollout with rollback triggers from `100k-production-plan.md`.
