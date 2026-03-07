from rest_framework import serializers

from django.contrib.auth import get_user_model
from rest_framework.fields import SerializerMethodField, IntegerField
from rest_framework.serializers import ModelSerializer

from apps.users.models import UserProfile
from django.db.models import Count

User = get_user_model()

class AdminUserSerializer(ModelSerializer):
    email_verified = SerializerMethodField()
    avatar = SerializerMethodField()
    banner = SerializerMethodField()
    bio = SerializerMethodField()
    is_private = SerializerMethodField()
    
    # Activity counts from annotations
    favorites_count = IntegerField(source='_favorites_count', read_only=True, default=0)
    reviews_count = IntegerField(source='_reviews_count', read_only=True, default=0)
    list_entries_count = IntegerField(source='_list_entries_count', read_only=True, default=0)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'date_joined', 'last_login',
            'is_active', 'is_staff', 'is_superuser',
            'email_verified', 'avatar', 'banner', 'bio', 'is_private',
            'favorites_count', 'reviews_count', 'list_entries_count'
        ]

    def get_email_verified(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.email_verified if profile else False

    def get_avatar(self, obj):
        profile = getattr(obj, "userprofile", None)
        if profile and profile.avatar:
            try:
                return profile.avatar.url
            except ValueError:
                return None
        return None

    def get_banner(self, obj):
        profile = getattr(obj, "userprofile", None)
        if profile and profile.banner:
            try:
                return profile.banner.url
            except ValueError:
                return None
        return None

    def get_bio(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.bio if profile else None

    def get_is_private(self, obj):
        profile = getattr(obj, "userprofile", None)
        return profile.is_private if profile else False
