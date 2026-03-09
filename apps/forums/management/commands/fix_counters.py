from django.core.management.base import BaseCommand

from apps.forums.models import Category, Post, Thread


class Command(BaseCommand):
    help = "Fix corrupted like/reply/thread counters"

    def handle(self, *args, **options):
        self.stdout.write("Fixing counters...")

        # Fix thread like counts
        fixed_threads = 0
        for thread in Thread.objects.all():
            actual_likes = thread.likes.count()
            if thread.like_count != actual_likes:
                self.stdout.write(f"  Thread {thread.id}: {thread.like_count} -> {actual_likes}")
                thread.like_count = actual_likes
                thread.save(update_fields=["like_count"])
                fixed_threads += 1

        self.stdout.write(f"Fixed {fixed_threads} threads")

        # Fix post like counts
        fixed_posts = 0
        for post in Post.objects.all():
            actual_likes = post.likes.count()
            if post.like_count != actual_likes:
                self.stdout.write(f"  Post {post.id}: {post.like_count} -> {actual_likes}")
                post.like_count = actual_likes
                post.save(update_fields=["like_count"])
                fixed_posts += 1

        self.stdout.write(f"Fixed {fixed_posts} posts")

        # Fix thread reply counts
        for thread in Thread.objects.all():
            actual_posts = thread.posts.count()
            if thread.reply_count != actual_posts:
                self.stdout.write(
                    f"  Thread {thread.id} replies: {thread.reply_count} -> {actual_posts}"
                )
                thread.reply_count = actual_posts
                thread.save(update_fields=["reply_count"])

        # Fix category thread counts
        for category in Category.objects.all():
            actual_threads = category.threads.count()
            if category.thread_count != actual_threads:
                self.stdout.write(
                    f"  Category {category.id}: {category.thread_count} -> {actual_threads}"
                )
                category.thread_count = actual_threads
                category.save(update_fields=["thread_count"])

        self.stdout.write(self.style.SUCCESS("Done!"))
