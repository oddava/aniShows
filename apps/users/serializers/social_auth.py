from allauth.account import app_settings as allauth_account_settings
from allauth.socialaccount.helpers import complete_social_login
from allauth.socialaccount.providers.oauth2.client import OAuth2Error
from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.http import HttpRequest, HttpResponseBadRequest
from django.urls.exceptions import NoReverseMatch
from django.utils.translation import gettext_lazy as _
from requests.exceptions import HTTPError
from rest_framework import serializers
from rest_framework.reverse import reverse

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

        adapter = adapter_class(request)
        app = adapter.get_provider().app

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

            provider = adapter.get_provider()
            scope = provider.get_scope_from_request(request)
            client = self.client_class(
                request,
                app.client_id,
                app.secret,
                adapter.access_token_method,
                adapter.access_token_url,
                self.callback_url,
                scope,
                scope_delimiter=adapter.scope_delimiter,
                headers=adapter.headers,
                basic_auth=adapter.basic_auth,
            )
            try:
                token = client.get_access_token(code)
            except OAuth2Error as exc:
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
        except HTTPError as exc:
            raise serializers.ValidationError(_("Incorrect value")) from exc

        if isinstance(ret, HttpResponseBadRequest):
            raise serializers.ValidationError(ret.content)

        if not login.is_existing:
            if allauth_account_settings.UNIQUE_EMAIL:
                if self.auth_service.email_exists(login.user.email):
                    raise serializers.ValidationError(
                        _("User is already registered with this e-mail address.")
                    )

            login.lookup()
            try:
                login.save(request, connect=True)
            except IntegrityError as exc:
                raise serializers.ValidationError(
                    _("User is already registered with this e-mail address.")
                ) from exc

        attrs["user"] = login.account.user
        return attrs
