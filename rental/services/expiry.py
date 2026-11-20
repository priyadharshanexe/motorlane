"""Turn stale bookings into EXPIRED rows so the database matches what the API already shows.

Rules (the same ones `Booking.display_status` applies on read):

* A PENDING request expires once its 24-hour response window (`expires_at`) has passed,
  or once its pickup date is in the past, whichever comes first. The owner never answered.
* A CONFIRMED booking that was never picked up expires the day after its END date, not its
  start date. Owners may record a late pickup at any point inside the booked window, so the
  booking only becomes a no-show once that whole window is over.

IN_PROGRESS rentals are never expired: the vehicle is physically with the renter, and an
overdue return is surfaced as `overdue` instead.

The job is idempotent: it only selects rows still in PENDING/CONFIRMED and locks them, so
running it twice, or in two containers at once, expires each booking exactly once.
"""
import logging

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from ..models import Booking
from .events import record_event

logger = logging.getLogger(__name__)

REQUEST_TIMED_OUT = "The owner did not respond before the request expired."
PICKUP_DATE_PASSED = "The pickup date passed before the owner responded."
NO_SHOW = "The rental window ended without a recorded pickup."


def stale_bookings(now=None):
    now = now or timezone.now()
    today = timezone.localdate(now)
    return Booking.objects.filter(
        Q(status=Booking.Status.PENDING) & (Q(expires_at__lte=now) | Q(start_date__lt=today))
        | Q(status=Booking.Status.CONFIRMED, end_date__lt=today, picked_up_at__isnull=True)
    )


def expiry_reason(booking, now):
    if booking.status == Booking.Status.CONFIRMED:
        return NO_SHOW
    if booking.expires_at and booking.expires_at <= now:
        return REQUEST_TIMED_OUT
    return PICKUP_DATE_PASSED


def expire_bookings(now=None, batch_size=200):
    """Expire every stale booking. Returns the ids that changed."""
    now = now or timezone.now()
    expired = []
    while True:
        with transaction.atomic():
            batch = list(stale_bookings(now).select_for_update(skip_locked=True).order_by("pk")[:batch_size])
            for booking in batch:
                previous, reason = booking.status, expiry_reason(booking, now)
                booking.status = Booking.Status.EXPIRED
                booking.status_changed_at = now
                booking.status_changed_by = None
                booking.save(update_fields=["status", "status_changed_at", "status_changed_by"])
                record_event(booking, previous, Booking.Status.EXPIRED, note=reason, at=now)
                expired.append(booking.pk)
        if len(batch) < batch_size:
            break
    logger.info("bookings_expired count=%s ids=%s", len(expired), expired[:50])
    return expired

