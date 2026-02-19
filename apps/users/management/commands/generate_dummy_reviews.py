import random
import string
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from django.db import IntegrityError
from apps.animes.models import Anime, Review

User = get_user_model()

class Command(BaseCommand):
    help = 'Generate dummy users and reviews for a specific anime'

    def add_arguments(self, parser):
        parser.add_argument('--anime_slug', type=str, default='jujutsu-kaisen-season-2', help='Slug of the anime to review')
        parser.add_argument('--count', type=int, default=30, help='Number of reviews to generate')

    def handle(self, *args, **options):
        anime_slug = options['anime_slug']
        count = options['count']

        try:
            anime = Anime.objects.get(slug=anime_slug)
        except Anime.DoesNotExist:
            self.stdout.write(self.style.ERROR(f'Anime with slug "{anime_slug}" does not exist.'))
            return

        self.stdout.write(f'Generating {count} reviews for "{anime.title}"...')

        reviews_created = 0
        users_created = 0
        
        while reviews_created < count:
            # Generate random username
            username = 'testuser_' + ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
            
            try:
                # Determine email
                email = f'{username}@example.com'
                user = User.objects.create_user(username=username, password='password123', email=email)
                users_created += 1
            except IntegrityError:
                continue # Username taken, try again

            # Generate random review
            # Weight towards positive ratings for realism if desired, but random is fine
            rating = random.randint(1, 10) 
            
            text_options = [
                "Amazing show! totally recommended.",
                "It was okay, not the best.",
                "Loved the animation! MAPPA crazy.",
                "Story was a bit weak but good visuals.",
                "Masterpiece.",
                "I didn't like the ending.",
                "Can't wait for next season!",
                "Characters are so well written, especially Gojo.",
                "Overrated in my opinion.",
                "Solid 10/10.",
                "Worst anime I've ever seen (jk).",
                "Best anime I've ever seen.",
                "It was meh.",
                "Action scenes were top notch.",
                "Music was fire.",
                "Shibuya arc was insane!",
                "Sukuna is terrifying.",
                "The fight choreography is unmatched.",
                "A bit confusing at times but still good.",
                "Highly entertaining.",
                "Visuals: 10, Story: 8.",
                "I binged this in one day.",
                "Can't recommend enough.",
                "Don't understand the hype.",
                "Peak fiction.",
            ]
            
            # 20% chance of empty review text
            if random.random() < 0.2:
                text = ""
            else:
                text = random.choice(text_options)
            
            # Optional: Add rating breakdown
            rating_story = random.randint(1, 10)
            rating_animation = random.randint(1, 10)
            rating_music = random.randint(1, 10)
            rating_characters = random.randint(1, 10)

            try:
                Review.objects.create(
                    user=user,
                    anime=anime,
                    rating=rating,
                    text=text,
                    rating_story=rating_story,
                    rating_animation=rating_animation,
                    rating_music=rating_music,
                    rating_characters=rating_characters
                )
                reviews_created += 1
                # self.stdout.write(f'Created review {reviews_created}/{count} by {username}')
            except IntegrityError:
                self.stdout.write(self.style.WARNING(f'User {username} already reviewed this anime.'))
                pass
        
        self.stdout.write(self.style.SUCCESS(f'Successfully created {users_created} users and {reviews_created} reviews for {anime.title}'))
