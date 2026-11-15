# Public search: trigram indexes, before and after (2026-11-16)

Seeded catalog: 40,000 anime (`scripts/seed_perf_catalog.py`, seed 20261110),
`ANALYZE`d, Postgres 18. Anonymous `GET /api/v1/anime/?q=<term>&page_size=24`,
cold app cache; `EXPLAIN (ANALYZE, BUFFERS)` of the page query, best of 3.
Raw plans: `2026-11-search-before.json`, `2026-11-search-after.json`.

## Why the indexes were unused

`icontains` compiles to `UPPER("title"::text) LIKE UPPER('%x%')`. The
`gin_trgm_ops` indexes are on `title`, `title_jp` and `synopsis`, not on
`UPPER(...)`, so no plan could use them: every selective search read all
40,000 rows.

## What changed

- `title__ilike` (a small lookup, `apps/animes/lookups.py`) emits
  `title ILIKE '%x%'`, which `gin_trgm_ops` serves.
- Fuzzy matching: `title__trigram_word_similar` (`title %> 'x'`, i.e.
  `word_similarity('x', title)` ≥ `pg_trgm.word_similarity_threshold`, set to
  0.5 per connection; the default 0.6 misses `narto`/`one peice`), also
  index-served. Several words: each must appear or be a close match.
- No `sort` (navbar search): results are ordered by exact title, then title
  prefix, then word similarity, with the popular order breaking ties, among
  the 500 most popular matches (`RELEVANCE_WINDOW`), so a common word is not
  scored row by row. An explicit `sort` keeps its order.

## Results

| case | term | before ms | before plan | after ms | after plan (catalog indexes) |
|---|---|---:|---|---:|---|
| common word, no sort | `Season` | 328.5 | seq scan | 68.7 | popular index (window) |
| common word, sort=popular | `Season` | 323.2 | seq scan | 3.4 | popular index |
| rare word, no sort | `Bachime` | 315.9 | seq scan | 23.0 | title / title_jp / synopsis trigram |
| rare word, sort=popular | `Bachime` | 313.9 | seq scan | 19.5 | title / title_jp / synopsis trigram |
| typo, no sort | `Bcahime` | 328.3 (0 results) | seq scan | 2.6 (fuzzy hits) | title / title_jp / synopsis trigram |
| two words, no sort | `Kibuyu Bachime` | 71.2 | seq scan | 6.2 | title / title_jp trigram |
| no match | `zzqxjv` | 312.3 | seq scan | 0.5 | title / title_jp / synopsis trigram |
| two letters, no sort | `se` | — | — | 16.8 | popular index (window) |
| two letters, sort=popular | `se` | — | — | 0.4 | popular index |

After the runs, `pg_stat_user_indexes`: `anime_title_trgm_gin` 128 scans,
`anime_title_jp_trgm_gin` 128, `anime_synopsis_trgm_gin` 48. No search plan
contains `Seq Scan on anime_anime`.

Dense terms are served by walking `anime_public_popular_list_idx` (the planner
picks it when matches are frequent); selective terms by a `BitmapOr` over the
trigram indexes, e.g. for `Bachime`:

```
->  Bitmap Heap Scan on anime_anime u0  (actual time=3.985..17.808 rows=110)
      Recheck Cond: ((title ~~* '%Bachime%') OR (title_jp ~~* '%Bachime%')
                     OR (title %> 'Bachime') OR (title_jp %> 'Bachime')
                     OR (synopsis ~~* '%Bachime%'))
      ->  BitmapOr
            ->  Bitmap Index Scan on anime_title_trgm_gin     Index Cond: (title ~~* '%Bachime%')
            ->  Bitmap Index Scan on anime_title_jp_trgm_gin  Index Cond: (title_jp ~~* '%Bachime%')
            ->  Bitmap Index Scan on anime_title_trgm_gin     Index Cond: (title %> 'Bachime')
            ->  Bitmap Index Scan on anime_title_jp_trgm_gin  Index Cond: (title_jp %> 'Bachime')
            ->  Bitmap Index Scan on anime_synopsis_trgm_gin  Index Cond: (synopsis ~~* '%Bachime%')
Execution Time: 22.999 ms
```

`apps/animes/tests/test_search_trigram.py` fails if a search condition stops
being one these indexes can serve.
