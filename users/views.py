from django.http import HttpResponse
from django.views import View
from django.views.generic import TemplateView


class SignupView(TemplateView):
    template_name = 'auth/register_page.html'

class LoginView(TemplateView):
    template_name = 'auth/login_page.html'

class LogoutView(View):
    def get(self, request):
        return HttpResponse('Log out')

class PasswordResetView(View):
    def get(self, request):
        return HttpResponse('Password Reset')