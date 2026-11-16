"""Weekly re-read of AniList's ``isAdult`` (see ``apps/animes/adult_content.py``)."""

from ...shared.celery import observed_shared_task
from .. import adult_content


# No retry: a failed request skips its chunk (never clears a flag), and next
# week's run, or any metadata refresh of the row, catches up.
@observed_shared_task(retry_policy="none", time_limit_preset="long")
def sync_adult_flags(self):
    return adult_content.sync_adult_flags_from_anilist()
