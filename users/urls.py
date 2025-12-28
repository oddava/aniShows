from django.urls import path, re_path, include

from users import views
from users.views import ActivateAccountView

urlpatterns = [
    path('signup/', views.SignupView.as_view(), name='register'),
    path('login/', views.LoginView.as_view(), name='login'),
    path('logout/', views.LogoutView.as_view(), name='logout'),
    path('password-reset/', views.PasswordResetView.as_view(), name='password_reset'),
    path('password-reset-confirm/<uidb64>/<token>/', views.PasswordResetConfirmView.as_view(),
         name='password_reset_confirm'),
    re_path(r'^auth/user/confirm/(?P<uidb64>[0-9A-Za-z_\-]+)/(?P<token>[0-9A-Za-z]{1,13}-[0-9A-Za-z]{1,40})/$',
            ActivateAccountView.as_view(), name='confirm_email_page'),
]
