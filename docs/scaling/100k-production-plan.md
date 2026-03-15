# 100k Active Users Plan

## Current State

The current stack is not guaranteed to safely support 100k concurrent active users without additional capacity and tuning. Key risks were:

- aggressive request-level logging volume
- repeated runtime policy cache reads on hot paths
- unread-notification count queries on websocket and notification fanout paths
- conservative infra defaults in horizontal-scaling Terraform
- fixed single-instance deploy behavior in production script

On a single `2 vCPU / 8 GB` droplet, 100k active users is not feasible. This requires horizontal scaling and managed data services.

## Implemented Changes

1. Runtime pressure reduction:
- added local in-process cache for admin runtime settings lookups
- request logging now samples successful traffic and always keeps errors/admin/auth logs
- notification unread counts now use cache-backed counters with DB fallback

2. High-concurrency tunables:
- added env-driven Redis connection-pool and channel-layer capacity settings
- added Gunicorn backlog/worker lifecycle/concurrency tuning envs
- added Caddy upstream pool envs (`WEB_UPSTREAMS`, `WS_UPSTREAMS`) with load-balancing and active health checks

3. Production deployment scaling:
- `deploy-prod.sh` now supports service scaling flags via env:
  - `SCALE_WEB`, `SCALE_DAPHNE`
  - `SCALE_CELERY`, `SCALE_CELERY_PRIORITY`
  - `SCALE_CELERY_IMAGES`, `SCALE_CELERY_ANALYTICS`

4. Infrastructure defaults:
- Terraform horizontal-scaling defaults now target higher throughput:
  - larger ASG footprint
  - larger RDS classes/storage
  - larger Redis nodes/cluster count
  - configurable autoscaling targets and warmup

## Validation Gates (Required Before Production Claim)

1. Load test to 25k concurrent users with p95 API latency <= 300ms and error rate < 0.5%.
2. Load test to 50k concurrent users with stable queue depths and no sustained 5xx bursts.
3. Load test to 100k concurrent users with:
- autoscaling convergence < 10 minutes
- DB CPU < 70% sustained
- Redis used memory < 75%
- websocket disconnect rate < 1% per hour
4. Canary rollout with 5% traffic, then 25%, then 100%.

## Rollback Triggers

- 5xx > 1% for 5 minutes
- p95 latency > 1s for 10 minutes
- ALB unhealthy targets > 10%
- Redis evicted keys increasing continuously for 5 minutes

## DigitalOcean Note

If hosting on DigitalOcean, replace single-droplet deployment with:

- Load Balancer in front of multiple app droplets
- Dedicated worker droplets
- Managed PostgreSQL (primary + read replica)
- Managed Redis
- Spaces + CDN for static/media

Reference: `docs/scaling/digitalocean-100k-topology.md`
