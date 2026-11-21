"""The list-entry transition rules (spec 3 P0-8), shared by the API and the importers."""

from datetime import date, timedelta
from types import SimpleNamespace

from django.test import SimpleTestCase
from django.utils import timezone
from freezegun import freeze_time

from ...animes.models import Anime
from ..models import UserAnimeList
from ..services.list_rules import (
    MAX_EPISODES_UNKNOWN_TOTAL,
    MAX_NOTES_LENGTH,
    ListRuleError,
    normalize_entry,
    user_today,
)

Status = UserAnimeList.UserAnimeStatus
TODAY = date(2026, 11, 16)


def anime(total=12):
    return Anime(title="Rules", slug="rules", episode_count=total)


def entry(**fields):
    values = {
        "status": Status.watching,
        "episodes_watched": 0,
        "started_at": None,
        "finished_at": None,
        "total_rewatches": 0,
        "is_rewatching": False,
    }
    values.update(fields)
    return UserAnimeList(**values)


def normalize(instance, attrs, total=12, *, strict=True):
    return normalize_entry(instance, attrs, anime(total), TODAY, strict=strict)


class CompletionRuleTests(SimpleTestCase):
    def test_full_progress_auto_completes(self):
        result = normalize(entry(episodes_watched=11), {"episodes_watched": 12})

        self.assertEqual(result["status"], Status.completed)
        self.assertEqual(result["finished_at"], TODAY)

    def test_completed_sets_progress_to_total_and_finish_date(self):
        result = normalize(entry(episodes_watched=3), {"status": Status.completed})

        self.assertEqual(result["episodes_watched"], 12)
        self.assertEqual(result["finished_at"], TODAY)

    def test_completed_keeps_an_existing_finish_date(self):
        earlier = date(2025, 1, 2)
        result = normalize(
            entry(episodes_watched=3, started_at=date(2025, 1, 1), finished_at=earlier),
            {"status": Status.completed},
        )

        self.assertNotIn("finished_at", result)

    def test_completed_with_unknown_total_keeps_progress(self):
        result = normalize(entry(episodes_watched=40), {"status": Status.completed}, total=0)

        self.assertEqual(result["status"], Status.completed)
        self.assertEqual(result.get("episodes_watched", 40), 40)

    def test_full_progress_completes_whatever_status_is_sent(self):
        # The contract (P0-8): progress == known total and status != Completed -> Completed.
        for sent in (Status.dropped, Status.on_hold, Status.watching):
            with self.subTest(sent=str(sent)):
                result = normalize(
                    entry(episodes_watched=11), {"status": sent, "episodes_watched": 12}
                )
                self.assertEqual(result["status"], Status.completed)
                self.assertEqual(result["finished_at"], TODAY)

    def test_explicit_dropped_below_full_progress_is_kept(self):
        result = normalize(entry(episodes_watched=3), {"status": Status.dropped})

        self.assertEqual(result["status"], Status.dropped)
        self.assertNotIn("episodes_watched", result)  # unchanged progress is not resent

    def test_lowering_progress_on_completed_entry_uncompletes_it(self):
        result = normalize(
            entry(status=Status.completed, episodes_watched=12), {"episodes_watched": 5}
        )

        self.assertEqual((result["status"], result["episodes_watched"]), (Status.watching, 5))

    def test_explicit_status_with_lower_progress_is_respected(self):
        result = normalize(
            entry(status=Status.completed, episodes_watched=12),
            {"status": Status.on_hold, "episodes_watched": 5},
        )

        self.assertEqual(result["status"], Status.on_hold)


def airing(total=12, aired=6, *, days_ahead=3):
    """A show still airing: episode ``aired + 1`` is scheduled ``days_ahead`` from now."""
    return Anime(
        title="Airing",
        slug="airing",
        episode_count=total,
        status=Anime.AnimeStatus.airing,
        next_airing_episode=aired + 1,
        next_airing_date=timezone.now() + timedelta(days=days_ahead),
    )


