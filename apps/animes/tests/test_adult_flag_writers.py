"""Safety net for ``Anime.is_adult``: bulk writers are known, drift is repaired.

``is_adult`` is maintained by ``Anime.save()`` and the genre ``m2m_changed``
receiver. Writes that skip both can leave an adult title visible to anonymous
visitors, so:

- a source scan fails when a new bulk write of tags or genres appears outside
  the reviewed list below (add it there only once it refreshes the flag), and
- the nightly ``reconcile_adult_flags`` task fixes any drift and logs it.
"""

import ast
from pathlib import Path
from unittest import mock

import pytest

from apps.animes.adult_content import reconcile_adult_flags
from apps.animes.models import Anime, Genre
from apps.animes.tasks.adult_content import reconcile_adult_flags as reconcile_task

APPS_DIR = Path(__file__).resolve().parents[2]

# path (relative to apps/) -> why its bulk write keeps is_adult right
REVIEWED_BULK_WRITERS = {
    "animes/services/offline_catalog_persistence.py": (
        "bulk_create sets is_adult from the entry's tags; bulk_update lists is_adult "
        "and only turns it on when an adult tag arrives"
    ),
}
ADULT_INPUT_FIELDS = {"tags", "genres"}


def _string_values(node) -> set[str]:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return {node.value}
    if isinstance(node, ast.List | ast.Tuple | ast.Set):
        return {value for item in node.elts for value in _string_values(item)}
    return set()


def _bulk_writes_of_adult_inputs(tree) -> list[int]:
    lines = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
            continue
        method = node.func.attr
        receiver = ast.unparse(node.func.value)
        if method == "update" and ADULT_INPUT_FIELDS & {kw.arg for kw in node.keywords}:
            lines.append(node.lineno)
        elif method == "bulk_update":
            fields = node.args[1] if len(node.args) > 1 else None
            fields = fields or next((kw.value for kw in node.keywords if kw.arg == "fields"), None)
            names = _string_values(fields) if fields is not None else set()
            # A computed field list can't be checked; treat it as a write of anything.
            if not names or ADULT_INPUT_FIELDS & names:
                lines.append(node.lineno)
        elif method == "bulk_create" and (
            "through" in receiver or "Anime.objects" in receiver or "AnimeGenre" in receiver
        ):
            lines.append(node.lineno)
    return lines


def test_bulk_writes_of_tags_and_genres_are_reviewed():
    found = {}
    for path in APPS_DIR.rglob("*.py"):
        relative = path.relative_to(APPS_DIR).as_posix()
        if "/tests/" in f"/{relative}" or "/migrations/" in f"/{relative}":
            continue
        lines = _bulk_writes_of_adult_inputs(ast.parse(path.read_text(encoding="utf-8")))
        if lines and relative not in REVIEWED_BULK_WRITERS:
            found[relative] = lines
    assert not found, (
        "These writes change tags or genres without Anime.save() or the m2m signal, "
        "so Anime.is_adult can go stale. Call refresh_adult_flags() for the touched "
        f"rows, then add the file to REVIEWED_BULK_WRITERS: {found}"
    )


def test_reviewed_writers_still_exist():
    for relative in REVIEWED_BULK_WRITERS:
        assert (APPS_DIR / relative).exists(), f"stale REVIEWED_BULK_WRITERS entry: {relative}"


def test_scan_catches_each_kind_of_bulk_write():
    source = "\n".join(
        [
            "Anime.objects.filter(pk=1).update(tags=['sex'])",
            "Anime.objects.bulk_update(rows, ['title', 'tags'])",
            "Anime.objects.bulk_update(rows, fields)",
            "Anime.genres.through.objects.bulk_create(links)",
            "Anime.objects.filter(pk=1).update(title='x')",
            "Anime.objects.bulk_update(rows, ['title'])",
        ]
    )
    assert _bulk_writes_of_adult_inputs(ast.parse(source)) == [1, 2, 3, 4]


@pytest.mark.django_db
class TestReconcile:
    @pytest.fixture(autouse=True)
    def _no_side_effect_tasks(self, monkeypatch):
        monkeypatch.setattr("apps.animes.signals.enrich_metadata.delay", lambda *a, **k: None)

    def _anime(self, slug, **fields):
        return Anime.objects.create(title=slug, slug=slug, synopsis="synopsis", **fields)

    def test_fixes_rows_a_bulk_write_left_stale(self):
        hidden = self._anime("stale-tag")
        shown = self._anime("stale-genre")
        hentai = Genre.objects.create(name="Hentai", slug="hentai")
        # Both writes skip save() and the m2m signal.
        Anime.objects.filter(pk=hidden.pk).update(tags=["sex"])
        Anime.genres.through.objects.bulk_create(
            [Anime.genres.through(anime_id=shown.pk, genre_id=hentai.pk)]
        )
        cleared = self._anime("was-adult", tags=["sex"])
        Anime.objects.filter(pk=cleared.pk).update(tags=["comedy"])

        with mock.patch("apps.animes.adult_content.logger") as logger:
            result = reconcile_adult_flags()

        assert result == {"flagged": 2, "cleared": 1}
        assert set(Anime.objects.filter(is_adult=True).values_list("slug", flat=True)) == {
            "stale-tag",
            "stale-genre",
        }
        logger.warning.assert_called_once()

    def test_fixed_rows_drop_their_cached_public_payloads(self, django_capture_on_commit_callbacks):
        hidden = self._anime("cached-stale")
        other = self._anime("cached-other")
        Anime.objects.filter(pk__in=[hidden.pk, other.pk]).update(tags=["sex"])
        with (
            mock.patch("apps.animes.adult_content.logger"),
            mock.patch("apps.animes.signals._invalidate_anime_public_caches") as invalidate,
            mock.patch(
                "apps.animes.services.public_anime_service.AnimePublicPayloadService"
                ".bump_collection_cache_namespace"
            ) as bump,
            django_capture_on_commit_callbacks(execute=True) as callbacks,
        ):
            reconcile_adult_flags()
            # Nothing is dropped before the update commits.
            invalidate.assert_not_called()

        assert len(callbacks) == 1
        bump.assert_called_once_with()  # once for every list, not per row
        assert sorted(call.args[0] for call in invalidate.call_args_list) == [
            "cached-other",
            "cached-stale",
        ]
        assert all(call.kwargs == {"bump_namespace": False} for call in invalidate.call_args_list)

    def test_no_drift_is_silent(self):
        self._anime("clean", tags=["comedy"])
        self._anime("adult", tags=["sex"])
        with mock.patch("apps.animes.adult_content.logger") as logger:
            assert reconcile_adult_flags() == {"flagged": 0, "cleared": 0}
        logger.warning.assert_not_called()

    def test_task_runs_the_reconcile(self):
        anime = self._anime("task-stale")
        Anime.objects.filter(pk=anime.pk).update(tags=["sex"])
        with mock.patch("apps.animes.adult_content.logger"):
            assert reconcile_task.apply().get() == {"flagged": 1, "cleared": 0}
