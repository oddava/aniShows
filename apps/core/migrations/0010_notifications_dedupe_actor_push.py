"""G4: notification idempotency/aggregation keys, actor, pending index, push endpoint fixes.

Data steps are batched and reverse as no-ops (the schema steps drop what they added).
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

BATCH_SIZE = 2000


def _as_int(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _forum_target(data):
    post_id = _as_int(data.get("post_id"))
    if post_id is not None and not data.get("is_thread"):
        return f"p:{post_id}"
    thread_id = _as_int(data.get("thread_id"))
    return f"t:{thread_id}" if thread_id is not None else None


def _keys_for(notification_type, data):
    """Return ``(dedupe_key, group_key, actor_id)`` for a legacy row (any may be None)."""
    if not isinstance(data, dict):
        return None, None, None
    dedupe_key = group_key = None
    actor_id = _as_int(data.get("follower_id")) or _as_int(data.get("replier_id"))
    liker_ids = data.get("liker_user_ids")
    if actor_id is None and isinstance(liker_ids, list) and liker_ids:
        actor_id = _as_int(liker_ids[0])

    if notification_type == "new_episode":
        anime_id = _as_int(data.get("anime_id"))
        episode = _as_int(data.get("episode_number"))
        if anime_id is not None:
            group_key = f"new_episode:{anime_id}"
            if episode is not None:
                dedupe_key = f"new_episode:{anime_id}:{episode}"
    elif notification_type == "new_follower":
        follower_id = _as_int(data.get("follower_id"))
        if follower_id is not None:
            dedupe_key = f"follow:{follower_id}"
    elif notification_type == "badge_awarded":
        badge_id = _as_int(data.get("badge_id"))
        if badge_id is not None:
            dedupe_key = f"badge:{badge_id}"
    elif notification_type == "review_like":
        review_id = _as_int(data.get("review_id"))
        if review_id is not None:
            group_key = f"review_like:{review_id}"
    elif notification_type == "forum_like":
        target = _forum_target(data)
        if target is not None:
            group_key = f"forum_like:{target}"
    return dedupe_key, group_key, actor_id


USERS_PER_CHUNK = 500


def _backfill_users(Notification, User, user_ids):
    """Backfill every row of these users (keys are per user, so chunks are independent)."""
    first_dedupe: dict[tuple[int, str], int] = {}  # (user_id, key) -> earliest id
    newest_unread_group: dict[tuple[int, str], int] = {}  # (user_id, key) -> newest unread
    actor_by_id: dict[int, int] = {}
    rows = (
        Notification.objects.filter(user_id__in=user_ids)
        .order_by("id")
        .values_list("id", "user_id", "notification_type", "is_read", "data")
        .iterator(chunk_size=BATCH_SIZE)
    )
    for row_id, user_id, notification_type, is_read, data in rows:
        dedupe_key, group_key, actor_id = _keys_for(notification_type, data)
        if dedupe_key is not None:
            first_dedupe.setdefault((user_id, dedupe_key), row_id)
        if group_key is not None and not is_read:
            newest_unread_group[(user_id, group_key)] = row_id
        if actor_id is not None:
            actor_by_id[row_id] = actor_id

    updates: dict[int, dict[str, object]] = {}
    for (_user_id, key), row_id in first_dedupe.items():
        updates.setdefault(row_id, {})["dedupe_key"] = key
    for (_user_id, key), row_id in newest_unread_group.items():
        updates.setdefault(row_id, {})["group_key"] = key
    existing_users = set(
        User.objects.filter(pk__in=set(actor_by_id.values())).values_list("pk", flat=True)
    )
    for row_id, actor_id in actor_by_id.items():
        if actor_id in existing_users:
            updates.setdefault(row_id, {})["actor_id"] = actor_id

    Notification.objects.bulk_update(
        [
            Notification(
                id=row_id,
                dedupe_key=values.get("dedupe_key"),
                group_key=values.get("group_key"),
                actor_id=values.get("actor_id"),
            )
            for row_id, values in updates.items()
        ],
        ["dedupe_key", "group_key", "actor_id"],
        batch_size=BATCH_SIZE,
    )


def backfill_notification_keys(apps, schema_editor):
    """Set the contract keys on legacy rows, a few hundred users at a time.

    Earliest row wins a dedupe key and only the newest unread row of a target gets
    its group key, so both partial unique indexes can be built afterwards. Memory is
    bounded by the rows of one user chunk, not the table.
    """
    Notification = apps.get_model("core", "Notification")
    User = apps.get_model("users", "CustomUser")
    user_ids = (
        Notification.objects.order_by("user_id").values_list("user_id", flat=True).distinct()
    )
    chunk: list[int] = []
    for user_id in user_ids.iterator(chunk_size=BATCH_SIZE):
        chunk.append(user_id)
        if len(chunk) >= USERS_PER_CHUNK:
            _backfill_users(Notification, User, chunk)
            chunk = []
    if chunk:
        _backfill_users(Notification, User, chunk)

    if schema_editor.connection.vendor == "postgresql":
        # The actor FK is deferrable: fire its checks now, so the ALTER TABLEs that
        # follow in this transaction don't fail on "pending trigger events".
        schema_editor.execute("SET CONSTRAINTS ALL IMMEDIATE")


def dedupe_push_endpoints(apps, schema_editor):
    """Keep one row per endpoint: the newest active one (else the newest)."""
    PushSubscription = apps.get_model("core", "PushSubscription")
    duplicated = (
        PushSubscription.objects.values("endpoint")
        .annotate(n=models.Count("id"))
        .filter(n__gt=1)
        .values_list("endpoint", flat=True)
    )
    for endpoint in list(duplicated):
        rows = list(
            PushSubscription.objects.filter(endpoint=endpoint)
            .order_by("-is_active", "-created_at", "-id")
            .values_list("id", flat=True)
        )
        PushSubscription.objects.filter(id__in=rows[1:]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0009_notification_review_like_and_index"),
        # Only the user table is needed (it exists since users.0001). Depending on the
        # users leaf would make every later users migration test unapply this one.
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="notification",
            name="dedupe_key",
            field=models.CharField(blank=True, max_length=160, null=True),
        ),
        migrations.AddField(
            model_name="notification",
            name="group_key",
            field=models.CharField(blank=True, max_length=160, null=True),
        ),
        migrations.AddField(
            model_name="notification",
            name="actor",
            field=models.ForeignKey(
                blank=True,
                help_text="Who caused the notification (the latest one for aggregates).",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.RunPython(backfill_notification_keys, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="notification",
            constraint=models.UniqueConstraint(
                condition=models.Q(dedupe_key__isnull=False),
                fields=("user", "dedupe_key"),
                name="core_notif_user_dedupe_uniq",
            ),
        ),
        migrations.AddConstraint(
            model_name="notification",
            constraint=models.UniqueConstraint(
                condition=models.Q(group_key__isnull=False, is_read=False),
                fields=("user", "group_key"),
                name="core_notif_user_group_unread_uniq",
            ),
        ),
        migrations.RemoveIndex(
            model_name="notification",
            name="core_notifi_is_emai_344774_idx",
        ),
        migrations.RemoveIndex(
            model_name="notification",
            name="core_notifi_is_push_13eb2d_idx",
        ),
        migrations.AddIndex(
            model_name="notification",
            index=models.Index(
                condition=models.Q(is_push_sent=False) | models.Q(is_email_sent=False),
                fields=["created_at"],
                name="core_notif_pending_idx",
            ),
        ),
        migrations.AlterField(
            model_name="pushsubscription",
            name="endpoint",
            field=models.URLField(max_length=2048),
        ),
        migrations.RunPython(dedupe_push_endpoints, migrations.RunPython.noop),
        migrations.RemoveIndex(
            model_name="pushsubscription",
            name="core_pushsu_endpoin_0a3bd0_idx",
        ),
        migrations.AddConstraint(
            model_name="pushsubscription",
            constraint=models.UniqueConstraint(fields=("endpoint",), name="core_pushsub_endpoint_uniq"),
        ),
        migrations.AddField(
            model_name="pushsubscription",
            name="failure_count",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