class AiringCompletionRuleTests(SimpleTestCase):
    """Completed on a show still airing fills progress to the aired episodes, not the total."""

    def run_rules(self, instance, attrs, show):
        return normalize_entry(instance, attrs, show, TODAY, strict=True)

    def test_completed_fills_up_to_the_aired_count(self):
        result = self.run_rules(entry(episodes_watched=2), {"status": Status.completed}, airing())

        self.assertEqual((result["status"], result["episodes_watched"]), (Status.completed, 6))
        self.assertEqual(result["finished_at"], TODAY)

    def test_completed_never_lowers_progress_watched_ahead(self):
        result = self.run_rules(entry(episodes_watched=8), {"status": Status.completed}, airing())

        self.assertEqual(result["status"], Status.completed)
        self.assertEqual(result.get("episodes_watched", 8), 8)  # unchanged: not resent

    def test_completed_counts_an_episode_whose_airing_time_has_passed(self):
        # Episode 7 aired an hour ago; the sync has not moved the marker on yet.
        show = airing(days_ahead=-1 / 24)
        result = self.run_rules(entry(episodes_watched=2), {"status": Status.completed}, show)

        self.assertEqual((result["status"], result["episodes_watched"]), (Status.completed, 7))

    def test_completed_with_the_last_episode_aired_fills_to_total(self):
        show = airing(aired=11, days_ahead=-1 / 24)  # episode 12 of 12 aired
        result = self.run_rules(entry(episodes_watched=2), {"status": Status.completed}, show)

        self.assertEqual(result["episodes_watched"], 12)

    def test_completed_without_an_airing_date_fills_to_total(self):
        show = airing()
        show.next_airing_date = None
        result = self.run_rules(entry(episodes_watched=2), {"status": Status.completed}, show)

        self.assertEqual(result["episodes_watched"], 12)

    def test_completed_with_unknown_total_counts_the_episode_just_aired(self):
        # ONE PIECE-style: episode 41 aired an hour ago, total not announced.
        show = airing(total=0, aired=40, days_ahead=-1 / 24)
        result = self.run_rules(entry(episodes_watched=10), {"status": Status.completed}, show)

        self.assertEqual((result["status"], result["episodes_watched"]), (Status.completed, 41))

    def test_completed_on_a_finished_show_still_fills_to_total(self):
        show = airing(aired=12)  # every episode out (next marker past the end)
        result = self.run_rules(entry(episodes_watched=2), {"status": Status.completed}, show)

        self.assertEqual(result["episodes_watched"], 12)

    def test_completed_with_unknown_total_fills_to_the_aired_count(self):
        show = airing(total=0, aired=40)
        result = self.run_rules(entry(episodes_watched=10), {"status": Status.completed}, show)

        self.assertEqual((result["status"], result["episodes_watched"]), (Status.completed, 40))

    def test_full_progress_still_auto_completes(self):
        result = self.run_rules(entry(episodes_watched=11), {"episodes_watched": 12}, airing())

        self.assertEqual((result["status"], result["episodes_watched"]), (Status.completed, 12))

    def test_caught_up_progress_does_not_auto_complete(self):
        result = self.run_rules(entry(episodes_watched=5), {"episodes_watched": 6}, airing())

        self.assertEqual(result["status"], Status.watching)

    def test_watching_a_new_episode_after_completing_reopens_the_entry(self):
        completed = entry(status=Status.completed, episodes_watched=6)
        result = self.run_rules(completed, {"episodes_watched": 7}, airing(aired=7))

        self.assertEqual((result["status"], result["episodes_watched"]), (Status.watching, 7))

    def test_resending_the_same_progress_keeps_completed(self):
        completed = entry(status=Status.completed, episodes_watched=6)
        result = self.run_rules(completed, {"episodes_watched": 6}, airing())

        self.assertEqual((result["status"], result["episodes_watched"]), (Status.completed, 6))

    def test_lowering_progress_on_a_completed_airing_entry_uncompletes_it(self):
        completed = entry(status=Status.completed, episodes_watched=6)
        result = self.run_rules(completed, {"episodes_watched": 4}, airing())

        self.assertEqual((result["status"], result["episodes_watched"]), (Status.watching, 4))

    def test_imports_follow_the_same_fill(self):
        result = normalize_entry(None, {"status": Status.completed}, airing(), TODAY, strict=False)

        self.assertEqual(result["episodes_watched"], 6)


