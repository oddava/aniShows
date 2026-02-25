from rest_framework import viewsets, permissions
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from apps.users import throttling
from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.core.cache import cache
from django.db.models import Count, Avg, Sum, F, Q, Exists, OuterRef
from datetime import timedelta
import logging
import time

from apps.animes.serializers import (
    UserSerializer,
    PublicUserSerializer,
    UserProfileUpdateSerializer,
    UserLightweightSerializer,
)
from apps.users.models import UserProfile, UserStats, UserBadge
from apps.users.services.cache import invalidate_user_caches

logger = logging.getLogger(__name__)
User = get_user_model()


class UserProfileView(APIView):
    """
    Get/update current user profile.

    GET /users/me/ - Returns user profile (cached, fast)
    Supports 'full' query param for complete stats.
    """

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        start_time = time.time()
        user_id = request.user.id
        is_full = request.query_params.get("full", "false").lower() == "true"

        # Try cache first
        cache_key = f"user_profile:{user_id}:{'full' if is_full else 'light'}"
        cached_data = cache.get(cache_key)

        if cached_data:
            duration = (time.time() - start_time) * 1000
            logger.debug(f"Profile cache hit for user {user_id}: {duration:.2f}ms")
            return Response(cached_data)

        # Get user with basic profile
        try:
            user = User.objects.select_related("userprofile").get(pk=user_id)
        except User.DoesNotExist:
            return Response({"error": "User not found"}, status=404)

        # Get stats from UserStats table (pre-calculated, fast)
        # Fallback to on-the-fly calculation if not available
        stats_data = None
        try:
            stats = UserStats.objects.get(user=user)
            stats_data = {
                "followers_count": stats.followers_count,
                "following_count": stats.following_count,
                "anime_count": stats.anime_count,
                "episodes_watched": stats.episodes_watched,
                "total_minutes": getattr(stats, "total_minutes", 0),
                "days_watched": round(stats.days_watched, 1),
                "mean_score": round(stats.mean_score, 1) if stats.mean_score else None,
                "favorites_count": stats.favorites_count,
                "reviews_count": stats.reviews_count,
            }
        except UserStats.DoesNotExist:
            # Calculate stats on-the-fly (fallback)
            from apps.users.services.stats_service import calculate_user_stats

            stats_data = calculate_user_stats(user)
            # Add follower counts (not included in calculate_user_stats)
            stats_data["followers_count"] = 0
            stats_data["following_count"] = 0

            # Trigger async stats creation for next time
            from apps.users.tasks import update_user_stats

            update_user_stats.delay(user_id)

        # Build response data
        profile = getattr(user, "userprofile", None)
        data = {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "date_joined": user.date_joined,
            "avatar": profile.avatar.url if profile and profile.avatar else None,
            "banner": profile.banner.url if profile and profile.banner else None,
            "bio": profile.bio if profile else None,
            "is_private": profile.is_private if profile else False,
            "email_verified": profile.email_verified if profile else False,
            "social_links": profile.social_links if profile else [],
            "points": profile.points if profile else 0,
            "has_password": user.has_usable_password(),
            "is_staff": user.is_staff,
            "is_superuser": user.is_superuser,
        }

        # Add stats
        if stats_data:
            data.update(stats_data)

        # Add featured badges
        featured_badges = (
            UserBadge.objects.filter(user=user, badge__is_active=True, is_featured=True)
            .select_related("badge")
            .order_by("-granted_at")[:3]
        )
        data["badges"] = [
            {
                "id": ub.badge.id,
                "name": ub.badge.name,
                "slug": ub.badge.slug,
                "icon": ub.badge.icon,
                "image": ub.badge.image.url if ub.badge.image else None,
                "color": ub.badge.color,
                "description": ub.badge.description,
            }
            for ub in featured_badges
        ]
        data["total_badges_count"] = UserBadge.objects.filter(
            user=user, badge__is_active=True
        ).count()

        # Cache for 5 minutes (300 seconds)
        # Short TTL ensures fresh data while reducing DB load
        cache.set(cache_key, data, timeout=300)

        duration = (time.time() - start_time) * 1000
        logger.info(f"Profile fetched for user {user_id}: {duration:.2f}ms")

        return Response(data)

    def patch(self, request):
        serializer = UserProfileUpdateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        user = request.user

        # Handle username change
        new_username = serializer.validated_data.get("username")
        if new_username and new_username != user.username:
            profile, _ = UserProfile.objects.get_or_create(user=user)

            # Check cooldown
            if profile.last_username_change:
                elapsed = timezone.now() - profile.last_username_change
                if elapsed < timedelta(days=14):
                    days_left = 14 - elapsed.days
                    return Response(
                        {"username": f"You can change your username again in {days_left} days."},
                        status=400,
                    )

            # Check availability
            if User.objects.filter(username=new_username).exists():
                return Response({"username": "This username is already taken."}, status=400)

            user.username = new_username
            user.save()
            profile.last_username_change = timezone.now()
            profile.save()

        # Update profile fields
        profile, _ = UserProfile.objects.get_or_create(user=user)

        if "avatar" in serializer.validated_data:
            profile.avatar = serializer.validated_data["avatar"]
        if "banner" in serializer.validated_data:
            profile.banner = serializer.validated_data["banner"]
        if serializer.validated_data.get("remove_banner"):
            profile.banner = None
        if "bio" in serializer.validated_data:
            profile.bio = serializer.validated_data["bio"]
        if "is_private" in serializer.validated_data:
            profile.is_private = serializer.validated_data["is_private"]
        if "social_links" in serializer.validated_data:
            old_links = profile.social_links if profile.social_links else []
            new_links = serializer.validated_data["social_links"]

            # Quick check if links actually changed (simple hash comparison)
            def hash_links(links):
                """Create a simple hash of links for comparison"""
                if not links:
                    return ""
                link_strs = []
                for link in sorted(links, key=lambda x: x.get("url", "") + x.get("value", "")):
                    url = link.get("url") or link.get("value", "")
                    platform = link.get("platform", "")
                    link_strs.append(f"{platform}:{url}")
                return "|".join(link_strs)

            # Only process if links actually changed
            if hash_links(old_links) != hash_links(new_links):
                # Get IP address
                ip_address = self._get_client_ip(request)

                # Log the changes
                from apps.core.services.social_links_service import SocialLinksService

                service = SocialLinksService()
                service.log_changes(user, old_links, new_links, ip_address)

                # Validate and process links (metadata fetched async)
                processed_links = service.validate_and_process(new_links, user, skip_metadata=True)
                profile.social_links = processed_links

        profile.save()

        # Invalidate caches
        self._invalidate_user_caches(user.id, user.username)

        # Return fresh data
        return self.get(request)

    def _invalidate_user_caches(self, user_id, username):
        """Invalidate all user-related caches."""
        invalidate_user_caches(user_id, username)

    def _get_client_ip(self, request):
        """Get the client's IP address from the request."""
        x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
        if x_forwarded_for:
            ip = x_forwarded_for.split(",")[0].strip()
        else:
            ip = request.META.get("REMOTE_ADDR")
        return ip or "0.0.0.0"


