"""
Admin API Views for aniShows Dashboard

Provides secure admin-only endpoints for:
- Dashboard statistics
- User management
- Anime management
- Review moderation
"""

from django.contrib.auth import get_user_model
from django.db.models import Count, Avg, Q
from django.db.models.functions import TruncDate
from django.utils import timezone
from datetime import timedelta

from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.pagination import PageNumberPagination

from anime.models import Anime, Genre, Studio, UserFavorite, UserHistory, Review
from users.models import UserProfile, UserAnimeList

User = get_user_model()


class AdminPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100


class IsAdminUser(permissions.BasePermission):
    """Custom permission to only allow admin/staff users."""
    
    def has_permission(self, request, view):
        return bool(
            request.user and 
            request.user.is_authenticated and 
            (request.user.is_staff or request.user.is_superuser)
        )


class AdminDashboardView(APIView):
    """Dashboard statistics and overview data."""
    permission_classes = [IsAdminUser]
    
    def get(self, request):
        now = timezone.now()
        last_7_days = now - timedelta(days=7)
        last_30_days = now - timedelta(days=30)
        
        # User statistics
        total_users = User.objects.count()
        new_users_7d = User.objects.filter(date_joined__gte=last_7_days).count()
        new_users_30d = User.objects.filter(date_joined__gte=last_30_days).count()
        verified_users = UserProfile.objects.filter(email_verified=True).count()
        
        # Content statistics
        total_anime = Anime.objects.count()
        airing_anime = Anime.objects.filter(status='Airing').count()
        total_reviews = Review.objects.count()
        new_reviews_7d = Review.objects.filter(created_at__gte=last_7_days).count()
        
        # Engagement statistics
        total_favorites = UserFavorite.objects.count()
        total_list_entries = UserAnimeList.objects.count()
        
        # User growth (last 30 days)
        user_growth = User.objects.filter(
            date_joined__gte=last_30_days
        ).annotate(
            date=TruncDate('date_joined')
        ).values('date').annotate(
            count=Count('id')
        ).order_by('date')
        
        # Popular anime (most favorites)
        popular_anime = Anime.objects.annotate(
            favorite_count=Count('favorites')
        ).order_by('-favorite_count')[:5].values(
            'id', 'title', 'slug', 'cover_image', 'favorite_count'
        )
        
        # Recent reviews
        recent_reviews = Review.objects.select_related(
            'user', 'anime'
        ).order_by('-created_at')[:5]
        
        recent_reviews_data = [{
            'id': r.id,
            'user': r.user.username,
            'anime': r.anime.title,
            'anime_slug': r.anime.slug,
            'rating': r.rating,
            'has_spoilers': r.has_spoilers,
            'created_at': r.created_at.isoformat()
        } for r in recent_reviews]
        
        # Recent users
        recent_users = User.objects.order_by('-date_joined')[:5].values(
            'id', 'username', 'email', 'date_joined', 'is_active', 'is_staff'
        )
        
        return Response({
            'statistics': {
                'users': {
                    'total': total_users,
                    'new_7d': new_users_7d,
                    'new_30d': new_users_30d,
                    'verified': verified_users,
                },
                'content': {
                    'total_anime': total_anime,
                    'airing_anime': airing_anime,
                    'total_reviews': total_reviews,
                    'new_reviews_7d': new_reviews_7d,
                },
                'engagement': {
                    'total_favorites': total_favorites,
                    'total_list_entries': total_list_entries,
                }
            },
            'charts': {
                'user_growth': list(user_growth),
            },
            'popular_anime': list(popular_anime),
            'recent_reviews': recent_reviews_data,
            'recent_users': list(recent_users),
        })


