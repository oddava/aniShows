"""Migration 0056: duplicate staff credits are removed, then made impossible."""

from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

BEFORE = [("anime", "0055_drop_theme_sync_fields")]
AFTER = [("anime", "0056_anime_staff_unique_credit")]


class StaffCreditMigrationTests(TransactionTestCase):
    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def _models(self, target):
        executor = MigrationExecutor(connection)
        executor.migrate(target)
        state = executor.loader.project_state(target).apps
        return (
            state.get_model("anime", "Anime"),
            state.get_model("anime", "Staff"),
            state.get_model("anime", "AnimeStaff"),
        )

    def test_duplicates_are_merged_and_cannot_come_back(self):
        anime_model, staff_model, credit_model = self._models(BEFORE)
        anime = anime_model.objects.create(title="A", slug="a")
        director = staff_model.objects.create(name="Director Person")
        first = credit_model.objects.create(anime=anime, staff=director, role="Director")
        credit_model.objects.create(anime=anime, staff=director, role="Director")
        credit_model.objects.create(anime=anime, staff=director, role="Storyboard")

        _, _, credit_model = self._models(AFTER)

        rows = list(credit_model.objects.order_by("id").values_list("id", "role"))
        self.assertEqual(rows[0], (first.id, "Director"))
        self.assertEqual(sorted(role for _, role in rows), ["Director", "Storyboard"])
        with self.assertRaises(IntegrityError), transaction.atomic():
            credit_model.objects.create(anime_id=anime.id, staff_id=director.id, role="Director")
