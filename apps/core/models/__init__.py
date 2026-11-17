"""Core app models, one module per owning group (feature-revamp seams).

- ``logs``, ``settings``, ``celery``: G6 Admin
- ``notifications``: G4 Notifications

Import models from ``apps.core.models`` as before. A group adds a model to its own
module and to that module's ``__all__``; this file never needs to change.
"""

from .celery import *  # noqa: F403
from .logs import *  # noqa: F403
from .notifications import *  # noqa: F403
from .settings import *  # noqa: F403
