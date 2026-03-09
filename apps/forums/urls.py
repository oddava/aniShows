from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CategoryViewSet, PostViewSet, TagViewSet, ThreadViewSet

app_name = 'forums'

router = DefaultRouter()
router.register(r'categories', CategoryViewSet, basename='category')
router.register(r'threads', ThreadViewSet, basename='thread')
router.register(r'posts', PostViewSet, basename='post')
router.register(r'tags', TagViewSet, basename='tag')

urlpatterns = [
    path('', include(router.urls)),
]
