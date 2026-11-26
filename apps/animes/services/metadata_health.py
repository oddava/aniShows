from django.db.models import Q

# Synopsis the retired offline-database import gave rows it could not enrich yet.
# Rows still carrying it are treated as missing metadata.
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
