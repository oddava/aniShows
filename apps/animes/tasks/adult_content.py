"""Weekly re-read of AniList's ``isAdult`` (see ``apps/animes/adult_content.py``)."""

from ...shared.celery import observed_shared_task
from .. import adult_content

# Rows per task run: 10 AniList requests (50 IDs each), about 20 seconds at
# the default 30 requests a minute (ANILIST_RATE_LIMIT_PER_MINUTE). Each run
# queues the next, so with one worker process (the lean profile) other tasks,
# such as verification and password-reset emails, wait at most one run.
ROWS_PER_RUN = 500


# No retry: a failed request skips its chunk (never clears a flag), and next
# week's run, or any metadata refresh of the row, catches up.
@observed_shared_task(retry_policy="none", time_limit_preset="standard")
def sync_adult_flags(self, after_pk: int = 0):
    totals = adult_content.sync_adult_flags_from_anilist(after_pk=after_pk, limit=ROWS_PER_RUN)
    if totals["checked"] >= ROWS_PER_RUN:
        sync_adult_flags.apply_async(kwargs={"after_pk": totals["last_pk"]}, queue="low_priority")
    return totals
