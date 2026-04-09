from django.db.models import Q

from ...users.models import UserAnimeList


def build_user_list_queryset(params):
    queryset = UserAnimeList.objects.select_related("user", "anime")

    list_status = params.get("status")
    if list_status:
        queryset = queryset.filter(status=list_status)

    min_score = params.get("min_score")
    if min_score:
        queryset = queryset.filter(score__gte=int(min_score))

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

    ordering = params.get("ordering", "-updated_at")
    valid_orderings = {"updated_at", "-updated_at", "score", "-score"}
    if ordering in valid_orderings:
        queryset = queryset.order_by(ordering)

    return queryset


def serialize_user_list_entries(entries):
    return [
        {
            "id": entry.id,
            "user": {"id": entry.user.id, "username": entry.user.username},
            "anime": {"id": entry.anime.id, "title": entry.anime.title, "slug": entry.anime.slug},
            "status": entry.status,
            "score": entry.score,
            "episodes_watched": entry.episodes_watched,
            "updated_at": entry.updated_at.isoformat(),
        }
        for entry in entries
    ]


def serialize_user_list_entry(entry):
    return {
        "id": entry.id,
        "user": {"id": entry.user.id, "username": entry.user.username},
        "anime": {"id": entry.anime.id, "title": entry.anime.title, "slug": entry.anime.slug},
        "status": entry.status,
        "score": entry.score,
        "episodes_watched": entry.episodes_watched,
        "is_rewatching": entry.is_rewatching,
        "notes": entry.notes,
        "started_at": entry.started_at.isoformat() if entry.started_at else None,
        "finished_at": entry.finished_at.isoformat() if entry.finished_at else None,
        "total_rewatches": entry.total_rewatches,
        "updated_at": entry.updated_at.isoformat(),
    }
