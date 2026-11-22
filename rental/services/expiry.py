"""Turn stale bookings into EXPIRED rows so the database matches what the API already shows.

Rules (the same ones `Booking.display_status` applies on read):

* A PENDING request expires once its 24-hour response window (`expires_at`) has passed,
  or once its pickup time has passed, whichever comes first. The owner never answered.
* A CONFIRMED booking that was never picked up expires once its RETURN time has passed, not
  its pickup time. Owners may record a late pickup at any point inside the booked window, so
  the booking only becomes a no-show once that whole window is over.

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
from .notifications import notify

logger = logging.getLogger(__name__)

REQUEST_TIMED_OUT = "The owner did not respond before the request expired."
PICKUP_DATE_PASSED = "The pickup time passed before the owner responded."
NO_SHOW = "The rental window ended without a recorded pickup."


def stale_bookings(now=None):
    now = now or timezone.now()
    today = timezone.localdate(now)
    clock = timezone.localtime(now).time()
    pickup_passed = Q(start_date__lt=today) | Q(start_date=today, pickup_time__lte=clock)
    return_passed = Q(end_date__lt=today) | Q(end_date=today, return_time__lte=clock)
    return Booking.objects.filter(
        Q(status=Booking.Status.PENDING) & (Q(expires_at__lte=now) | pickup_passed)
        | Q(status=Booking.Status.CONFIRMED, picked_up_at__isnull=True) & return_passed
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
                note = reason
                if previous == Booking.Status.CONFIRMED:
                    # A no-show keeps the rental charge, but the deposit was never at risk.
                    from ..payments.service import refund_deposit
                    if deposit := refund_deposit(booking):
                        note = f"{reason} Deposit of ₹{deposit} refunded."
                record_event(booking, previous, Booking.Status.EXPIRED, note=note, at=now)
                notify("request_expired" if previous == Booking.Status.PENDING else "booking_expired", booking,
                       reason=note)
                expired.append(booking.pk)
        if len(batch) < batch_size:
            break
    logger.info("bookings_expired count=%s ids=%s", len(expired), expired[:50])
    return expired

