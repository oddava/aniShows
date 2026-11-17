"""``ilike`` lookup: case-insensitive substring match that trigram indexes can serve.

Django compiles ``icontains`` on PostgreSQL to ``UPPER(col) LIKE UPPER(%s)``.
A ``gin_trgm_ops`` index is built on ``col``, not ``UPPER(col)``, so the
planner can never use it for ``icontains``. ``ILIKE`` on the bare column is
the same match and is index-supported.

    Anime.objects.filter(title__ilike="frieren")  # title ILIKE '%frieren%'
    Anime.objects.filter(title__ilike_prefix="frie")  # title ILIKE 'frie%'

The value is a plain substring: LIKE wildcards and the escape character in it are escaped.
"""

from django.db.models import CharField, TextField
from django.db.models.lookups import PatternLookup


class _ILikePattern(PatternLookup):
    prepare_rhs = False

    def get_rhs_op(self, connection, rhs):
        if hasattr(self.rhs, "as_sql"):
            # The wildcards are added to plain values only (process_rhs).
            raise TypeError(f"__{self.lookup_name} takes a string, not an expression")
        return f"ILIKE {rhs}"


@CharField.register_lookup
@TextField.register_lookup
class ILikeContains(_ILikePattern):
    """``col ILIKE '%value%'``."""

    lookup_name = "ilike"
    param_pattern = "%%%s%%"


@CharField.register_lookup
@TextField.register_lookup
class ILikePrefix(_ILikePattern):
    """``col ILIKE 'value%'``: starts with ``value`` (also index-served, 3+ characters)."""

    lookup_name = "ilike_prefix"
    param_pattern = "%s%%"
