"""Query helpers shared by admin list endpoints."""

from __future__ import annotations

from django.db.models import Count, IntegerField, OuterRef, Subquery, Value
from django.db.models.functions import Coalesce


def related_count(model, fk_field: str, *, outer: str = "pk", **filters):
    """A correlated ``COUNT(*)`` of ``model`` rows pointing at the outer row.

    Unlike ``Count("relation")`` it never joins, so several counts on one queryset
    do not multiply each other.
    """
    subquery = (
        model.objects.filter(**{fk_field: OuterRef(outer)}, **filters)
        .order_by()
        .values(fk_field)
        .annotate(total=Count("*"))
        .values("total")[:1]
    )
    return Coalesce(Subquery(subquery, output_field=IntegerField()), Value(0))
