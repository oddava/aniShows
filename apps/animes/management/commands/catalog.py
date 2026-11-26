"""Run the catalog engine by hand (``apps.animes.catalog``).

manage.py catalog status
manage.py catalog run seasons            # this and the neighbouring seasons
manage.py catalog run seed               # continue (or start) the full sweep
manage.py catalog run seed --restart     # start the sweep over
manage.py catalog run trending --async   # queue it on the worker instead
manage.py catalog rescope                # re-apply the scope rule to stored rows
"""

from django.core.management.base import BaseCommand, CommandError

from ...catalog import scope
from ...catalog.lanes import LANES
from ...catalog.overview import catalog_overview
from ...catalog.runner import LANE_QUEUES, run_lane
from ...models import CatalogRun


class Command(BaseCommand):
    help = "Run catalog lanes, show the catalog's state, or re-apply the scope rule."

    def add_arguments(self, parser):
        sub = parser.add_subparsers(dest="action", required=True)
        run = sub.add_parser("run", help="Run one lane now")
        run.add_argument("lane", choices=sorted(LANES))
        run.add_argument("--restart", action="store_true", help="seed: start the sweep over")
        run.add_argument("--async", dest="run_async", action="store_true", help="Queue it")
        sub.add_parser("status", help="Coverage, lanes and the sweep's position")
        sub.add_parser("rescope", help="Hide/show stored rows by the scope rule (no requests)")

    def handle(self, *args, **options):
        action = options["action"]
        if action == "status":
            return self._status()
        if action == "rescope":
            result = scope.rescope_stored()
            self.stdout.write(f"Hidden: {result['hidden']}, shown again: {result['shown']}")
            return None
        lane = options["lane"]
        extra = {"restart": True} if options["restart"] else {}
        if options["restart"] and lane != "seed":
            raise CommandError("--restart only applies to the seed lane.")
        if options["run_async"]:
            from ...tasks.catalog import run_catalog_lane

            result = run_catalog_lane.apply_async(
                kwargs={"lane": lane, "trigger": CatalogRun.Trigger.ADMIN, **extra},
                queue=LANE_QUEUES[lane],
            )
            self.stdout.write(f"Queued {lane} (task {result.id})")
            return None
        result = run_lane(lane, trigger=CatalogRun.Trigger.ADMIN, **extra)
        self.stdout.write(str(result))
        return None

    def _status(self):
        overview = catalog_overview()
        totals = overview["totals"]
        self.stdout.write(
            f"Listed: {totals['listed']}  hidden: {totals['hidden']}  "
            f"with details: {totals['hydrated']}"
        )
        for season in overview["seasons"]:
            self.stdout.write(
                f"  {season['label']}: {season['listed']} listed"
                + (f" / AniList {season['anilist']}" if season["anilist"] is not None else "")
            )
        sweep = overview["sweep"]
        self.stdout.write(f"Sweep: {sweep}")
        for lane in overview["lanes"]:
            last = lane["last_run"]
            self.stdout.write(
                f"  {lane['lane']:<9} last: "
                + (f"{last['status']} at {last['started_at']}" if last else "never")
            )
