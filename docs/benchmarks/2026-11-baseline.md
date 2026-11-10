# Public API baseline (2026-11-09)

The Phase 0 baseline from `docs/REFACTOR_PLAN.md`. Later performance work
compares against this table on the same machine.

- Code: `refactor/phase0-guardrails` branched from `677caa1` (no app code changed).
- Command: `make bench-api ARGS="--rounds 5 --json /app/docs/benchmarks/2026-11-baseline.json"`
- Environment: local dev stack in WSL2 (Docker), `DJANGO_ENV=development`
  (`DEBUG=True`), Redis cache, Postgres 18.
- Raw numbers: `2026-11-baseline.json`.

Catalog: 50 anime · rounds: 5 · warm samples per round: 5 · DEBUG=True

| Endpoint | Cold p50 (ms) | Warm p50 (ms) | Cold queries | Cold SQL (ms) | Size (KB) |
|---|---:|---:|---:|---:|---:|
| `list` | 85.5 | 30.0 | 3 | 6.0 | 24.5 |
| `list_sorted_rating` | 65.1 | 34.8 | 4 | 6.0 | 1.0 |
| `search` | 83.9 | 30.2 | 3 | 6.0 | 20.8 |
| `detail` | 91.4 | 28.3 | 7 | 11.0 | 14.1 |
| `trending` | 75.5 | 29.9 | 3 | 5.0 | 19.8 |
| `top_rated` | 59.5 | 28.9 | 3 | 5.0 | 2.3 |
| `browse_rows` | 125.9 | 29.6 | 9 | 21.0 | 25.0 |
| `schedule` | 73.8 | 74.2 | 3 | 5.0 | 42.3 |
| `list_genre` | 81.8 | 29.1 | 4 | 8.0 | 21.9 |
| `public_profile` | 42.7 | 26.1 | 4 | 5.0 | 0.4 |

## Reading it

- **The catalog is small (50 rows).** The dev catalog was wiped on 2026-10-15,
  and the hourly sync has not refilled it since, because `api.jikan.moe` is
  unreachable from this network. At this size SQL is only 5–21 ms of each
  request; most cold time is Python serialization and the cache layer. Re-run
  this baseline after the catalog refills (self-hosted Jikan,
  `docker compose --profile jikan up -d`) before doing Phase 5 query work,
  because query-plan problems only appear at full size (~39k rows).
- **`schedule` is not cached on the server:** warm ≈ cold. This is Phase 5,
  step 6 in the plan.
- **Warm responses take ~30 ms even from cache.** That is the floor of the
  middleware chain plus a Redis round-trip under `DEBUG=True`. It is not a
  target by itself, but it is the number to watch if the middleware stack
  changes.
- `list_sorted_rating` and `top_rated` are almost empty because rating shelves
  require a high member count, which few rows have at this catalog size.
