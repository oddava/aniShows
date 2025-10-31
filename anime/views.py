from django.core.cache import cache
from django.db.models import Prefetch, Q
from django.db.models.aggregates import Count, Avg
from django.views.generic import TemplateView, ListView

from anime.models import Anime, Genre, UserFavorite, UserHistory


class HomePageView(TemplateView):
    template_name = 'anime/home_page.html'


class AnimeListView(ListView):
    model = Anime
    template_name = 'anime/anime_list_page.html'
    context_object_name = 'anime_list'
    paginate_by = 20

    def get_queryset(self):
        queryset = Anime.objects.select_related(
            'studio'
        ).prefetch_related(
            'genres',
            Prefetch('favorites', queryset=UserFavorite.objects.filter(
                user=self.request.user) if self.request.user.is_authenticated else UserFavorite.objects.none())
        ).annotate(
            favorite_count=Count('favorites'),
            avg_rating=Avg('reviews__rating')
        )

        # Apply filters
        genre_filter = self.request.GET.get('genre')
        if genre_filter and genre_filter != 'all':
            queryset = queryset.filter(genres__slug=genre_filter)

        # Apply search
        search_query = self.request.GET.get('q')
        if search_query:
            queryset = queryset.filter(
                Q(title__icontains=search_query) |
                Q(title_english__icontains=search_query) |
                Q(synopsis__icontains=search_query)
            )

        # Apply sorting
        sort_by = self.request.GET.get('sort', 'popular')
        sort_mapping = {
            'popular': '-favorite_count',
            'rating': '-avg_rating',
            'newest': '-release_date',
            'title': 'title'
        }
        queryset = queryset.order_by(sort_mapping.get(sort_by, '-favorite_count'))

        return queryset.distinct()

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)

        # Get or cache genres
        # genres = cache.get('all_genres')
        # if not genres:
        genres = Genre.objects.all().order_by('name')
        # cache.set('all_genres', genres, 3600)  # Cache for 1 hour
        context['genres'] = genres

        # Recently viewed anime (from session or user history)
        if self.request.user.is_authenticated:
            context['recently_viewed'] = UserHistory.objects.filter(
                user=self.request.user
            ).select_related('anime').order_by('-viewed_at')[:5]

        # Current filters
        context['current_genre'] = self.request.GET.get('genre', 'all')
        context['current_sort'] = self.request.GET.get('sort', 'popular')
        context['search_query'] = self.request.GET.get('q', '')

        # Total count for results display
        context['total_count'] = self.get_queryset().count()

        return context
