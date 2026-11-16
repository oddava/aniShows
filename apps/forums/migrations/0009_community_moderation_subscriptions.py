import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def _moderation_fields(model_name):
    return [
        migrations.AddField(
            model_name=model_name,
            name="edited_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name=model_name,
            name="is_removed",
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name=model_name,
            name="removed_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name=model_name,
            name="removed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name=model_name,
            name="removal_reason",
            field=models.CharField(blank=True, max_length=200),
        ),
    ]


class Migration(migrations.Migration):
    dependencies = [
        ("forums", "0008_thread_category_updated_idx"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        *_moderation_fields("thread"),
        *_moderation_fields("post"),
        migrations.CreateModel(
            name="ThreadSubscription",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "thread",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="subscriptions",
                        to="forums.thread",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="forum_thread_subscriptions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "indexes": [models.Index(fields=["thread"], name="forums_threadsub_thread_idx")],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("user", "thread"), name="forums_threadsub_user_thread_uniq"
                    )
                ],
            },
        ),
    ]