class RewatchRuleTests(SimpleTestCase):
    def test_rewatch_start_goes_to_watching_from_episode_zero(self):
        result = normalize(
            entry(status=Status.completed, episodes_watched=12), {"is_rewatching": True}
        )

        self.assertEqual(result["status"], Status.watching)
        self.assertEqual(result["episodes_watched"], 0)
        self.assertTrue(result["is_rewatching"])
        self.assertEqual(result.get("total_rewatches", 0), 0)  # counted when it ends

    def test_rewatch_start_keeps_a_sent_progress_below_total(self):
        result = normalize(
            entry(status=Status.completed, episodes_watched=12),
            {"is_rewatching": True, "episodes_watched": 3},
        )

        self.assertEqual((result["status"], result["episodes_watched"]), (Status.watching, 3))

    def test_rewatch_start_resets_a_sent_full_progress(self):
        """A modal that sends every field at once must not complete the rewatch it starts."""
        result = normalize(
            entry(status=Status.completed, episodes_watched=12),
            {"is_rewatching": True, "episodes_watched": 12, "status": Status.completed},
        )

        self.assertEqual((result["status"], result["episodes_watched"]), (Status.watching, 0))
        self.assertTrue(result["is_rewatching"])

    def test_finishing_a_rewatch_counts_it_and_clears_the_flag(self):
        finished = date(2025, 3, 1)
        result = normalize(
            entry(
                episodes_watched=11,
                is_rewatching=True,
                total_rewatches=1,
                started_at=date(2025, 2, 1),
                finished_at=finished,
            ),
            {"episodes_watched": 12},
        )

        self.assertEqual(result["status"], Status.completed)
        self.assertEqual(result["total_rewatches"], 2)
        self.assertFalse(result["is_rewatching"])
        self.assertNotIn("finished_at", result)  # the first finish date stays


class StartRuleTests(SimpleTestCase):
    def test_watching_sets_started_at(self):
        result = normalize(entry(status=Status.plan_to_watch), {"status": Status.watching})

        self.assertEqual(result["started_at"], TODAY)

    def test_watching_keeps_an_existing_start_date(self):
        result = normalize(
            entry(status=Status.on_hold, started_at=date(2024, 5, 5)), {"status": Status.watching}
        )

        self.assertNotIn("started_at", result)

    def test_plan_to_watch_keeps_progress(self):
        result = normalize(entry(episodes_watched=4), {"status": Status.plan_to_watch})

        self.assertEqual(result["status"], Status.plan_to_watch)
        self.assertEqual(result.get("episodes_watched", 4), 4)  # unchanged, never zeroed

    def test_progress_on_plan_to_watch_moves_to_watching(self):
        result = normalize(entry(status=Status.plan_to_watch), {"episodes_watched": 2})

        self.assertEqual(result["status"], Status.watching)
        self.assertEqual(result["started_at"], TODAY)

    def test_create_without_status_defaults_to_plan_to_watch(self):
        result = normalize(None, {})

        self.assertEqual((result["status"], result["episodes_watched"]), (Status.plan_to_watch, 0))

    def test_create_with_progress_and_no_status_is_watching(self):
        result = normalize(None, {"episodes_watched": 3})

        self.assertEqual(result["status"], Status.watching)


class BoundsTests(SimpleTestCase):
    def test_notes_over_limit_rejected(self):
        with self.assertRaises(ListRuleError) as ctx:
            normalize(entry(), {"notes": "x" * (MAX_NOTES_LENGTH + 1)})
        self.assertEqual(ctx.exception.field, "notes")

    def test_notes_at_limit_accepted(self):
        result = normalize(entry(), {"notes": "x" * MAX_NOTES_LENGTH})
        self.assertEqual(len(result["notes"]), MAX_NOTES_LENGTH)

    def test_dates_out_of_range_rejected(self):
        for value in (date(1959, 12, 31), date(2026, 11, 18)):
            with self.subTest(value=str(value)), self.assertRaises(ListRuleError) as ctx:
                normalize(entry(), {"started_at": value})
            self.assertEqual(ctx.exception.field, "started_at")

    def test_tomorrow_is_accepted(self):
        result = normalize(entry(), {"started_at": date(2026, 11, 17)})
        self.assertEqual(result["started_at"], date(2026, 11, 17))

    def test_finish_before_start_rejected(self):
        with self.assertRaises(ListRuleError) as ctx:
            normalize(entry(), {"started_at": date(2025, 5, 2), "finished_at": date(2025, 5, 1)})
        self.assertEqual(ctx.exception.field, "finished_at")

    def test_episodes_over_total_rejected(self):
        with self.assertRaises(ListRuleError):
            normalize(entry(), {"episodes_watched": 13})

    def test_episodes_over_unknown_total_cap_rejected(self):
        with self.assertRaises(ListRuleError):
            normalize(entry(), {"episodes_watched": MAX_EPISODES_UNKNOWN_TOTAL + 1}, total=0)
        result = normalize(entry(), {"episodes_watched": MAX_EPISODES_UNKNOWN_TOTAL}, total=0)
        self.assertEqual(result["episodes_watched"], MAX_EPISODES_UNKNOWN_TOTAL)

    def test_negative_episodes_rejected(self):
        with self.assertRaises(ListRuleError):
            normalize(entry(), {"episodes_watched": -1})


