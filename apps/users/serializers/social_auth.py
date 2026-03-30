from allauth.socialaccount.helpers import complete_social_login
from allauth.socialaccount.providers.oauth2.client import OAuth2Error
from django.core.exceptions import ImproperlyConfigured, MultipleObjectsReturned, ObjectDoesNotExist
from django.http import HttpRequest, HttpResponseBadRequest
from django.urls.exceptions import NoReverseMatch
from django.utils.translation import gettext_lazy as _
from requests.exceptions import HTTPError
from requests.exceptions import RequestException
from rest_framework import serializers
from rest_framework.reverse import reverse

from apps.shared.logger import logger
from apps.users.services.auth_service import AuthService


class SocialLoginSerializer(serializers.Serializer):
    """Serializer for social auth flows (OAuth code or access token)."""

    access_token = serializers.CharField(required=False, allow_blank=True)
    code = serializers.CharField(required=False, allow_blank=True)
    id_token = serializers.CharField(required=False, allow_blank=True)
    auth_service = AuthService()

    def _get_request(self):
        request = self.context.get("request")
        if not isinstance(request, HttpRequest):
            request = request._request
        return request

    def get_social_login(self, adapter, app, token, response):
        request = self._get_request()
        social_login = adapter.complete_login(request, app, token, response=response)
        social_login.token = token
        return social_login

    def set_callback_url(self, view, adapter_class):
        self.callback_url = getattr(view, "callback_url", None)
        if not self.callback_url:
            try:
                self.callback_url = reverse(
                    viewname=adapter_class.provider_id + "_callback",
                    request=self._get_request(),
                )
            except NoReverseMatch as exc:
                raise serializers.ValidationError(_("Define callback_url in view")) from exc

    def validate(self, attrs):
        view = self.context.get("view")
        request = self._get_request()

        if not view:
            raise serializers.ValidationError(
                _("View is not defined, pass it as a context variable")
            )

        adapter_class = getattr(view, "adapter_class", None)
        if not adapter_class:
            raise serializers.ValidationError(_("Define adapter_class in view"))

        try:
            adapter = adapter_class(request)
            app = adapter.get_provider().app
        except (ImproperlyConfigured, MultipleObjectsReturned, ObjectDoesNotExist, ValueError) as exc:
            logger.exception(
                "Social auth provider configuration error",
                extra={"provider": getattr(adapter_class, "provider_id", "unknown")},
            )
            raise serializers.ValidationError(_("Social login is temporarily unavailable.")) from exc

        access_token = attrs.get("access_token")
        code = attrs.get("code")

        if access_token:
            tokens_to_parse = {"access_token": access_token}
            token = access_token
            id_token = attrs.get("id_token")
            if id_token:
                tokens_to_parse["id_token"] = id_token
        elif code:
            self.set_callback_url(view=view, adapter_class=adapter_class)
            self.client_class = getattr(view, "client_class", None)

            if not self.client_class:
                raise serializers.ValidationError(_("Define client_class in view"))

            client = self.client_class(
                request,
                app.client_id,
                app.secret,
                adapter.access_token_method,
                adapter.access_token_url,
                self.callback_url,
                scope_delimiter=adapter.scope_delimiter,
                headers=adapter.headers,
                basic_auth=adapter.basic_auth,
            )
            try:
                token = client.get_access_token(code)
            except (OAuth2Error, RequestException, ValueError) as exc:
                logger.warning(
                    "Google token exchange failed",
                    extra={
                        "provider": getattr(adapter, "provider_id", "unknown"),
                        "callback_url": self.callback_url,
                    },
                    exc_info=True,
                )
                raise serializers.ValidationError(
                    _("Failed to exchange code for access token")
                ) from exc

            access_token = token["access_token"]
            tokens_to_parse = {"access_token": access_token}

            for key in ["refresh_token", "id_token", adapter.expires_in_key]:
                if key in token:
                    tokens_to_parse[key] = token[key]
        else:
            raise serializers.ValidationError(
                _("Incorrect input. access_token or code is required.")
            )

        social_token = adapter.parse_token(tokens_to_parse)
        social_token.app = app

        try:
            if adapter.provider_id == "google" and not code:
                login = self.get_social_login(
                    adapter, app, social_token, response={"id_token": id_token}
                )
            else:
                login = self.get_social_login(adapter, app, social_token, token)
            ret = complete_social_login(request, login)
        except (OAuth2Error, HTTPError) as exc:
            raise serializers.ValidationError(_("Incorrect value")) from exc
        except Exception as exc:
            logger.exception(
                "Unhandled social auth completion error",
                extra={"provider": getattr(adapter, "provider_id", "unknown")},
            )
            raise serializers.ValidationError(_("Failed to authenticate with social provider.")) from exc

        if isinstance(ret, HttpResponseBadRequest):
            raise serializers.ValidationError(ret.content)

        try:
            attrs["user"] = self.auth_service.finalize_social_login(request, login)
        except serializers.ValidationError:
            raise
        except Exception as exc:
            logger.exception(
                "Unhandled social auth finalization error",
                extra={"provider": getattr(adapter, "provider_id", "unknown")},
            )
            raise serializers.ValidationError(_("Failed to finalize social login.")) from exc
        return attrs
