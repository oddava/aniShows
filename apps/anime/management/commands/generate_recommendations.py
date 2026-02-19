"""
Management command to generate recommendations for users.
Useful for testing and initial setup.
"""

from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from apps.anime.recommendations import RecommendationService

User = get_user_model()


class Command(BaseCommand):
    help = "Generate anime recommendations for users"

    def add_arguments(self, parser):
        parser.add_argument(
            "--user",
            type=str,
            help="Generate recommendations for a specific username or user ID",
        )
        parser.add_argument(
            "--all",
            action="store_true",
            help="Generate recommendations for all active users",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=50,
            help="Number of recommendations per user (default: 50)",
        )

    def handle(self, *args, **options):
        service = RecommendationService()

        if options["user"]:
            # Generate for specific user
            user_identifier = options["user"]
            try:
                # Try as user ID first
                if user_identifier.isdigit():
                    user = User.objects.get(id=int(user_identifier))
                else:
                    user = User.objects.get(username=user_identifier)

                self.stdout.write(
                    f"Generating recommendations for user: {user.username}"
                )
                recs = service.generate_for_user(user, save=True)
                self.stdout.write(
                    self.style.SUCCESS(
                        f"Generated {len(recs)} recommendations for {user.username}"
                    )
                )

                # Display top 5
                for rec in recs[:5]:
                    self.stdout.write(
                        f"  - {rec.anime.title} (Score: {rec.score}, Reason: {rec.reason})"
                    )

            except User.DoesNotExist:
                self.stdout.write(
                    self.style.ERROR(f"User '{user_identifier}' not found")
                )

        elif options["all"]:
            # Generate for all users
            self.stdout.write("Generating recommendations for all active users...")
            stats = service.generate_for_all_users()

            self.stdout.write(
                self.style.SUCCESS(
                    f"Complete! Processed {stats['processed']}/{stats['total_users']} users, "
                    f"generated {stats['total_recommendations']} total recommendations"
                )
            )
            if stats["failed"] > 0:
                self.stdout.write(
                    self.style.WARNING(f"Failed: {stats['failed']} users")
                )

        else:
            self.stdout.write(
                self.style.WARNING("Please specify --user or --all option")
            )
            self.stdout.write("\nExamples:")
            self.stdout.write(
                "  python manage.py generate_recommendations --user john_doe"
            )
            self.stdout.write("  python manage.py generate_recommendations --user 123")
            self.stdout.write("  python manage.py generate_recommendations --all")
            self.stdout.write(
                "  python manage.py generate_recommendations --all --limit 100"
            )
