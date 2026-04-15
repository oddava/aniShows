from django.db.models import Q

PLACEHOLDER_SYNOPSIS = "Imported from Anime Offline Database. Metadata enrichment pending."


def build_missing_metadata_query(*, missing_tags_only: bool = False) -> Q:
    """Return the shared query used to find anime needing metadata hydration."""
    if missing_tags_only:
        return Q(tags=[])

    return (
        Q(characters__isnull=True)
        | Q(staff__isnull=True)
        | Q(synopsis=PLACEHOLDER_SYNOPSIS)
        | Q(tags=[])
    )


def build_stalled_offline_metadata_query() -> Q:
    """Return the durable signal for offline imports still awaiting enrichment."""
    return Q(synopsis=PLACEHOLDER_SYNOPSIS)
