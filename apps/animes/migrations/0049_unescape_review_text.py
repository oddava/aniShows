import html

from django.db import migrations

BATCH_SIZE = 500


def _rewrite_texts(apps, transform):
    Review = apps.get_model("anime", "Review")
    changed = []
    for review in Review.objects.exclude(text="").only("id", "text").iterator(chunk_size=BATCH_SIZE):
        new_text = transform(review.text)
        if new_text != review.text:
            review.text = new_text
            changed.append(review)
        if len(changed) >= BATCH_SIZE:
            Review.objects.bulk_update(changed, ["text"])
            changed.clear()
    if changed:
        Review.objects.bulk_update(changed, ["text"])


def unescape_review_text(apps, schema_editor):
    # The serializer used to store django.utils.html.escape(text); reviews are
    # rendered as plain text, so store what the author typed.
    _rewrite_texts(apps, html.unescape)


def escape_review_text(apps, schema_editor):
    _rewrite_texts(apps, lambda text: html.escape(text, quote=True))


class Migration(migrations.Migration):

    dependencies = [
        ("anime", "0048_anime_data_model_cleanup"),
    ]

    operations = [
        migrations.RunPython(unescape_review_text, escape_review_text),
    ]