class AdminUserViewSet(viewsets.ViewSet):
    """User management for admins."""
    permission_classes = [IsAdminUser]
    pagination_class = AdminPagination
    
    def list(self, request):
        """List all users with filtering and search."""
        queryset = User.objects.select_related('userprofile').all()
        
        # Search
        search = request.query_params.get('search', '')
        if search:
            queryset = queryset.filter(
                Q(username__icontains=search) |
                Q(email__icontains=search)
            )
        
        # Filters
        is_staff = request.query_params.get('is_staff')
        if is_staff is not None:
            queryset = queryset.filter(is_staff=is_staff.lower() == 'true')
        
        is_active = request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        
        # Sorting
        ordering = request.query_params.get('ordering', '-date_joined')
        valid_orderings = ['date_joined', '-date_joined', 'username', '-username', 'email', '-email']
        if ordering in valid_orderings:
            queryset = queryset.order_by(ordering)
        
        # Pagination
        paginator = AdminPagination()
        page = paginator.paginate_queryset(queryset, request)
        
        users_data = []
        for user in page:
            profile = getattr(user, 'userprofile', None)
            users_data.append({
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'date_joined': user.date_joined.isoformat(),
                'last_login': user.last_login.isoformat() if user.last_login else None,
                'is_active': user.is_active,
                'is_staff': user.is_staff,
                'is_superuser': user.is_superuser,
                'email_verified': profile.email_verified if profile else False,
                'avatar': profile.avatar.url if profile and profile.avatar else None,
            })
        
        return paginator.get_paginated_response(users_data)
    
    def retrieve(self, request, pk=None):
        """Get detailed user information."""
        try:
            user = User.objects.select_related('userprofile').get(pk=pk)
        except User.DoesNotExist:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
        
        profile = getattr(user, 'userprofile', None)
        
        # Get user activity stats
        favorites_count = user.favorites.count()
        reviews_count = user.reviews.count()
        list_entries_count = user.anime_lists.count()
        
        return Response({
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'date_joined': user.date_joined.isoformat(),
            'last_login': user.last_login.isoformat() if user.last_login else None,
            'is_active': user.is_active,
            'is_staff': user.is_staff,
            'is_superuser': user.is_superuser,
            'email_verified': profile.email_verified if profile else False,
            'avatar': profile.avatar.url if profile and profile.avatar else None,
            'banner': profile.banner.url if profile and profile.banner else None,
            'bio': profile.bio if profile else None,
            'is_private': profile.is_private if profile else False,
            'activity': {
                'favorites_count': favorites_count,
                'reviews_count': reviews_count,
                'list_entries_count': list_entries_count,
            }
        })
    
    @action(detail=True, methods=['post'])
    def toggle_active(self, request, pk=None):
        """Toggle user active status (ban/unban)."""
        try:
            user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
        
        # Prevent self-deactivation
        if user.id == request.user.id:
            return Response(
                {'detail': 'Cannot deactivate your own account.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Prevent modifying superusers (unless you're also superuser)
        if user.is_superuser and not request.user.is_superuser:
            return Response(
                {'detail': 'Cannot modify superuser status.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        user.is_active = not user.is_active
        user.save()
        
        return Response({
            'id': user.id,
            'username': user.username,
            'is_active': user.is_active,
            'message': f"User {'activated' if user.is_active else 'deactivated'} successfully."
        })
    
    @action(detail=True, methods=['post'])
    def toggle_staff(self, request, pk=None):
        """Toggle user staff/admin status."""
        if not request.user.is_superuser:
            return Response(
                {'detail': 'Only superusers can modify staff status.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        try:
            user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
        
        # Prevent self-modification
        if user.id == request.user.id:
            return Response(
                {'detail': 'Cannot modify your own staff status.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        user.is_staff = not user.is_staff
        user.save()
        
        return Response({
            'id': user.id,
            'username': user.username,
            'is_staff': user.is_staff,
            'message': f"User {'promoted to' if user.is_staff else 'removed from'} staff."
        })
    
    def destroy(self, request, pk=None):
        """Delete a user account."""
        if not request.user.is_superuser:
            return Response(
                {'detail': 'Only superusers can delete users.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        try:
            user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
        
        # Prevent self-deletion
        if user.id == request.user.id:
            return Response(
                {'detail': 'Cannot delete your own account through admin.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Prevent deleting other superusers
        if user.is_superuser:
            return Response(
                {'detail': 'Cannot delete superuser accounts.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        username = user.username
        user.delete()
        
        return Response({
            'message': f"User '{username}' deleted successfully."
        })


class AdminAnimeViewSet(viewsets.ViewSet):
    """Anime management for admins."""
    permission_classes = [IsAdminUser]
    pagination_class = AdminPagination
    
    def list(self, request):
        """List all anime with filtering."""
        queryset = Anime.objects.prefetch_related('genres').select_related('studio')
        
        # Search
        search = request.query_params.get('search', '')
        if search:
            queryset = queryset.filter(
                Q(title__icontains=search) |
                Q(title_jp__icontains=search)
            )
        
        # Filters
        anime_status = request.query_params.get('status')
        if anime_status:
            queryset = queryset.filter(status=anime_status)
        
        anime_type = request.query_params.get('type')
        if anime_type:
            queryset = queryset.filter(anime_type=anime_type)
        
        # Sorting
        ordering = request.query_params.get('ordering', '-created_at')
        valid_orderings = [
            'title', '-title', 'created_at', '-created_at', 
            'rating', '-rating', 'release_date', '-release_date'
        ]
        if ordering in valid_orderings:
            queryset = queryset.order_by(ordering)
        
        # Annotate with stats
        queryset = queryset.annotate(
            favorites_count=Count('favorites'),
            reviews_count=Count('reviews')
        )
        
        # Pagination
        paginator = AdminPagination()
        page = paginator.paginate_queryset(queryset, request)
        
        anime_data = []
        for anime in page:
            anime_data.append({
                'id': anime.id,
                'title': anime.title,
                'title_jp': anime.title_jp,
                'slug': anime.slug,
                'status': anime.status,
                'anime_type': anime.anime_type,
                'rating': float(anime.rating) if anime.rating else None,
                'episode_count': anime.episode_count,
                'release_date': anime.release_date.isoformat() if anime.release_date else None,
                'cover_image': anime.cover_image.url if anime.cover_image else None,
                'studio': anime.studio.name if anime.studio else None,
                'genres': [g.name for g in anime.genres.all()],
                'favorites_count': anime.favorites_count,
                'reviews_count': anime.reviews_count,
                'created_at': anime.created_at.isoformat(),
            })
        
        return paginator.get_paginated_response(anime_data)
    
    def retrieve(self, request, pk=None):
        """Get detailed anime information."""
        try:
            anime = Anime.objects.prefetch_related('genres').select_related('studio').get(pk=pk)
        except Anime.DoesNotExist:
            return Response({'detail': 'Anime not found.'}, status=status.HTTP_404_NOT_FOUND)
        
        favorites_count = anime.favorites.count()
        reviews_count = anime.reviews.count()
        avg_rating = anime.reviews.aggregate(avg=Avg('rating'))['avg']
        
        return Response({
            'id': anime.id,
            'title': anime.title,
            'title_jp': anime.title_jp,
            'slug': anime.slug,
            'synopsis': anime.synopsis,
            'status': anime.status,
            'anime_type': anime.anime_type,
            'rating': float(anime.rating) if anime.rating else None,
            'episode_count': anime.episode_count,
            'duration_minutes': anime.duration_minutes,
            'release_date': anime.release_date.isoformat() if anime.release_date else None,
            'end_date': anime.end_date.isoformat() if anime.end_date else None,
            'cover_image': anime.cover_image.url if anime.cover_image else None,
            'banner_image': anime.banner_image.url if anime.banner_image else None,
            'trailer_url': anime.trailer_url,
            'studio': {'id': anime.studio.id, 'name': anime.studio.name} if anime.studio else None,
            'genres': [{'id': g.id, 'name': g.name} for g in anime.genres.all()],
            'meta_description': anime.meta_description,
            'favorites_count': favorites_count,
            'reviews_count': reviews_count,
            'avg_review_rating': float(avg_rating) if avg_rating else None,
            'created_at': anime.created_at.isoformat(),
            'updated_at': anime.updated_at.isoformat(),
        })
    
    def destroy(self, request, pk=None):
        """Delete an anime."""
        if not request.user.is_superuser:
            return Response(
                {'detail': 'Only superusers can delete anime.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        try:
            anime = Anime.objects.get(pk=pk)
        except Anime.DoesNotExist:
            return Response({'detail': 'Anime not found.'}, status=status.HTTP_404_NOT_FOUND)
        
        title = anime.title
        anime.delete()
        
        return Response({
            'message': f"Anime '{title}' deleted successfully."
        })


class AdminReviewViewSet(viewsets.ViewSet):
    """Review moderation for admins."""
    permission_classes = [IsAdminUser]
    pagination_class = AdminPagination
    
    def list(self, request):
        """List all reviews with filtering."""
        queryset = Review.objects.select_related('user', 'anime')
        
        # Filters
        has_spoilers = request.query_params.get('has_spoilers')
        if has_spoilers is not None:
            queryset = queryset.filter(has_spoilers=has_spoilers.lower() == 'true')
        
        min_rating = request.query_params.get('min_rating')
        if min_rating:
            queryset = queryset.filter(rating__gte=int(min_rating))
        
        max_rating = request.query_params.get('max_rating')
        if max_rating:
            queryset = queryset.filter(rating__lte=int(max_rating))
        
        # Search
        search = request.query_params.get('search', '')
        if search:
            queryset = queryset.filter(
                Q(text__icontains=search) |
                Q(user__username__icontains=search) |
                Q(anime__title__icontains=search)
            )
        
        # Sorting
        ordering = request.query_params.get('ordering', '-created_at')
        valid_orderings = ['created_at', '-created_at', 'rating', '-rating']
        if ordering in valid_orderings:
            queryset = queryset.order_by(ordering)
        
        # Pagination
        paginator = AdminPagination()
        page = paginator.paginate_queryset(queryset, request)
        
        reviews_data = []
        for review in page:
            reviews_data.append({
                'id': review.id,
                'user': {
                    'id': review.user.id,
                    'username': review.user.username,
                },
                'anime': {
                    'id': review.anime.id,
                    'title': review.anime.title,
                    'slug': review.anime.slug,
                },
                'rating': review.rating,
                'text': review.text[:200] + '...' if len(review.text) > 200 else review.text,
                'has_spoilers': review.has_spoilers,
                'created_at': review.created_at.isoformat(),
            })
        
        return paginator.get_paginated_response(reviews_data)
    
    def retrieve(self, request, pk=None):
        """Get full review details."""
        try:
            review = Review.objects.select_related('user', 'anime').get(pk=pk)
        except Review.DoesNotExist:
            return Response({'detail': 'Review not found.'}, status=status.HTTP_404_NOT_FOUND)
        
        return Response({
            'id': review.id,
            'user': {
                'id': review.user.id,
                'username': review.user.username,
            },
            'anime': {
                'id': review.anime.id,
                'title': review.anime.title,
                'slug': review.anime.slug,
            },
            'rating': review.rating,
            'text': review.text,
            'has_spoilers': review.has_spoilers,
            'created_at': review.created_at.isoformat(),
            'updated_at': review.updated_at.isoformat(),
        })
    
    def destroy(self, request, pk=None):
        """Delete a review."""
        try:
            review = Review.objects.get(pk=pk)
        except Review.DoesNotExist:
            return Response({'detail': 'Review not found.'}, status=status.HTTP_404_NOT_FOUND)
        
        review.delete()
        
        return Response({
            'message': 'Review deleted successfully.'
        })


class AdminStatsExportView(APIView):
    """Export statistics data for admins."""
    permission_classes = [IsAdminUser]
    
    def get(self, request):
        """Export summary statistics as JSON."""
        now = timezone.now()
        
        # Gather comprehensive stats
        stats = {
            'generated_at': now.isoformat(),
            'users': {
                'total': User.objects.count(),
                'active': User.objects.filter(is_active=True).count(),
                'staff': User.objects.filter(is_staff=True).count(),
                'superusers': User.objects.filter(is_superuser=True).count(),
            },
            'content': {
                'anime': {
                    'total': Anime.objects.count(),
                    'by_status': dict(Anime.objects.values_list('status').annotate(count=Count('id'))),
                    'by_type': dict(Anime.objects.values_list('anime_type').annotate(count=Count('id'))),
                },
                'genres': Genre.objects.count(),
                'studios': Studio.objects.count(),
            },
            'engagement': {
                'reviews': Review.objects.count(),
                'favorites': UserFavorite.objects.count(),
                'list_entries': UserAnimeList.objects.count(),
                'history_entries': UserHistory.objects.count(),
            }
        }
        
        return Response(stats)
