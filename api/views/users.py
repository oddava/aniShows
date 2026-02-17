from rest_framework import viewsets, permissions
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.core.cache import cache
from django.db.models import Count, Avg, Sum, F, Q, Exists, OuterRef
from datetime import timedelta
import logging

from api.serializers import (
    UserSerializer,
    PublicUserSerializer,
    UserProfileUpdateSerializer,
)
from users.models import UserProfile

logger = logging.getLogger(__name__)
User = get_user_model()


def get_annotated_user_queryset(user=None, lightweight=False):
    """Helper to get user queryset with all performance annotations.

    Args:
        user: The requesting user (for is_following annotation)
        lightweight: If True, only include essential fields for faster loading
    """
    from django.db.models import FloatField, Subquery, OuterRef
    from django.db.models.functions import Coalesce, Round
    from users.models import UserAnimeList

    # Base queryset with select_related for userprofile
    queryset = User.objects.select_related("userprofile")

    # Essential annotations always included (fast counts)
    queryset = queryset.annotate(
        _followers_count=Count("followers", distinct=True),
        _following_count=Count("following", distinct=True),
        _anime_count=Count("anime_lists", distinct=True),
    )

    if not lightweight:
        # Full annotations for complete profile (slower, only when needed)
        queryset = queryset.annotate(
            _favorites_count=Count("favorites", distinct=True),
            _reviews_count=Count("reviews", distinct=True),
        )

        # Calculate episodes watched using subquery to avoid join duplicates
        episodes_subquery = (
            UserAnimeList.objects.filter(user=OuterRef("pk"))
            .values("user")
            .annotate(total=Sum("episodes_watched"))
            .values("total")
        )

        queryset = queryset.annotate(
            _episodes_watched=Coalesce(Subquery(episodes_subquery), 0)
        )

        # Calculate total minutes watched using subquery to avoid join duplicates
        total_minutes_subquery = (
            UserAnimeList.objects.filter(user=OuterRef("pk"))
            .annotate(
                entry_minutes=F("episodes_watched") * F("anime__duration_minutes")
            )
            .values("user")
            .annotate(total=Sum("entry_minutes"))
            .values("total")
        )

        queryset = queryset.annotate(
            _total_minutes=Coalesce(Subquery(total_minutes_subquery), 0)
        )

        # Calculate mean score (exclude 0 scores) - round to 1 decimal place
        queryset = queryset.annotate(
            _mean_score_raw=Avg(
                "anime_lists__score", filter=Q(anime_lists__score__gt=0)
            )
        )

        # Calculate days watched from total minutes
        queryset = queryset.annotate(
            _days_watched=Coalesce(F("_total_minutes"), 0) / 1440.0
        )

    # Annotate is_following if user is provided
    if user and user.is_authenticated:
        from users.models import UserFollow

        queryset = queryset.annotate(
            _is_following=Exists(
                UserFollow.objects.filter(follower=user, following=OuterRef("pk"))
            )
        )

    return queryset


class UserProfileView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        # Get user with annotations
        user = get_annotated_user_queryset().get(pk=request.user.pk)
        serializer = UserSerializer(user, context={"request": request})
        return Response(serializer.data)

    def patch(self, request):
        serializer = UserProfileUpdateSerializer(data=request.data)
        if serializer.is_valid():
            # Username Change Logic
            new_username = serializer.validated_data.get("username")
            if new_username and new_username != request.user.username:
                profile, created = UserProfile.objects.get_or_create(user=request.user)

                # Check for cooldown
                if profile.last_username_change:
                    elapsed = timezone.now() - profile.last_username_change
                    if elapsed < timedelta(days=14):
                        days_left = 14 - elapsed.days
                        return Response(
                            {
                                "username": f"You can change your username again in {days_left} days."
                            },
                            status=400,
                        )

                # Check availability (User model handles unique constraint but good to be explicit for API)
                if User.objects.filter(username=new_username).exists():
                    return Response(
                        {"username": "This username is already taken."},
                        status=400,
                    )

                request.user.username = new_username
                request.user.save()

                # Update timestamp
                profile.last_username_change = timezone.now()
                profile.save()

            # Update profile fields - only from validated_data (mass assignment protection)
            profile, created = UserProfile.objects.get_or_create(user=request.user)
            if "avatar" in serializer.validated_data:
                profile.avatar = serializer.validated_data["avatar"]
            if "banner" in serializer.validated_data:
                profile.banner = serializer.validated_data["banner"]
            if "bio" in serializer.validated_data:
                profile.bio = serializer.validated_data["bio"]
            if "is_private" in serializer.validated_data:
                profile.is_private = serializer.validated_data["is_private"]

            # Social links
            if "social_links" in serializer.validated_data:
                profile.social_links = serializer.validated_data["social_links"]

            profile.save()

            # Invalidate public profile cache using versioning
            # This will invalidate ALL cached versions (authenticated and anonymous)
            username = request.user.username
            version_key = f"profile_cache_version:{username}"
            try:
                cache.incr(version_key)
            except ValueError:
                cache.set(version_key, 1, timeout=3600)

            # Get user with annotations after update
            user = get_annotated_user_queryset().get(pk=request.user.pk)
            return Response(UserSerializer(user, context={"request": request}).data)
        return Response(serializer.errors, status=400)


