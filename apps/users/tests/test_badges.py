"""Featured badges and the badge service (G5 P1-10)."""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APITestCase

from ..models import Badge, UserBadge, UserProfile
from ..services.badge_service import grant_badge, revoke_badge

User = get_user_model()

FEATURED_URL = "/api/v1/badges/featured/"


class FeaturedBadgesTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("holder", "holder@example.com", "pw-123456")
        UserProfile.objects.filter(user=self.user).update(email_verified=True)
        self.grants = [
            UserBadge.objects.create(
                user=self.user, badge=Badge.objects.create(name=f"B{i}", description="d")
            )
            for i in range(5)
        ]
        self.ids = [grant.id for grant in self.grants]
        self.client.force_authenticate(self.user)

    def _put(self, badge_ids):
        return self.client.put(FEATURED_URL, {"badge_ids": badge_ids}, format="json")

    def _featured_ids(self) -> set[int]:
        return set(
            UserBadge.objects.filter(user=self.user, is_featured=True).values_list("id", flat=True)
        )

    def test_sets_exactly_the_given_badges(self):
        UserBadge.objects.filter(pk=self.ids[4]).update(is_featured=True)

        with patch("apps.users.services.badge_service.invalidate_user_caches") as invalidate:
            response = self._put(self.ids[:3])

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._featured_ids(), set(self.ids[:3]))
        self.assertEqual({row["id"] for row in response.data["featured_badges"]}, set(self.ids[:3]))
        self.assertTrue(all(row["is_featured"] for row in response.data["featured_badges"]))
        invalidate.assert_called_once_with(
            self.user.id, self.user.username, trigger_stats_update=False
        )

    def test_empty_list_clears(self):
        UserBadge.objects.filter(pk=self.ids[0]).update(is_featured=True)
        self.assertEqual(self._put([]).status_code, 200)
        self.assertEqual(self._featured_ids(), set())

    def test_invalid_payloads_are_400_and_change_nothing(self):
        UserBadge.objects.filter(pk=self.ids[4]).update(is_featured=True)
        other = User.objects.create_user("other", "other@example.com", "pw-123456")
        foreign = UserBadge.objects.create(user=other, badge=self.grants[0].badge)
        Badge.objects.filter(pk=self.grants[1].badge_id).update(is_active=False)
        cases = {
            "not a list": "1,2",
            "strings": [str(self.ids[0])],
            "bools": [True],
            "duplicates": [self.ids[0], self.ids[0]],
            "too many": self.ids[:4],
            "not owned": [self.ids[0], foreign.id],
            "inactive badge": [self.ids[0], self.ids[1]],
            "missing": [self.ids[0], 999999],
        }
        for label, payload in cases.items():
            with self.subTest(label):
                response = self._put(payload)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.data["code"], "validation_error")
                self.assertIn("badge_ids", response.data["errors"])
                self.assertEqual(self._featured_ids(), {self.ids[4]})

    def test_non_object_body_is_400(self):
        response = self.client.put(FEATURED_URL, [1, 2], format="json")
        self.assertEqual(response.status_code, 400)

    def test_mine_keeps_is_active(self):
        Badge.objects.filter(pk=self.grants[0].badge_id).update(is_active=False)
        response = self.client.get("/api/v1/badges/mine/")
        active = {row["id"]: row["badge"]["is_active"] for row in response.data}
        self.assertFalse(active[self.ids[0]])
        self.assertTrue(active[self.ids[1]])


class BadgeServiceNotifyTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("holder", "holder@example.com", "pw-123456")
        self.admin = User.objects.create_superuser("boss", "boss@example.com", "pw-123456")
        self.badge = Badge.objects.create(name="Veteran", description="Long time member")

    def test_grant_notifies_through_the_producer_api(self):
        with (
            patch("apps.users.services.badge_service.notify") as notify,
            patch("apps.users.services.badge_service.invalidate_user_caches") as invalidate,
        ):
            grant_badge(self.user, self.badge, granted_by=self.admin)
            self.assertIsNone(grant_badge(self.user, self.badge, granted_by=self.admin))

        notify.assert_called_once_with(
            self.user,
            "badge_awarded",
            actor=self.admin,
            data={"badge_id": self.badge.id},
            dedupe_key=f"badge:{self.badge.id}",
        )
        invalidate.assert_called_once()

    def test_revoke_invalidates_only_when_held(self):
        grant_badge(self.user, self.badge)
        with patch("apps.users.services.badge_service.invalidate_user_caches") as invalidate:
            self.assertTrue(revoke_badge(self.user, self.badge))
            self.assertFalse(revoke_badge(self.user, self.badge))
        invalidate.assert_called_once_with(
            self.user.id, self.user.username, trigger_stats_update=False
        )
