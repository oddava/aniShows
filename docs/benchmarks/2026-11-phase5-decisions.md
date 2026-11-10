# Phase 5 decisions: index audit and D6 (2026-11-10)

Measured on the seeded 40k catalog described in `2026-11-phase5-before.md`,
with D5 (`Anime.is_adult` and `anime_public_popular_list_idx`) applied.

## Step 4: index audit

Rule from the plan: drop an index only if it had **0 scans** under the
benchmark workload **and** another index fully covers it (its columns are a
leading prefix of the other index, same order and direction). Indexes that are
idle only because the synthetic workload does not exercise their feature
(admin, sync, uniqueness, filters the benchmark does not send) stay.

Workload: `pg_stat_reset()`, then `scripts/bench_public_api.py --rounds 20`
(13 endpoints, 20 cold + 100 warm requests each), then
`scripts/explain_public_queries.py index-usage`.

| Index (0 scans) | Columns | Covered by another index? | Decision |
|---|---|---|---|
| `anime_anime_anilist_id_key`, `anime_anime_mal_id_key`, `anime_anime_slug_key` | unique `anilist_id` / `mal_id` / `slug` | – | keep: uniqueness constraints, provider and sync lookups |
| `anime_anime_broadcast_day_1b8cbe8a_like` | `broadcast_day varchar_pattern_ops` | – | keep: Django creates it with `db_index=True` on a `CharField`; it cannot be dropped without changing the field |
| `anime_anime_anime_t_1361c7_idx` | `anime_type, rating DESC` | no: `(anime_type, status, rating DESC)` only shares the first column | keep: `?type=` filters |
| `anime_anime_anime_t_37eb80_idx` | `anime_type, status, rating DESC` | no | keep: `?type=&status=` filters |
| `anime_anime_status_0ee837_idx` | `status, release_date DESC` | no: the other `status` indexes continue with `anime_type`, `site_rank`, `broadcast_day` | keep: `?status=` filters |
| `anime_anime_status_d8233f_idx` | `status, anime_type, release_date DESC` | no | keep |
| `anime_anime_status_55994d_idx` | `status, site_rank DESC, rating DESC` | no | keep |
| `anime_anime_season_ad2bb0_idx` | `season, season_year, popularity_rank DESC` | no other index leads with `season` | keep |
| `anime_anime_title_81712a_idx`, `anime_anime_title_j_b0f38d_idx` | `title, status` / `title_jp, status` | no other b-tree on these columns | keep: `sort=title`, the offline import's `title__in` matching |
| `anime_anime_last_aired_at_…`, `anime_anime_offline_db_last_seen_at_…` | single column | no | keep: airing and offline-sync jobs |
| `anime_source_material_idx`, `anime_episode_count_idx`, `anime_duration_minutes_idx` | single column | no | keep: list filters the benchmark does not send |
| `anime_title_trgm_gin`, `anime_title_jp_trgm_gin`, `anime_synopsis_trgm_gin` | GIN trigram | no | keep, see the follow-up below |
| `anime_tags_gin` | GIN `tags` | no | keep: still serves `?tags=` (`tags @> [...]`); it was busy before D5 only because the adult-tag subquery ran on every request |

No index is a leading prefix of another index on `anime_anime`, so **no index
qualifies and none was dropped** (no migration for this step).

Two observations for later:

- **The trigram indexes are never used** (0 scans before and after): search
  compiles `icontains` to `UPPER(col) LIKE UPPER('%term%')`, which
  `gin_trgm_ops` cannot serve. A small custom lookup that emits `ILIKE` would
  let them serve searches that the new partial index does not (rare terms,
  viewers who opted into adult content). The three indexes take 60 MB, 48 MB
  of it for `synopsis`. Not done here: it changes the SQL search generates, and
  with D5 the common search path no longer needs it (search cold p50 377 →
  35 ms in this post-D5 run).
- `anime_tags_gin` and `anime_anime_pkey` lost most of their scans with D5
  (pkey 599,417 → 1,504 per workload): those were the anti-join subplans.

Scans per index after the workload (non-zero only):

| index | scans |
|---|---:|
| `anime_anime_broadcast_day_1b8cbe8a` | 1 |
| `anime_anime_slug_3ec903e0_like` | 21 |
| `anime_season_year_pop_idx` | 21 |
| `anime_anime_trendin_efa654_idx` | 63 |
| `anime_anime_popular_5c7763_idx` | 64 |
| `anime_anime_site_ra_cc0d00_idx` | 84 |
| `anime_public_popular_list_idx` (new, D5) | 105 |
| `anime_anime_release_251241_idx` | 147 |
| `anime_anime_member__8b889b_idx` | 168 |
| `anime_anime_season__f7b111_idx` | 231 |
| `anime_schedule_day_idx` | 242 |
| `anime_anime_pkey` | 1,504 |

## Step 5: D6 (`offline_db_payload` side table)

Measured with `scripts/explain_public_queries.py table-stats` on the seeded
catalog (40,000 rows; the seeder gives about 90% of rows a payload shaped like
a manami offline-database entry, the shape the offline import stores).

| Measure | Value |
|---|---:|
| `anime_anime` heap | 60 MB |
| `anime_anime` TOAST | 17 MB |
| `anime_anime` indexes | 88 MB |
| average row (`pg_column_size` of the whole row) | 1,890 B (72 MB total) |
| `offline_db_payload` stored | 35 MB, average 927 B |
| `offline_db_payload` values over 2 kB (TOASTed) | 0 |
| `synopsis` stored | 18 MB |
| `tags` stored | 3.2 MB |

The payload is about half of the row data and lives inline in the heap, so it
is a large share. The second condition does not hold: **no public list, search,
shelf, browse-row or schedule query selects it.** Every public queryset goes
through `.only(LIST_FIELDS)`, and the detail queryset uses
`.defer(*DETAIL_DEFER_FIELDS)`, which names `offline_db_payload`
(`public_query/fields.py`). Outside migrations and tests, only the offline
catalog import reads or writes the column.

What it still costs the public path is heap width: queries that scan the table
read pages that are half payload. To size that, a throwaway experiment
(`CREATE TABLE ... AS SELECT * FROM anime_anime` twice, payload blanked and
`VACUUM FULL` on one copy, primary keys added, no other indexes, so both copies
are scanned sequentially) ran the captured list SQL against both copies,
best of 5:

| Query (sequential scan on the copy) | With payload (ms) | Without payload (ms) |
|---|---:|---:|
| `sort=newest` | 84.5 | 75.6 |
| `sort=trending` | 147.4 | 139.3 |
| `genre=action` | 110.4 | 98.0 |
| default list, adult content allowed | 160.1 | 151.2 |

The copy without the payload has a 39 MB heap instead of 63 MB, but the
queries get only 5-11% faster: they are bound by evaluating and sorting the
ordering expressions, not by reading pages (the test catalog is fully cached).
With D5 the anonymous default list and search no longer scan the table at all.

**Decision: skipped.** The column is a large share of the table, but the public
queries do not read it, and the remaining heap-width effect is small next to
what a side table would cost (a new model and migration, a join or second write
in the offline import, and a backfill that copies 35 MB). Worth revisiting only
if the payload grows past the TOAST threshold (then it leaves the heap on its
own) or a sequential-scan list path becomes the bottleneck.
