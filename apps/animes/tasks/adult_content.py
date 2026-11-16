"""Weekly re-read of AniList's ``isAdult`` (see ``apps/animes/adult_content.py``)."""

from ...shared.celery import observed_shared_task
from .. import adult_content

# Rows per task run: about 4 AniList requests (50 IDs each), well under a
# minute at the default rate limit. Each run queues the next, so with one
# worker process (the lean profile) other tasks, such as emails, run between.
ROWS_PER_RUN = 2000


# No retry: a failed request skips its chunk (never clears a flag), and next
# week's run, or any metadata refresh of the row, catches up.
@observed_shared_task(retry_policy="none", time_limit_preset="standard")
def sync_adult_flags(self, after_pk: int = 0):
    totals = adult_content.sync_adult_flags_from_anilist(after_pk=after_pk, limit=ROWS_PER_RUN)
    if totals["checked"] >= ROWS_PER_RUN:
        sync_adult_flags.apply_async(kwargs={"after_pk": totals["last_pk"]}, queue="low_priority")
    return totals
