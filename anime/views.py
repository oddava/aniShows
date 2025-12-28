from decimal import Decimal

from django.core.paginator import EmptyPage, PageNotAnInteger, Paginator
from django.db.models import Prefetch
from django.db.models.aggregates import Count, Avg
from django.http import JsonResponse, HttpResponse
from django.shortcuts import get_object_or_404
from django.template.loader import render_to_string
from django.utils import timezone
from django.views.generic import TemplateView, DetailView
from django_filters.views import FilterView

from anime.filters import AnimeFilter
from anime.models import Anime, Genre, UserFavorite, UserHistory, Review


class HomePageView(TemplateView):
    template_name = 'anime/home_page.html'


class AnimeListView(FilterView):
    queryset = Anime.objects.select_related('studio')
    filterset_class = AnimeFilter
    template_name = 'anime/anime_list_page.html'
    context_object_name = 'anime_list'
    paginate_by = 20

    def get_queryset(self):
        qs = super().get_queryset()
        qs = qs.prefetch_related(
            'genres',
            Prefetch(
                'favorites',
                queryset=UserFavorite.objects.filter(user=self.request.user)
                if self.request.user.is_authenticated
                else UserFavorite.objects.none()
            )
        ).annotate(
            favorite_count=Count('favorites'),
            avg_rating=Avg('reviews__rating')
        )
        return qs

    def get_filterset_kwargs(self, filterset_class):
        kwargs = super().get_filterset_kwargs(filterset_class)
        # Set default ordering if not provided
        if 'sort' not in self.request.GET:
            kwargs['data'] = self.request.GET.copy()
            kwargs['data']['sort'] = '-favorite_count'
        return kwargs

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['genres'] = Genre.objects.all().order_by('name')

        if self.request.user.is_authenticated:
            context['recently_viewed'] = UserHistory.objects.filter(
                user=self.request.user
            ).select_related('anime').order_by('-viewed_at')[:5]

        context['current_genre'] = self.request.GET.get('genre', 'all')
        context['current_sort'] = self.request.GET.get('sort', 'popular')
        context['search_query'] = self.request.GET.get('q', '')

        # Get the filtered queryset
        filterset = context.get('filter')
        if filterset:
            context['total_count'] = filterset.qs.distinct().count()

        return context

    def get(self, request, *args, **kwargs):
        # Handle AJAX requests (search, filter, etc.)
        self.object_list = self.get_queryset()
        filterset_class = self.get_filterset_class()
        self.filterset = self.get_filterset(filterset_class)
        queryset = self.filterset.qs.distinct()

        # Paginate the results
        paginator = Paginator(queryset, self.paginate_by)
        page_number = request.GET.get('page', 1)

        if request.GET.get('ajax') == 'true':
            try:
                page_obj = paginator.page(page_number)
            except (PageNotAnInteger, EmptyPage):
                page_obj = paginator.page(1)

            # Build context for template rendering
            context = self.get_context_data(
                filter=self.filterset,
                object_list=page_obj.object_list,
                page_obj=page_obj,
                is_paginated=page_obj.has_other_pages(),
                paginator=paginator,
            )

            # Render the full template
            html = render_to_string(
                self.template_name,
                context,
                request=request
            )

            return HttpResponse(html)

        # Handle infinite scroll AJAX
        if request.GET.get('scroll') == 'true':

            paginator = Paginator(queryset, self.paginate_by)
            page_number = request.GET.get('page', 1)

            try:
                page_obj = paginator.page(page_number)
            except (PageNotAnInteger, EmptyPage):
                return JsonResponse({'results': [], 'has_next': False})

            results = [
                {
                    'id': anime.id,
                    'html': render_to_string(
                        'components/anime_card.html',
                        {'anime': anime, 'user': request.user}
                    )
                }
                for anime in page_obj.object_list
            ]

            return JsonResponse({
                'results': results,
                'has_next': page_obj.has_next(),
            })

        # Normal page load
        return super().get(request, *args, **kwargs)


