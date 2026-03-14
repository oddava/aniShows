from django.db.models import Q

from apps.animes.models import UserFavorite


def build_user_favorites_queryset(params):
    queryset = UserFavorite.objects.select_related("user", "anime")

    search = params.get("search", "")
    if search:
        queryset = queryset.filter(
            Q(user__username__icontains=search) | Q(anime__title__icontains=search)
        )

    user_filter = params.get("user")
    if user_filter:
        if str(user_filter).isdigit():
            queryset = queryset.filter(user_id=int(user_filter))
        else:
            queryset = queryset.filter(user__username__icontains=user_filter)

    anime_filter = params.get("anime")
    if anime_filter:
        if str(anime_filter).isdigit():
            queryset = queryset.filter(anime_id=int(anime_filter))
        else:
            queryset = queryset.filter(anime__title__icontains=anime_filter)

    ordering = params.get("ordering", "-added_at")
    valid_orderings = {"added_at", "-added_at"}
    if ordering in valid_orderings:
        queryset = queryset.order_by(ordering)

    return queryset


def serialize_user_favorites(entries):
    return [
        {
            "id": fav.id,
            "user_id": fav.user.id,
            "user_username": fav.user.username,
            "anime_id": fav.anime.id,
            "anime_title": fav.anime.title,
            "anime_slug": fav.anime.slug,
            "added_at": fav.added_at.isoformat(),
            "created_at": fav.added_at.isoformat(),
        }
        for fav in entries
    ]
