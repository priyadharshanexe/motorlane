from django.db import IntegrityError, transaction
from django.utils import timezone

from ..models import BookingEvent


def record_event(booking, from_status, to_status, actor=None, note="", at=None):
    """Append one row to the booking's audit trail. Call inside the same transaction as the change."""
    return BookingEvent.objects.create(
        booking=booking, from_status=from_status or "", to_status=to_status,
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        at=at or timezone.now(), note=note[:255],
    )


PROVIDER_LABELS = {"fake": "demo payment", "razorpay": "Razorpay test"}


def rupees(amount):
    return f"₹{amount:,.0f}" if amount == int(amount) else f"₹{amount:,.2f}"


def record_money_event(booking, kind, note, payment=None, refund=None, actor=None, at=None):
    """Record a paid/refund stop once. A second call for the same payment or refund is a no-op."""
    lookup = {"payment": payment} if payment is not None else {"refund": refund}
    if BookingEvent.objects.filter(kind=kind, **lookup).exists():
        return None
    try:
        with transaction.atomic():
            return BookingEvent.objects.create(
                booking=booking, kind=kind, from_status=booking.status, to_status=booking.status,
                actor=actor if getattr(actor, "is_authenticated", False) else None,
                at=at or timezone.now(), note=note[:255], payment=payment, refund=refund)
    except IntegrityError:
        return None


def record_paid(payment, booking, at=None):
    label = PROVIDER_LABELS.get(payment.provider, payment.provider)
    return record_money_event(booking, "paid", f"Paid {rupees(payment.amount)} · {label}",
                              payment=payment, actor=booking.user.user, at=at or payment.paid_at)


def record_refund_issued(intent, booking):
    return record_money_event(booking, "refund_issued", f"Refund of {rupees(intent.amount)} issued ({intent.reason})",
                              refund=intent)


def record_refunded(intent_id):
    from ..models import RefundIntent
    intent = RefundIntent.objects.select_related("payment__booking").filter(pk=intent_id).first()
    if intent is None or intent.status != RefundIntent.Status.SUCCEEDED:
        return None
    return record_money_event(intent.payment.booking, "refunded", f"{rupees(intent.amount)} refunded", refund=intent)
