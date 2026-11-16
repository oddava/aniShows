"""G6: drop CeleryTaskSchedule. Beat runs the file scheduler and never read it.

Reversible schema-wise (the table comes back empty). Nothing is deployed yet.
"""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0012_admin_auditlog_actions_entity_index"),
    ]

    operations = [
        migrations.DeleteModel(
            name="CeleryTaskSchedule",
        ),
    ]
