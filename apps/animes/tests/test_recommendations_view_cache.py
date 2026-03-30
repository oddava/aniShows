from datetime import timedelta

from django.test import SimpleTestCase
from django.utils import timezone

from apps.animes.views.recommendations import _is_recommendations_cache_fresh


class RecommendationsCacheFreshnessTests(SimpleTestCase):
    def test_returns_true_for_recent_cached_payload(self):
        now = timezone.now().isoformat()
        cached_data = [{"id": 1, "created_at": now}]

        self.assertTrue(_is_recommendations_cache_fresh(cached_data, stale_after_hours=24))

    def test_returns_false_for_stale_cached_payload(self):
        stale = (timezone.now() - timedelta(hours=25)).isoformat()
        cached_data = [{"id": 1, "created_at": stale}]

        self.assertFalse(_is_recommendations_cache_fresh(cached_data, stale_after_hours=24))

    def test_returns_false_when_created_at_is_missing_or_invalid(self):
        self.assertFalse(_is_recommendations_cache_fresh([{"id": 1}], stale_after_hours=24))
        self.assertFalse(
            _is_recommendations_cache_fresh(
                [{"id": 1, "created_at": "not-a-date"}], stale_after_hours=24
            )
        )
