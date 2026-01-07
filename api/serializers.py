from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.utils.html import escape
from anime.models import Anime, Genre, Studio, UserFavorite, Review, Character, Staff, AnimeCharacter, AnimeStaff
from users.models import UserProfile, UserAnimeList
import logging

User = get_user_model()
logger = logging.getLogger(__name__)

# File upload limits
MAX_AVATAR_SIZE = 2 * 1024 * 1024  # 2MB
MAX_BANNER_SIZE = 5 * 1024 * 1024  # 5MB
ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
MAX_BIO_LENGTH = 1000
MAX_REVIEW_LENGTH = 5000


class GenreSerializer(serializers.ModelSerializer):
    class Meta:
        model = Genre
        fields = ['id', 'name', 'slug']


class StudioSerializer(serializers.ModelSerializer):
    class Meta:
        model = Studio
        fields = ['id', 'name', 'website']


class CharacterSerializer(serializers.ModelSerializer):
    image = serializers.SerializerMethodField()

    class Meta:
        model = Character
        fields = ['id', 'name', 'name_native', 'image', 'description']

    def get_image(self, obj):
        if obj.image:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.image.url)
            return obj.image.url
        return obj.image_url

class StaffSerializer(serializers.ModelSerializer):
    image = serializers.SerializerMethodField()

    class Meta:
        model = Staff
        fields = ['id', 'name', 'name_native', 'image', 'description']

    def get_image(self, obj):
        if obj.image:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.image.url)
            return obj.image.url
        return obj.image_url

class AnimeCharacterSerializer(serializers.ModelSerializer):
    character = CharacterSerializer(read_only=True)
    voice_actor = StaffSerializer(read_only=True)
    
    class Meta:
        model = AnimeCharacter
        fields = ['id', 'character', 'role', 'voice_actor']

class AnimeStaffSerializer(serializers.ModelSerializer):
    staff = StaffSerializer(read_only=True)
    
    class Meta:
        model = AnimeStaff
        fields = ['id', 'staff', 'role']

class AnimeListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for lists"""
    genres = GenreSerializer(many=True, read_only=True)
    studio_name = serializers.CharField(source='studio.name', read_only=True, default=None)
    is_favorite = serializers.SerializerMethodField()
    user_list_status = serializers.SerializerMethodField()
    
    class Meta:
        model = Anime
        fields = [
            'id', 'title', 'title_jp', 'slug', 'cover_image', 'banner_image', 'rating', 
            'episode_count', 'anime_type', 'status', 'genres',
            'studio_name', 'is_favorite', 'user_list_status', 'synopsis', 'release_date'
        ]
    
    def get_is_favorite(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return UserFavorite.objects.filter(user=request.user, anime=obj).exists()
        return False

    def get_user_list_status(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            user_list = UserAnimeList.objects.filter(user=request.user, anime=obj).first()
            if user_list:
                return {
                    'id': user_list.id,
                    'status': user_list.status,
                    'score': user_list.score,
                    'episodes_watched': user_list.episodes_watched,
                    'progress': (user_list.episodes_watched / obj.episode_count * 100) if obj.episode_count and obj.episode_count > 0 else 0
                }
        return None


class AnimeDetailSerializer(serializers.ModelSerializer):
    """Full serializer for detail page"""
    genres = GenreSerializer(many=True, read_only=True)
    studio = StudioSerializer(read_only=True)
    characters = AnimeCharacterSerializer(source='cast', many=True, read_only=True)
    staff = AnimeStaffSerializer(source='production_staff', many=True, read_only=True)
    
    is_favorite = serializers.SerializerMethodField()
    user_list_status = serializers.SerializerMethodField()
    user_review = serializers.SerializerMethodField()
    review_count = serializers.IntegerField(read_only=True)
    avg_rating = serializers.DecimalField(max_digits=3, decimal_places=1, read_only=True)
    
    class Meta:
        model = Anime
        fields = [
            'id', 'title', 'title_jp', 'slug', 'synopsis',
            'cover_image', 'banner_image', 'trailer_url',
            'rating', 'episode_count', 'duration_minutes',
            'anime_type', 'status', 'release_date', 'end_date',
            'genres', 'studio', 'characters', 'staff',
            'external_links', 'relations', 'site_rank', 'popularity_rank',
            'is_favorite', 'user_list_status', 'user_review',
            'review_count', 'avg_rating', 'created_at'
        ]
    
    def get_is_favorite(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return UserFavorite.objects.filter(user=request.user, anime=obj).exists()
        return False
    
    def get_user_list_status(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            user_list = UserAnimeList.objects.filter(user=request.user, anime=obj).first()
            if user_list:
                return {
                    'id': user_list.id,
                    'status': user_list.status,
                    'score': user_list.score,
                    'episodes_watched': user_list.episodes_watched,
                    'progress': (user_list.episodes_watched / obj.episode_count * 100) if obj.episode_count and obj.episode_count > 0 else 0
                }
        return None

    def get_user_review(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            review = Review.objects.filter(user=request.user, anime=obj).first()
            if review:
                # Return minimal data needed for "Edit Review" functionality
                return {
                    'id': review.id,
                    'rating': review.rating,
                    'text': review.text,
                    'has_spoilers': review.has_spoilers
                }
        return None


class UserSerializer(serializers.ModelSerializer):
    avatar = serializers.SerializerMethodField()
    banner = serializers.SerializerMethodField()
    bio = serializers.SerializerMethodField()
    is_private = serializers.SerializerMethodField()
    favorites_count = serializers.SerializerMethodField()
    reviews_count = serializers.SerializerMethodField()
    
    email_verified = serializers.SerializerMethodField()
    has_password = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'date_joined', 'avatar', 'banner', 'bio', 
                  'is_private', 'favorites_count', 'reviews_count', 'email_verified', 'has_password',
                  'is_staff', 'is_superuser']
        read_only_fields = ['id', 'date_joined', 'email_verified', 'has_password', 'is_staff', 'is_superuser']
    
    def get_avatar(self, obj):
        profile = getattr(obj, 'userprofile', None)
        return profile.avatar.url if profile and profile.avatar else None

    def get_banner(self, obj):
        profile = getattr(obj, 'userprofile', None)
        return profile.banner.url if profile and profile.banner else None
    
    def get_bio(self, obj):
        profile = getattr(obj, 'userprofile', None)
        return profile.bio if profile else None
    
    def get_favorites_count(self, obj):
        return obj.favorites.count()
    
    def get_reviews_count(self, obj):
        return obj.reviews.count()

    def get_is_private(self, obj):
        profile = getattr(obj, 'userprofile', None)
        return profile.is_private if profile else False

    def get_email_verified(self, obj):
        profile = getattr(obj, 'userprofile', None)
        return profile.email_verified if profile else False

    def get_has_password(self, obj):
        return obj.has_usable_password()


class PublicUserSerializer(serializers.ModelSerializer):
    """Limited serializer for public profile view"""
    avatar = serializers.SerializerMethodField()
    banner = serializers.SerializerMethodField()
    bio = serializers.SerializerMethodField()
    favorites_count = serializers.SerializerMethodField()
    reviews_count = serializers.SerializerMethodField()
    is_private = serializers.SerializerMethodField()
    
    class Meta:
        model = User
        fields = ['id', 'username', 'date_joined', 'avatar', 'banner', 'bio', 'favorites_count', 'reviews_count', 'is_private']
        read_only_fields = fields
    
    def get_avatar(self, obj):
        profile = getattr(obj, 'userprofile', None)
        return profile.avatar.url if profile and profile.avatar else None

    def get_banner(self, obj):
        profile = getattr(obj, 'userprofile', None)
        return profile.banner.url if profile and profile.banner else None
    
    def get_bio(self, obj):
        profile = getattr(obj, 'userprofile', None)
        return profile.bio if profile else None
    
    def get_favorites_count(self, obj):
        return obj.favorites.count()
    
    def get_reviews_count(self, obj):
        return obj.reviews.count()
        
    def get_is_private(self, obj):
        profile = getattr(obj, 'userprofile', None)
        return profile.is_private if profile else False

class UserProfileUpdateSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150, required=False)
    avatar = serializers.ImageField(required=False, allow_null=True)
    banner = serializers.ImageField(required=False, allow_null=True)
    bio = serializers.CharField(required=False, allow_blank=True, max_length=MAX_BIO_LENGTH)
    
    def validate_avatar(self, value):
        """Validate avatar file size and type."""
        if value is None:
            return value
        if value.size > MAX_AVATAR_SIZE:
            raise serializers.ValidationError(
                f"Avatar file too large. Maximum size is {MAX_AVATAR_SIZE // (1024*1024)}MB."
            )
        if hasattr(value, 'content_type') and value.content_type not in ALLOWED_IMAGE_TYPES:
            raise serializers.ValidationError(
                "Invalid file type. Allowed types: JPEG, PNG, WebP, GIF."
            )
        return value
    
    def validate_banner(self, value):
        """Validate banner file size and type."""
        if value is None:
            return value
        if value.size > MAX_BANNER_SIZE:
            raise serializers.ValidationError(
                f"Banner file too large. Maximum size is {MAX_BANNER_SIZE // (1024*1024)}MB."
            )
        if hasattr(value, 'content_type') and value.content_type not in ALLOWED_IMAGE_TYPES:
            raise serializers.ValidationError(
                "Invalid file type. Allowed types: JPEG, PNG, WebP, GIF."
            )
        return value
    
    def validate_bio(self, value):
        """Sanitize bio text to prevent XSS."""
        if value:
            # Basic HTML escape for XSS prevention
            return escape(value.strip())
        return value


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    
    class Meta:
        model = User
        fields = ['username', 'email', 'password']
    
    def validate_email(self, value):
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value
        
    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password']
        )
        return user


class FavoriteSerializer(serializers.ModelSerializer):
    anime = AnimeListSerializer(read_only=True)
    anime_id = serializers.PrimaryKeyRelatedField(
        queryset=Anime.objects.all(), 
        source='anime', 
        write_only=True
    )
    
    class Meta:
        model = UserFavorite
        fields = ['id', 'anime', 'anime_id', 'added_at']
        read_only_fields = ['id', 'added_at']


class UserAnimeListSerializer(serializers.ModelSerializer):
    anime = AnimeListSerializer(read_only=True)
    anime_id = serializers.PrimaryKeyRelatedField(
        queryset=Anime.objects.all(),
        source='anime',
        write_only=True,
        required=False  # Not required for updates
    )
    status = serializers.ChoiceField(choices=UserAnimeList.UserAnimeStatus.choices, required=False)
    progress = serializers.SerializerMethodField()
    
    class Meta:
        model = UserAnimeList
        fields = ['id', 'anime', 'anime_id', 'status', 'score', 'episodes_watched', 'progress', 'updated_at']
    
    def get_progress(self, obj):
        if obj.anime.episode_count and obj.anime.episode_count > 0:
             return int((obj.episodes_watched / obj.anime.episode_count) * 100)
        return 0

    def validate(self, attrs):
        # For creation, anime_id is required
        if not self.instance and 'anime' not in attrs:
            raise serializers.ValidationError({'anime_id': 'This field is required.'})
        
        episodes_watched = attrs.get('episodes_watched')
        anime = attrs.get('anime')
        status = attrs.get('status')
        
        # If updating, anime might not be in attrs, get from instance
        if not anime and self.instance:
            anime = self.instance.anime
            
        if episodes_watched is not None and anime and anime.episode_count > 0:
            if episodes_watched > anime.episode_count:
                raise serializers.ValidationError(
                    {'episodes_watched': f'Episodes watched cannot exceed total episodes ({anime.episode_count}).'}
                )
            
            # Auto-complete logic
            if episodes_watched == anime.episode_count:
                 attrs['status'] = UserAnimeList.UserAnimeStatus.completed

        # If status is set to Completed, ensure episodes_watched is set to max
        if status == UserAnimeList.UserAnimeStatus.completed and anime and anime.episode_count > 0:
            attrs['episodes_watched'] = anime.episode_count

        return attrs


class ReviewSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    anime = AnimeListSerializer(read_only=True)
    anime_slug = serializers.SlugRelatedField(
        slug_field='slug',
        queryset=Anime.objects.all(),
        source='anime',
        write_only=True
    )
    has_spoilers = serializers.BooleanField(default=False, required=False)
    text = serializers.CharField(
        required=False, 
        allow_blank=True, 
        max_length=MAX_REVIEW_LENGTH
    )

    def validate_text(self, value):
        """Sanitize review text to prevent XSS."""
        if value:
            return escape(value)
        return value
    is_completed = serializers.SerializerMethodField()
    helpful_count = serializers.SerializerMethodField()
    user_vote = serializers.SerializerMethodField()
    
    class Meta:
        model = Review
        fields = [
            'id', 'user', 'anime', 'anime_slug', 'rating', 
            'rating_story', 'rating_animation', 'rating_music', 'rating_characters',
            'text', 'has_spoilers', 'is_completed', 'helpful_count', 'user_vote',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'user', 'anime', 'created_at', 'updated_at']
    
    def get_is_completed(self, obj):
        try:
            return UserAnimeList.objects.filter(
                user=obj.user, 
                anime=obj.anime, 
                status=UserAnimeList.UserAnimeStatus.completed
            ).exists()
        except Exception:
            return False
    
    def get_helpful_count(self, obj):
        return obj.votes.filter(is_helpful=True).count()
    
    def get_user_vote(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            vote = obj.votes.filter(user=request.user).first()
            if vote:
                return vote.is_helpful
        return None



class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(required=False, allow_blank=True, allow_null=True, write_only=True)
    new_password = serializers.CharField(required=True, write_only=True, min_length=8)
    
    def validate(self, attrs):
        user = self.context['request'].user
        old_password = attrs.get('old_password')
        
        # Log for debugging
        logger.info(f"Validating password change for {user.username}: has_usable_password={user.has_usable_password()}, old_password_provided={bool(old_password)}")
        
        # If user has a password, old_password is REQUIRED
        if user.has_usable_password():
            if not old_password:
                raise serializers.ValidationError({'old_password': 'Current password is required to set a new one.'})
            if not user.check_password(old_password):
                raise serializers.ValidationError({'old_password': 'The current password you entered is incorrect.'})
        
        return attrs
