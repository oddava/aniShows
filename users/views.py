import requests
from django.shortcuts import render, redirect
from django.views import View
from django.views.generic import FormView
from django.contrib.auth import login, logout
from django.contrib.auth.mixins import LoginRequiredMixin
from django.contrib import messages
from django.core.mail import send_mail
from django.urls import reverse
from django.contrib.auth.tokens import default_token_generator
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.utils.encoding import force_bytes, force_str
from django.conf import settings
from users.models import CustomUser as User

from anime.tokens import account_activation_token
from anime.utils import send_registration_link
from .forms import SignupForm, PasswordResetRequestForm
from django.contrib.auth.views import LoginView as DjangoLoginView
import urllib.parse
from django.contrib.auth import login as auth_login


class SignupView(FormView):
    template_name = 'auth/register_page.html'
    form_class = SignupForm

    def form_valid(self, form):
        user = form.save(commit=False)
        user.is_active = False
        user.save()

        send_registration_link(user, f"http://{self.request.get_host()}")

        messages.success(
            self.request,
            'Account created! Please check your email to verify your account.'
        )
        return redirect('login')

    def form_invalid(self, form):
        messages.error(self.request, 'Please correct the errors below.')
        return super().form_invalid(form)


class ActivateAccountView(View):
    def get(self, request, uidb64, token):
        try:
            uid = force_bytes(urlsafe_base64_decode(uidb64)).decode()
            user = User.objects.get(pk=uid)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            user = None

        if user is not None and account_activation_token.check_token(user, token):
            user.is_active = True
            user.save()
            login(request, user)
            messages.success(request, "Email verified successfully! You can now log in now.")
        else:
            messages.error(request, "Something went wrong. Please try again.")

        return redirect('anime_list_page')


class LoginView(DjangoLoginView):
    template_name = 'auth/login_page.html'
    redirect_authenticated_user = True

    def get_success_url(self):
        return self.request.GET.get('next', '/browse/')

    def form_valid(self, form):
        messages.success(self.request, f'Welcome back!')
        return super().form_valid(form)

    def form_invalid(self, form):
        messages.error(self.request, 'Invalid username or password.')
        return super().form_invalid(form)


class LogoutView(LoginRequiredMixin, View):
    def get(self, request):
        logout(request)
        messages.success(request, 'You have been logged out successfully.')
        return redirect('login')


class PasswordResetView(FormView):
    template_name = 'auth/password_reset.html'
    form_class = PasswordResetRequestForm

    def form_valid(self, form):
        email = form.cleaned_data['email']
        users = User.objects.filter(email=email)

        if users.exists():
            for user in users:
                token = default_token_generator.make_token(user)
                uid = urlsafe_base64_encode(force_bytes(user.pk))

                reset_url = self.request.build_absolute_uri(
                    reverse('password_reset_confirm', kwargs={
                        'uidb64': uid,
                        'token': token
                    })
                )

                send_mail(
                    'Password Reset Request',
                    f'Click the link to reset your password: {reset_url}',
                    settings.DEFAULT_FROM_EMAIL,
                    [email],
                    fail_silently=False,
                )

        messages.success(
            self.request,
            'If an account exists with that email, a password reset link has been sent.'
        )
        return redirect('login')


class PasswordResetConfirmView(View):
    template_name = 'auth/password_reset_confirm.html'

    def get(self, request, uidb64, token):
        try:
            uid = force_str(urlsafe_base64_decode(uidb64))
            user = User.objects.get(pk=uid)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            user = None

        if user and default_token_generator.check_token(user, token):
            return render(request, self.template_name, {'validlink': True, 'uidb64': uidb64, 'token': token})
        else:
            messages.error(request, 'Password reset link is invalid or has expired.')
            return redirect('password_reset')

    def post(self, request, uidb64, token):
        password1 = request.POST.get('password1')
        password2 = request.POST.get('password2')

        if password1 != password2:
            messages.error(request, 'Passwords do not match.')
            return redirect(request.path)

        try:
            uid = force_str(urlsafe_base64_decode(uidb64))
            user = User.objects.get(pk=uid)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            user = None

        if user and default_token_generator.check_token(user, token):
            user.set_password(password1)
            user.save()
            messages.success(request, 'Password has been reset successfully!')
            return redirect('login')
        else:
            messages.error(request, 'Password reset link is invalid.')
            return redirect('password_reset')

