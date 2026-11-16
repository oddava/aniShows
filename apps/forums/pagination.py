from rest_framework.pagination import PageNumberPagination


class ForumPostPagination(PageNumberPagination):
    """Pages of top-level posts; each page also carries their capped descendants."""

    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 50
