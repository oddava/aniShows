from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.urls import reverse_lazy
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from apps.animes.utils.tokens import account_activation_token
from apps.shared.logger import logger


def send_email(subject: str, body: str | None, emails: list[str], html_content=None):
    email = EmailMultiAlternatives(
        subject=subject,
        body=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=emails,
    )
    email.attach_alternative(html_content, "text/html")
    try:
        email.send()
    except Exception:
        logger.exception("Failed to send email")

def send_registration_link(user, host: str):
    subject = 'Successful Registration'
    token = account_activation_token.make_token(user)
    uidb64 = urlsafe_base64_encode(force_bytes(user.pk))
    url = reverse_lazy('confirm_email_page', kwargs={'uidb64': uidb64, 'token': token})
    logger.debug(f"Registration link: {host}{url}")
    context = {
        'email': user.email,
        'username': user.username,
        'confirm_link': host + url
    }
    html_content = render_to_string('anime/registration_email.html', context)

    send_email(subject, None, [user.email], html_content)
