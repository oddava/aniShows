from django.urls import path

from anime.views import AnimeListView, HomePageView

urlpatterns = [
    path('', HomePageView.as_view(), name='home'),
    path('browse/', AnimeListView.as_view(), name='anime_list_page'),
]