# Public read path before Phase 5 (2026-11-10)

The "before" measurement for Phase 5 of `docs/REFACTOR_PLAN.md`. The "after"
numbers in `2026-11-phase5-after.md` were taken the same way, on the same seed.

- Code: `refactor/phase5-read-path` at `bf731db` (Phase 4 merged, no Phase 5 change yet).
- Database: the throwaway `test_db` service of this worktree's compose project
  (Postgres 18.3, tmpfs, `fsync=off`), seeded with a synthetic **40,000-anime**
  catalog. The dev DB only holds ~50 anime, which hides every query-plan cost.
- Settings: `root.settings.test` (`DEBUG=True`, LocMem cache), in-process Django
  test client, anonymous visitor (so the adult-content exclusion is active).
- Absolute numbers differ from the dev stack (tmpfs, no Redis round-trip, no
  fsync). Only the before/after comparison on this setup is meaningful.
- Raw numbers: `2026-11-phase5-before.json`; full plans:
  `2026-11-phase5-before-explain.md`.

## Commands

```sh
touch .env
docker compose --profile test up -d test_db
docker compose --profile test run --rm test python manage.py migrate
docker compose --profile test run --rm test python scripts/seed_perf_catalog.py   # seed 20261110
docker compose --profile test run --rm test python scripts/explain_public_queries.py reset-stats
docker compose --profile test run --rm test python scripts/bench_public_api.py --rounds 20 \
    --json /app/docs/benchmarks/2026-11-phase5-before.json
docker compose --profile test run --rm test python scripts/explain_public_queries.py index-usage
docker compose --profile test run --rm test python scripts/explain_public_queries.py explain \
    --runs 3 --adult-variant --output /app/scripts/.explain-before.md
docker compose --profile test run --rm test python scripts/explain_public_queries.py table-stats
docker compose --profile test rm -sf test_db    # when done
```

The seed (`scripts/seed_perf_catalog.py`, deterministic for a given `--seed`):
18 regular genres plus Hentai/Erotica, 320 studios, years 1980–2027 skewed to
recent ones, 622 airing rows with broadcast slots, ~5% upcoming, a rating on
~75% of rows, a long-tailed member count (240 rows above 200k, 831 above 25k)
with popularity/site ranks derived from it, 300 trending ranks, **1,142 rows with
an adult genre plus 133 with only an explicit tag (≈3.2%)**, an
`offline_db_payload` on ~90% of rows and an offline sync state on ~80% (0.5% of
them quarantined).

## Benchmark (20 rounds, 5 warm samples per round)

Catalog: 40,000 anime · rounds: 20 · warm samples per round: 5 · DEBUG=True

| Endpoint | Cold p50 (ms) | Cold p95 (ms) | Warm p50 (ms) | Warm p95 (ms) | Cold queries | Cold SQL (ms) | Size (KB) |
|---|---:|---:|---:|---:|---:|---:|---:|
| `list` | 244.1 | 284.7 | 5.1 | 9.1 | 4 | 209.5 | 18.1 |
| `list_sorted_rating` | 47.2 | 57.8 | 4.6 | 6.2 | 4 | 19.0 | 17.7 |
| `search` | 376.8 | 406.1 | 4.7 | 7.2 | 4 | 352.0 | 15.2 |
| `detail` | 32.9 | 39.2 | 3.4 | 5.0 | 8 | 10.0 | 2.0 |
| `trending` | 37.3 | 49.3 | 4.7 | 6.4 | 4 | 16.0 | 17.4 |
| `top_rated` | 39.7 | 44.0 | 4.9 | 7.9 | 4 | 17.5 | 19.0 |
| `browse_rows` | 177.8 | 219.6 | 6.2 | 8.7 | 14 | 95.0 | 36.0 |
| `schedule` | 344.6 | 578.9 | 350.6 | 572.7 | 4 | 37.0 | 447.5 |
| `list_sorted_newest` | 153.0 | 178.7 | 4.9 | 7.0 | 4 | 127.0 | 18.0 |
| `list_sorted_trending` | 243.2 | 281.2 | 5.4 | 8.7 | 4 | 208.5 | 17.8 |
| `list_season` | 76.1 | 96.3 | 6.7 | 11.5 | 4 | 42.0 | 17.9 |
| `list_genre` | 216.3 | 236.4 | 5.7 | 8.1 | 5 | 178.0 | 18.2 |
| `public_profile` | 12.4 | 14.3 | 3.6 | 5.5 | 4 | 4.0 | 0.4 |

`search` is `?q=Blade` (the first word of the most popular title), `list_genre`
is `?genre=action`, `list_season` is `?season=fall&year=2026`.
`list_sorted_newest`, `list_sorted_trending` and `list_season` are new in this
run; the other rows are the Phase 0 endpoints.

## EXPLAIN (ANALYZE, BUFFERS): what the time is spent on

The SQL is what the endpoints actually run, captured with
`CaptureQueriesContext` on a cold app cache (only catalog queries; the genre,
studio and prefetch queries are cheap). Each statement was explained three times
and the fastest run kept. The "no exclusion" variant is the same request with
`can_view_adult_content` forced to `True`, i.e. the identical SQL minus the two
`NOT IN` subqueries.

| Endpoint | Adult exclusion on (ms) | Exclusion off (ms) | Share of the query cost |
|---|---:|---:|---:|
| `list` | 224.0 | 193.1 | 14% |
| `search` | 355.6 | 157.8 | **56%** |
| `list_genre` | 180.1 | 139.2 | 23% |
| `browse_rows` (5 queries) | 52.3 | 29.9 | 43% |
| `schedule` | 14.3 | 6.1 | 57% |

What the plans show:

