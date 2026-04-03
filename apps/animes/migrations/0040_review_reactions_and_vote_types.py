from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def migrate_review_vote_types(apps, schema_editor):
    ReviewVote = apps.get_model("anime", "ReviewVote")

    for vote in ReviewVote.objects.all().only("id", "is_helpful"):
        vote.vote_type = "helpful" if vote.is_helpful else "dislike"
        vote.save(update_fields=["vote_type"])


class Migration(migrations.Migration):

    dependencies = [
        ("anime", "0039_userfavoritecharacter_userfavoritestaff"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ReviewReaction",
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
                (
                    "reaction_type",
                    models.CharField(
                        choices=[
                            ("thumbs_up", "Thumbs Up"),
                            ("heart", "Heart"),
                            ("laugh", "Laugh"),
                            ("surprised", "Surprised"),
                            ("sad", "Sad"),
                        ],
                        max_length=20,
                    ),
                ),
                (
                    "review",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="reactions",
                        to="anime.review",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="review_reactions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "unique_together": {("user", "review", "reaction_type")},
                "indexes": [
                    models.Index(
                        fields=["review", "reaction_type"],
                        name="anime_revie_review__9feeb4_idx",
                    ),
                    models.Index(
                        fields=["user", "review", "reaction_type"],
                        name="anime_revie_user_id_60a9d1_idx",
                    ),
                ],
            },
        ),
        migrations.AddField(
            model_name="reviewvote",
            name="vote_type",
            field=models.CharField(
                choices=[("helpful", "Helpful"), ("dislike", "Dislike")],
                max_length=20,
                null=True,
            ),
        ),
        migrations.RunPython(migrate_review_vote_types, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="reviewvote",
            name="vote_type",
            field=models.CharField(
                choices=[("helpful", "Helpful"), ("dislike", "Dislike")],
                max_length=20,
            ),
        ),
        migrations.AlterUniqueTogether(
            name="reviewvote",
            unique_together={("user", "review", "vote_type")},
        ),
        migrations.RemoveIndex(
            model_name="reviewvote",
            name="anime_revie_review__79478d_idx",
        ),
        migrations.RemoveIndex(
            model_name="reviewvote",
            name="anime_revie_user_id_80f2ed_idx",
        ),
        migrations.AddIndex(
            model_name="reviewvote",
            index=models.Index(
                fields=["review", "vote_type"],
                name="anime_revie_review__5b332b_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="reviewvote",
            index=models.Index(
                fields=["user", "review", "vote_type"],
                name="anime_revie_user_id_86991f_idx",
            ),
        ),
        migrations.DeleteModel(
            name="ReviewComment",
        ),
        migrations.RemoveField(
            model_name="reviewvote",
            name="is_helpful",
        ),
    ]
