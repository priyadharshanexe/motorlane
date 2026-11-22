"""Pickup reminders, queued once per booking the day before pickup by the scheduler.

The outbox's dedupe key makes queueing idempotent; `reminder_sent_at` is set by the outbox
only after the email is actually delivered, so a failed reminder keeps being retried.
"""
import logging
from datetime import timedelta

from django.utils import timezone

from ..models import Booking
from .notifications import notify

logger = logging.getLogger(__name__)


def send_pickup_reminders(now=None):
    """Queue reminders for confirmed bookings that start tomorrow. Returns the newly queued booking ids."""
    now = now or timezone.now()
    tomorrow = timezone.localdate(now) + timedelta(days=1)
    due = Booking.objects.filter(status=Booking.Status.CONFIRMED, start_date=tomorrow, reminder_sent_at__isnull=True,
                                 ).exclude(notifications__kind="pickup_reminder")
    queued = [booking.pk for booking in due if notify("pickup_reminder", booking)]
    logger.info("pickup_reminders_queued count=%s", len(queued))
    return queued
