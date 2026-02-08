"""
Management command to backfill points for existing users based on their review votes.
This is a one-time command to initialize points for users with existing helpful votes.

Usage:
    python manage.py backfill_points
"""
from django.core.management.base import BaseCommand
from django.db.models import Sum, Case, When, IntegerField

from users.models import UserProfile
from anime.models import ReviewVote


class Command(BaseCommand):
    help = 'Backfill points for all users based on their existing review votes'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be updated without making changes',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        
        self.stdout.write('Calculating points for all users...')
        
        # Get all users with profiles
        profiles = UserProfile.objects.select_related('user').all()
        updated_count = 0
        
        for profile in profiles:
            # Count helpful votes as +1, unhelpful as -1
            result = ReviewVote.objects.filter(review__user=profile.user).aggregate(
                total_points=Sum(
                    Case(
                        When(is_helpful=True, then=1),
                        When(is_helpful=False, then=-1),
                        default=0,
                        output_field=IntegerField(),
                    )
                )
            )
            
            new_points = result['total_points'] or 0
            
            if profile.points != new_points:
                if dry_run:
                    self.stdout.write(
                        f'  [DRY RUN] {profile.user.username}: {profile.points} -> {new_points}'
                    )
                else:
                    profile.points = new_points
                    profile.save(update_fields=['points'])
                    self.stdout.write(
                        self.style.SUCCESS(
                            f'  Updated {profile.user.username}: {new_points} points'
                        )
                    )
                updated_count += 1
        
        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f'\n[DRY RUN] Would update {updated_count} users'
                )
            )
        else:
            self.stdout.write(
                self.style.SUCCESS(
                    f'\nSuccessfully updated {updated_count} users'
                )
            )
