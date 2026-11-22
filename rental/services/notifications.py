"""Booking emails through a persistent outbox.

`notify()` renders the message and stores it in `NotificationOutbox` inside the current
transaction, so an email exists if and only if the booking change committed. Delivery runs
after commit (`deliver`), and the scheduler's `send_notifications` job retries anything
still pending with backoff, so a mail server outage delays emails instead of losing them.
Each kind has a plain-text and an HTML template under `templates/rental/emails/`.
"""
import logging
from datetime import timedelta

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import IntegrityError, transaction
from django.template.loader import render_to_string
from django.utils import timezone

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
RETRY_DELAYS = [timedelta(minutes=m) for m in (1, 5, 15, 60, 240)]
MAX_ATTEMPTS = len(RETRY_DELAYS) + 1


def notify(kind, booking, dedupe_key=None, **extra):
    """Render and queue one email about `booking`. Returns the outbox row, or None if skipped.

    Enqueueing the same `dedupe_key` twice keeps the first message only.
    """
    from ..models import Booking, NotificationOutbox

    if kind not in MESSAGES:
        raise ValueError(f"Unknown notification {kind}")
    booking = Booking.objects.select_related("vehicle__owner__user", "user__user").get(pk=booking.pk)
    role, subject = MESSAGES[kind]
    profile = booking.user if role == "renter" else booking.vehicle.owner
    recipient = getattr(getattr(profile, "user", None), "email", "")
    if not recipient:
        logger.info("notification_skipped kind=%s booking_id=%s reason=no_email", kind, booking.pk)
        return None
    context = {
        "booking": booking, "vehicle": booking.vehicle, "recipient_name": profile.name,
        "renter_name": booking.contact_name or booking.user.name, "site_url": settings.SITE_URL.rstrip("/"),
        **extra,
    }
    try:
        with transaction.atomic():
            message = NotificationOutbox.objects.create(
                kind=kind, booking=booking, dedupe_key=dedupe_key or f"{kind}:{booking.pk}", to=recipient,
                subject=subject.format(vehicle=booking.vehicle.name),
                body_text=render_to_string(f"rental/emails/{kind}.txt", context),
                body_html=render_to_string(f"rental/emails/{kind}.html", context),
            )
    except IntegrityError:
        logger.info("notification_duplicate kind=%s booking_id=%s", kind, booking.pk)
        return None
    transaction.on_commit(lambda: deliver(message.pk))
    return message


def deliver(message_id, now=None):
    """Try to send one due message. Returns True when it was sent by this call."""
    from ..models import Booking, NotificationOutbox

    now = now or timezone.now()
    with transaction.atomic():
        # The row lock is held while sending, so two workers never send the same message at once.
        message = (NotificationOutbox.objects.select_for_update(skip_locked=True)
                   .filter(pk=message_id, status=NotificationOutbox.Status.PENDING, next_attempt_at__lte=now).first())
        if message is None:
            return False
        message.attempts += 1
        email = EmailMultiAlternatives(subject=message.subject, body=message.body_text, to=[message.to])
        if message.body_html:
            email.attach_alternative(message.body_html, "text/html")
        try:
            email.send()
        except Exception as error:  # any transport error: retry later
            give_up = message.attempts >= MAX_ATTEMPTS
            message.status = NotificationOutbox.Status.FAILED if give_up else NotificationOutbox.Status.PENDING
            message.next_attempt_at = now + RETRY_DELAYS[min(message.attempts, len(RETRY_DELAYS)) - 1]
            message.last_error = f"{type(error).__name__}: {error}"[:255]
            message.save(update_fields=["status", "attempts", "next_attempt_at", "last_error"])
            logger.exception("notification_failed kind=%s booking_id=%s attempt=%s give_up=%s",
                             message.kind, message.booking_id, message.attempts, give_up)
            if give_up:
                logger.error("notification_gave_up outbox_id=%s kind=%s booking_id=%s: needs attention",
                             message.pk, message.kind, message.booking_id)
            return False
        message.status, message.sent_at, message.last_error = NotificationOutbox.Status.SENT, now, ""
        message.save(update_fields=["status", "attempts", "sent_at", "last_error"])
        if message.kind == "pickup_reminder" and message.booking_id:
            # Only a delivered reminder counts as sent; a failed one stays due for retry.
            Booking.objects.filter(pk=message.booking_id).update(reminder_sent_at=now)
    logger.info("notification_sent kind=%s booking_id=%s attempt=%s", message.kind, message.booking_id, message.attempts)
    return True


def deliver_due(now=None):
    from ..models import NotificationOutbox

    now = now or timezone.now()
    due = NotificationOutbox.objects.filter(status=NotificationOutbox.Status.PENDING, next_attempt_at__lte=now)
    return sum(deliver(pk, now) for pk in due.order_by("next_attempt_at", "pk").values_list("pk", flat=True))


def retry_failed(ids=None):
    """Put permanently failed emails back in the queue with a fresh set of attempts."""
    from ..models import NotificationOutbox

    failed = NotificationOutbox.objects.filter(status=NotificationOutbox.Status.FAILED)
    if ids is not None:
        failed = failed.filter(pk__in=ids)
    count = failed.update(status=NotificationOutbox.Status.PENDING, attempts=0, next_attempt_at=timezone.now())
    logger.warning("notifications_requeued count=%s", count)
    return count
