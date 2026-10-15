from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient, APITestCase


class FranchiseFetchEndpointTests(APITestCase):
    endpoint_name = "anime-franchise-fetch"

    @patch("apps.animes.services.franchise_import.FranchiseImportService.import_related_anime")
    def test_anonymous_post_requires_authentication(self, mock_import):
        response = self.client.post(
            reverse(self.endpoint_name),
            {"anilist_id": 1735, "source_slug": "naruto"},
            format="json",
        )

        self.assertEqual(response.status_code, 401)
        mock_import.assert_not_called()

    @patch("apps.animes.services.franchise_import.FranchiseImportService.import_related_anime")
    def test_authenticated_user_is_forbidden(self, mock_import):
        user = get_user_model().objects.create_user(username="normal-franchise-user", password="pass12345")
        self.client.force_authenticate(user=user)

        response = self.client.post(
            reverse(self.endpoint_name),
            {"anilist_id": 97940, "source_slug": "naruto-shippuuden"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        mock_import.assert_not_called()

    @patch("apps.animes.services.franchise_import.FranchiseImportService.import_related_anime")
    def test_superuser_session_without_csrf_token_is_rejected(self, mock_import):
        user = get_user_model().objects.create_superuser(
            username="csrf-session-user",
            email="csrf-session-user@example.com",
            password="pass12345",
        )
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(user)

        response = client.post(
            reverse(self.endpoint_name),
            {"anilist_id": 97940, "source_slug": "naruto-shippuuden"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        mock_import.assert_not_called()

    @patch("apps.animes.services.franchise_import.FranchiseImportService.import_related_anime")
    def test_invalid_anilist_id_returns_400(self, mock_import):
        user = get_user_model().objects.create_superuser(
            username="invalid-anilist-user",
            email="invalid-anilist-user@example.com",
            password="pass12345",
        )
        self.client.force_authenticate(user=user)

        response = self.client.post(
            reverse(self.endpoint_name),
            {"anilist_id": "invalid"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], "anilist_id must be a valid integer")
        self.assertEqual(response.data["code"], "invalid_anilist_id")
        mock_import.assert_not_called()
