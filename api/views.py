from rest_framework import viewsets, status, generics, permissions, serializers
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django.db.models import Count, Avg, Q, Prefetch
from django.contrib.auth import get_user_model

from anime.models import Anime, Genre, Studio, UserFavorite, Review
from users.models import UserProfile, UserAnimeList
from .serializers import (
    AnimeListSerializer, AnimeDetailSerializer,
    GenreSerializer, StudioSerializer,
    UserSerializer, UserProfileUpdateSerializer, RegisterSerializer,
    FavoriteSerializer, UserAnimeListSerializer, ReviewSerializer
)

User = get_user_model()


class AnimeViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Anime listing and detail with filtering, search, and sorting.
    """
    lookup_field = 'slug'
    
    def get_queryset(self):
        queryset = Anime.objects.select_related('studio').prefetch_related('genres')
        
        # Annotate with counts
        queryset = queryset.annotate(
            review_count=Count('reviews'),
            avg_rating=Avg('reviews__rating')
        )
        
        # Search
        search = self.request.query_params.get('q')
        if search:
            queryset = queryset.filter(
                Q(title__icontains=search) |
                Q(title_jp__icontains=search) |
                Q(synopsis__icontains=search)
            )
        
        # Filter by genre
        genres = []
        # Handle ?genre=action&genre=romance
        params = self.request.query_params.getlist('genre')
        for param in params:
            if param == 'all':
                continue
            # Handle ?genre=action,romance
            if ',' in param:
                genres.extend(param.split(','))
            else:
                genres.append(param)
        
        if genres:
            # Filter for anime that match ALL selected genres (AND logic)
            for genre in genres:
                queryset = queryset.filter(genres__slug=genre)
        
        # Filter by status
        anime_status = self.request.query_params.get('status')
        if anime_status:
            queryset = queryset.filter(status=anime_status)
        
        # Filter by type
        anime_type = self.request.query_params.get('type')
        if anime_type:
            queryset = queryset.filter(anime_type=anime_type)
        
        # Sorting
        sort = self.request.query_params.get('sort', 'popular')
        sort_mapping = {
            'popular': '-favorite_count',
            'rating': '-rating',
            'newest': '-release_date',
            'title': 'title',
        }
        
        # Add favorite count for sorting
        queryset = queryset.annotate(favorite_count=Count('favorites'))
        
        sort_field = sort_mapping.get(sort, '-favorite_count')
        
        # logical fixes for specific sorts:
        # Exclude upcoming (0 episodes) from rating and newest sorts to prevent them from hitting top
        if sort == 'rating':
            queryset = queryset.filter(episode_count__gt=0, rating__isnull=False)
        elif sort == 'newest':
            queryset = queryset.filter(episode_count__gt=0)

        queryset = queryset.order_by(sort_field)
        
        return queryset.distinct()
    
    def get_serializer_class(self):
        if self.action == 'retrieve':
            return AnimeDetailSerializer
        return AnimeListSerializer
    
    @action(detail=False, methods=['get'])
    def trending(self, request):
        """Get trending anime (most favorited recently)"""
        queryset = self.get_queryset()[:12]
        serializer = AnimeListSerializer(queryset, many=True, context={'request': request})
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def top_rated(self, request):
        """Get top rated anime"""
        queryset = Anime.objects.select_related('studio').prefetch_related('genres')
        queryset = queryset.filter(rating__isnull=False).order_by('-rating')[:12]
        serializer = AnimeListSerializer(queryset, many=True, context={'request': request})
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def reviews(self, request, slug=None):
        """Get reviews for a specific anime"""
        anime = self.get_object()
        reviews = Review.objects.filter(anime=anime).select_related('user')
        serializer = ReviewSerializer(reviews, many=True, context={'request': request})
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def related(self, request, slug=None):
        """Get related anime based on genres"""
        anime = self.get_object()
        genre_ids = anime.genres.values_list('id', flat=True)
        related = Anime.objects.filter(genres__in=genre_ids).exclude(id=anime.id)
        related = related.annotate(shared_genres=Count('genres')).order_by('-shared_genres')[:8]
        serializer = AnimeListSerializer(related, many=True, context={'request': request})
        return Response(serializer.data)


class GenreViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Genre.objects.all().order_by('name')
    serializer_class = GenreSerializer
    pagination_class = None


class StudioViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Studio.objects.all().order_by('name')
    serializer_class = StudioSerializer
    pagination_class = None


from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['username'] = serializers.CharField(required=False)
        self.fields['email'] = serializers.EmailField(required=False)

    def validate(self, attrs):
        # Allow login with email or username
        email = attrs.get('email')
        username = attrs.get('username')
        password = attrs.get('password')
        
        if username:
            username = username.strip()
            attrs['username'] = username
        
        # If username is provided but looks like an email, extract it
        if username and '@' in username:
            email = username
            username = None
        
        if email and not username:
            # Try to find user by email
            User = get_user_model()
            try:
                user = User.objects.get(email=email)
                attrs['username'] = user.username
            except User.DoesNotExist:
                # Let the super call handle the failure
                pass
            
        return super().validate(attrs)


class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer


class RegisterView(APIView):
    permission_classes = [permissions.AllowAny]
    
    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.save()
            # Email verification disabled for now
            # user.is_active = False 
            # user.save()
            
            # Send Verification Email - Disabled
            # token = default_token_generator.make_token(user)
            # ...
            
            return Response({
                'message': 'Registration successful. You can now log in.'
            }, status=status.HTTP_201_CREATED)
            
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

class VerifyEmailView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        uidb64 = request.data.get('uid')
        token = request.data.get('token')
        
        if not uidb64 or not token:
             return Response({'error': 'Missing UID or Token'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            uid = force_str(urlsafe_base64_decode(uidb64))
            user = User.objects.get(pk=uid)
            print(f"DEBUG: Verify for user {user.username} (ID: {user.pk})")
            print(f"DEBUG: Active? {user.is_active}")
            print(f"DEBUG: Received Token: {token}")
            
            is_valid = default_token_generator.check_token(user, token)
            print(f"DEBUG: Token Valid? {is_valid}")
            
        except (TypeError, ValueError, OverflowError, User.DoesNotExist) as e:
            print(f"DEBUG: UID Decode Error: {e}")
            return Response({'error': 'Invalid UID'}, status=status.HTTP_400_BAD_REQUEST)

        if user.is_active:
             return Response({'message': 'Account already active'}, status=status.HTTP_200_OK)

        if is_valid:
            user.is_active = True
            user.save()
            return Response({'message': 'Email verified successfully. You can now login.'}, status=status.HTTP_200_OK)
        else:
            return Response({'error': 'Invalid or expired token'}, status=status.HTTP_400_BAD_REQUEST)

class PasswordResetView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        email = request.data.get('email')
        if not email:
            return Response({'error': 'Email is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            # Don't reveal user existence
            return Response({'message': 'If an account exists with this email, a reset link has been sent.'}, status=status.HTTP_200_OK)
            
        token = default_token_generator.make_token(user)
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        
        # Link to frontend reset page
        reset_link = f"http://localhost:5173/reset-password/{uid}/{token}/"
        
        subject = 'Reset your password - aniShows'
        message = f'Click the link below to reset your password:\n\n{reset_link}'
        
        try:
            send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, [email])
        except Exception as e:
             print(f"Error sending email: {e}")

        return Response({'message': 'If an account exists with this email, a reset link has been sent.'}, status=status.HTTP_200_OK)


class PasswordResetConfirmView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        uidb64 = request.data.get('uid')
        token = request.data.get('token')
        password = request.data.get('password')
        
        if not all([uidb64, token, password]):
            return Response({'error': 'Missing required fields'}, status=status.HTTP_400_BAD_REQUEST)
            
        try:
            uid = force_str(urlsafe_base64_decode(uidb64))
            user = User.objects.get(pk=uid)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            return Response({'error': 'Invalid link'}, status=status.HTTP_400_BAD_REQUEST)
            
        if default_token_generator.check_token(user, token):
            user.set_password(password)
            user.save()
            return Response({'message': 'Password has been reset successfully.'}, status=status.HTTP_200_OK)
        else:
            return Response({'error': 'Invalid or expired link'}, status=status.HTTP_400_BAD_REQUEST)



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
        serializer = UserSerializer(request.user, context={'request': request})
        return Response(serializer.data)
    
    def patch(self, request):
        serializer = UserProfileUpdateSerializer(data=request.data)
        if serializer.is_valid():
            # Username Change Logic
            new_username = serializer.validated_data.get('username')
            if new_username and new_username != request.user.username:
                profile, created = UserProfile.objects.get_or_create(user=request.user)
                
                # Check for cooldown
                if profile.last_username_change:
                    elapsed = timezone.now() - profile.last_username_change
                    if elapsed < timedelta(days=14):
                        days_left = 14 - elapsed.days
                        return Response(
                            {'username': f'You can change your username again in {days_left} days.'}, 
                            status=status.HTTP_400_BAD_REQUEST
                        )
                
                # Check availability (User model handles unique constraint but good to be explicit for API)
                if User.objects.filter(username=new_username).exists():
                     return Response(
                        {'username': 'This username is already taken.'}, 
                        status=status.HTTP_400_BAD_REQUEST
                    )

                request.user.username = new_username
                request.user.save()
                
                # Update timestamp
                profile.last_username_change = timezone.now()
                profile.save()

            # Update profile fields
            profile, created = UserProfile.objects.get_or_create(user=request.user)
            if 'avatar' in serializer.validated_data:
                profile.avatar = serializer.validated_data['avatar']
            if 'banner' in serializer.validated_data:
                profile.banner = serializer.validated_data['banner']
            if 'bio' in serializer.validated_data:
                profile.bio = serializer.validated_data['bio']
            profile.save()
            
            return Response(UserSerializer(request.user, context={'request': request}).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class FavoriteViewSet(viewsets.ModelViewSet):
    serializer_class = FavoriteSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        return UserFavorite.objects.filter(user=self.request.user).select_related('anime__studio').prefetch_related('anime__genres')
    
    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
    
    @action(detail=False, methods=['post'])
    def toggle(self, request):
        """Toggle favorite status for an anime"""
        anime_id = request.data.get('anime_id')
        if not anime_id:
            return Response({'error': 'anime_id required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            anime = Anime.objects.get(id=anime_id)
        except Anime.DoesNotExist:
            return Response({'error': 'Anime not found'}, status=status.HTTP_404_NOT_FOUND)
        
        favorite, created = UserFavorite.objects.get_or_create(user=request.user, anime=anime)
        
        if not created:
            favorite.delete()
            return Response({'is_favorite': False, 'message': 'Removed from favorites'})
        
        return Response({'is_favorite': True, 'message': 'Added to favorites'})


class UserAnimeListViewSet(viewsets.ModelViewSet):
    serializer_class = UserAnimeListSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        queryset = UserAnimeList.objects.filter(user=self.request.user).select_related('anime__studio').prefetch_related('anime__genres')
        
        # Filter by status
        list_status = self.request.query_params.get('status')
        if list_status:
            queryset = queryset.filter(status=list_status)
        
        return queryset.order_by('-updated_at')
    
    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class ReviewViewSet(viewsets.ModelViewSet):
    serializer_class = ReviewSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    
    def get_queryset(self):
        queryset = Review.objects.select_related('user', 'anime')
        
        # Filter by anime
        anime_slug = self.request.query_params.get('anime')
        if anime_slug:
            queryset = queryset.filter(anime__slug=anime_slug)
        
        # Filter by user
        if self.request.query_params.get('mine') == 'true' and self.request.user.is_authenticated:
            queryset = queryset.filter(user=self.request.user)
        
        return queryset.order_by('-created_at')
    
    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
