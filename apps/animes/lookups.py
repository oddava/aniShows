"""``ilike`` lookup: case-insensitive substring match that trigram indexes can serve.

Django compiles ``icontains`` on PostgreSQL to ``UPPER(col) LIKE UPPER(%s)``.
A ``gin_trgm_ops`` index is built on ``col``, not ``UPPER(col)``, so the
planner can never use it for ``icontains``. ``ILIKE`` on the bare column is
the same match and is index-supported.

    Anime.objects.filter(title__ilike="frieren")  # title ILIKE '%frieren%'

The value is a plain substring: LIKE wildcards and the escape character in it are escaped.
"""

from django.db.models import CharField, TextField
from django.db.models.lookups import PatternLookup


@CharField.register_lookup
@TextField.register_lookup
class ILikeContains(PatternLookup):
    lookup_name = "ilike"
    param_pattern = "%%%s%%"
    prepare_rhs = False

    def get_rhs_op(self, connection, rhs):
        return f"ILIKE {rhs}"
