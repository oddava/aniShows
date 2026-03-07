# Generated migration to add database indexes for performance optimization

from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [
        ("anime", "0016_add_status_distribution"),
    ]

    operations = [
        # Add indexes to UserFavorite model
        migrations.AddIndex(
            model_name="userfavorite",
            index=models.Index(
                fields=["user", "order"], name="anime_userfa_user_id_7e8b8e_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="userfavorite",
            index=models.Index(
                fields=["user", "-added_at"],
                name="anime_userfa_user_id_added_8f3e9a_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="userfavorite",
            index=models.Index(
                fields=["anime"], name="anime_userfa_anime_i_3a4b5c_idx"
            ),
        ),
        # Add indexes to ReviewVote model
        migrations.AddIndex(
            model_name="reviewvote",
            index=models.Index(
                fields=["review", "is_helpful"],
                name="anime_review_review__is_he_9c8d7e_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="reviewvote",
            index=models.Index(
                fields=["user", "review"], name="anime_review_user_id_review_7f6e5d_idx"
            ),
        ),
    ]
