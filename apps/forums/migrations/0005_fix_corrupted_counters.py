# Generated manually to fix corrupted like counts
from django.db import migrations


def recalculate_all_counters(apps, schema_editor):
    """Recalculate all denormalized counters to fix data corruption."""
    Thread = apps.get_model("forums", "Thread")
    Post = apps.get_model("forums", "Post")
    Category = apps.get_model("forums", "Category")

    print("Recalculating thread like counts...")
    for thread in Thread.objects.all():
        actual_likes = thread.likes.count()
        if thread.like_count != actual_likes:
            print(f"  Thread {thread.id}: {thread.like_count} -> {actual_likes}")
            thread.like_count = actual_likes
            thread.save(update_fields=["like_count"])

    print("Recalculating post like counts...")
    for post in Post.objects.all():
        actual_likes = post.likes.count()
        if post.like_count != actual_likes:
            print(f"  Post {post.id}: {post.like_count} -> {actual_likes}")
            post.like_count = actual_likes
            post.save(update_fields=["like_count"])

    print("Recalculating thread reply counts...")
    for thread in Thread.objects.all():
        actual_posts = thread.posts.count()
        if thread.reply_count != actual_posts:
            print(f"  Thread {thread.id} replies: {thread.reply_count} -> {actual_posts}")
            thread.reply_count = actual_posts
            thread.save(update_fields=["reply_count"])

    print("Recalculating category thread counts...")
    for category in Category.objects.all():
        actual_threads = category.threads.count()
        if category.thread_count != actual_threads:
            print(f"  Category {category.id}: {category.thread_count} -> {actual_threads}")
            category.thread_count = actual_threads
            category.save(update_fields=["thread_count"])

    print("Done! All counters recalculated.")


def reverse_migration(apps, schema_editor):
    """No reverse needed - data fix only."""
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("forums", "0004_populate_denormalized_counters"),
    ]

    operations = [
        migrations.RunPython(recalculate_all_counters, reverse_migration),
    ]
