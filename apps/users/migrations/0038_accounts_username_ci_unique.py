"""One account per username, whatever its case (G1 P1-2, A13)."""

import django.db.models.functions.text
from django.db import migrations, models
from django.db.models import Count
from django.db.models.functions import Lower


def refuse_duplicate_usernames(apps, schema_editor):
    """Stop with instructions instead of a bare IntegrityError (mirrors 0037).

    Accounts whose usernames differ only by case cannot be merged automatically:
    an operator has to decide which one keeps the name.
    """
    User = apps.get_model("users", "CustomUser")
    duplicates = (
        User.objects.annotate(username_ci=Lower("username"))
        .values("username_ci")
        .annotate(n=Count("id"))
        .filter(n__gt=1)
    )
    if not duplicates.exists():
        return

    lines = []
    for row in duplicates[:20]:
        usernames = User.objects.annotate(username_ci=Lower("username")).filter(
            username_ci=row["username_ci"]
        )
        lines.append(f"  {row['username_ci']}: {', '.join(u.username for u in usernames)}")
    raise RuntimeError(
        f"{duplicates.count()} username(s) belong to more than one account "
        "(ignoring case). Rename all but one of each, then migrate again:\n" + "\n".join(lines)
    )


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0037_customuser_email_ci_unique"),
    ]

    operations = [
        migrations.RunPython(refuse_duplicate_usernames, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="customuser",
            constraint=models.UniqueConstraint(
                django.db.models.functions.text.Lower("username"),
                name="users_customuser_username_ci_unique",
            ),
        ),
    ]