class UserStatsView(APIView):
    """Get detailed user statistics (separate endpoint for heavy calculations)."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user_id = request.user.id
        cache_key = f"user_stats:{user_id}"

        # Try cache first
        cached_data = cache.get(cache_key)
        if cached_data:
            return Response(cached_data)

        # Try UserStats table first (fast)
        try:
            stats = UserStats.objects.get(user=request.user)
            data = {
                "favorites_count": stats.favorites_count,
                "reviews_count": stats.reviews_count,
                "anime_count": stats.anime_count,
                "episodes_watched": stats.episodes_watched,
                "total_minutes": getattr(stats, "total_minutes", 0),
                "days_watched": round(stats.days_watched, 1),
                "mean_score": round(stats.mean_score, 1) if stats.mean_score else 0,
                "last_updated": stats.last_updated,
            }
            cache.set(cache_key, data, timeout=300)
            return Response(data)
        except UserStats.DoesNotExist:
            pass

        # Fallback: calculate on the fly (slow)
        from apps.users.models import UserAnimeList

        favorites_count = request.user.favorites.count()
        reviews_count = request.user.reviews.count()
        anime_count = UserAnimeList.objects.filter(user=request.user).count()

        episodes_watched = (
            UserAnimeList.objects.filter(user=request.user).aggregate(
                total=Sum("episodes_watched")
            )["total"]
            or 0
        )

        total_minutes = (
            UserAnimeList.objects.filter(user=request.user)
            .annotate(entry_minutes=F("episodes_watched") * F("anime__duration_minutes"))
            .aggregate(total=Sum("entry_minutes"))["total"]
            or 0
        )

        mean_score = UserAnimeList.objects.filter(user=request.user, score__gt=0).aggregate(
            avg=Avg("score")
        )["avg"]

        days_watched = total_minutes / 1440.0

        data = {
            "favorites_count": favorites_count,
            "reviews_count": reviews_count,
            "anime_count": anime_count,
            "episodes_watched": episodes_watched,
            "total_minutes": total_minutes,
            "days_watched": round(days_watched, 1),
            "mean_score": round(mean_score, 1) if mean_score else 0,
            "last_updated": timezone.now(),
        }

        cache.set(cache_key, data, timeout=300)
        return Response(data)


def get_annotated_user_queryset(user=None, lightweight=False):
    """Helper to get user queryset with all performance annotations.

    Args:
        user: The requesting user (for is_following annotation)
        lightweight: If True, only include essential fields for faster loading
    """
    from django.db.models import FloatField, Subquery, OuterRef
    from django.db.models.functions import Coalesce, Round
    from apps.users.models import UserAnimeList

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

        queryset = queryset.annotate(_episodes_watched=Coalesce(Subquery(episodes_subquery), 0))

        # Calculate total minutes watched using subquery to avoid join duplicates
        total_minutes_subquery = (
            UserAnimeList.objects.filter(user=OuterRef("pk"))
            .annotate(entry_minutes=F("episodes_watched") * F("anime__duration_minutes"))
            .values("user")
            .annotate(total=Sum("entry_minutes"))
            .values("total")
        )

        queryset = queryset.annotate(_total_minutes=Coalesce(Subquery(total_minutes_subquery), 0))

        # Calculate mean score (exclude 0 scores) - round to 1 decimal place
        queryset = queryset.annotate(
            _mean_score_raw=Avg("anime_lists__score", filter=Q(anime_lists__score__gt=0))
        )

        # Calculate days watched from total minutes
        queryset = queryset.annotate(_days_watched=Coalesce(F("_total_minutes"), 0) / 1440.0)

    # Annotate is_following if user is provided
    if user and user.is_authenticated:
        from apps.users.models import UserFollow

        queryset = queryset.annotate(
            _is_following=Exists(UserFollow.objects.filter(follower=user, following=OuterRef("pk")))
        )

    return queryset


class PublicUserProfileViewSet(viewsets.ReadOnlyModelViewSet):
    """Public profile view by username"""

    serializer_class = PublicUserSerializer
    permission_classes = [permissions.AllowAny]
    throttle_classes = [throttling.PublicUserProfileRateThrottle]
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

        # Check if viewing own profile
        is_own_profile = is_authenticated and request.user.username.lower() == username.lower()

        # Try cache first (fastest path - <10ms)
        # Include viewer ID in cache key to prevent data leakage between users
        viewer_id = request.user.id if is_authenticated else "anonymous"
        cache_key = f"public_profile:{username}:v0:viewer:{viewer_id}"
        cached_data = cache.get(cache_key)

        if cached_data:
            # Check if cached profile is private and viewer is not owner
            if cached_data.get("is_private") and not is_own_profile:
                return Response({"error": "Profile not found"}, status=404)

            logger.debug(
                f"Profile cache hit for {username}: {(time.time() - start_time) * 1000:.2f}ms"
            )
            return Response(cached_data)

        # Try pre-calculated stats table (fast path - <50ms)
        try:
            from apps.users.models import UserStats

            user = User.objects.select_related("userprofile", "stats").get(username=username)

            # Check if profile is private and viewer is not the owner
            is_private = user.userprofile.is_private if user.userprofile else False
            if is_private and not is_own_profile:
                return Response({"error": "Profile not found"}, status=404)

            if hasattr(user, "stats"):
                stats = user.stats

                # Validate stats aren't stale/zero-filled.
                # If anime_count is 0 but user actually has anime entries,
                # the UserStats row was created with defaults and never
                # properly populated (e.g. Celery task failed mid-way).
                # Fall through to the annotation-based serializer path which
                # computes correct live data, and trigger async stats rebuild.
                if stats.anime_count == 0:
                    from apps.users.models import UserAnimeList

                    has_anime = UserAnimeList.objects.filter(user=user).exists()
                    if has_anime:
                        logger.warning(
                            f"UserStats for {username} has anime_count=0 but user has anime entries — "
                            "falling through to live query"
                        )
                        from apps.users.tasks import update_user_stats

                        update_user_stats.delay(user.id)
                        # Raise to break out of the try block into the fallback path
                        raise ValueError("Stale UserStats detected")

                # Use pre-calculated stats
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
                    "is_private": user.userprofile.is_private if user.userprofile else False,
                    "social_links": user.userprofile.social_links if user.userprofile else [],
                    "points": user.userprofile.points if user.userprofile else 0,
                    # Stats from materialized view
                    "followers_count": stats.followers_count,
                    "following_count": stats.following_count,
                    "anime_count": stats.anime_count,
                    "episodes_watched": stats.episodes_watched,
                    "days_watched": stats.days_watched,
                    "mean_score": round(stats.mean_score, 1) if stats.mean_score else None,
                    "favorites_count": stats.favorites_count,
                    "reviews_count": stats.reviews_count,
                    "is_online": self._check_user_online(user),
                }

                # Add viewer-specific data
                if is_authenticated:
                    from apps.users.models import UserFollow

                    data["is_following"] = UserFollow.objects.filter(
                        follower=request.user, following=user
                    ).exists()
                else:
                    data["is_following"] = False

                # Add featured badges
                featured_badges = (
                    UserBadge.objects.filter(user=user, badge__is_active=True, is_featured=True)
                    .select_related("badge")
                    .order_by("-granted_at")[:3]
                )
                data["badges"] = [
                    {
                        "id": ub.badge.id,
                        "name": ub.badge.name,
                        "slug": ub.badge.slug,
                        "icon": ub.badge.icon,
                        "image": ub.badge.image.url if ub.badge.image else None,
                        "color": ub.badge.color,
                        "description": ub.badge.description,
                    }
                    for ub in featured_badges
                ]
                data["total_badges_count"] = UserBadge.objects.filter(
                    user=user, badge__is_active=True
                ).count()

                # Cache for 5 minutes — shorter TTL ensures fresh data after actions
                cache.set(cache_key, data, timeout=300)

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

        # Check if profile is private and viewer is not the owner
        is_private = user.userprofile.is_private if user.userprofile else False
        if is_private and not is_own_profile:
            return Response({"error": "Profile not found"}, status=404)

        serializer = self.get_serializer(user)
        data = serializer.data

        # Cache the result for 5 minutes
        cache.set(cache_key, data, timeout=300)

        # Trigger async stats update for this user
        from apps.users.tasks import update_user_stats

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
