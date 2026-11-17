"""Drop review indexes that duplicate a unique constraint or a wider index (spec 5 R11).

- ReviewVote (user, review) and ReviewReaction (user, review, reaction_type) are
  exact copies of their unique constraints.
- Review (anime, user) is covered by the (user, anime) unique constraint for the
  pair lookups and by (anime, -created_at) for per-anime scans.

Pure index drops, no data; reversing recreates the indexes.
"""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("anime", "0057_anime_character_unique_voice"),
    ]

    operations = [
        migrations.RemoveIndex(
            model_name="reviewvote",
            name="anime_revie_user_review_idx",
        ),
        migrations.RemoveIndex(
            model_name="reviewreaction",
            name="anime_revie_user_id_60a9d1_idx",
        ),
        migrations.RemoveIndex(
            model_name="review",
            name="anime_revie_anime_i_b641c4_idx",
        ),
    ]
