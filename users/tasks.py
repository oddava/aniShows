from celery import shared_task
from django.utils import timezone
from django.contrib.auth import get_user_model
from datetime import timedelta
import logging

logger = logging.getLogger(__name__)
User = get_user_model()

@shared_task
def cleanup_unverified_accounts():
    """
    Delete accounts that have not verified their email within 7 days.
    """
    logger.info("Starting unverified accounts cleanup")
    
    threshold_date = timezone.now() - timedelta(days=7)
    
    # Find users who are not verified and joined before threshold
    # Note: We're using the email_verified field on UserProfile
    
    # We can filter users whose profile has email_verified=False
    # AND date_joined < threshold_date
    
    users_to_delete = User.objects.filter(
        userprofile__email_verified=False,
        date_joined__lt=threshold_date
    )
    
    count = users_to_delete.count()
    
    if count > 0:
        # bulk delete doesn't call delete() method on instances, so signals might not fire
        # but standard User delete is usually safe with cascades.
        # However, for safety and logging, we might want to iterate if count is small
        # or just delete.
        
        users_to_delete.delete()
        logger.info(f"Deleted {count} unverified accounts created before {threshold_date}")
    else:
        logger.info("No unverified accounts to clean up")
    
    return f"Deleted {count} accounts"
