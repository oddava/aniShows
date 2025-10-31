from django.shortcuts import render
from django.views.generic import TemplateView


class HomePageView(TemplateView):
    def get(self, request, *args, **kwargs):
        return render(request, 'core/home_page.html')