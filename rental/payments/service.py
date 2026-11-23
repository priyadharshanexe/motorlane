"""Payment rules.

* After the owner approves, the renter pays the rental charge plus the refundable deposit.
  Pickup is refused until that payment is complete.
* Cancelling a confirmed, paid booking refunds everything when it happens at least
  `RENTAL_FREE_CANCELLATION_HOURS` before pickup. Later than that, a fee of
  `RENTAL_CANCELLATION_FEE_PERCENT` of the rental charge is kept; the deposit is always refunded.
* The deposit is refunded when the owner records the return.
* Refunds are durable intents: recorded with the booking change, sent to the provider after
  commit with a stable idempotency key, retried with backoff, and reconciled by the scheduler.

Lock order. Every path that locks more than one of these rows takes them in this order:
vehicle -> booking -> payment -> refund intent. Booking transitions lock the vehicle, then the
booking, then (for refunds) the payment; checkout locks the booking, then the payment; the
webhook resolves the booking from the order without locking, then locks booking, then payment.
Taking them in one global order means two of these paths can wait for each other but never
deadlock (MySQL error 1213).
* Webhooks are verified by signature and recorded by provider event id, so a redelivered
  event is acknowledged without being applied twice.
"""
import json
import logging
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from ..models import Booking, Payment, RefundIntent, WebhookEvent
from ..services.events import record_paid, record_refund_issued, record_refunded
from ..services.pricing import money
from .providers import PaymentError, get_provider

logger = logging.getLogger(__name__)


def start_payment(booking):
    """Create (once) the provider order for a confirmed booking. Call with the booking row locked."""
    if booking.display_status != Booking.Status.CONFIRMED:
        raise ValidationError("Payment opens once the owner confirms the booking.")
    existing = Payment.objects.filter(booking=booking).first()
    if existing and existing.is_paid:
        raise ValidationError("This booking is already paid.")
    if existing and existing.status in (Payment.Status.CREATED, Payment.Status.FAILED):
        # Reuse the provider order: a late success on it must still find this payment.
        if existing.status == Payment.Status.FAILED:
            existing.status = Payment.Status.CREATED
            existing.save(update_fields=["status"])
        return existing
    provider = get_provider()
    payment = existing or Payment(booking=booking)
    payment.provider, payment.status, payment.currency = provider.name, Payment.Status.CREATED, settings.PAYMENT_CURRENCY
    payment.amount, payment.deposit = booking.total_price + booking.deposit_amount, booking.deposit_amount
    try:
        payment.order_id = provider.create_order(payment)
    except PaymentError as error:
        raise ValidationError(str(error)) from error
    payment.save()
    logger.info("payment_order_created booking_id=%s provider=%s", booking.pk, provider.name)
    return payment


PAYABLE = (Booking.Status.CONFIRMED, Booking.Status.IN_PROGRESS, Booking.Status.RETURNED)


def mark_paid(payment, payment_id):
    """Record a captured payment. Call with the payment row locked.

    Money can arrive after the booking stopped needing it (the renter cancelled or the request
    expired while a checkout window was open, or a webhook arrives late). The payment is still
    recorded, because the money did move, and it is refunded in full straight away.
    """
    if payment.is_paid:
        return False
    payment.payment_id = payment_id
    payment.status = Payment.Status.PAID
    payment.paid_at = timezone.now()
    payment.save(update_fields=["payment_id", "status", "paid_at"])
    logger.info("payment_completed booking_id=%s provider=%s", payment.booking_id, payment.provider)
    booking = Booking.objects.select_for_update().get(pk=payment.booking_id)
    record_paid(payment, booking)
    if booking.status not in PAYABLE:
        logger.warning("payment_after_close booking_id=%s status=%s: refunding in full", booking.pk, booking.status)
        issue_refund(payment, payment.amount - payment.refunded_amount, "booking_closed")
    return True


def confirm_checkout(booking, order_id, payment_id, signature):
    payment = Payment.objects.select_for_update().filter(booking=booking, order_id=order_id).first()
    if payment is None:
        raise ValidationError("Unknown payment order for this booking.")
    if not get_provider().verify_checkout(order_id, payment_id, signature):
        raise ValidationError("The payment signature is not valid.")
    mark_paid(payment, payment_id)
    return payment


def payment_settled(booking):
    """Whether pickup may go ahead as far as payment is concerned."""
    if not booking.payment_required:
        return True
    payment = Payment.objects.filter(booking=booking).first()
    return bool(payment and payment.is_paid)


def cancellation_terms(booking, now=None):
    """(fee, refund) if this booking were cancelled now."""
    payment = Payment.objects.filter(booking=booking).first()
    if not payment or not payment.is_paid:
        return Decimal("0.00"), Decimal("0.00")
    now = now or timezone.now()
    late = booking.pickup_at - now < timedelta(hours=settings.RENTAL_FREE_CANCELLATION_HOURS)
    fee = money(booking.total_price * settings.RENTAL_CANCELLATION_FEE_PERCENT / 100) if late else Decimal("0.00")
    return fee, payment.amount - payment.refunded_amount - fee


