from rest_framework import serializers
from django.contrib.auth import get_user_model
from anime.models import Anime, Genre, Studio, UserFavorite, Review
from users.models import UserProfile, UserAnimeList

User = get_user_model()


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
    favorites_count = serializers.SerializerMethodField()
    reviews_count = serializers.SerializerMethodField()
    
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'date_joined', 'avatar', 'banner', 'bio', 
                  'favorites_count', 'reviews_count']
        read_only_fields = ['id', 'date_joined']
    
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


class UserProfileUpdateSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150, required=False)
    avatar = serializers.ImageField(required=False, allow_null=True)
    banner = serializers.ImageField(required=False, allow_null=True)
    bio = serializers.CharField(required=False, allow_blank=True)


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    
    class Meta:
        model = User
        fields = ['username', 'email', 'password']
    
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
    anime_slug = serializers.SlugRelatedField(
        slug_field='slug',
        queryset=Anime.objects.all(),
        source='anime',
        write_only=True
    )
    
    class Meta:
        model = Review
        fields = ['id', 'user', 'anime', 'anime_slug', 'rating', 'text', 'created_at', 'updated_at']
        read_only_fields = ['id', 'user', 'anime', 'created_at', 'updated_at']
