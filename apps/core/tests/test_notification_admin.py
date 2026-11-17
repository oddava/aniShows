from django.contrib import admin

from apps.core.models import Notification


def test_notification_admin_uses_raw_ids_for_both_user_foreign_keys():
    # A select box for ``actor`` would load every account on each change page.
    assert set(admin.site._registry[Notification].raw_id_fields) == {"user", "actor"}
