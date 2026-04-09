from rest_framework.exceptions import NotFound
from rest_framework.pagination import PageNumberPagination, _positive_int
from rest_framework.response import Response
from rest_framework.utils.urls import remove_query_param, replace_query_param


class StandardPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 200


class NoCountPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 200
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
        return self.page

    def get_page_number(self, request):
        page_number = request.query_params.get(self.page_query_param, 1)
        try:
            return _positive_int(page_number, strict=True, cutoff=None)
        except (TypeError, ValueError):
            raise NotFound(self.invalid_page_message)

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
                "count": None,
                "next": self.get_next_link(),
                "previous": self.get_previous_link(),
                "results": data,
            }
        )