REFUND_RETRY_DELAYS = [timedelta(minutes=m) for m in (1, 5, 15, 60, 240)]
MAX_REFUND_ATTEMPTS = len(REFUND_RETRY_DELAYS) + 1
PROVIDER_STATUS = {"processed": RefundIntent.Status.SUCCEEDED, "pending": RefundIntent.Status.SENT,
                   "failed": RefundIntent.Status.FAILED}


def issue_refund(payment, amount, reason):
    """Record a refund we owe. Call inside the booking transaction; the provider is called after commit.

    The intent and the payment's refunded total change together with the booking, so a rollback
    leaves nothing behind, and a commit always leaves a durable intent for the scheduler to finish.
    """
    amount = money(amount)
    if amount <= 0:
        return None
    intent = RefundIntent.objects.create(
        payment=payment, amount=amount, reason=reason,
        idempotency_key=f"motorlane-refund-{payment.pk}-{reason}",
    )
    payment.refunded_amount += amount
    payment.status = (Payment.Status.REFUNDED if payment.refunded_amount >= payment.amount
                      else Payment.Status.PARTIALLY_REFUNDED)
    payment.save(update_fields=["refunded_amount", "status", "cancellation_fee"])
    # After commit, so the stop follows the status change that caused it (cancel, return).
    transaction.on_commit(lambda: record_refund_issued(intent, Booking.objects.get(pk=payment.booking_id)))
    logger.info("refund_recorded booking_id=%s amount=%s reason=%s", payment.booking_id, amount, reason)
    transaction.on_commit(lambda: process_refund(intent.pk))
    return intent


def process_refund(intent_id, now=None):
    """Send one due refund to the provider. Safe to call any number of times, from any process."""
    now = now or timezone.now()
    with transaction.atomic():
        intent = (RefundIntent.objects.select_for_update(skip_locked=True).select_related("payment")
                  .filter(pk=intent_id, status=RefundIntent.Status.PENDING, next_attempt_at__lte=now).first())
        if intent is None:
            return None
        intent.attempts += 1
        # Claim the attempt before calling out, so a concurrent worker skips it until the backoff passes.
        intent.next_attempt_at = now + REFUND_RETRY_DELAYS[min(intent.attempts, len(REFUND_RETRY_DELAYS)) - 1]
        intent.save(update_fields=["attempts", "next_attempt_at", "updated_at"])
    provider = get_provider()
    try:
        # After a crash or timeout the provider may already have the refund; never ask twice.
        found = provider.find_refund(intent.payment, intent.idempotency_key) if intent.attempts > 1 else None
        refund_id, provider_status = found or provider.refund(intent.payment, intent.amount, intent.idempotency_key)
    except PaymentError as error:
        give_up = intent.attempts >= MAX_REFUND_ATTEMPTS
        RefundIntent.objects.filter(pk=intent.pk).update(
            last_error=str(error)[:255], status=RefundIntent.Status.FAILED if give_up else RefundIntent.Status.PENDING,
            updated_at=timezone.now())
        log = logger.error if give_up else logger.warning
        log("refund_attempt_failed intent_id=%s attempt=%s give_up=%s", intent.pk, intent.attempts, give_up)
        if give_up:
            logger.error("refund_gave_up intent_id=%s booking_id=%s amount=%s: needs attention",
                         intent.pk, intent.payment.booking_id, intent.amount)
        return None
    status = PROVIDER_STATUS.get(provider_status, RefundIntent.Status.SENT)
    RefundIntent.objects.filter(pk=intent.pk).update(provider_refund_id=refund_id, status=status, last_error="",
                                                     updated_at=timezone.now())
    logger.info("refund_sent intent_id=%s provider_refund_id=%s status=%s", intent.pk, refund_id, status)
    record_refunded(intent.pk)
    return refund_id


def process_due_refunds(now=None):
    now = now or timezone.now()
    due = RefundIntent.objects.filter(status=RefundIntent.Status.PENDING, next_attempt_at__lte=now)
    return [pk for pk in due.values_list("pk", flat=True) if process_refund(pk, now)]


