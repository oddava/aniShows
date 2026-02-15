from rest_framework import viewsets, status, generics, permissions, serializers
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.exceptions import PermissionDenied
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle
from django.db.models import Count, Avg, Q, Prefetch
from django.db import IntegrityError
from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.core.mail import send_mail
from django.conf import settings
from django.utils import timezone
from datetime import timedelta
from datetime import datetime
from django.core.cache import cache
import logging

logger = logging.getLogger(__name__)

from anime.models import Anime, Genre, Studio, UserFavorite, Review, ReviewVote
from users.models import UserProfile, UserAnimeList
from . import throttling
from .serializers import (
    AnimeListSerializer,
    AnimeMinimalSerializer,
    AnimeDetailSerializer,
    GenreSerializer,
    StudioSerializer,
    UserSerializer,
    UserProfileUpdateSerializer,
    RegisterSerializer,
    FavoriteSerializer,
    UserAnimeListSerializer,
    ReviewSerializer,
    ChangePasswordSerializer,
    PublicUserSerializer,
    UserRecommendationSerializer,
)

User = get_user_model()


class AnimeViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Anime listing and detail with filtering, search, and sorting.
    """

    lookup_field = "slug"

    def get_object(self):
        """Override to support lookup by both slug and anilist_id"""
        queryset = self.get_queryset()
        lookup_url_kwarg = self.lookup_url_kwarg or self.lookup_field
        lookup_value = self.kwargs.get(lookup_url_kwarg)

        if lookup_value:
            # Try slug first
            try:
                obj = queryset.get(slug=lookup_value)
                return obj
            except Anime.DoesNotExist:
                pass

            # Try anilist_id if lookup_value is numeric
            if lookup_value.isdigit():
                try:
                    obj = queryset.get(anilist_id=int(lookup_value))
                    return obj
                except Anime.DoesNotExist:
                    pass

        # Fall back to default behavior (will raise 404)
        return super().get_object()

    def get_queryset(self):
        queryset = Anime.objects.select_related("studio").prefetch_related("genres")

        # Prefetch user-specific data to avoid N+1 queries in serializers
        user = self.request.user
        if user.is_authenticated:
            from django.db.models import Exists, OuterRef

            # Annotate is_favorite as boolean (avoids query per anime)
            queryset = queryset.annotate(
                _is_favorite=Exists(
                    UserFavorite.objects.filter(user=user, anime=OuterRef("pk"))
                )
            )
            # Prefetch user's list entries for these anime
            queryset = queryset.prefetch_related(
                Prefetch(
                    "user_lists",
                    queryset=UserAnimeList.objects.filter(user=user),
                    to_attr="_user_list_entries",
                )
            )

        # Annotate with counts
        queryset = queryset.annotate(
            review_count=Count("reviews", distinct=True),
            avg_rating=Avg("reviews__rating"),
            favorite_count=Count("favorites", distinct=True),
        )

        if self.action != "list":
            return queryset.order_by(
                "-id"
            )  # Ensure stable ordering if needed, or default

        # Search
        search = self.request.query_params.get("q")
        if search:
            queryset = queryset.filter(
                Q(title__icontains=search)
                | Q(title_jp__icontains=search)
                | Q(synopsis__icontains=search)
            )

        # Filter by genre
        genres = []
        # Handle ?genre=action&genre=romance
        params = self.request.query_params.getlist("genre")
        for param in params:
            if param == "all":
                continue
            # Handle ?genre=action,romance
            if "," in param:
                genres.extend(param.split(","))
            else:
                genres.append(param)

        if genres:
            # Filter for anime that match ALL selected genres (AND logic)
            for genre in genres:
                queryset = queryset.filter(genres__slug=genre)

        # Filter by status
        anime_status = self.request.query_params.get("status")
        if anime_status:
            if "," in anime_status:
                queryset = queryset.filter(status__in=anime_status.split(","))
            else:
                queryset = queryset.filter(status=anime_status)

        # Filter by type
        anime_type = self.request.query_params.get("type")
        if anime_type:
            if "," in anime_type:
                queryset = queryset.filter(anime_type__in=anime_type.split(","))
            else:
                queryset = queryset.filter(anime_type=anime_type)

        # Filter by studio
        studio = self.request.query_params.get("studio")
        if studio:
            queryset = queryset.filter(studio__id=studio)

        # Filter by rating range
        min_rating = self.request.query_params.get("min_rating")
        max_rating = self.request.query_params.get("max_rating")
        if min_rating:
            queryset = queryset.filter(rating__gte=float(min_rating))
        if max_rating:
            queryset = queryset.filter(rating__lte=float(max_rating))

        # Filter by season and year
        season = self.request.query_params.get("season")
        year = self.request.query_params.get("year")
        if year:
            try:
                year_int = int(year)
                # Season date ranges
                season_ranges = {
                    "winter": [(year_int, 1, 1), (year_int, 3, 31)],
                    "spring": [(year_int, 4, 1), (year_int, 6, 30)],
                    "summer": [(year_int, 7, 1), (year_int, 9, 30)],
                    "fall": [(year_int, 10, 1), (year_int, 12, 31)],
                }
                if season and season.lower() in season_ranges:
                    start, end = season_ranges[season.lower()]
                    from datetime import date

                    queryset = queryset.filter(
                        release_date__gte=date(*start), release_date__lte=date(*end)
                    )
                else:
                    # Just filter by year
                    queryset = queryset.filter(release_date__year=year_int)
            except ValueError:
                pass

        # Sorting
        sort = self.request.query_params.get("sort", "popular")
        sort_mapping = {
            "popular": "popularity_rank",  # Use AniList popularity ranking (lower = more popular)
            "rating": "site_rank",
            "newest": "-release_date",
            "title": "title",
            "upcoming": "-member_count",  # Most anticipated (by member count)
            "trending": "trending_rank",
        }

        sort_field = sort_mapping.get(sort, "popularity_rank")

        # logical fixes for specific sorts:
        # Exclude upcoming (0 episodes) from rating and newest sorts to prevent them from hitting top
        if sort == "rating":
            queryset = queryset.filter(site_rank__isnull=False, member_count__gt=200000)
        elif sort == "newest":
            queryset = queryset.filter(episode_count__gt=0)
        elif sort == "upcoming":
            # Show only upcoming anime, sorted by nearest release date
            queryset = queryset.filter(status="Upcoming")
        elif sort == "popular":
            # For popular sort, filter out anime without popularity_rank so they don't clutter results
            # BUT: when filtering by season/year, include all anime so seasonal views work correctly
            if not season and not year:
                queryset = queryset.filter(popularity_rank__isnull=False)
            else:
                # For seasonal views, sort by member_count (descending) which is a better
                # indicator of popularity - more members = more popular
                # This ensures popular anime like Frieren appear first even if they
                # don't have a popularity_rank set yet
                from django.db.models import F
                from django.db.models.functions import Coalesce

                queryset = queryset.annotate(member_sort=Coalesce(F("member_count"), 0))
                sort_field = "-member_sort"  # Descending - higher member count first
        elif sort == "trending":
            queryset = queryset.filter(trending_rank__isnull=False)

        # Add ID as tie-breaker for stable pagination
        queryset = queryset.order_by(sort_field, "-id")

        return queryset.distinct()

    def get_serializer_class(self):
        if self.action == "retrieve":
            return AnimeDetailSerializer
        # Use minimal serializer for list to reduce payload size
        if self.action == "list":
            return AnimeMinimalSerializer
        return AnimeListSerializer

    @action(detail=False, methods=["get"])
    def trending(self, request):
        """Get trending anime (most favorited recently)"""
        # Cache for 15 minutes
        cache_key = "anime_trending"
        data = cache.get(cache_key)

        if not data:
            queryset = (
                self.get_queryset()
                .filter(trending_rank__isnull=False)
                .order_by("trending_rank")[:12]
            )
            serializer = AnimeListSerializer(
                queryset, many=True, context={"request": request}
            )
            data = serializer.data
            cache.set(cache_key, data, 60 * 15)

        return Response(data)

    @action(detail=False, methods=["get"])
    def top_rated(self, request):
        """Get top rated anime"""
        # Cache for 15 minutes
        cache_key = "anime_top_rated"
        data = cache.get(cache_key)

        if not data:
            queryset = Anime.objects.select_related("studio").prefetch_related("genres")
            queryset = queryset.filter(rating__isnull=False).order_by("-rating")[:12]
            serializer = AnimeListSerializer(
                queryset, many=True, context={"request": request}
            )
            data = serializer.data
            cache.set(cache_key, data, 60 * 15)

        return Response(data)

    @action(detail=True, methods=["get"])
    def reviews(self, request, slug=None):
        """Get reviews for a specific anime"""
        anime = self.get_object()
        reviews = Review.objects.filter(anime=anime).select_related("user")
        serializer = ReviewSerializer(reviews, many=True, context={"request": request})
        return Response(serializer.data)

    @action(detail=True, methods=["get"])
    def related(self, request, slug=None):
        """Get related anime based on genres - optimized with single query"""
        from django.db.models import Subquery

        anime = self.get_object()

        # Use subquery to get genre IDs directly in the filter
        # This reduces the query from 2 to 1
        related = (
            Anime.objects.filter(genres__id__in=Subquery(anime.genres.values("id")))
            .exclude(id=anime.id)
            .select_related("studio")
            .prefetch_related("genres")
            .annotate(shared_genres=Count("genres", distinct=True))
            .order_by("-shared_genres")[:8]
        )

        serializer = AnimeListSerializer(
            related, many=True, context={"request": request}
        )
        return Response(serializer.data)


class GenreViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = GenreSerializer
    pagination_class = None

    def get_queryset(self):
        # Cache genre list for 1 hour since it rarely changes
        cache_key = "genres_all"
        queryset = cache.get(cache_key)
        if queryset is None:
            queryset = Genre.objects.all().order_by("name")
            cache.set(cache_key, queryset, 60 * 60)  # 1 hour
        return queryset


class StudioViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = StudioSerializer
    pagination_class = None

    def get_queryset(self):
        # Cache studio list for 1 hour since it rarely changes
        cache_key = "studios_all"
        queryset = cache.get(cache_key)
        if queryset is None:
            queryset = Studio.objects.all().order_by("name")
            cache.set(cache_key, queryset, 60 * 60)  # 1 hour
        return queryset


from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.tokens import RefreshToken


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["username"] = serializers.CharField(required=False)
        self.fields["email"] = serializers.EmailField(required=False)

    def validate(self, attrs):
        # Allow login with email or username
        email = attrs.get("email")
        username = attrs.get("username")
        password = attrs.get("password")

        if username:
            username = username.strip()
            attrs["username"] = username

        # If username is provided but looks like an email, extract it
        if username and "@" in username:
            email = username
            username = None

        if email and not username:
            # Try to find user by email
            User = get_user_model()
            try:
                user = User.objects.get(email=email)
                attrs["username"] = user.username
            except User.DoesNotExist:
                # Let the super call handle the failure
                pass

        return super().validate(attrs)


class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
    throttle_classes = [throttling.LoginRateThrottle]


class RegisterView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [throttling.RegisterRateThrottle]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.save()

            # User is active but email not verified - they can login but with restrictions
            # email_verified is set to False by default in UserProfile

            # Send Verification Email
            token = default_token_generator.make_token(user)
            uid = urlsafe_base64_encode(force_bytes(user.pk))

            # Link to frontend verification page
            verify_link = f"{settings.FRONTEND_URL}/verify-email/{uid}/{token}/"

            subject = "Verify your email - aniShows"
            message = f"""Welcome to aniShows!

