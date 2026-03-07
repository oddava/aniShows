import django_filters
from django.db.models import Q
from django_filters import FilterSet, CharFilter, OrderingFilter

from .models import Anime

class AnimeFilter(FilterSet):
    genre = CharFilter(method="filter_genre", label="Genre")

    q = CharFilter(method="search_filter", label="Search")

    sort = OrderingFilter(
        fields=(
            ("favorite_count", "popular"),
            ("avg_rating", "rating"),
            ("release_date", "newest"),
            ("title", "title"),
        ),
        field_labels={
            "-favorite_count": "Most Popular",
            "-avg_rating": "Highest Rated",
            "-release_date": "Newest",
            "title": "Title (A-Z)",
        },
    )

    class Meta:
        model = Anime
        fields = ["genre", "q", "sort"]

    def filter_genre(self, queryset, name, value):
        # Handle 'all' case
        if not value or value == "all":
            return queryset
        return queryset.filter(genres__slug=value)

    def search_filter(self, queryset, name, value):
        if value:
            return queryset.filter(Q(title__icontains=value) | Q(title_jp__icontains=value))
        return queryset
