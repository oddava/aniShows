"""Back-compat re-exports for the pre-split ``users.py`` serializer module.

The serializers now live in one module per owning group: ``accounts`` (G1),
``recommendations`` (G2), ``lists`` (G3), ``notifications`` (G4) and
``badges``, ``favorites``, ``social`` (G5). Import from those modules; this shim
star-imports their ``__all__`` so it never needs editing.
"""

from .accounts import *  # noqa: F403
from .badges import *  # noqa: F403
from .favorites import *  # noqa: F403
from .lists import *  # noqa: F403
from .notifications import *  # noqa: F403
from .recommendations import *  # noqa: F403
from .social import *  # noqa: F403