Please verify your email address by clicking the link below:

{verify_link}

If you didn't create an account, you can ignore this email.

Note: Unverified accounts are automatically deleted after 7 days.
"""

            try:
                send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, [user.email])
            except Exception as e:
                logger.exception("Failed to send verification email")

            return Response(
                {
                    "message": "Registration successful. Please check your email to verify your account."
                },
                status=status.HTTP_201_CREATED,
            )

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class VerifyEmailView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def post(self, request):
        uidb64 = request.data.get("uid")
        token = request.data.get("token")

        if not uidb64 or not token:
            return Response(
                {"error": "Missing UID or Token"}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            uid = force_str(urlsafe_base64_decode(uidb64))
            # Import the helper function
            from api.views.users import get_annotated_user_queryset

            user = get_annotated_user_queryset().get(pk=uid)
            profile = getattr(user, "userprofile", None)

            is_valid = default_token_generator.check_token(user, token)
            logger.debug(
                f"Verify email for user {user.username}, token valid: {is_valid}"
            )

        except (TypeError, ValueError, OverflowError, User.DoesNotExist) as e:
            logger.debug(f"UID decode error: {e}")
            return Response(
                {"error": "Invalid UID"}, status=status.HTTP_400_BAD_REQUEST
            )

        if profile and profile.email_verified:
            # Just return tokens if already verified so they get logged in
            refresh = RefreshToken.for_user(user)
            return Response(
                {
                    "message": "Email already verified",
                    "access": str(refresh.access_token),
                    "refresh": str(refresh),
                    "user": UserSerializer(user, context={"request": request}).data,
                },
                status=status.HTTP_200_OK,
            )

        if is_valid:
            if profile:
                profile.email_verified = True
                profile.save()

            # Generate tokens for auto-login
            refresh = RefreshToken.for_user(user)

            return Response(
                {
                    "message": "Email verified successfully!",
                    "access": str(refresh.access_token),
                    "refresh": str(refresh),
                    "user": UserSerializer(user, context={"request": request}).data,
                },
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {"error": "Invalid or expired token"},
                status=status.HTTP_400_BAD_REQUEST,
            )


class ResendVerificationView(APIView):
    """Resend verification email for users who didn't receive it or whose token expired."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def post(self, request):
        email = request.data.get("email")
        if not email:
            return Response(
                {"error": "Email is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.select_related("userprofile").get(email=email)
            profile = getattr(user, "userprofile", None)
            if profile and profile.email_verified:
                # Already verified, don't reveal this for security
                raise User.DoesNotExist
        except User.DoesNotExist:
            # Don't reveal user existence - return success anyway
            return Response(
                {
                    "message": "If an account with this email exists and is pending verification, a new link has been sent."
                },
                status=status.HTTP_200_OK,
            )

        # Generate new token and send email
        token = default_token_generator.make_token(user)
        uid = urlsafe_base64_encode(force_bytes(user.pk))

        verify_link = f"{settings.FRONTEND_URL}/verify-email/{uid}/{token}/"

        subject = "Verify your email - aniShows"
        message = f"""Welcome to aniShows!

Please verify your email address by clicking the link below:

{verify_link}

If you didn't create an account, you can ignore this email.

Note: Unverified accounts are automatically deleted after 7 days.
"""

        try:
            send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, [user.email])
        except Exception as e:
            logger.exception("Failed to send verification email")

        return Response(
            {
                "message": "If an account with this email exists and is pending verification, a new link has been sent."
            },
            status=status.HTTP_200_OK,
        )


class PasswordResetView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [throttling.PasswordResetRateThrottle]

    def post(self, request):
        email = request.data.get("email")
        if not email:
            return Response(
                {"error": "Email is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            # Don't reveal user existence
            return Response(
                {
                    "message": "If an account exists with this email, a reset link has been sent."
                },
                status=status.HTTP_200_OK,
            )

        token = default_token_generator.make_token(user)
        uid = urlsafe_base64_encode(force_bytes(user.pk))

        # Link to frontend reset page
        reset_link = f"{settings.FRONTEND_URL}/reset-password/{uid}/{token}/"

        subject = "Reset your password - aniShows"
        message = f"Click the link below to reset your password:\n\n{reset_link}"

        try:
            send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, [email])
        except Exception as e:
            logger.exception("Failed to send password reset email")

        return Response(
            {
                "message": "If an account exists with this email, a reset link has been sent."
            },
            status=status.HTTP_200_OK,
        )


class PasswordResetConfirmView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def post(self, request):
        uidb64 = request.data.get("uid")
        token = request.data.get("token")
        password = request.data.get("password")

        if not all([uidb64, token, password]):
            return Response(
                {"error": "Missing required fields"}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            uid = force_str(urlsafe_base64_decode(uidb64))
            user = User.objects.get(pk=uid)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            return Response(
                {"error": "Invalid link"}, status=status.HTTP_400_BAD_REQUEST
            )

        if default_token_generator.check_token(user, token):
            user.set_password(password)
            user.save()
            return Response(
                {"message": "Password has been reset successfully."},
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {"error": "Invalid or expired link"}, status=status.HTTP_400_BAD_REQUEST
            )


from django.utils import timezone
from datetime import timedelta
from django.core.mail import send_mail
from django.conf import settings
from django.urls import reverse
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.utils.encoding import force_bytes, force_str
from django.contrib.auth.tokens import default_token_generator


class UserProfileView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        # Cache user profile data to avoid expensive recalculation
        cache_key = f"user_profile:{request.user.id}"
        cached_data = cache.get(cache_key)

        if cached_data:
            return Response(cached_data)

        serializer = UserSerializer(request.user, context={"request": request})
        data = serializer.data

        # Cache for 5 minutes (300 seconds)
        cache.set(cache_key, data, 300)

        return Response(data)

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
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                # Check availability (User model handles unique constraint but good to be explicit for API)
                if User.objects.filter(username=new_username).exists():
                    return Response(
                        {"username": "This username is already taken."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                request.user.username = new_username
                request.user.save()

                # Update timestamp
                profile.last_username_change = timezone.now()
                profile.save()

            # Update profile fields
            profile, created = UserProfile.objects.get_or_create(user=request.user)
            if "avatar" in serializer.validated_data:
                profile.avatar = serializer.validated_data["avatar"]
            if "banner" in serializer.validated_data:
                profile.banner = serializer.validated_data["banner"]
            if "bio" in serializer.validated_data:
                profile.bio = serializer.validated_data["bio"]
            if "is_private" in request.data:
                profile.is_private = request.data.get("is_private", False)

            # Social links
            if "social_links" in serializer.validated_data:
                profile.social_links = serializer.validated_data["social_links"]

            profile.save()

            # Invalidate profile cache after update
            cache.delete(f"user_profile:{request.user.id}")

            return Response(
                UserSerializer(request.user, context={"request": request}).data
            )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ChangePasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(
            data=request.data, context={"request": request}
        )
        if serializer.is_valid():
            request.user.set_password(serializer.validated_data["new_password"])
            request.user.save()
            return Response(
                {"message": "Password changed successfully"}, status=status.HTTP_200_OK
            )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class PublicUserProfileViewSet(viewsets.ReadOnlyModelViewSet):
    """Public profile view by username"""

    serializer_class = PublicUserSerializer
    permission_classes = [permissions.AllowAny]
    throttle_classes = [throttling.PublicUserProfileRateThrottle]
    lookup_field = "username"

    def get_queryset(self):
        from django.db.models import Count, Avg, Sum, F, Q, Exists, OuterRef, Subquery
        from django.db.models.functions import Coalesce
        from users.models import UserAnimeList

        user = self.request.user

        queryset = User.objects.select_related("userprofile").all()

        # Annotate with counts to avoid N+1 queries
        queryset = queryset.annotate(
            _favorites_count=Count("favorites", distinct=True),
            _reviews_count=Count("reviews", distinct=True),
            _followers_count=Count("followers", distinct=True),
            _following_count=Count("following", distinct=True),
            _anime_count=Count("anime_lists", distinct=True),
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

        # Calculate mean score (exclude 0 scores) - use _mean_score_raw for rounding in serializer
        queryset = queryset.annotate(
            _mean_score_raw=Avg(
                "anime_lists__score", filter=Q(anime_lists__score__gt=0)
            )
        )

        # Calculate days watched from total minutes
        queryset = queryset.annotate(
            _days_watched=Coalesce(F("_total_minutes"), 0) / 1440.0
        )

        # Annotate is_following if user is authenticated
        if user.is_authenticated:
            queryset = queryset.annotate(
                _is_following=Exists(
                    UserFollow.objects.filter(follower=user, following=OuterRef("pk"))
                )
            )

        return queryset.distinct()


class FavoriteViewSet(viewsets.ModelViewSet):
    serializer_class = FavoriteSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        username = self.request.query_params.get("username")
        queryset = UserFavorite.objects.all()

        if username:
            target_user = get_object_or_404(User, username=username)
            if target_user != self.request.user:
                profile = getattr(target_user, "userprofile", None)
                if profile and profile.is_private:
                    return UserFavorite.objects.none()
            queryset = queryset.filter(user=target_user)
        elif self.request.user.is_authenticated:
            queryset = queryset.filter(user=self.request.user)
        else:
            return UserFavorite.objects.none()

        return queryset.select_related("anime__studio").prefetch_related(
            "anime__genres"
        )

    def perform_create(self, serializer):
        # Check email verification
        profile = getattr(self.request.user, "userprofile", None)
        if not profile or not profile.email_verified:
            raise PermissionDenied("Please verify your email to add favorites.")
        serializer.save(user=self.request.user)

    def perform_destroy(self, instance):
        """Ensure users can only delete their own favorites."""
        if instance.user != self.request.user:
            raise PermissionDenied("You can only remove your own favorites.")
        instance.delete()

    @action(detail=False, methods=["post"])
    def toggle(self, request):
        """Toggle favorite status for an anime"""
        anime_id = request.data.get("anime_id")
        if not anime_id:
            return Response(
                {"error": "anime_id required"}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            anime = Anime.objects.get(id=anime_id)
        except Anime.DoesNotExist:
            return Response(
                {"error": "Anime not found"}, status=status.HTTP_404_NOT_FOUND
            )

        # Check email verification
        profile = getattr(request.user, "userprofile", None)
        if not profile or not profile.email_verified:
            return Response(
                {"error": "Please verify your email to add favorites."},
                status=status.HTTP_403_FORBIDDEN,
            )

        favorite, created = UserFavorite.objects.get_or_create(
            user=request.user, anime=anime
        )

        if not created:
            favorite.delete()
            return Response({"is_favorite": False, "message": "Removed from favorites"})

        return Response({"is_favorite": True, "message": "Added to favorites"})

    @action(detail=False, methods=["post"])
    def reorder(self, request):
        """Reorder user's favorites"""
        items = request.data.get("items", [])
        if not items:
            return Response(
                {"error": "items required"}, status=status.HTTP_400_BAD_REQUEST
            )

        # Update the order for each favorite
        for item in items:
            try:
                favorite = UserFavorite.objects.get(id=item["id"], user=request.user)
                favorite.order = item.get("order", 0)
                favorite.save(update_fields=["order"])
            except UserFavorite.DoesNotExist:
                continue

        return Response({"message": "Order saved successfully"})


class UserAnimeListViewSet(viewsets.ModelViewSet):
    serializer_class = UserAnimeListSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        username = self.request.query_params.get("username")
        queryset = UserAnimeList.objects.all()

        if username:
            target_user = get_object_or_404(User, username=username)
            if target_user != self.request.user:
                profile = getattr(target_user, "userprofile", None)
                if profile and profile.is_private:
                    return UserAnimeList.objects.none()
            queryset = queryset.filter(user=target_user)
        elif self.request.user.is_authenticated:
            queryset = queryset.filter(user=self.request.user)
        else:
            return UserAnimeList.objects.none()

        queryset = queryset.select_related("anime__studio").prefetch_related(
            "anime__genres"
        )

        # Filter by status
        list_status = self.request.query_params.get("status")
        if list_status:
            queryset = queryset.filter(status=list_status)

        return queryset.order_by("-updated_at")

    def perform_create(self, serializer):
        # Check email verification
        profile = getattr(self.request.user, "userprofile", None)
        if not profile or not profile.email_verified:
            raise PermissionDenied(
                "Please verify your email to add anime to your list."
            )
        try:
            serializer.save(user=self.request.user)
        except IntegrityError:
            raise serializers.ValidationError(
                {"detail": "This anime is already in your list."}
            )

    def perform_update(self, serializer):
        """Ensure users can only update their own list entries."""
        if serializer.instance.user != self.request.user:
            raise PermissionDenied("You can only modify your own anime list.")
        serializer.save()

    def perform_destroy(self, instance):
        """Ensure users can only delete their own list entries."""
        if instance.user != self.request.user:
            raise PermissionDenied(
                "You can only remove items from your own anime list."
            )
        instance.delete()


class ReviewViewSet(viewsets.ModelViewSet):
    serializer_class = ReviewSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        from django.db.models import Exists, OuterRef
        from users.models import UserAnimeList

        queryset = Review.objects.select_related("user", "user__userprofile", "anime")

        # Always annotate helpful_count to avoid N+1 queries
        queryset = queryset.annotate(
            _helpful_count=Count("votes", filter=Q(votes__is_helpful=True))
        )

        # Annotate is_completed to avoid N+1 queries
        # Check if the reviewer has completed the anime
        queryset = queryset.annotate(
            _is_completed=Exists(
                UserAnimeList.objects.filter(
                    user=OuterRef("user"),
                    anime=OuterRef("anime"),
                    status=UserAnimeList.UserAnimeStatus.completed,
                )
            )
        )

        # Annotate user_vote for the current user to avoid N+1
        user = self.request.user
        if user.is_authenticated:
            queryset = queryset.annotate(
                _user_vote=Exists(
                    ReviewVote.objects.filter(
                        user=user, review=OuterRef("pk"), is_helpful=True
                    )
                )
            )

        # Filter by anime
        anime_slug = self.request.query_params.get("anime")
        if anime_slug:
            queryset = queryset.filter(anime__slug=anime_slug)

        # Filter by target user
        target_username = self.request.query_params.get("user")
        if target_username:
            queryset = queryset.filter(user__username=target_username)

        # Filter by user (mine)
        if (
            self.request.query_params.get("mine") == "true"
            and self.request.user.is_authenticated
        ):
            queryset = queryset.filter(user=self.request.user)

        # Filter by rating (1-5 stars = 2-10 internal rating)
        rating_filter = self.request.query_params.get("rating")
        if rating_filter:
            try:
                stars = int(rating_filter)
                # Convert 5-star to 10-point scale: 5 stars = 9-10, 4 stars = 7-8, etc.
                min_rating = (stars - 1) * 2 + 1
                max_rating = stars * 2
                queryset = queryset.filter(
                    rating__gte=min_rating, rating__lte=max_rating
                )
            except ValueError:
                pass

        # Sorting
        sort = self.request.query_params.get("sort", "helpful")
        if sort == "highest":
            queryset = queryset.order_by("-rating", "-created_at")
        elif sort == "lowest":
            queryset = queryset.order_by("rating", "-created_at")
        elif sort == "newest":
            queryset = queryset.order_by("-created_at")
        else:  # helpful (default)
            queryset = queryset.order_by("-_helpful_count", "-created_at")

        return queryset

    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Get review statistics for an anime"""
        anime_slug = request.query_params.get("anime")
        if not anime_slug:
            return Response(
                {"error": "anime parameter required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reviews = Review.objects.filter(anime__slug=anime_slug)
        total = reviews.count()

        if total == 0:
            return Response(
                {
                    "total_reviews": 0,
                    "distribution": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0},
                    "averages": {
                        "overall": 0,
                        "story": None,
                        "animation": None,
                        "music": None,
                        "characters": None,
                    },
                }
            )

        # Rating distribution (convert 10-point to 5-star)
        distribution = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
        for review in reviews.values("rating"):
            rating = review["rating"] or 0
            stars = min(5, max(1, (rating + 1) // 2))
            distribution[stars] += 1

        # Average calculations
        averages = reviews.aggregate(
            overall=Avg("rating"),
            story=Avg("rating_story"),
            animation=Avg("rating_animation"),
            music=Avg("rating_music"),
            characters=Avg("rating_characters"),
        )

        # Convert to 5-point scale
        if averages["overall"]:
            averages["overall"] = averages["overall"] / 2
        if averages["story"]:
            averages["story"] = averages["story"] / 2
        if averages["animation"]:
            averages["animation"] = averages["animation"] / 2
        if averages["music"]:
            averages["music"] = averages["music"] / 2
        if averages["characters"]:
            averages["characters"] = averages["characters"] / 2

        return Response(
            {"total_reviews": total, "distribution": distribution, "averages": averages}
        )

    def perform_create(self, serializer):
        user = self.request.user

        # Check email verification
        profile = getattr(user, "userprofile", None)
        if not profile or not profile.email_verified:
            raise PermissionDenied("Please verify your email to write reviews.")

        anime = serializer.validated_data.get("anime")
        if not anime:
            raise serializers.ValidationError(
                {"non_field_errors": ["Anime not found."]}
            )

        # Check if user has anime on their list
        if not UserAnimeList.objects.filter(user=user, anime=anime).exists():
            raise serializers.ValidationError(
                {
                    "non_field_errors": [
                        "You must add this anime to your list before writing a review."
                    ]
                }
            )

        try:
            serializer.save(user=user)
        except IntegrityError:
            raise serializers.ValidationError(
                {"non_field_errors": ["You have already reviewed this anime."]}
            )

    def perform_update(self, serializer):
        """Ensure users can only update their own reviews."""
        if serializer.instance.user != self.request.user:
            raise PermissionDenied("You can only edit your own reviews.")
        serializer.save()

    def perform_destroy(self, instance):
        """Ensure users can only delete their own reviews."""
        if instance.user != self.request.user:
            raise PermissionDenied("You can only delete your own reviews.")
        instance.delete()

    @action(
        detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated]
    )
    def vote(self, request, pk=None):
        """Toggle helpful vote on a review"""
        review = self.get_object()
        user = request.user

        # Can't vote on your own review
        if review.user == user:
            return Response(
                {"error": "Cannot vote on your own review"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        is_helpful = request.data.get("is_helpful", True)

        # Check if user already voted
        existing_vote = ReviewVote.objects.filter(user=user, review=review).first()

        if existing_vote:
            if existing_vote.is_helpful == is_helpful:
                # Same vote type - remove the vote
                existing_vote.delete()
                return Response({"voted": False, "is_helpful": None})
            else:
                # Different vote type - update the vote
                existing_vote.is_helpful = is_helpful
                existing_vote.save()
                return Response({"voted": True, "is_helpful": is_helpful})
        else:
            # Create new vote
            ReviewVote.objects.create(user=user, review=review, is_helpful=is_helpful)
            return Response({"voted": True, "is_helpful": is_helpful})


class RecommendationsViewSet(viewsets.ViewSet):
    """Personalized anime recommendations for authenticated users"""

    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        """Get personalized recommendations for the current user"""
        from anime.recommendations import RecommendationService
        from django.core.cache import cache
        from rest_framework.pagination import LimitOffsetPagination

        # Check cache first
        cache_key = f"user_recommendations:{request.user.id}"
        cached_data = cache.get(cache_key)

        if cached_data:
            return Response(cached_data)

        # Get limit parameter
        limit = int(request.query_params.get("limit", 12))

        try:
            service = RecommendationService()
            recs = service.get_recommendations_for_user(request.user, limit=limit)

            serializer = UserRecommendationSerializer(
                recs, many=True, context={"request": request}
            )

            data = serializer.data

            # Cache for 1 hour
            cache.set(cache_key, data, 60 * 60)

            return Response(data)

        except Exception as e:
            logger.exception("Error fetching recommendations")
            return Response(
                {"error": "Failed to fetch recommendations"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=False, methods=["post"])
    def refresh(self, request):
        """Force refresh recommendations for the current user"""
        from anime.recommendations import RecommendationService
        from django.core.cache import cache

        try:
            # Clear cache
            cache_key = f"user_recommendations:{request.user.id}"
            cache.delete(cache_key)

            # Generate new recommendations
            service = RecommendationService()
            recs = service.generate_for_user(request.user)

            return Response(
                {
                    "message": f"Generated {len(recs)} new recommendations",
                    "count": len(recs),
                }
            )

        except Exception as e:
            logger.exception("Error refreshing recommendations")
            return Response(
                {"error": "Failed to refresh recommendations"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=["post"])
    def dismiss(self, request, pk=None):
        """Dismiss a recommendation (hide it from future results)"""
        from anime.recommendations import RecommendationService
        from anime.models import UserRecommendation

        try:
            anime_id = int(pk)
            service = RecommendationService()
            success = service.dismiss_recommendation(request.user, anime_id)

            if success:
                # Clear cache so dismissed item doesn't appear
                cache_key = f"user_recommendations:{request.user.id}"
                from django.core.cache import cache

                cache.delete(cache_key)

                return Response({"message": "Recommendation dismissed"})
            else:
                return Response(
                    {"error": "Recommendation not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )

        except (ValueError, TypeError):
            return Response(
                {"error": "Invalid anime ID"}, status=status.HTTP_400_BAD_REQUEST
            )


class DeleteAccountView(APIView):
    """Allow users to delete their own account."""

    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [throttling.StrictUserRateThrottle]

    def delete(self, request):
        user = request.user
        password = request.data.get("password")

        logger.info(
            f"Account deletion attempt for {user.username}: has_usable_password={user.has_usable_password()}, password_provided={bool(password)}"
        )

        # Require password confirmation ONLY if user has a usable password
        if user.has_usable_password():
            if not password:
                return Response(
                    {
                        "error": "Your current password is required to delete your account."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not user.check_password(password):
                return Response(
                    {"error": "The password you entered is incorrect."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Delete user and all related data (cascades via ForeignKey)
        user.delete()

        return Response(
            {"message": "Account deleted successfully"}, status=status.HTTP_200_OK
        )


class ChangeEmailView(APIView):
    """Request email change - sends verification to new email."""

    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [throttling.StrictUserRateThrottle]

    def post(self, request):
        new_email = request.data.get("new_email")
        password = request.data.get("password")
        user = request.user

        # Require password confirmation ONLY if user has a usable password
        if user.has_usable_password():
            if not password:
                return Response(
                    {
                        "error": "Your current password is required to change your email."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not user.check_password(password):
                return Response(
                    {"error": "The password you entered is incorrect."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Check if email already in use
        if User.objects.filter(email=new_email).exclude(pk=user.pk).exists():
            return Response(
                {"error": "This email is already in use"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Generate token for email change confirmation
        token = default_token_generator.make_token(user)
        uid = urlsafe_base64_encode(force_bytes(user.pk))

        # Store the new email temporarily (we'll use the token to validate)
        # Since we can't add to the user model, we'll encode the new email in the URL
        new_email_encoded = urlsafe_base64_encode(force_bytes(new_email))

        confirm_link = f"{settings.FRONTEND_URL}/confirm-email-change/{uid}/{token}/{new_email_encoded}/"

        subject = "Confirm your new email - aniShows"
        message = f"""You requested to change your email address on aniShows.

Click the link below to confirm your new email address:

{confirm_link}

If you didn't request this change, please ignore this email.
"""

        try:
            send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, [new_email])
        except Exception as e:
            logger.exception("Failed to send email change confirmation")
            return Response(
                {"error": "Failed to send confirmation email"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {
                "message": "Confirmation email sent to your new email address. Please check your inbox."
            },
            status=status.HTTP_200_OK,
        )


class ConfirmEmailChangeView(APIView):
    """Confirm email change with token."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def post(self, request):
        uidb64 = request.data.get("uid")
        token = request.data.get("token")
        new_email_encoded = request.data.get("new_email")

        if not all([uidb64, token, new_email_encoded]):
            return Response(
                {"error": "Missing required fields"}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            uid = force_str(urlsafe_base64_decode(uidb64))
            user = User.objects.get(pk=uid)
            new_email = force_str(urlsafe_base64_decode(new_email_encoded))
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            return Response(
                {"error": "Invalid link"}, status=status.HTTP_400_BAD_REQUEST
            )

        if not default_token_generator.check_token(user, token):
            return Response(
                {"error": "Invalid or expired link"}, status=status.HTTP_400_BAD_REQUEST
            )

        # Check email not taken (again, in case of race condition)
        if User.objects.filter(email=new_email).exclude(pk=user.pk).exists():
            return Response(
                {"error": "This email is already in use"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Update email and mark as verified
        user.email = new_email
        user.save()

        profile = getattr(user, "userprofile", None)
        if profile:
            profile.email_verified = True
            profile.save()

        return Response(
            {"message": "Email changed successfully!"}, status=status.HTTP_200_OK
        )
