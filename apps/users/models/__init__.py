"""Users app models, one module per owning group (feature-revamp seams).

- ``accounts``: G1 Accounts & auth
- ``lists``: G3 Lists & AniList sync
- ``social``, ``badges``: G5 Community

Import models from ``apps.users.models`` as before. A group adds a model to its own
module and to that module's ``__all__``; this file never needs to change.
"""

from .accounts import *  # noqa: F403
from .badges import *  # noqa: F403
from .lists import *  # noqa: F403
from .social import *  # noqa: F403
