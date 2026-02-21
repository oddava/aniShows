from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import CategoryViewSet, ThreadViewSet, PostViewSet, TagViewSet

app_name = 'forums'

router = DefaultRouter()
router.register(r'categories', CategoryViewSet, basename='category')
router.register(r'threads', ThreadViewSet, basename='thread')
router.register(r'posts', PostViewSet, basename='post')
router.register(r'tags', TagViewSet, basename='tag')

urlpatterns = [
    path('', include(router.urls)),
]