def reconcile_refunds(now=None):
    """Bring sent intents up to date with the provider, and recover pending ones it already has.

    Returns {"succeeded": n, "failed": n, "recovered": n}.
    """
    provider = get_provider()
    counts = {"succeeded": 0, "failed": 0, "recovered": 0}
    for intent in RefundIntent.objects.filter(status=RefundIntent.Status.SENT).exclude(provider_refund_id=None):
        try:
            status = PROVIDER_STATUS.get(provider.refund_status(intent.provider_refund_id), RefundIntent.Status.SENT)
        except PaymentError:
            continue
        if status != RefundIntent.Status.SENT:
            RefundIntent.objects.filter(pk=intent.pk).update(status=status, updated_at=timezone.now())
            record_refunded(intent.pk)
            counts[status] += 1
    for intent in RefundIntent.objects.filter(status=RefundIntent.Status.PENDING, attempts__gt=0).select_related("payment"):
        try:
            found = provider.find_refund(intent.payment, intent.idempotency_key)
        except PaymentError:
            continue
        if found:
            refund_id, provider_status = found
            RefundIntent.objects.filter(pk=intent.pk).update(
                provider_refund_id=refund_id, status=PROVIDER_STATUS.get(provider_status, RefundIntent.Status.SENT),
                updated_at=timezone.now())
            record_refunded(intent.pk)
            counts["recovered"] += 1
    logger.info("refunds_reconciled %s", " ".join(f"{k}={v}" for k, v in counts.items()))
    return counts


def refund_cancellation(booking):
    """Refund a cancelled booking per the policy. Returns (fee, refund)."""
    payment = Payment.objects.select_for_update().filter(booking=booking).first()
    fee, refund = cancellation_terms(booking)
    if payment and payment.is_paid:
        payment.cancellation_fee = fee
        issue_refund(payment, refund, "cancellation")
    return fee, refund


def refund_deposit(booking):
    payment = Payment.objects.select_for_update().filter(booking=booking).first()
    if not payment or not payment.is_paid or not payment.deposit:
        return Decimal("0.00")
    already = sum((r.amount for r in payment.refunds.filter(reason="deposit")), Decimal("0"))
    if already:
        return Decimal("0.00")
    issue_refund(payment, payment.deposit, "deposit")
    return payment.deposit


def handle_webhook(body, signature, event_id):
    """Apply one verified provider event. Returns "processed", "duplicate" or "ignored"."""
    provider = get_provider()
    if not provider.verify_webhook(body, signature):
        raise PermissionError("Invalid webhook signature.")
    payload = json.loads(body)
    if not isinstance(payload, dict):
        raise ValueError("Webhook body must be a JSON object.")
    event_type = payload.get("event", "")
    event_id = event_id or payload.get("id", "")
    if not event_id:
        raise ValueError("Missing event id.")
    try:
        with transaction.atomic():
            WebhookEvent.objects.create(provider=provider.name, event_id=event_id, event_type=event_type, payload=payload)
            applied = apply_event(event_type, payload.get("payload", {}))
    except IntegrityError:
        logger.info("webhook_duplicate provider=%s event_id=%s", provider.name, event_id)
        return "duplicate"
    logger.info("webhook_received provider=%s event_id=%s type=%s applied=%s", provider.name, event_id, event_type, applied)
    return "processed" if applied else "ignored"


def lock_payment_by_order(order_id):
    """Lock the booking, then the payment, for a provider order (the global lock order).

    The booking id is read without a lock first; locking the payment first would invert the
    order that booking transitions use and could deadlock against a concurrent cancellation.
    """
    row = Payment.objects.filter(order_id=order_id).values_list("pk", "booking_id").first()
    if row is None or not order_id:
        return None
    payment_id, booking_id = row
    Booking.objects.select_for_update().get(pk=booking_id)
    return Payment.objects.select_for_update().get(pk=payment_id)


def apply_event(event_type, data):
    if event_type in ("payment.captured", "order.paid"):
        entity = data.get("payment", {}).get("entity", {})
        payment = lock_payment_by_order(entity.get("order_id", ""))
        if payment:
            mark_paid(payment, entity.get("id", ""))
            return True
    elif event_type == "payment.failed":
        entity = data.get("payment", {}).get("entity", {})
        updated = Payment.objects.filter(order_id=entity.get("order_id", ""), status=Payment.Status.CREATED)
        return bool(updated.update(status=Payment.Status.FAILED))
    elif event_type == "refund.processed":
        entity = data.get("refund", {}).get("entity", {})
        intents = RefundIntent.objects.filter(provider_refund_id=entity.get("id", ""))
        ids = list(intents.values_list("pk", flat=True))
        updated = intents.update(status=RefundIntent.Status.SUCCEEDED)
        for pk in ids:
            record_refunded(pk)
        return bool(updated)
    return False


def retry_failed_refunds(ids=None):
    """Give failed refund intents a fresh set of attempts (after a person fixed the cause).

    The idempotency key is unchanged, so a refund the provider did make is found, not repeated.
    """
    failed = RefundIntent.objects.filter(status=RefundIntent.Status.FAILED)
    if ids is not None:
        failed = failed.filter(pk__in=ids)
    count = failed.update(status=RefundIntent.Status.PENDING, attempts=1, next_attempt_at=timezone.now(),
                          updated_at=timezone.now())
    logger.warning("refunds_requeued count=%s", count)
    return count
