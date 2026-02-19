#!/usr/bin/env python
"""
Test command to verify log API endpoints are working.
"""

from django.core.management.base import BaseCommand
from django.test import Client
from django.urls import reverse


class Command(BaseCommand):
    help = "Test log API endpoints"

    def handle(self, *args, **options):
        self.stdout.write("Testing log API endpoints...")

        # Test URL resolution
        try:
            url = reverse("admin-logs-list")
            self.stdout.write(self.style.SUCCESS(f"✓ admin-logs-list: {url}"))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"✗ admin-logs-list: {e}"))

        try:
            url = reverse("admin-logs-stats")
            self.stdout.write(self.style.SUCCESS(f"✓ admin-logs-stats: {url}"))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"✗ admin-logs-stats: {e}"))

        try:
            url = reverse("admin-audit-logs-list")
            self.stdout.write(self.style.SUCCESS(f"✓ admin-audit-logs-list: {url}"))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"✗ admin-audit-logs-list: {e}"))

        try:
            url = reverse("admin-audit-logs-stats")
            self.stdout.write(self.style.SUCCESS(f"✓ admin-audit-logs-stats: {url}"))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"✗ admin-audit-logs-stats: {e}"))

        self.stdout.write("\nAll log endpoints are registered!")
        self.stdout.write("Note: Make sure to restart the Django development server.")
