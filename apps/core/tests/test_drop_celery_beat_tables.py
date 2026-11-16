"""D-8: django_celery_beat is gone, and core 0014 drops its leftover tables safely."""

import importlib

import pytest
from django.apps import apps as django_apps
from django.conf import settings
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.db import connection

migration = importlib.import_module("apps.core.migrations.0014_drop_django_celery_beat_tables")


def _tables() -> set[str]:
    return {name for name in connection.introspection.table_names() if "celery_beat" in name}


def test_the_app_is_not_installed():
    assert "django_celery_beat" not in settings.INSTALLED_APPS


@pytest.mark.django_db(transaction=True)
def test_drops_leftover_tables_rows_and_content_types():
    with connection.cursor() as cursor:
        cursor.execute("CREATE TABLE django_celery_beat_periodictask (id serial PRIMARY KEY)")
        cursor.execute(
            "CREATE TABLE django_celery_beat_crontabschedule (id serial PRIMARY KEY, "
            "task_id integer REFERENCES django_celery_beat_periodictask (id))"
        )
        cursor.execute(
            "INSERT INTO django_migrations (app, name, applied) "
            "VALUES ('django_celery_beat', '0001_initial', now())"
        )
    content_type = ContentType.objects.create(app_label="django_celery_beat", model="periodictask")
    Permission.objects.create(
        content_type=content_type, codename="view_periodictask", name="Can view"
    )
    assert _tables() == {"django_celery_beat_periodictask", "django_celery_beat_crontabschedule"}

    with connection.schema_editor() as schema_editor:
        migration.drop_tables(django_apps, schema_editor)

    assert _tables() == set()
    with connection.cursor() as cursor:
        cursor.execute("SELECT count(*) FROM django_migrations WHERE app = 'django_celery_beat'")
        assert cursor.fetchone()[0] == 0
    assert not ContentType.objects.filter(app_label="django_celery_beat").exists()
    assert not Permission.objects.filter(codename="view_periodictask").exists()

    # Idempotent: a second run (or a database that never had the app) is a no-op.
    with connection.schema_editor() as schema_editor:
        migration.drop_tables(django_apps, schema_editor)
