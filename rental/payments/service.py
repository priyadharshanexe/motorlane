"""Payment rules.

* After the owner approves, the renter pays the rental charge plus the refundable deposit.
  Pickup is refused until that payment is complete.
* Cancelling a confirmed, paid booking refunds everything when it happens at least
  `RENTAL_FREE_CANCELLATION_HOURS` before pickup. Later than that, a fee of
  `RENTAL_CANCELLATION_FEE_PERCENT` of the rental charge is kept; the deposit is always refunded.
* The deposit is refunded when the owner records the return.
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

from ..models import Booking, Payment, Refund, WebhookEvent
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
    if existing and existing.status == Payment.Status.CREATED:
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


def mark_paid(payment, payment_id):
    if payment.is_paid:
        return False
    payment.payment_id = payment_id
    payment.status = Payment.Status.PAID
    payment.paid_at = timezone.now()
    payment.save(update_fields=["payment_id", "status", "paid_at"])
    logger.info("payment_completed booking_id=%s provider=%s", payment.booking_id, payment.provider)
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


def issue_refund(payment, amount, reason):
    amount = money(amount)
    if amount <= 0:
        return None
    try:
        refund_id = get_provider().refund(payment, amount)
    except PaymentError as error:
        raise ValidationError(f"The refund could not be started: {error}") from error
    refund = Refund.objects.create(payment=payment, provider_refund_id=refund_id, amount=amount, reason=reason)
    payment.refunded_amount += amount
    payment.status = (Payment.Status.REFUNDED if payment.refunded_amount >= payment.amount
                      else Payment.Status.PARTIALLY_REFUNDED)
    payment.save(update_fields=["refunded_amount", "status", "cancellation_fee"])
    logger.info("refund_issued booking_id=%s amount=%s reason=%s", payment.booking_id, amount, reason)
    return refund


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


def apply_event(event_type, data):
    if event_type in ("payment.captured", "order.paid"):
        entity = data.get("payment", {}).get("entity", {})
        payment = Payment.objects.select_for_update().filter(order_id=entity.get("order_id", "")).first()
        if payment:
            mark_paid(payment, entity.get("id", ""))
            return True
    elif event_type == "payment.failed":
        entity = data.get("payment", {}).get("entity", {})
        updated = Payment.objects.filter(order_id=entity.get("order_id", ""), status=Payment.Status.CREATED)
        return bool(updated.update(status=Payment.Status.FAILED))
    elif event_type == "refund.processed":
        entity = data.get("refund", {}).get("entity", {})
        return bool(Refund.objects.filter(provider_refund_id=entity.get("id", "")).update(processed=True))
    return False
