"""Booking emails, sent through the configured email backend (console in development).

Every message is queued with `transaction.on_commit`, so nothing is sent for a change that
rolls back, and a mail server failure never undoes a booking change: it is logged instead.
Each kind has a plain-text and an HTML template under `templates/rental/emails/`.
"""
import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)

# kind: (recipient role, subject template)
MESSAGES = {
    "request_received": ("owner", "New rental request for your {vehicle}"),
    "request_approved": ("renter", "Your {vehicle} rental is confirmed"),
    "request_rejected": ("renter", "Your {vehicle} request was declined"),
    "booking_cancelled": ("renter", "Your {vehicle} booking is cancelled"),
    "booking_cancelled_owner": ("owner", "A {vehicle} booking was cancelled"),
    "pickup_reminder": ("renter", "Reminder: pick up your {vehicle} tomorrow"),
    "return_received": ("renter", "We received your {vehicle} back"),
    "review_request": ("renter", "How was your {vehicle} rental?"),
}


def notify(kind, booking, **extra):
    """Queue one email about `booking`, sent after the current transaction commits."""
    if kind not in MESSAGES:
        raise ValueError(f"Unknown notification {kind}")
    booking_id = booking.pk
    transaction.on_commit(lambda: send_now(kind, booking_id, **extra))


def send_now(kind, booking_id, **extra):
    from ..models import Booking

    booking = Booking.objects.select_related("vehicle__owner__user", "user__user").get(pk=booking_id)
    role, subject = MESSAGES[kind]
    profile = booking.user if role == "renter" else booking.vehicle.owner
    recipient = getattr(getattr(profile, "user", None), "email", "")
    if not recipient:
        logger.info("notification_skipped kind=%s booking_id=%s reason=no_email", kind, booking_id)
        return False
    context = {
        "booking": booking, "vehicle": booking.vehicle, "recipient_name": profile.name,
        "renter_name": booking.contact_name or booking.user.name, "site_url": settings.SITE_URL.rstrip("/"),
        **extra,
    }
    message = EmailMultiAlternatives(
        subject=subject.format(vehicle=booking.vehicle.name),
        body=render_to_string(f"rental/emails/{kind}.txt", context),
        to=[recipient],
    )
    message.attach_alternative(render_to_string(f"rental/emails/{kind}.html", context), "text/html")
    try:
        message.send()
    except Exception:
        logger.exception("notification_failed kind=%s booking_id=%s", kind, booking_id)
        return False
    logger.info("notification_sent kind=%s booking_id=%s", kind, booking_id)
    return True
