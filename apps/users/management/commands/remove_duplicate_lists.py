from django.core.management.base import BaseCommand
from django.db.models import Count, Max

from ...models import UserAnimeList


class Command(BaseCommand):
    help = 'Remove duplicate UserAnimeList entries, keeping the most recently updated one.'

    def handle(self, *args, **options):
        duplicates = (
            UserAnimeList.objects.values('user', 'anime')
            .annotate(count=Count('id'), max_id=Max('id'))
            .filter(count__gt=1)
        )

        total_deleted = 0

        for entry in duplicates:
            user_id = entry['user']
            anime_id = entry['anime']

            # Get all duplicates for this user/anime pair
            entries = UserAnimeList.objects.filter(user_id=user_id, anime_id=anime_id).order_by('-updated_at')

            # Keep the first one (most recent), delete the rest
            to_delete = entries[1:]

            count = to_delete.count()
            if count > 0:
                self.stdout.write(f"Found {count} duplicates for User {user_id}, Anime {anime_id}. Deleting...")
                for item in to_delete:
                    item.delete()
                total_deleted += count

        self.stdout.write(self.style.SUCCESS(f'Successfully deleted {total_deleted} duplicate entries.'))
