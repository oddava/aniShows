from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.utils.html import escape
from anime.models import Anime, Genre, Studio, UserFavorite, Review
from users.models import UserProfile, UserAnimeList

User = get_user_model()

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


class AnimeListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for lists"""
    genres = GenreSerializer(many=True, read_only=True)
    studio_name = serializers.CharField(source='studio.name', read_only=True, default=None)
    is_favorite = serializers.SerializerMethodField()
    
    class Meta:
        model = Anime
        fields = [
            'id', 'title', 'slug', 'cover_image', 'rating', 
            'episode_count', 'anime_type', 'status', 'genres',
            'studio_name', 'is_favorite'
        ]
    
    def get_is_favorite(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return UserFavorite.objects.filter(user=request.user, anime=obj).exists()
        return False


class AnimeDetailSerializer(serializers.ModelSerializer):
    """Full serializer for detail page"""
    genres = GenreSerializer(many=True, read_only=True)
    studio = StudioSerializer(read_only=True)
    is_favorite = serializers.SerializerMethodField()
    user_list_status = serializers.SerializerMethodField()
    review_count = serializers.IntegerField(read_only=True)
    avg_rating = serializers.DecimalField(max_digits=3, decimal_places=1, read_only=True)
    
    class Meta:
        model = Anime
        fields = [
            'id', 'title', 'title_jp', 'slug', 'synopsis',
            'cover_image', 'banner_image', 'trailer_url',
            'rating', 'episode_count', 'duration_minutes',
            'anime_type', 'status', 'release_date', 'end_date',
            'genres', 'studio', 'is_favorite', 'user_list_status',
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
                    'episodes_watched': user_list.episodes_watched
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

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'date_joined', 'avatar', 'banner', 'bio', 
                  'is_private', 'favorites_count', 'reviews_count', 'email_verified']
        read_only_fields = ['id', 'date_joined', 'email_verified']
    
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
        # Create profile if it doesn't exist
        UserProfile.objects.get_or_create(user=user)
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
        write_only=True
    )
    
    class Meta:
        model = UserAnimeList
        fields = ['id', 'anime', 'anime_id', 'status', 'score', 'episodes_watched', 'updated_at']


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
    
    class Meta:
        model = Review
        fields = ['id', 'user', 'anime', 'anime_slug', 'rating', 'text', 'has_spoilers', 'created_at', 'updated_at']
        read_only_fields = ['id', 'user', 'anime', 'created_at', 'updated_at']
    
    def validate_text(self, value):
        """Sanitize review text to prevent XSS."""
        if value:
            return escape(value.strip())
        return value


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(required=True, write_only=True)
    new_password = serializers.CharField(required=True, write_only=True, min_length=8)
    
    def validate_old_password(self, value):
        user = self.context['request'].user
        if not user.check_password(value):
            raise serializers.ValidationError('Current password is incorrect')
        return value
