"""D-6 (owner decision): deleting an account keeps its forum threads and posts.

``Thread.author`` and ``Post.author`` become nullable with ``SET_NULL``; the API
returns ``author: null`` and the site shows "deleted user". Schema only. Reversing
needs every row to have an author again (rows by deleted accounts would violate
NOT NULL), so the reverse deletes those first, as CASCADE would have.
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def drop_authorless_rows(apps, schema_editor):
    alias = schema_editor.connection.alias
    apps.get_model("forums", "Post").objects.using(alias).filter(author__isnull=True).delete()
    apps.get_model("forums", "Thread").objects.using(alias).filter(author__isnull=True).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("forums", "0010_community_reparent_deep_posts"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name="thread",
            name="author",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="forum_threads",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AlterField(
            model_name="post",
            name="author",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="forum_posts",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        # Last, so that reversing runs it first (before NOT NULL comes back).
        migrations.RunPython(migrations.RunPython.noop, drop_authorless_rows, elidable=False),
    ]
