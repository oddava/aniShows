"""G6: new AuditLog actions (choices only, no schema change) and the entity index.

Reserved number 0012 (overview section 7). Depends on 0009 on the G6 branch; the
integrator re-points it to G4's 0011 at rebase (no rename).
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0009_notification_review_like_and_index"),
    ]

    operations = [
        migrations.AlterField(
            model_name="auditlog",
            name="action",
            field=models.CharField(
                choices=[
                    ("CREATE", "Create"),
                    ("UPDATE", "Update"),
                    ("DELETE", "Delete"),
                    ("LOGIN", "Login"),
                    ("LOGOUT", "Logout"),
                    ("EXPORT", "Export"),
                    ("BULK_ACTION", "Bulk Action"),
                    ("SUSPEND", "Suspend"),
                    ("RESTORE", "Restore"),
                    ("RESOLVE", "Resolve"),
                    ("DISMISS", "Dismiss"),
                    ("TRIGGER", "Trigger"),
                    ("CONTROL", "Control"),
                ],
                max_length=20,
            ),
        ),
        migrations.AddIndex(
            model_name="auditlog",
            index=models.Index(
                fields=["entity_type", "entity_id", "-timestamp"], name="core_audit_entity_idx"
            ),
        ),
    ]
