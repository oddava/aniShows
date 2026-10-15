from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

User = get_user_model()

BEFORE = [("anime", "0050_remove_anime_relations_json")]
AFTER = [("anime", "0051_unescape_review_text")]


class UnescapeReviewTextMigrationTests(TransactionTestCase):
    def tearDown(self):
        MigrationExecutor(connection).migrate(AFTER)

    def _review_model(self, target):
        executor = MigrationExecutor(connection)
        executor.migrate(target)
        return executor.loader.project_state(target).apps.get_model("anime", "Review")

    def test_escaped_text_is_restored_and_the_reverse_re_escapes(self):
        typed = "I don't <3 the ending & \"twist\""
        escaped = "I don&#x27;t &lt;3 the ending &amp; &quot;twist&quot;"
        old_review = self._review_model(BEFORE)
        anime_model = old_review._meta.get_field("anime").related_model
        anime = anime_model.objects.create(title="A", slug="a")
        user = User.objects.create_user(username="r", email="r@example.com", password="x")
        review_id = old_review.objects.create(user_id=user.id, anime=anime, rating=8, text=escaped).id

        new_review = self._review_model(AFTER)
        self.assertEqual(new_review.objects.get(id=review_id).text, typed)

        old_review = self._review_model(BEFORE)
        self.assertEqual(old_review.objects.get(id=review_id).text, escaped)
