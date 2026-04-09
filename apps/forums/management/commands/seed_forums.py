from django.core.management.base import BaseCommand

from ...models import Category, Tag


class Command(BaseCommand):
    help = 'Seed the forums with initial categories and tags'

    def handle(self, *args, **options):
        categories = [
            {'name': 'General Discussion', 'slug': 'general', 'description': 'Talk about anything anime-related.', 'order': 1},
            {'name': 'Anime Recommendations', 'slug': 'recommendations', 'description': 'Ask for or share anime recommendations.', 'order': 2},
            {'name': 'News & Announcements', 'slug': 'news', 'description': 'Latest anime news, upcoming releases, and announcements.', 'order': 3},
            {'name': 'Reviews & Opinions', 'slug': 'reviews', 'description': 'Share your reviews and hot takes.', 'order': 4},
            {'name': 'Off-Topic', 'slug': 'off-topic', 'description': 'Non-anime discussions and community chatter.', 'order': 5},
        ]

        tags = [
            {'name': 'Discussion', 'slug': 'discussion', 'color': '#8B5CF6'},
            {'name': 'Question', 'slug': 'question', 'color': '#3B82F6'},
            {'name': 'Recommendation', 'slug': 'recommendation', 'color': '#10B981'},
            {'name': 'Spoiler', 'slug': 'spoiler', 'color': '#EF4444'},
            {'name': 'News', 'slug': 'news', 'color': '#F59E0B'},
            {'name': 'Fan Art', 'slug': 'fan-art', 'color': '#EC4899'},
            {'name': 'Meme', 'slug': 'meme', 'color': '#F97316'},
        ]

        created_cats = 0
        for cat_data in categories:
            _, created = Category.objects.get_or_create(slug=cat_data['slug'], defaults=cat_data)
            if created:
                created_cats += 1

        created_tags = 0
        for tag_data in tags:
            _, created = Tag.objects.get_or_create(slug=tag_data['slug'], defaults=tag_data)
            if created:
                created_tags += 1

        self.stdout.write(self.style.SUCCESS(
            f'Seeded forums: {created_cats} categories, {created_tags} tags created.'
        ))
