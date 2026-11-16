"""D-8 (owner decision): drop the unused ``django_celery_beat`` tables.

The app left ``INSTALLED_APPS`` in this release: beat runs Celery's default
file scheduler (``--schedule /tmp/celerybeat-schedule``) from
``root/settings/celery_schedule.py``, and nothing ever read these tables. The
deploy's pre-migrate backup holds a copy.

Idempotent (``IF EXISTS``), so it is safe on databases that never had the app.
The app's ``django_migrations`` rows, content types and permissions go too, so
re-adding the app later and running ``migrate`` recreates its tables cleanly.
Reversing is a no-op (the tables are not restored; that is what re-adding the
app does).
"""

from django.db import migrations

TABLES = (
    "django_celery_beat_periodictask",
    "django_celery_beat_periodictasks",
    "django_celery_beat_crontabschedule",
    "django_celery_beat_intervalschedule",
    "django_celery_beat_solarschedule",
    "django_celery_beat_clockedschedule",
)
APP_LABEL = "django_celery_beat"


def drop_tables(apps, schema_editor):
    connection = schema_editor.connection
    quote = schema_editor.quote_name
    with connection.cursor() as cursor:
        for table in TABLES:
            cursor.execute(f"DROP TABLE IF EXISTS {quote(table)} CASCADE")  # noqa: S608
        cursor.execute("DELETE FROM django_migrations WHERE app = %s", [APP_LABEL])

    content_type = apps.get_model("contenttypes", "ContentType")
    permission = apps.get_model("auth", "Permission")
    alias = connection.alias
    stale = content_type.objects.using(alias).filter(app_label=APP_LABEL)
    permission.objects.using(alias).filter(content_type__in=stale).delete()
    stale.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0013_admin_drop_celerytaskschedule"),
        ("contenttypes", "0002_remove_content_type_name"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.RunPython(drop_tables, migrations.RunPython.noop, elidable=False),
    ]
