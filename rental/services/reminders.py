"""Pickup reminders, sent once per booking the day before pickup by the scheduler."""
import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from ..models import Booking
from .notifications import notify

logger = logging.getLogger(__name__)


def send_pickup_reminders(now=None):
    """Remind renters of confirmed bookings that start tomorrow. Idempotent via reminder_sent_at."""
    now = now or timezone.now()
    tomorrow = timezone.localdate(now) + timedelta(days=1)
    with transaction.atomic():
        due = list(Booking.objects.select_for_update(skip_locked=True).filter(
            status=Booking.Status.CONFIRMED, start_date=tomorrow, reminder_sent_at__isnull=True,
        ))
        for booking in due:
            booking.reminder_sent_at = now
            booking.save(update_fields=["reminder_sent_at"])
            notify("pickup_reminder", booking)
    logger.info("pickup_reminders_queued count=%s", len(due))
    return [booking.pk for booking in due]