class UserStatsView(APIView):
    """Get user statistics for the current user."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from users.models import UserAnimeList

        user = request.user

        # Get counts
        favorites_count = user.favorites.count()
        reviews_count = user.reviews.count()
        anime_count = UserAnimeList.objects.filter(user=user).count()

        # Calculate episodes watched
        episodes_watched = (
            UserAnimeList.objects.filter(user=user).aggregate(
                total=Sum("episodes_watched")
            )["total"]
            or 0
        )

        # Calculate total minutes watched
        total_minutes = (
            UserAnimeList.objects.filter(user=user)
            .annotate(
                entry_minutes=F("episodes_watched") * F("anime__duration_minutes")
            )
            .aggregate(total=Sum("entry_minutes"))["total"]
            or 0
        )

        # Calculate mean score (excluding 0 scores)
        mean_score = UserAnimeList.objects.filter(user=user, score__gt=0).aggregate(
            avg=Avg("score")
        )["avg"]

        # Calculate days watched
        days_watched = total_minutes / 1440.0

        return Response(
            {
                "favorites_count": favorites_count,
                "reviews_count": reviews_count,
                "anime_count": anime_count,
                "episodes_watched": episodes_watched,
                "total_minutes": total_minutes,
                "days_watched": round(days_watched, 1),
                "mean_score": round(mean_score, 1) if mean_score else 0,
            }
        )


class PublicUserProfileViewSet(viewsets.ReadOnlyModelViewSet):
    """Public profile view by username"""

    serializer_class = PublicUserSerializer
    permission_classes = [permissions.AllowAny]
    throttle_classes = []
    lookup_field = "username"

    def get_queryset(self):
        return get_annotated_user_queryset(
            self.request.user if self.request.user.is_authenticated else None
        )

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context

    def retrieve(self, request, *args, **kwargs):
        """Optimized retrieve using pre-calculated stats table and caching."""
        import time

        start_time = time.time()

        username = self.kwargs.get(self.lookup_field)
        is_authenticated = request.user.is_authenticated

        # Try cache first (fastest path - <10ms)
        cache_key = f"public_profile:{username}:v0"
        cached_data = cache.get(cache_key)

        if cached_data:
            data = cached_data.copy()

            # Add viewer-specific data
            if is_authenticated:
                from users.models import UserFollow

                data["is_following"] = UserFollow.objects.filter(
                    follower=request.user, following__username=username
                ).exists()
            else:
                data["is_following"] = False

            logger.debug(
                f"Profile cache hit for {username}: {(time.time() - start_time) * 1000:.2f}ms"
            )
            return Response(data)

        # Try pre-calculated stats table (fast path - <50ms)
        try:
            from users.models import UserStats

            user = User.objects.select_related("userprofile", "stats").get(
                username=username
            )

            if hasattr(user, "stats"):
                # Use pre-calculated stats
                stats = user.stats
                data = {
                    "id": user.id,
                    "username": user.username,
                    "date_joined": user.date_joined,
                    "avatar": user.userprofile.avatar.url
                    if user.userprofile and user.userprofile.avatar
                    else None,
                    "banner": user.userprofile.banner.url
                    if user.userprofile and user.userprofile.banner
                    else None,
                    "bio": user.userprofile.bio if user.userprofile else None,
                    "is_private": user.userprofile.is_private
                    if user.userprofile
                    else False,
                    "social_links": user.userprofile.social_links
                    if user.userprofile
                    else [],
                    "points": user.userprofile.points if user.userprofile else 0,
                    # Stats from materialized view
                    "followers_count": stats.followers_count,
                    "following_count": stats.following_count,
                    "anime_count": stats.anime_count,
                    "episodes_watched": stats.episodes_watched,
                    "days_watched": stats.days_watched,
                    "mean_score": round(stats.mean_score, 1)
                    if stats.mean_score
                    else None,
                    "favorites_count": stats.favorites_count,
                    "reviews_count": stats.reviews_count,
                    "is_online": self._check_user_online(user),
                }

                # Add viewer-specific data
                if is_authenticated:
                    from users.models import UserFollow

                    data["is_following"] = UserFollow.objects.filter(
                        follower=request.user, following=user
                    ).exists()
                else:
                    data["is_following"] = False

                # Cache for 30 minutes (longer since we have stats table)
                cache.set(cache_key, data, timeout=1800)

                duration = (time.time() - start_time) * 1000
                logger.info(f"Profile stats hit for {username}: {duration:.2f}ms")
                return Response(data)

        except User.DoesNotExist:
            from rest_framework.exceptions import NotFound

            raise NotFound("User not found")
        except Exception as e:
            logger.warning(f"Stats table lookup failed for {username}: {e}")

        # Fallback: Use expensive query (slow path - 1-6s)
        logger.warning(f"Using fallback query for {username} - stats table miss")
        queryset = self.get_queryset().filter(username=username)

        if not queryset.exists():
            from rest_framework.exceptions import NotFound

            raise NotFound("User not found")

        user = queryset.first()
        serializer = self.get_serializer(user)
        data = serializer.data

        # Cache the result
        cache.set(cache_key, data, timeout=1800)

        # Trigger async stats update for this user
        from users.tasks import update_user_stats

        update_user_stats.delay(user.id)

        duration = (time.time() - start_time) * 1000
        logger.warning(f"Profile fallback query for {username}: {duration:.2f}ms")
        return Response(data)

    def _check_user_online(self, user):
        """Check if user is currently online."""
        from django.core.cache import cache
        from django.utils import timezone
        from datetime import timedelta

        cache_key = f"user_online:{user.id}"
        if cache.get(cache_key) is not None:
            return True

        if user.userprofile and user.userprofile.last_activity:
            time_since = timezone.now() - user.userprofile.last_activity
            if time_since < timedelta(minutes=5):
                return True

        return False

        return Response(data)