class AnimeDetailView(DetailView):
    """
    Detail view for displaying comprehensive anime information including
    synopsis, reviews, statistics, and related anime.
    """
    queryset = Anime.objects.select_related(
        'studio'
    ).prefetch_related(
        'genres',
        Prefetch(
            'reviews',
            queryset=Review.objects.select_related('user').order_by('-created_at')
        ),
    )
    template_name = 'anime/anime_detail_page.html'
    context_object_name = 'anime'


    def get_object(self, queryset=None):
        """
        Retrieve the anime object and track user history
        """
        if queryset is None:
            queryset = self.get_queryset()

        anime = get_object_or_404(queryset, slug=self.kwargs.get(self.slug_url_kwarg))

        # Track viewing history for authenticated users
        if self.request.user.is_authenticated:
            UserHistory.objects.update_or_create(
                user=self.request.user,
                anime=anime,
                defaults={'viewed_at': timezone.now()}
            )
        else:
            # Track in session for anonymous users
            self.track_anonymous_history(anime)

        return anime

    def track_anonymous_history(self, anime):
        """Track recently viewed for anonymous users using session"""
        recently_viewed = self.request.session.get('recently_viewed', [])

        # Remove if already exists to avoid duplicates
        if anime.id in recently_viewed:
            recently_viewed.remove(anime.id)

        # Add to beginning
        recently_viewed.insert(0, anime.id)

        # Keep only last 10
        recently_viewed = recently_viewed[:10]

        self.request.session['recently_viewed'] = recently_viewed
        self.request.session.modified = True

    def get_context_data(self, **kwargs):
        """
        Add additional context data for the template
        """
        context = super().get_context_data(**kwargs)
        anime = self.object

        # Get related anime based on shared genres
        context['related_anime'] = self.get_related_anime(anime)

        # Get reviews with statistics
        reviews = anime.reviews.all()
        context['reviews'] = reviews[:5]  # Show first 5 reviews
        context['review_count'] = reviews.count()
        context['average_user_rating'] = reviews.aggregate(Avg('rating'))['rating__avg']

        # User-specific data
        if self.request.user.is_authenticated:
            context['is_favorited'] = UserFavorite.objects.filter(
                user=self.request.user,
                anime=anime
            ).exists()

            # Get user's review if exists
            try:
                context['user_review'] = Review.objects.get(
                    user=self.request.user,
                    anime=anime
                )
            except Review.DoesNotExist:
                context['user_review'] = None
        else:
            context['is_favorited'] = False
            context['user_review'] = None

        # Statistics
        context['favorites_count'] = anime.favorites.count()
        context['total_episodes'] = anime.episode_count or 'Unknown'

        # Format dates
        context['aired_from'] = anime.release_date
        context['aired_to'] = anime.end_date

        # Status display
        context['status_display'] = anime.get_status_display()
        context['type_display'] = anime.get_anime_type_display()

        return context

    def get_related_anime(self, anime, limit=8):
        related = Anime.objects.filter(
            genres__in=anime.genres.all()
        ).exclude(
            id=anime.id
        ).distinct().select_related('studio').prefetch_related('genres')

        if anime.rating:
            score_range = Decimal("1.5")
            related = related.filter(
                rating__gte=anime.rating - score_range,
                rating__lte=anime.rating + score_range
            )

        related = related.filter(anime_type=anime.anime_type)
        related = related.order_by('-rating', '-created_at')[:limit]

        if related.count() < limit:
            additional = Anime.objects.filter(
                genres__in=anime.genres.all()
            ).exclude(id=anime.id).exclude(
                id__in=[r.id for r in related]
            ).distinct().select_related('studio').prefetch_related('genres')

            if anime.rating:
                additional = additional.filter(
                    rating__gte=anime.rating - score_range,
                    rating__lte=anime.rating + score_range
                )

            additional = additional.order_by('-rating', '-created_at')[:limit - related.count()]
            related = list(related) + list(additional)

        return related

