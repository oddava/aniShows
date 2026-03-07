import os
import django
import sys

# Set up Django environment
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "root.settings.test")

# Patch database to use sqlite before setup
from django.conf import settings

if not settings.configured:
    # Need to setup env somehow, or just set env var before django.setup()
    pass

# actually better to just inject a sqlite database in settings
os.environ["DATABASE_URL"] = "sqlite:///test.db"
django.setup()

from django.core.management import call_command

call_command("migrate", verbosity=0)

import logging

l = logging.getLogger("django.db.backends")
l.setLevel(logging.DEBUG)
l.addHandler(logging.StreamHandler())

from django.test import RequestFactory
from django.contrib.auth import get_user_model
from apps.users.models import UserFollow
from apps.users.views.follows import FollowViewSet

User = get_user_model()

# Create a test environment
User.objects.all().delete()
UserFollow.objects.all().delete()

user_a = User.objects.create_user(username="usera", password="password")
user_b = User.objects.create_user(username="userb", password="password")
user_c = User.objects.create_user(username="userc", password="password")

# a follows b, b follows a (mutual)
UserFollow.objects.create(follower=user_a, following=user_b)
UserFollow.objects.create(follower=user_b, following=user_a)

# a follows c, c does not follow a (not mutual)
UserFollow.objects.create(follower=user_a, following=user_c)

# c follows b, b does not follow c
UserFollow.objects.create(follower=user_c, following=user_b)

user_d = User.objects.create_user(username="userd", password="password")

# a follows d, d follows a (mutual)
UserFollow.objects.create(follower=user_a, following=user_d)
UserFollow.objects.create(follower=user_d, following=user_a)

factory = RequestFactory()
request = factory.get("/mutuals/usera")
request.user = user_a  # authenticated request as user_a

view = FollowViewSet.as_view({"get": "mutuals"})
response = view(request, username="usera")

print(f"Status Code: {response.status_code}")
if response.status_code == 200:
    data = response.data
    results = data.get("results", data)
print("Mutuals for usera:")
if response.status_code == 200:
    data = response.data
    results = data.get("results", data)
    for item in results:
        print(f" - {item['user']['username']}")
