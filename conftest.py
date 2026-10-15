import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _clear_cache():
    """Start every test with an empty cache.

    The test settings use one in-process LocMemCache, so cached responses and
    throttle counters would otherwise leak between tests.
    """
    cache.clear()
