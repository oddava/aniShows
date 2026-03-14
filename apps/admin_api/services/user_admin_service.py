from dataclasses import dataclass


class AdminUserActionError(Exception):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(slots=True)
class AdminUserActionResult:
    payload: dict
    status_code: int


def toggle_user_active(target_user, actor) -> AdminUserActionResult:
    if target_user.id == actor.id:
        raise AdminUserActionError("Cannot deactivate your own account.", 400)

    if target_user.is_superuser and not actor.is_superuser:
        raise AdminUserActionError("Cannot modify superuser status.", 403)

    target_user.is_active = not target_user.is_active
    target_user.save(update_fields=["is_active"])

    return AdminUserActionResult(
        payload={
            "id": target_user.id,
            "username": target_user.username,
            "is_active": target_user.is_active,
            "message": (
                f"User {'activated' if target_user.is_active else 'deactivated'} successfully."
            ),
        },
        status_code=200,
    )


def toggle_user_staff(target_user, actor) -> AdminUserActionResult:
    if not actor.is_superuser:
        raise AdminUserActionError("Only superusers can modify staff status.", 403)

    if target_user.id == actor.id:
        raise AdminUserActionError("Cannot modify your own staff status.", 400)

    target_user.is_staff = not target_user.is_staff
    target_user.save(update_fields=["is_staff"])

    return AdminUserActionResult(
        payload={
            "id": target_user.id,
            "username": target_user.username,
            "is_staff": target_user.is_staff,
            "message": (
                f"User {'promoted to' if target_user.is_staff else 'removed from'} staff."
            ),
        },
        status_code=200,
    )


def delete_user_account(target_user, actor) -> AdminUserActionResult:
    if not actor.is_superuser:
        raise AdminUserActionError("Only superusers can delete users.", 403)

    if target_user.id == actor.id:
        raise AdminUserActionError("Cannot delete your own account through admin.", 400)

    if target_user.is_superuser:
        raise AdminUserActionError("Cannot delete superuser accounts.", 403)

    username = target_user.username
    target_user.delete()

    return AdminUserActionResult(
        payload={"message": f"User '{username}' deleted successfully."},
        status_code=200,
    )
