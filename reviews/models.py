from django.db.models import ForeignKey, IntegerField, Model, TextField, DateTimeField, CASCADE


class Review(Model):
    user = ForeignKey("users.UserProfile", on_delete=CASCADE)
    anime = ForeignKey("anime.Anime", on_delete=CASCADE)
    rating = IntegerField(default=0)
    text = TextField(blank=True, null=True)
    created_at = DateTimeField(auto_now_add=True)