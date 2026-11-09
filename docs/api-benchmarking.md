# API Benchmarking

This project includes a k6 benchmark suite to evaluate API performance by API group and endpoint tags.

## Files

- `monitoring/load-tests/k6-api-benchmark.js`: Main benchmark suite (`smoke`, `standard`, `micro`).
- `monitoring/load-tests/results/`: JSON summary output location.

## Run Modes

### 1) Smoke (CI gate)

Short run intended for CI and quick local validation.

```bash
make load-api-smoke BASE_URL=http://localhost
```

### 2) Standard (local baseline)

Longer mixed workload for local profiling and regression checks.

```bash
make load-api-standard BASE_URL=http://localhost
```

### 3) Micro (endpoint-isolated)

Runs endpoint scenarios in staggered sequence to isolate per-endpoint latency.
When credentials are omitted, micro mode runs only public endpoint scenarios.

```bash
make load-api-micro BASE_URL=http://localhost
```

## Authenticated Flows

To include authenticated user endpoints, provide benchmark credentials:

```bash
make load-api-standard \
  BASE_URL=http://localhost \
  BENCH_USERNAME=benchuser \
  BENCH_PASSWORD=benchpass
```

If credentials are not provided (or login fails), the benchmark still runs public API flows.

## Optional List CRUD Writes

List CRUD writes are disabled by default because they require a verified user profile.

```bash
make load-api-standard \
  BASE_URL=http://localhost \
  BENCH_USERNAME=benchuser \
  BENCH_PASSWORD=benchpass \
  ENABLE_LIST_WRITES=true
```

## Summary Export

Each Make target writes JSON summary to `monitoring/load-tests/results/` by default.
You can override the path:

```bash
make load-api-smoke \
  BASE_URL=http://localhost \
  SUMMARY_EXPORT_PATH=/load-tests/results/custom-summary.json
```

## Useful Environment Variables

- `BENCH_MODE`: `smoke`, `standard`, `micro` (set by Make targets).
- `BASE_URL`: target host (default `http://localhost`).
- `BENCH_USERNAME`, `BENCH_PASSWORD`: auth for user endpoints.
- `WRITE_RATIO`: write-operation probability in mixed mode (default `0.15`).
- `ENABLE_LIST_WRITES`: `true|false` (default `false`).
- `MIXED_RATE`, `MIXED_DURATION`, `MIXED_PREALLOCATED_VUS`, `MIXED_MAX_VUS`.
- `MICRO_RATE`, `MICRO_DURATION`, `MICRO_STAGGER_SECONDS`, `MICRO_PREALLOCATED_VUS`, `MICRO_MAX_VUS`.
- `REQUEST_TIMEOUT`: per-request timeout (default `10s`).

## Metrics and Tags

Each request is tagged for grouped analysis:

- `api_group`: `core`, `anime`, `forums`, `users`
- `endpoint_name`: canonical endpoint identifier
- `auth_type`: `public` or `authenticated`
- `op_type`: `read` or `write`
- `mode`: benchmark mode (`smoke|standard|micro`)

Thresholds are enforced for:

- global checks pass rate
- global failed request rate
- p95 duration per API group / op type

## In-process endpoint benchmark (refactor baselines)

`scripts/bench_public_api.py` times the public read endpoints inside Django
(test client, no HTTP or proxy) against the dev database. It reports, per
endpoint, the median cold time (app cache emptied first), the median warm time
(served from cache), and the cold request's query count and SQL time.

```bash
make bench-api                                   # Markdown table on stdout
make bench-api ARGS="--rounds 5 --json /app/docs/benchmarks/run.json"
```

It is safe to run against the dev stack: it uses its own Redis key prefix and
deletes only those keys, disables request logging (so no Celery tasks are
queued), and never writes to the database. Use it before and after a
performance change on the same machine and DB snapshot; the k6 suite above is
for load and throughput.

Two test files lock in what the benchmark measures, so a refactor can't
quietly regress it:

- `apps/animes/tests/test_query_budgets.py`: cold-cache query budgets per
  endpoint, and a check that the count doesn't grow with the number of rows
  (N+1).
- `apps/animes/tests/test_public_contract.py`: the response *shape* of each
  public endpoint, compared with `apps/animes/tests/snapshots/public_contract.json`.
