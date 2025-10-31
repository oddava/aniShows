from django.urls import path

from users import views

urlpatterns = [
    path('signup/', view=views.SignupView.as_view(), name='register'),
    path('login/', view=views.LoginView.as_view(), name='login'),
    path('logout/', view=views.LogoutView.as_view(), name='logout'),
    path('logout/', view=views.PasswordResetView.as_view(), name='password_reset'),
]