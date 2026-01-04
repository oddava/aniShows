from django.core.management.base import BaseCommand
from anime.models import Anime
from anime.services.anilist import AniListService
from asgiref.sync import sync_to_async
import asyncio
import time

class Command(BaseCommand):
    help = 'Backfills metadata for existing anime with rate limiting resilience'

    def handle(self, *args, **options):
        self.stdout.write("Starting metadata backfill...")
        
        async def run_backfill():
            service = AniListService()
            try:
                # Get all anime from DB
                all_anime = await sync_to_async(list)(Anime.objects.all().order_by('-popularity_rank'))
                total = len(all_anime)
                self.stdout.write(f"Found {total} anime to update.")
                
                updated_count = 0
                error_count = 0

                for i, anime in enumerate(all_anime):
                    self.stdout.write(f"[{i+1}/{total}] Updating {anime.title}...")
                    
                    retries = 3
                    
                    while retries > 0:
                        try:
                            # Search by title
                            search_term = anime.title
                            results = await service.search_anime(search_term)
                            
                            if results:
                                item = results[0]
                                stats = await service.process_media_list([item])
                                updated_count += 1
                                break # Success
                            else:
                                self.stdout.write(self.style.WARNING(f"  No match found for: {anime.title}"))
                                break # No result
                                
                        except Exception as e:
                            self.stdout.write(self.style.ERROR(f"  Error: {e}"))
                            # If it's a connection error or likely transient, retry
                            # For now, simple retry logic
                            retries -= 1
                            if retries > 0:
                                await asyncio.sleep(5.0) # Wait longer on error
                            else:
                                error_count += 1
                        
                        
                    # Standard Rate limit kindness
                    await asyncio.sleep(2.0)

                self.stdout.write(self.style.SUCCESS(f"Backfill Complete. Updated: {updated_count}, Errors: {error_count}"))

            finally:
                await service.close()

        asyncio.run(run_backfill())
