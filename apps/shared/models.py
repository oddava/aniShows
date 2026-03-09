from django.db.models import DateTimeField, Model, SlugField


class TimestampMixin(Model):
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)

    class Meta:
        abstract = True

class CreatedAtMixin(Model):
    created_at = DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True

class SlugMixin(Model):
    slug = SlugField(max_length=200, unique=True)

    class Meta:
        abstract = True
