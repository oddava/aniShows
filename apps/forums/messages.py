"""User-facing forum validation messages, shared by the serializers and the write services.

The services re-check thread and parent state after taking their row locks (a lock or
removal can land between validation and the write), so both layers raise the same text.
"""

THREAD_NOT_FOUND = "Thread not found."
THREAD_LOCKED = "This thread is locked."
TOO_DEEP = "This conversation is too deep to reply here. Reply higher up."
PARENT_REMOVED = "This reply was removed and can't be replied to."
PARENT_NOT_FOUND = "The reply you answered no longer exists."
POST_REMOVED = "A removed reply can't be edited."
