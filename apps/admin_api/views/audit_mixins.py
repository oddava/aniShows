"""Audit helpers for admin ModelViewSets: one ``AuditLog`` row per create/update/delete."""

from __future__ import annotations

import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from django.db import transaction
from django.db.models import Model

from ...core.models import AuditLog
from ..services.audit import mark_nothing_to_audit, record_admin_action

if TYPE_CHECKING:
    from rest_framework.generics import GenericAPIView

    _ViewBase = GenericAPIView
else:
    _ViewBase = object


def jsonable(value):
    """A JSON-safe form of a model field value for an audit diff."""
    if value is None or isinstance(value, bool | int | float | str):
        return value
    if isinstance(value, Model):
        return value.pk
    if isinstance(value, datetime.date | datetime.datetime | datetime.time):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, list | tuple | set):
        return [jsonable(item) for item in value]
    if hasattr(value, "all"):  # a related manager
        return sorted(item.pk for item in value.all())
    if hasattr(value, "name") and hasattr(value, "url"):  # a file field
        return value.name or ""
    return str(value)


def field_snapshot(instance, fields) -> dict:
    return {field: jsonable(getattr(instance, field, None)) for field in fields}


class AuditedModelViewSetMixin(_ViewBase):
    """Audit ``perform_create/update/destroy`` with the changed fields."""

    audit_entity_type = ""

    def _audit(self, action, instance, *, previous=None, new=None):
        record_admin_action(
            self.request,
            action=action,
            entity_type=self.audit_entity_type or type(instance).__name__,
            entity_id=instance.pk,
            entity_repr=str(instance),
            previous=previous,
            new=new,
        )

    @transaction.atomic
    def perform_create(self, serializer):
        instance = serializer.save()
        self._audit(
            AuditLog.ActionType.CREATE,
            instance,
            new=field_snapshot(instance, serializer.validated_data),
        )

    @transaction.atomic
    def perform_update(self, serializer):
        fields = list(serializer.validated_data)
        previous = field_snapshot(serializer.instance, fields)
        instance = serializer.save()
        new = field_snapshot(instance, fields)
        if new == previous:
            # Saved without a change: nothing happened worth a row.
            mark_nothing_to_audit(self.request)
            return
        self._audit(AuditLog.ActionType.UPDATE, instance, previous=previous, new=new)

    def audit_destroy(self, instance, extra: dict | None = None):
        """Write the delete row before the row is gone; call it inside the delete's transaction."""
        # The editable fields as they were, so a mistaken delete can be redone by hand.
        fields = getattr(self.get_serializer(instance), "fields", {})
        editable = [
            name
            for name, field in fields.items()
            if not field.read_only and hasattr(instance, name)
        ]
        self._audit(
            AuditLog.ActionType.DELETE,
            instance,
            previous={"repr": str(instance), **field_snapshot(instance, editable), **(extra or {})},
        )

    @transaction.atomic
    def perform_destroy(self, instance):
        self.audit_destroy(instance)
        instance.delete()
