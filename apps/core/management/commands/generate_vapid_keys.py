"""Print a fresh VAPID key pair for web push (``VAPID_PUBLIC_KEY`` / ``VAPID_PRIVATE_KEY``).

The public key is the base64url uncompressed P-256 point the browser takes as
``applicationServerKey``; the private key is the base64url raw scalar pywebpush reads.
Nothing is written anywhere: copy the two lines into the environment.
"""

from cryptography.hazmat.primitives import serialization
from django.core.management.base import BaseCommand
from py_vapid import Vapid, b64urlencode


def generate_vapid_keypair() -> tuple[str, str]:
    """Return ``(public_key, private_key)``, both base64url without padding."""
    vapid = Vapid()
    vapid.generate_keys()
    public = vapid.public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    private = vapid.private_key.private_numbers().private_value.to_bytes(32, "big")
    return b64urlencode(public), b64urlencode(private)


class Command(BaseCommand):
    help = "Generate a VAPID key pair for web push and print it as env lines."

    def handle(self, *args, **options):
        public_key, private_key = generate_vapid_keypair()
        self.stdout.write(f"VAPID_PUBLIC_KEY={public_key}")
        self.stdout.write(f"VAPID_PRIVATE_KEY={private_key}")
        self.stdout.write(
            "VAPID_SUBJECT=mailto:you@example.com  # optional; defaults to DEFAULT_FROM_EMAIL"
        )