class LenientModeTests(SimpleTestCase):
    """Imports clamp instead of rejecting, and never invent dates."""

    def test_clamps_episodes_notes_and_drops_bad_dates(self):
        result = normalize(
            None,
            {
                "status": Status.watching,
                "episodes_watched": 99,
                "notes": "y" * (MAX_NOTES_LENGTH + 10),
                "started_at": date(1900, 1, 1),
            },
            strict=False,
        )

        self.assertEqual(result["status"], Status.completed)  # clamped to total = full progress
        self.assertEqual(result["episodes_watched"], 12)
        self.assertEqual(len(result["notes"]), MAX_NOTES_LENGTH)
        self.assertIsNone(result["started_at"])
        self.assertNotIn("finished_at", result)

    def test_no_dates_invented_for_watching_or_completed(self):
        watching = normalize(None, {"status": Status.watching, "episodes_watched": 2}, strict=False)
        completed = normalize(None, {"status": Status.completed}, strict=False)

        self.assertNotIn("started_at", watching)
        self.assertNotIn("finished_at", completed)

    def test_disordered_dates_move_finish_to_start(self):
        result = normalize(
            None,
            {
                "status": Status.completed,
                "started_at": date(2025, 5, 2),
                "finished_at": date(2025, 5, 1),
            },
            strict=False,
        )

        self.assertEqual(result["finished_at"], date(2025, 5, 2))

    def test_repeating_entry_becomes_watching_rewatch(self):
        result = normalize(
            None,
            {
                "status": Status.watching,
                "episodes_watched": 4,
                "is_rewatching": True,
                "total_rewatches": 1,
            },
            strict=False,
        )

        self.assertEqual((result["status"], result["episodes_watched"]), (Status.watching, 4))
        self.assertTrue(result["is_rewatching"])
        self.assertEqual(result["total_rewatches"], 1)


class UserTodayTests(SimpleTestCase):
    def user(self, zone):
        return SimpleNamespace(userprofile=SimpleNamespace(preferred_timezone=zone))

    @freeze_time("2026-11-16 20:30:00", tz_offset=0)
    def test_profile_timezone_decides_the_date(self):
        self.assertEqual(user_today(self.user("Asia/Tashkent")), date(2026, 11, 17))  # UTC+5
        self.assertEqual(user_today(self.user("")), date(2026, 11, 16))

    @freeze_time("2026-11-16 20:30:00", tz_offset=0)
    def test_invalid_timezone_and_no_user_fall_back_to_utc(self):
        self.assertEqual(user_today(self.user("Not/AZone")), date(2026, 11, 16))
        self.assertEqual(user_today(None), date(2026, 11, 16))

    @freeze_time("2026-11-16 20:30:00", tz_offset=0)
    def test_completion_date_uses_profile_timezone(self):
        today = user_today(self.user("Asia/Tashkent"))
        result = normalize_entry(
            entry(episodes_watched=3), {"status": Status.completed}, anime(), today
        )

        self.assertEqual(result["finished_at"], date(2026, 11, 17))


class AutomaticDateTests(SimpleTestCase):
    """Automatic dates fit around stored ones; they never move a stored date (council M1)."""

    FINISHED = date(2020, 5, 1)

    def completed(self):
        return entry(status=Status.completed, episodes_watched=12, finished_at=self.FINISHED)

    def test_rewatch_of_an_entry_finished_long_ago_keeps_its_finish_date(self):
        result = normalize(self.completed(), {"is_rewatching": True})

        self.assertEqual(result["status"], Status.watching)
        self.assertNotIn("finished_at", result)
        self.assertIsNone(result.get("started_at"))

    def test_lowering_progress_keeps_the_finish_date(self):
        result = normalize(self.completed(), {"episodes_watched": 5})

        self.assertEqual(result["status"], Status.watching)
        self.assertNotIn("finished_at", result)
        self.assertIsNone(result.get("started_at"))

    def test_back_to_watching_keeps_the_finish_date(self):
        result = normalize(self.completed(), {"status": Status.watching})

        self.assertNotIn("finished_at", result)
        self.assertIsNone(result.get("started_at"))

    def test_watching_still_gets_a_start_date_without_a_past_finish(self):
        result = normalize(entry(status=Status.plan_to_watch), {"status": Status.watching})

        self.assertEqual(result["started_at"], TODAY)

    def test_invented_finish_date_never_precedes_a_start_date_of_tomorrow(self):
        tomorrow = date(2026, 11, 17)
        result = normalize(
            entry(status=Status.watching, started_at=tomorrow), {"status": Status.completed}
        )

        self.assertEqual(result["finished_at"], tomorrow)
