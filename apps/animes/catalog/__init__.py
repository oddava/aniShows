"""The catalog engine: every anime row comes from AniList through here.

One source (AniList), one scope rule (``scope``), one writer (``writer``) and a few
lanes (``lanes``), each keeping one kind of data fresh:

- ``seasons``   previous, current, next and the one after: every title, every 6 hours
- ``delta``     anything AniList edited since the last run, every 15 minutes
- ``trending``  the trending top 50 and its ranks, hourly
- ``airing``    schedules of the shows on air, hourly
- ``hydrate``   full details (cast, staff, images) for the titles people look at
- ``seed``      a resumable sweep of the whole scope, year by year; weekly re-sweep

``runner.run_lane`` runs one lane, records a ``CatalogRun`` and keeps lanes from
overlapping. AniList answers 30 requests a minute and caps any paged query at
5,000 results, which is why the sweep walks one release year at a time.
"""
