from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APITestCase

from apps.admin_api.services.reports_service import generate_report
from apps.animes.models import Anime, Genre, Review, ReviewReport
from apps.core.middleware.logging_middleware import AdminAuditMiddleware
from apps.core.models import AdminPanelSettings
from apps.users.models import UserAnimeList, UserProfile

User = get_user_model()


class TestAdminSettingsAPI(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user(
            username="admin_user",
            email="admin@example.com",
            password="password123",
            is_staff=True,
        )
        self.client.force_authenticate(user=self.admin)
        self.url = "/api/v1/admin/settings/"

    def test_get_settings_initializes_persistent_record(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("general", response.data)
        self.assertEqual(AdminPanelSettings.objects.count(), 1)

    def test_put_settings_persists_to_database(self):
        payload = {
            "general": {"siteName": "aniShows Pro", "timezone": "America/New_York"},
            "security": {"sessionTimeout": 12, "apiRateLimit": 5000},
        }
        response = self.client.put(self.url, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["settings"]["general"]["siteName"], "aniShows Pro")

        cache.clear()
        get_response = self.client.get(self.url)
        self.assertEqual(get_response.status_code, status.HTTP_200_OK)
        self.assertEqual(get_response.data["general"]["siteName"], "aniShows Pro")
        self.assertEqual(get_response.data["security"]["sessionTimeout"], 12)

    def test_put_settings_rejects_invalid_types(self):
        payload = {"security": {"sessionTimeout": "abc"}}
        response = self.client.put(self.url, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("errors", response.data)
        self.assertIn("security.sessionTimeout", response.data["errors"])


class TestReviewReportFlow(APITestCase):
    def setUp(self):
        cache.clear()
        self.enrich_patch = patch("apps.animes.signals.enrich_metadata.delay", return_value=None)
        self.enrich_patch.start()
        self.addCleanup(self.enrich_patch.stop)

        self.admin = User.objects.create_user(
            username="moderator",
            email="moderator@example.com",
            password="password123",
            is_staff=True,
        )
        self.author = User.objects.create_user(
            username="author",
            email="author@example.com",
            password="password123",
        )
        self.reporter = User.objects.create_user(
            username="reporter",
            email="reporter@example.com",
            password="password123",
        )
        self.anime = Anime.objects.create(
            title="Review Report Test Anime",
            slug="review-report-test-anime",
            synopsis="Anime for review report tests.",
            status="Finished",
            anime_type="TV",
        )
        self.review = Review.objects.create(
            user=self.author,
            anime=self.anime,
            rating=8,
            text="This review should be reportable.",
            has_spoilers=False,
        )

    def test_submit_report_and_resolve_from_admin_queue(self):
        self.client.force_authenticate(user=self.reporter)
        report_response = self.client.post(
            f"/api/v1/reviews/{self.review.id}/report/",
            {"reason": ReviewReport.Reason.SPAM, "description": "Looks like spam"},
            format="json",
        )
        self.assertEqual(report_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(ReviewReport.objects.count(), 1)

        self.client.force_authenticate(user=self.admin)
        queue_response = self.client.get("/api/v1/admin/reviews/reports/?min_score=1")
        self.assertEqual(queue_response.status_code, status.HTTP_200_OK)
        self.assertEqual(queue_response.data["count"], 1)
        self.assertEqual(queue_response.data["results"][0]["id"], self.review.id)
        self.assertGreaterEqual(queue_response.data["results"][0]["open_user_reports"], 1)

        resolve_response = self.client.post(
            f"/api/v1/admin/reviews/{self.review.id}/reports/resolve/",
            {"status": ReviewReport.Status.RESOLVED, "notes": "Handled by moderator"},
            format="json",
        )
        self.assertEqual(resolve_response.status_code, status.HTTP_200_OK)

        report = ReviewReport.objects.get(review=self.review, reporter=self.reporter)
        self.assertEqual(report.status, ReviewReport.Status.RESOLVED)
        self.assertEqual(report.resolved_by_id, self.admin.id)
        self.assertIsNotNone(report.resolved_at)

        queue_after_resolution = self.client.get("/api/v1/admin/reviews/reports/?min_score=1")
        self.assertEqual(queue_after_resolution.status_code, status.HTTP_200_OK)
        self.assertEqual(queue_after_resolution.data["count"], 0)


class TestBulkOperationSafety(APITestCase):
    def setUp(self):
        self.enrich_patch = patch("apps.animes.signals.enrich_metadata.delay", return_value=None)
        self.enrich_patch.start()
        self.addCleanup(self.enrich_patch.stop)

        self.staff_admin = User.objects.create_user(
            username="staff_admin",
            email="staff-admin@example.com",
            password="password123",
            is_staff=True,
        )
        self.superuser = User.objects.create_user(
            username="root_admin",
            email="root-admin@example.com",
            password="password123",
            is_staff=True,
            is_superuser=True,
        )
        self.genre = Genre.objects.create(name="Action", slug="action")
        self.anime = Anime.objects.create(
            title="Bulk Safety Anime",
            slug="bulk-safety-anime",
            synopsis="Anime used for bulk operation safety tests.",
            status="Airing",
            anime_type="TV",
        )
        self.anime.genres.add(self.genre)
        self.bulk_url = "/api/v1/admin/bulk/"

    def test_bulk_genre_delete_requires_force_when_referenced(self):
        self.client.force_authenticate(user=self.staff_admin)
        response = self.client.post(
            self.bulk_url,
            {"operation": "delete", "entity_type": "genre", "entity_ids": [self.genre.id]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(Genre.objects.filter(id=self.genre.id).exists())

    def test_bulk_genre_delete_succeeds_with_force(self):
        self.client.force_authenticate(user=self.staff_admin)
        response = self.client.post(
            self.bulk_url,
            {
                "operation": "delete",
                "entity_type": "genre",
                "entity_ids": [self.genre.id],
                "force": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(Genre.objects.filter(id=self.genre.id).exists())

    def test_bulk_anime_delete_requires_superuser(self):
        self.client.force_authenticate(user=self.staff_admin)
        denied = self.client.post(
            self.bulk_url,
            {"operation": "delete", "entity_type": "anime", "entity_ids": [self.anime.id]},
            format="json",
        )
        self.assertEqual(denied.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(Anime.objects.filter(id=self.anime.id).exists())

        self.client.force_authenticate(user=self.superuser)
        allowed = self.client.post(
            self.bulk_url,
            {"operation": "delete", "entity_type": "anime", "entity_ids": [self.anime.id]},
            format="json",
        )
        self.assertEqual(allowed.status_code, status.HTTP_200_OK)
        self.assertFalse(Anime.objects.filter(id=self.anime.id).exists())


class TestAuditMiddlewareExtraction(TestCase):
    def setUp(self):
        self.middleware = AdminAuditMiddleware(lambda request: None)

    def test_extracts_correct_entity_and_id(self):
        self.assertEqual(self.middleware._get_entity_type("/api/v1/admin/users/123/"), "User")
        self.assertEqual(self.middleware._extract_entity_id("/api/v1/admin/users/123/"), "123")

    def test_ignores_action_paths_for_entity_id(self):
        self.assertEqual(self.middleware._get_entity_type("/api/v1/admin/reports/"), "Report")
        self.assertEqual(self.middleware._extract_entity_id("/api/v1/admin/reviews/reports/"), "")


class TestReportsServiceCache(TestCase):
    def setUp(self):
        cache.clear()

    def test_generate_report_uses_cache_and_force_refresh(self):
        with patch(
            "apps.admin_api.services.reports_service._overview_payload",
            return_value={"ok": True},
        ) as payload_builder:
            first = generate_report("overview", 30)
            second = generate_report("overview", 30)
            refreshed = generate_report("overview", 30, force_refresh=True)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(refreshed.status_code, 200)
        self.assertEqual(payload_builder.call_count, 2)


class TestRuntimePolicyControls(APITestCase):
    def setUp(self):
        cache.clear()
        self.enrich_patch = patch("apps.animes.signals.enrich_metadata.delay", return_value=None)
        self.enrich_patch.start()
        self.addCleanup(self.enrich_patch.stop)

        self.admin = User.objects.create_user(
            username="ops_admin",
            email="ops-admin@example.com",
            password="password123",
            is_staff=True,
        )
        self.regular_user = User.objects.create_user(
            username="regular_user",
            email="regular@example.com",
            password="password123",
        )
        UserProfile.objects.update_or_create(user=self.regular_user, defaults={"email_verified": True})
        self.anime = Anime.objects.create(
            title="Runtime Controls Anime",
            slug="runtime-controls-anime",
            synopsis="Anime for runtime controls tests.",
            status="Airing",
            anime_type="TV",
        )
        self.genre = Genre.objects.create(name="Runtime", slug="runtime")
        self.anime.genres.add(self.genre)

    def _set_settings(self, payload: dict):
        AdminPanelSettings.objects.update_or_create(
            key="global",
            defaults={"data": payload, "updated_by": self.admin},
        )
        cache.clear()

    def test_maintenance_mode_blocks_public_api_but_not_admin(self):
        self._set_settings({"general": {"maintenanceMode": True}})

        public_response = self.client.get("/api/v1/genres/")
        self.assertEqual(public_response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

        self.client.force_authenticate(user=self.admin)
        admin_response = self.client.get("/api/v1/admin/settings/")
        self.assertEqual(admin_response.status_code, status.HTTP_200_OK)

    def test_maintenance_mode_allows_authenticated_profile_lookup(self):
        self._set_settings({"general": {"maintenanceMode": True}})

        self.client.force_authenticate(user=self.admin)
        profile_response = self.client.get("/api/v1/users/me/")
        self.assertEqual(profile_response.status_code, status.HTTP_200_OK)
        self.assertEqual(profile_response.data["username"], self.admin.username)

    def test_maintenance_mode_keeps_me_endpoint_protected_for_anonymous(self):
        self._set_settings({"general": {"maintenanceMode": True}})

        profile_response = self.client.get("/api/v1/users/me/")
        self.assertEqual(profile_response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_health_endpoint_reports_maintenance_without_failing_liveness(self):
        self._set_settings({"general": {"maintenanceMode": True}})

        response = self.client.get("/api/v1/health/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertEqual(payload["status"], "maintenance")
        self.assertTrue(payload["maintenance_mode"])
        self.assertFalse(payload["service_available"])
        self.assertIn("detail", payload)
        self.assertEqual(payload["retry_after"], 300)

    @patch("apps.core.views.health.connection.cursor")
    @patch("apps.core.views.health.cache.get", side_effect=RuntimeError("cache offline"))
    @patch("apps.core.views.health.cache.set", side_effect=RuntimeError("cache offline"))
    def test_liveness_endpoint_stays_up_when_dependencies_fail(
        self,
        _mock_cache_set,
        _mock_cache_get,
        _mock_cursor,
    ):
        response = self.client.get("/api/v1/health/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertEqual(payload["checks"], {"app": True})

    def test_readiness_endpoint_reports_dependency_checks(self):
        response = self.client.get("/api/v1/health/ready/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertIn("database", payload["checks"])
        self.assertIn("cache", payload["checks"])

    def test_registration_can_be_disabled(self):
        self._set_settings({"general": {"allowRegistration": False}})

        response = self.client.post(
            "/api/v1/auth/register/",
            {"username": "newuser123", "email": "newuser@example.com", "password": "securepass123"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

    def test_register_respects_dynamic_username_length(self):
        self._set_settings({"users": {"minUsernameLength": 6, "maxUsernameLength": 8}})

        too_short = self.client.post(
            "/api/v1/auth/register/",
            {"username": "short", "email": "short@example.com", "password": "securepass123"},
            format="json",
        )
        self.assertEqual(too_short.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", too_short.data)

        too_long = self.client.post(
            "/api/v1/auth/register/",
            {
                "username": "verylongusername",
                "email": "verylong@example.com",
                "password": "securepass123",
            },
            format="json",
        )
        self.assertEqual(too_long.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", too_long.data)

    def test_registration_can_skip_email_verification_when_disabled(self):
        self._set_settings({"users": {"emailVerification": False}})

        response = self.client.post(
            "/api/v1/auth/register/",
            {
                "username": "verifiedonregister",
                "email": "verified-on-register@example.com",
                "password": "securepass123",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        user = User.objects.get(username="verifiedonregister")
        self.assertTrue(user.userprofile.email_verified)

    def test_reviews_can_be_disabled(self):
        self._set_settings({"content": {"enableReviews": False}})
        self.client.force_authenticate(user=self.regular_user)
        UserAnimeList.objects.create(
            user=self.regular_user,
            anime=self.anime,
            status=UserAnimeList.UserAnimeStatus.completed,
        )

        response = self.client.post(
            "/api/v1/reviews/",
            {"anime_slug": self.anime.slug, "rating": 8, "text": "Should be blocked"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
