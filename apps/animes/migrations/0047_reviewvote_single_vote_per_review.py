from django.db import migrations, models


def collapse_duplicate_review_votes(apps, schema_editor):
    ReviewVote = apps.get_model("anime", "ReviewVote")

    keepers = set()
    duplicate_ids = []

    votes = ReviewVote.objects.order_by(
        "user_id",
        "review_id",
        "-created_at",
        "-id",
    ).values_list("id", "user_id", "review_id")

    for vote_id, user_id, review_id in votes.iterator():
        key = (user_id, review_id)
        if key in keepers:
            duplicate_ids.append(vote_id)
        else:
            keepers.add(key)

    for start in range(0, len(duplicate_ids), 1000):
        ReviewVote.objects.filter(id__in=duplicate_ids[start : start + 1000]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("anime", "0046_add_shadow_duplicate_lookup_indexes"),
    ]

    operations = [
        migrations.RunPython(
            collapse_duplicate_review_votes,
            reverse_code=migrations.RunPython.noop,
        ),
        migrations.AlterUniqueTogether(
            name="reviewvote",
            unique_together={("user", "review")},
        ),
        migrations.RemoveIndex(
            model_name="reviewvote",
            name="anime_revie_user_id_86991f_idx",
        ),
        migrations.AddIndex(
            model_name="reviewvote",
            index=models.Index(
                fields=["user", "review"],
                name="anime_revie_user_review_idx",
            ),
        ),
    ]
