"""Nightly safety net for ``Anime.is_adult`` (see ``apps/animes/adult_content.py``)."""

from ...shared.celery import observed_shared_task, retry_on_error
from .. import adult_content


@observed_shared_task(retry_policy="standard", time_limit_preset="standard")
def reconcile_adult_flags(self):
    with retry_on_error(self, "Adult flag reconcile failed"):
        return adult_content.reconcile_adult_flags()
