from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("anime", "0034_reviewreport"),
    ]

    operations = [
        migrations.AddField(
            model_name="anime",
            name="offline_db_last_seen_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="anime",
            name="offline_db_last_update",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="anime",
            name="offline_db_payload",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="anime",
            name="provider_ids",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="anime",
            name="producers",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="anime",
            name="source_urls",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="anime",
            name="synonyms",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="anime",
            name="tags",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.CreateModel(
            name="OfflineCatalogImport",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "source_name",
                    models.CharField(default="anime-offline-database", max_length=100),
                ),
                ("release_tag", models.CharField(blank=True, max_length=50)),
                (
                    "asset_name",
                    models.CharField(
                        default="anime-offline-database.jsonl.zst",
                        max_length=100,
                    ),
                ),
                ("source_url", models.URLField(blank=True, max_length=500)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("running", "Running"),
                            ("completed", "Completed"),
                            ("failed", "Failed"),
                        ],
                        db_index=True,
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("last_processed_line", models.IntegerField(default=0)),
                ("records_seen", models.IntegerField(default=0)),
                ("records_created", models.IntegerField(default=0)),
                ("records_updated", models.IntegerField(default=0)),
                ("records_marked_stale", models.IntegerField(default=0)),
                ("records_failed", models.IntegerField(default=0)),
                ("summary", models.JSONField(blank=True, default=dict)),
                ("error_message", models.TextField(blank=True)),
            ],
            options={
                "ordering": ["-created_at"],
                "indexes": [
                    models.Index(
                        fields=["source_name", "-created_at"],
                        name="anime_offli_source__6e7f17_idx",
                    ),
                    models.Index(
                        fields=["status", "-created_at"],
                        name="anime_offli_status_785290_idx",
                    ),
                ],
            },
        ),
    ]