1. **The adult-content exclusion is material (decides D5).** Every exclusion
   adds two hashed subplans: a join over `anime_anime_genres` × `anime_genre`
   × `anime_anime` for the hentai/erotica slugs (1,142 ids, ~2,950 buffers,
   3.5–7.5 ms) and a GIN bitmap scan for `tags ?| [39 tags]` (402 ids, ~435
   buffers, 1.8–3.5 ms). They run once per query (and once per parallel
   worker), however few rows the query needs: the trending shelf goes from
   0.36 ms to 8.4 ms, the all-time shelf from 0.25 ms to 9.7 ms. Worse, the
   `NOT (id = ANY (hashed SubPlan))` filters wreck the row estimates
   (`rows=48` estimated vs 946 actual for search), so the search plan loses its
   parallel seq scan: 356 ms instead of 158 ms.
2. **List sorts are full-table sorts.** The default `popular` list orders by
   four `CASE` expressions, so Postgres seq-scans and quicksorts all ~38k
   visible rows (≈140 ms of the 193 ms without the exclusion) before taking 25.
   No index can serve that ordering; changing it would change behaviour and is
   out of scope for Phase 5.
3. **Search never uses the trigram indexes.** Django's `icontains` compiles to
   `UPPER(col) LIKE UPPER('%term%')`, which the `gin_trgm_ops` indexes on
   `title`, `title_jp` and `synopsis` cannot serve, so search is a seq scan over
   the whole heap (`anime_title_trgm_gin`, `anime_title_jp_trgm_gin` and
   `anime_synopsis_trgm_gin` have 0 scans below). Recorded as a follow-up; it
   is a lookup change, not one of the Phase 5 steps.
4. **`schedule` is cheap in SQL (37 ms for 4 queries) but costs 345 ms per
   request**, cold or warm, because it serializes all 622 airing rows (447 KB)
   on every request: there is no server-side cache.

## Table size (decides D6)

| rows | table incl. TOAST | heap | TOAST | indexes |
|---|---|---|---|---|
| 40000 | 77 MB | 60 MB | 17 MB | 88 MB |

| column | stored | avg bytes | rows over 2 kB |
|---|---|---|---|
| whole row | 72 MB | 1890 | – |
| `offline_db_payload` | 35 MB | 927 | 0 |
| `synopsis` | 18 MB | 474 | – |
| `tags` | 3261 kB | 83 | – |

`offline_db_payload` is about half of the stored row data, but it is never
TOASTed (no value exceeds 2 kB after compression, so it lives inline in the
heap) and **no public list or shelf query selects it**: list and shelf
querysets use `.only(LIST_FIELDS / SHELF_FIELDS)` and detail `.defer()`s it.
See the "after" report for the D6 decision.

## Index usage after the benchmark workload

`pg_stat_reset()` before the benchmark, read right after it. 32 indexes on
`anime_anime`:

| index | scans | definition |
|---|---:|---|
| anime_anime_anilist_id_key | 0 | UNIQUE (anilist_id) |
| anime_anime_anime_t_1361c7_idx | 0 | (anime_type, rating DESC) |
| anime_anime_anime_t_37eb80_idx | 0 | (anime_type, status, rating DESC) |
| anime_anime_broadcast_day_1b8cbe8a | 0 | (broadcast_day) |
| anime_anime_broadcast_day_1b8cbe8a_like | 0 | (broadcast_day varchar_pattern_ops) |
| anime_anime_last_aired_at_fe1c8c35 | 0 | (last_aired_at) |
| anime_anime_mal_id_key | 0 | UNIQUE (mal_id) |
| anime_anime_offline_db_last_seen_at_ea310ef3 | 0 | (offline_db_last_seen_at) |
| anime_anime_season_ad2bb0_idx | 0 | (season, season_year, popularity_rank DESC) |
| anime_anime_slug_key | 0 | UNIQUE (slug) |
| anime_anime_status_0ee837_idx | 0 | (status, release_date DESC) |
| anime_anime_status_55994d_idx | 0 | (status, site_rank DESC, rating DESC) |
| anime_anime_status_d8233f_idx | 0 | (status, anime_type, release_date DESC) |
| anime_anime_title_81712a_idx | 0 | (title, status) |
| anime_anime_title_j_b0f38d_idx | 0 | (title_jp, status) |
| anime_episode_count_idx | 0 | (episode_count) |
| anime_source_material_idx | 0 | (source_material) |
| anime_synopsis_trgm_gin | 0 | GIN (synopsis gin_trgm_ops) |
| anime_title_jp_trgm_gin | 0 | GIN (title_jp gin_trgm_ops) |
| anime_title_trgm_gin | 0 | GIN (title gin_trgm_ops) |
| anime_duration_minutes_idx | 1 | (duration_minutes) |
| anime_anime_slug_3ec903e0_like | 21 | (slug varchar_pattern_ops) |
| anime_season_year_pop_idx | 21 | (season_year, popularity_rank DESC) |
| anime_anime_trendin_efa654_idx | 63 | (trending_rank DESC) |
| anime_anime_popular_5c7763_idx | 106 | (popularity_rank DESC) |
| anime_anime_site_ra_cc0d00_idx | 126 | (site_rank DESC) |
| anime_anime_release_251241_idx | 147 | (release_date) |
| anime_anime_member__8b889b_idx | 210 | (member_count DESC) |
| anime_anime_season__f7b111_idx | 231 | (season_year, season, member_count DESC) |
| anime_schedule_day_idx | 242 | (status, broadcast_day, next_airing_date) |
| anime_tags_gin | 520 | GIN (tags) |
| anime_anime_pkey | 599417 | UNIQUE (id) |

The index decisions are in the "after" report.
