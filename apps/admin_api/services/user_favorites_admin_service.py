from django.db.models import Q

from apps.animes.models import UserFavorite


def build_user_favorites_queryset(params):
    queryset = UserFavorite.objects.select_related("user", "anime")

    search = params.get("search", "")
    if search:
        queryset = queryset.filter(
            Q(user__username__icontains=search) | Q(anime__title__icontains=search)
        )

    ordering = params.get("ordering", "-created_at")
    valid_orderings = {"created_at", "-created_at"}
    if ordering in valid_orderings:
        queryset = queryset.order_by(ordering)

    return queryset


def serialize_user_favorites(entries):
    return [
        {
            "id": fav.id,
            "user": {"id": fav.user.id, "username": fav.user.username},
            "anime": {"id": fav.anime.id, "title": fav.anime.title},
            "created_at": fav.created_at.isoformat(),
        }
        for fav in entries
    ]
