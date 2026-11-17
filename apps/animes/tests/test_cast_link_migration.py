"""Migration 0057: a cast link is unique even when it has no voice actor."""

from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

BEFORE = [("anime", "0056_anime_staff_unique_credit")]
AFTER = [("anime", "0057_anime_character_unique_voice")]


class CastLinkMigrationTests(TransactionTestCase):
    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def _models(self, target):
        executor = MigrationExecutor(connection)
        executor.migrate(target)
        state = executor.loader.project_state(target).apps
        return tuple(
            state.get_model("anime", name)
            for name in ("Anime", "Character", "Staff", "AnimeCharacter")
        )

    def test_duplicates_without_a_voice_actor_are_merged_and_blocked(self):
        anime_model, character_model, staff_model, link_model = self._models(BEFORE)
        anime = anime_model.objects.create(title="A", slug="a")
        elder = character_model.objects.create(name="Village Elder")
        voice = staff_model.objects.create(name="Voice")
        first = link_model.objects.create(anime=anime, character=elder)
        link_model.objects.create(anime=anime, character=elder)  # allowed before 0057
        link_model.objects.create(anime=anime, character=elder, voice_actor=voice)

        *_, link_model = self._models(AFTER)

        self.assertEqual(
            sorted(link_model.objects.values_list("id", "voice_actor_id"), key=str),
            sorted(
                [(first.id, None), (link_model.objects.get(voice_actor=voice.id).id, voice.id)],
                key=str,
            ),
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            link_model.objects.create(anime_id=anime.id, character_id=elder.id)
