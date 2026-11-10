# Public read path after Phase 5 (2026-11-10)

The "after" measurement for Phase 5 of `docs/REFACTOR_PLAN.md`, on the same
synthetic 40,000-anime catalog as `2026-11-phase5-before.md` (same seed, same
generator, a fresh `test_db`, settings `root.settings.test`, anonymous visitor).
The step 4 and step 5 decisions (index audit, D6) are in
`2026-11-phase5-decisions.md`.

- Code: `refactor/phase5-read-path` at the step 6 commit (`5c1bfc4`).
- Raw numbers: `2026-11-phase5-after.json` (medians of five runs, same format
  as the before file) and `2026-11-phase5-ab-runs.json` (all ten runs); full
  plans: `2026-11-phase5-after-explain.md`.

## Method: same-session A/B

The machine was much noisier in the afternoon than when the before numbers were
taken (another project's containers running, swap in use): a first after run
showed endpoints that Phase 5 does not touch (`public_profile`, `detail`) at
twice their morning time. Comparing that run with the morning file would have
measured the host, not the code.

So both sides were measured again on the same fresh seed, interleaved, five
runs each. The "before" side is this worktree with `apps/` checked out at
`bf731db` (`git checkout bf731db -- apps`, restored afterwards). It runs read-only
against the migrated schema, where the extra `is_adult` column and index don't
change its SQL. Run order:
`B A A B B A A B B A`. Each cell below is the median of the five per-run
values. The spread is in the second table.

## Commands

```sh
touch .env
docker compose --profile test rm -sf test_db
docker compose --profile test up -d test_db
docker compose --profile test run --rm test python manage.py migrate
docker compose --profile test run --rm test python scripts/seed_perf_catalog.py   # seed 20261110

# one benchmark run (repeated per side; before side: git checkout bf731db -- apps)
docker compose --profile test run --rm test python scripts/bench_public_api.py --rounds 20 \
    --json /app/scripts/.ab-after1.json
git checkout HEAD -- apps

# plans, index usage and table size on the after code
docker compose --profile test run --rm test python scripts/explain_public_queries.py reset-stats
docker compose --profile test run --rm test python scripts/bench_public_api.py --rounds 20
docker compose --profile test run --rm test python scripts/explain_public_queries.py index-usage
docker compose --profile test run --rm test python scripts/explain_public_queries.py explain \
    --runs 3 --adult-variant --output /app/scripts/.explain-after.md
docker compose --profile test run --rm test python scripts/explain_public_queries.py table-stats
docker compose --profile test rm -sf test_db    # when done
```

## Before / after (median of 5 interleaved runs each, 20 rounds, 5 warm samples per round)

| Endpoint | Cold p50 (ms) | Δ | Cold p95 (ms) | Warm p50 (ms) | Δ | Warm p95 (ms) | Cold queries | Cold SQL (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `list` | 293.3 → **53.2** | **-82%** | 334.2 → 62.1 | 7.4 → 8.0 | +8% | 10.4 → 10.9 | 4 → 4 | 254.5 → 11.0 |
| `list_sorted_rating` | 60.2 → **51.5** | -14% | 72.1 → 66.6 | 7.3 → 7.6 | +4% | 10.3 → 11.6 | 4 → 4 | 24.0 → 19.0 |
| `search` | 466.9 → **60.4** | **-87%** | 491.5 → 66.9 | 7.4 → 7.4 | +0% | 10.2 → 9.8 | 4 → 4 | 428.0 → 24.0 |
| `detail` | 53.5 → **53.6** | +0% | 59.0 → 57.6 | 6.1 → 6.3 | +3% | 8.7 → 8.8 | 8 → 8 | 15.5 → 15.5 |
| `trending` | 50.2 → **35.8** | -29% | 67.1 → 53.0 | 6.9 → 7.3 | +6% | 9.8 → 10.9 | 4 → 4 | 20.0 → 8.0 |
| `top_rated` | 55.5 → **47.0** | -15% | 63.2 → 55.0 | 7.4 → 7.2 | -3% | 11.4 → 9.7 | 4 → 4 | 24.0 → 19.0 |
| `browse_rows` | 222.7 → **174.8** | -22% | 267.5 → 210.4 | 8.7 → 9.4 | +8% | 11.7 → 12.2 | 14 → 14 | 114.0 → 73.0 |
| `schedule` | 421.7 → **525.0** | +24% ¹ | 709.4 → 718.6 | 415.6 → **42.8** | **-90%** | 732.3 → 53.1 | 4 → 4 | 47.0 → 35.0 |
| `list_sorted_newest` | 191.5 → **168.9** | -12% | 205.9 → 194.7 | 7.5 → 7.5 | +0% | 11.1 → 10.7 | 4 → 4 | 155.0 → 134.0 |
| `list_sorted_trending` | 284.0 → **260.4** | -8% | 309.6 → 306.5 | 7.8 → 7.6 | -3% | 11.3 → 10.2 | 4 → 4 | 245.5 → 224.0 |
| `list_season` | 83.2 → **76.1** | -9% | 92.0 → 87.8 | 7.5 → 7.5 | +0% | 10.3 → 10.3 | 4 → 4 | 42.5 → 36.0 |
| `list_genre` | 249.9 → **214.0** | -14% | 265.7 → 233.9 | 7.6 → 7.7 | +1% | 10.7 → 10.5 | 5 → 5 | 203.5 → 168.0 |
| `public_profile` | 18.1 → **17.5** | -3% | 22.1 → 21.1 | 5.8 → 5.8 | +0% | 8.9 → 8.4 | 4 → 4 | 6.0 → 5.0 |

Cold query counts are unchanged everywhere; the query-budget test is unchanged
(`schedule` stays at 4 anonymous cold queries). Warm differences of a few
percent are within run-to-run spread (the warm path of every endpoint except
`schedule` is the same cache-hit code before and after).

Against the morning's `2026-11-phase5-before.md` (quieter host), the list and
search targets hold too: `list` 244.1 → 53.2 ms, `search` 376.8 → 60.4 ms cold
p50.

¹ **Cold `schedule`.** This is the one cell above +10%, and it is not a code
cost. On a miss the endpoint runs the same query and serializes the same 622
rows as before, plus two `cache.set` calls for the fresh and stale copies
(about 9 ms for the 447 KB payload under `cProfile`). Measured on its own, with
25 cold requests in a row per side, interleaved `B A B A`, cold `schedule` is
396 / 386 ms before and 384 / 419 ms after: +3%, within noise. The benchmark's
+24% comes from what runs between its cold samples. Before, the five "warm"
requests in each round were full builds too, so every sample saw the same
interpreter state. Now they are cache hits that unpickle the payload, and the
next cold build's ~100k-object serialization lands at a different point in
Python's GC cycle. The same isolated loop with the GC switched off runs at
370–383 ms whether or not cache hits are interleaved, and 407–580 ms with it
on. In production a schedule miss happens once per cache key per 10-minute TTL
(16 keys: 7 days plus "all", times 2 adult settings), and every other request
takes the warm path, now 43 ms instead of 416 ms.

Spread of the per-run cold and warm p50 (ms), in run order:

| Endpoint | before cold | after cold | before warm | after warm |
|---|---|---|---|---|
| `list` | 394.2 / 255.6 / 293.3 / 287.9 / 303.7 | 53.2 / 56.8 / 46.2 / 53.3 / 44.7 | 11.8 / 6.8 / 7.2 / 7.4 / 7.8 | 8.0 / 9.1 / 7.7 / 8.3 / 6.9 |
| `list_sorted_rating` | 81.9 / 53.7 / 63.9 / 60.1 / 60.2 | 58.9 / 51.4 / 51.1 / 55.3 / 51.5 | 10.3 / 6.3 / 7.4 / 7.2 / 7.3 | 8.5 / 6.9 / 7.6 / 7.8 / 7.5 |
| `search` | 524.7 / 413.2 / 466.9 / 462.5 / 467.9 | 61.6 / 64.6 / 58.0 / 60.4 / 57.7 | 9.3 / 6.3 / 7.1 / 7.4 / 7.4 | 7.5 / 7.4 / 7.4 / 7.3 / 6.8 |
| `detail` | 61.4 / 40.1 / 53.5 / 54.8 / 47.1 | 53.6 / 54.8 / 50.1 / 56.2 / 49.3 | 6.7 / 4.7 / 6.1 / 6.2 / 5.5 | 6.3 / 6.5 / 5.5 / 6.9 / 5.8 |
| `trending` | 51.6 / 42.0 / 52.2 / 50.2 / 48.2 | 36.6 / 38.6 / 35.2 / 35.8 / 31.5 | 6.8 / 6.1 / 7.6 / 7.0 / 6.9 | 6.8 / 7.7 / 7.3 / 7.6 / 6.9 |
| `top_rated` | 59.3 / 44.8 / 55.5 / 56.7 / 55.3 | 45.3 / 49.8 / 47.0 / 50.6 / 45.3 | 8.1 / 6.1 / 7.3 / 7.8 / 7.4 | 6.4 / 7.9 / 7.2 / 7.3 / 6.9 |
| `browse_rows` | 255.5 / 189.8 / 222.7 / 224.8 / 218.4 | 180.9 / 177.4 / 160.2 / 174.8 / 165.4 | 9.5 / 7.3 / 8.7 / 9.4 / 8.4 | 9.7 / 9.5 / 8.9 / 9.4 / 8.4 |
| `schedule` | 453.7 / 473.3 / 411.3 / 402.8 / 421.7 | 581.5 / 499.3 / 525.0 / 529.8 / 520.6 | 455.1 / 386.7 / 422.3 / 412.2 / 415.6 | 44.8 / 42.8 / 43.0 / 42.4 / 41.2 |
| `list_sorted_newest` | 203.9 / 141.3 / 196.5 / 191.5 / 188.3 | 175.7 / 168.9 / 168.9 / 164.1 / 168.0 | 7.7 / 4.7 / 8.2 / 7.5 / 7.4 | 8.1 / 7.5 / 7.2 / 7.0 / 7.6 |
| `list_sorted_trending` | 300.8 / 206.8 / 284.0 / 286.8 / 281.9 | 269.3 / 250.8 / 260.4 / 257.2 / 263.2 | 8.6 / 4.6 / 7.8 / 7.8 / 7.2 | 7.6 / 7.1 / 7.7 / 7.2 / 7.6 |
| `list_season` | 86.6 / 56.7 / 83.1 / 84.3 / 83.2 | 77.7 / 63.3 / 76.1 / 75.2 / 77.4 | 7.8 / 4.5 / 7.5 / 7.4 / 7.5 | 8.0 / 5.4 / 7.2 / 7.8 / 7.5 |
| `list_genre` | 259.5 / 154.3 / 257.6 / 249.9 / 238.9 | 217.4 / 186.1 / 217.5 / 214.0 / 206.2 | 7.8 / 4.3 / 8.1 / 7.6 / 7.3 | 7.7 / 6.5 / 8.3 / 7.7 / 7.5 |
| `public_profile` | 19.4 / 9.3 / 20.2 / 18.1 / 16.0 | 19.7 / 15.4 / 17.5 / 17.7 / 16.8 | 6.3 / 2.8 / 6.3 / 5.8 / 5.2 | 6.5 / 4.8 / 5.8 / 5.6 / 5.9 |

## EXPLAIN (ANALYZE, BUFFERS) after

Same capture as in the before report: catalog SQL only, best of 3; the "adult
content allowed" variant forces `can_view_adult_content` to `True`.

| Endpoint | Anonymous before (ms) | Anonymous after (ms) | Adult content allowed, after (ms) |
|---|---:|---:|---:|
| `list` | 224.0 | **0.63** | 265.8 |
| `search` | 355.6 | **14.9** | 191.8 |
| `list_genre` | 180.1 | 231.4 ² | 197.9 |
| `browse_rows` (5 queries) | 52.3 | 40.1 | 40.9 |
| `schedule` | 14.3 | 7.5 | 6.5 |

- **`list` and `search`** now read `anime_public_popular_list_idx` (partial,
  `WHERE NOT is_adult`, on the default ordering's expressions) in order and stop
  once the page is full, instead of sorting the whole table. `search` applies
  the `LIKE` predicates while it walks the index, until the page is full (21
  rows for `?q=Blade`, after 1,050 index entries).
- **The NOT IN subplans are gone.** Every anonymous query filters on
  `NOT is_adult` instead (1,544 rows removed), so the row estimates are sane
  again.
- ² **`list_genre`** still joins the genre's ~12.5k rows and sorts them
  (`count(DISTINCT genre_id)` per group decides the plan, not the adult filter);
  this one plan was taken while the host was slow, see the benchmark table for
  the like-for-like change (-14% cold). Sorted lists other than the default
  (`newest`, `trending`, genre and season filters) keep their full sorts. Only
  the default ordering got an index; more expression indexes would be new
  schema for each sort key and were not in scope.
- Viewers who opted into adult content don't get the partial index (their
  `list` is 266 ms in EXPLAIN on this host). Their requests skip the anonymous
  list cache too, the same as before Phase 5.

## Searches with few or no matches (regression)

Reading the partial index in order only pays off when matches turn up early.
For a term that matches little or nothing, Postgres still picks the index
(it estimates ~180 matches for any `%term%`) and then walks all 38k entries
with a heap fetch per row. Same seed, anonymous, best of 3 `EXPLAIN ANALYZE`,
before and after measured back to back:

| `?q=` | Before (ms, plan) | After (ms, plan) |
|---|---:|---:|
| `Blade` (common: first word of the most popular title) | 330.2, seq scan | **9.0**, partial index |
| `Moon Lantern` (two words, few matches) | 67.9, seq scan | 69.8, seq scan |
| `Qzxv` (no match) | 136.2, seq scan | **318.7**, partial index |

A search with no results is 2.3× slower than before. It is not covered by the
benchmark, and it was not mitigated here: steering search away from the index
would give up the common case. Blocking that one plan would mean rewriting the
search SQL. The fix is the trigram follow-up in `2026-11-phase5-decisions.md`:
an `ILIKE` lookup lets the existing `gin_trgm_ops` indexes find the matching
rows directly, which makes rare and common terms both cheap. It changes the
SQL search emits, so it needs its own behaviour review.

## Index usage after the workload

`anime_public_popular_list_idx` (3.7 MB) is used by the default list and search
(42 scans in the workload above). `anime_tags_gin` fell from 520 scans to 0, and
`anime_anime_pkey` from 599,417 to 4,547: both served the old adult-exclusion
subplans. The other indexes are as in the before report. Nothing was dropped
(see `2026-11-phase5-decisions.md`).

## Table size

| rows | table incl. TOAST | heap | TOAST | indexes |
|---|---|---|---|---|
| 40000 | 80 MB | 63 MB | 17 MB | 93 MB |

The heap grows by 3 MB for `is_adult` (one byte, padded) and the indexes by
5 MB: 3.7 MB for `anime_public_popular_list_idx`, the rest normal fill on a
fresh load. `offline_db_payload` is unchanged at 35 MB, average 927 bytes
(D6 skipped).
