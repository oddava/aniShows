"""Data fixes for the forum community revamp (spec 5, migration plan 2).

1. Re-parent replies nested below ``MAX_DEPTH``. Old code clamped ``depth`` at 10
   but kept the deeper parent link, so a depth-10 post could have a depth-10 parent
   and was never returned. Each such post moves up until its parent is at depth 9.
2. Subscribe every thread author to their thread. Backfilled rows take the thread's
   ``created_at``, which is how the reverse step tells them apart.
3. Store forum text as typed: the serializer used to ``bleach.clean`` content, which
   entity-encoded ``<``, ``>`` and ``&``. Unescaped exactly once here.

Reverse: re-parenting is not undone (the new tree is valid either way), backfilled
subscriptions are deleted, and content is re-escaped.
"""

import html

from django.db import migrations
from django.db.models import F, OuterRef, Subquery

BATCH_SIZE = 500
MAX_DEPTH = 10
# Each pass moves every too-deep post one ancestor up. Real chains finish in a few
# passes; the cap only stops a corrupted parent cycle from looping forever.
MAX_REPARENT_PASSES = 10_000


def reparent_deep_posts(apps, schema_editor):
    Post = apps.get_model("forums", "Post")
    too_deep = (
        Post.objects.filter(depth__gte=MAX_DEPTH, parent__depth__gte=MAX_DEPTH)
        .exclude(parent__parent_id=None)
        .exclude(parent__parent_id=F("id"))
    )
    for _ in range(MAX_REPARENT_PASSES):
        batch = list(too_deep.values_list("id", "parent__parent_id")[:BATCH_SIZE])
        if not batch:
            return
        moved = [Post(id=post_id, parent_id=grandparent, depth=MAX_DEPTH) for post_id, grandparent in batch]
        Post.objects.bulk_update(moved, ["parent_id", "depth"])


def backfill_author_subscriptions(apps, schema_editor):
    Thread = apps.get_model("forums", "Thread")
    ThreadSubscription = apps.get_model("forums", "ThreadSubscription")
    last_id = 0
    while True:
        batch = list(
            Thread.objects.filter(id__gt=last_id)
            .order_by("id")
            .values_list("id", "author_id")[:BATCH_SIZE]
        )
        if not batch:
            return
        last_id = batch[-1][0]
        thread_ids = [thread_id for thread_id, _ in batch]
        ThreadSubscription.objects.bulk_create(
            [ThreadSubscription(thread_id=t, user_id=u) for t, u in batch],
            ignore_conflicts=True,
        )
        thread_created_at = Thread.objects.filter(pk=OuterRef("thread_id")).values("created_at")[:1]
        ThreadSubscription.objects.filter(
            thread_id__in=thread_ids, user_id=F("thread__author_id")
        ).update(created_at=Subquery(thread_created_at))


def delete_backfilled_subscriptions(apps, schema_editor):
    ThreadSubscription = apps.get_model("forums", "ThreadSubscription")
    ThreadSubscription.objects.filter(
        user_id=F("thread__author_id"), created_at=F("thread__created_at")
    ).delete()


def _rewrite_content(model, transform):
    changed = []
    rows = model.objects.exclude(content="").only("id", "content")
    for row in rows.iterator(chunk_size=BATCH_SIZE):
        new_content = transform(row.content)
        if new_content != row.content:
            row.content = new_content
            changed.append(row)
        if len(changed) >= BATCH_SIZE:
            model.objects.bulk_update(changed, ["content"])
            changed.clear()
    if changed:
        model.objects.bulk_update(changed, ["content"])


def unescape_content(apps, schema_editor):
    for model_name in ("Thread", "Post"):
        _rewrite_content(apps.get_model("forums", model_name), html.unescape)


def escape_content(apps, schema_editor):
    # bleach encoded only these three characters in text.
    for model_name in ("Thread", "Post"):
        _rewrite_content(
            apps.get_model("forums", model_name), lambda text: html.escape(text, quote=False)
        )


class Migration(migrations.Migration):
    dependencies = [
        ("forums", "0009_community_moderation_subscriptions"),
    ]

    operations = [
        migrations.RunPython(reparent_deep_posts, migrations.RunPython.noop),
        migrations.RunPython(backfill_author_subscriptions, delete_backfilled_subscriptions),
        migrations.RunPython(unescape_content, escape_content),
    ]
