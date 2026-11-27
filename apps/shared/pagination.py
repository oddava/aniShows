from rest_framework.exceptions import NotFound
from rest_framework.pagination import PageNumberPagination, _positive_int
from rest_framework.response import Response
from rest_framework.utils.urls import remove_query_param, replace_query_param


class StandardPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 200


class LargePagination(PageNumberPagination):
    """For long per-anime lists (episodes, characters, staff)."""

    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 100


def bounded_count(queryset, limit: int) -> int:
    """How many rows ``queryset`` has, counting no further than ``limit``.

    ``COUNT(*)`` over a ``LIMIT``-ed subquery: the cost is bounded by
    ``limit`` however large the match set is. Ordering is dropped (it does not
    change how many rows there are). Objects other than querysets may offer
    ``count_upto(limit)`` (see ``RankedSearchResults``).
    """
    count_upto = getattr(queryset, "count_upto", None)
    if count_upto is not None:
        return count_upto(limit)
    if isinstance(queryset, list | tuple):
        return min(len(queryset), limit)
    return queryset.order_by()[:limit].count()


class NoCountPagination(PageNumberPagination):
    """Pages without an unbounded COUNT query: ``next`` exists when one more row does.

    ``count`` is exact up to ``count_cap`` rows and ``count_cap`` beyond it,
    with ``count_capped`` true (BUG-009: it used to be null, so the UI could
    not say how many results a search has). The count reads at most
    ``count_cap + 1`` rows and is free when the first page is the last one;
    list payloads are cached per parameters, so it runs on cache misses only.

    Pages past ``max_page`` are 404: nobody browses that deep, and a deep
    OFFSET reads and discards every row before it (B11).
    """

    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 200
    max_page = 500
    count_cap = 2000
    invalid_page_message = "Invalid page."

    def paginate_queryset(self, queryset, request, view=None):
        page_size = self.get_page_size(request)
        if not page_size:
            return None

        self.request = request
        self.page_size = page_size
        self.page_number = self.get_page_number(request)
        self.has_previous = self.page_number > 1

        offset = (self.page_number - 1) * page_size
        items = list(queryset[offset : offset + page_size + 1])
        self.has_next = len(items) > page_size
        self.page = items[:page_size]
        if not self.has_next and (self.page or self.page_number == 1):
            # The last page: everything before it plus what is on it.
            self.count = offset + len(self.page)
        else:
            self.count = bounded_count(queryset, self.count_cap + 1)
        self.count_capped = self.count > self.count_cap
        self.count = min(self.count, self.count_cap)
        return self.page

    def get_page_number(self, request):
        page_number = request.query_params.get(self.page_query_param, 1)
        try:
            number = _positive_int(page_number, strict=True, cutoff=None)
        except (TypeError, ValueError):
            raise NotFound(self.invalid_page_message)
        if number > self.max_page:
            raise NotFound(self.invalid_page_message)
        return number

    def get_next_link(self):
        if not getattr(self, "has_next", False):
            return None
        url = self.request.build_absolute_uri()
        return replace_query_param(url, self.page_query_param, self.page_number + 1)

    def get_previous_link(self):
        if not getattr(self, "has_previous", False):
            return None
        url = self.request.build_absolute_uri()
        if self.page_number <= 2:
            return remove_query_param(url, self.page_query_param)
        return replace_query_param(url, self.page_query_param, self.page_number - 1)

    def get_paginated_response(self, data):
        return Response(
            {
                "count": getattr(self, "count", None),
                "count_capped": getattr(self, "count_capped", False),
                "next": self.get_next_link(),
                "previous": self.get_previous_link(),
                "results": data,
            }
        )
