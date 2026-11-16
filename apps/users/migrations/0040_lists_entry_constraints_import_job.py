"""G3 Lists: list-entry CHECK constraints and the import-job fields for cancel/resume.

Depends on 0037 on the G3 branch; at rebase it is re-pointed to G1's last users
migration (overview section 7). The data step clamps rows that would violate the new
constraints before they are added. It runs in pk batches and is not reversed (the
clamped values were invalid anyway).
"""

from django.db import migrations, models
from django.db.models import F, Q

BATCH_SIZE = 2000


def clamp_list_entries(apps, schema_editor):
    UserAnimeList = apps.get_model("users", "UserAnimeList")
    bounds = UserAnimeList.objects.aggregate(low=models.Min("pk"), high=models.Max("pk"))
    if bounds["low"] is None:
        return
    for start in range(bounds["low"], bounds["high"] + 1, BATCH_SIZE):
        rows = UserAnimeList.objects.filter(pk__gte=start, pk__lt=start + BATCH_SIZE)
        rows.filter(score__lt=0).update(score=0)
        rows.filter(score__gt=10).update(score=10)
        rows.filter(episodes_watched__lt=0).update(episodes_watched=0)
        rows.filter(total_rewatches__lt=0).update(total_rewatches=0)
        rows.filter(
            started_at__isnull=False,
            finished_at__isnull=False,
            finished_at__lt=F("started_at"),
        ).update(finished_at=None)


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0037_customuser_email_ci_unique"),
    ]

    operations = [
        migrations.RunPython(clamp_list_entries, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="useranimelist",
            constraint=models.CheckConstraint(
                condition=Q(("score__gte", 0), ("score__lte", 10)), name="lists_score_0_10"
            ),
        ),
        migrations.AddConstraint(
            model_name="useranimelist",
            constraint=models.CheckConstraint(
                condition=Q(("episodes_watched__gte", 0)), name="lists_episodes_nonneg"
            ),
        ),
        migrations.AddConstraint(
            model_name="useranimelist",
            constraint=models.CheckConstraint(
                condition=Q(("total_rewatches__gte", 0)), name="lists_rewatches_nonneg"
            ),
        ),
        migrations.AddConstraint(
            model_name="useranimelist",
            constraint=models.CheckConstraint(
                condition=Q(
                    ("started_at__isnull", True),
                    ("finished_at__isnull", True),
                    ("finished_at__gte", F("started_at")),
                    _connector="OR",
                ),
                name="lists_dates_ordered",
            ),
        ),
        migrations.AlterField(
            model_name="userimportjob",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("processing", "Processing"),
                    ("completed", "Completed"),
                    ("failed", "Failed"),
                    ("cancelled", "Cancelled"),
                ],
                default="pending",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="userimportjob",
            name="mode",
            field=models.CharField(
                choices=[("full", "Full"), ("incremental", "Incremental")],
                default="full",
                max_length=12,
            ),
        ),
        migrations.AddField(
            model_name="userimportjob",
            name="failure_reason",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="userimportjob",
            name="unmatched",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="userimportjob",
            name="payload",
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="userimportjob",
            name="heartbeat_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
