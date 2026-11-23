"""Backfill the money stops on existing timelines: one "paid" per paid payment, and one
"refund_issued" (plus "refunded" once confirmed) per refund intent. Reversing removes only
the rows this kind of migration adds (kind other than "status")."""
from datetime import timedelta

from django.db import migrations

LABELS = {"fake": "demo payment", "razorpay": "Razorpay test"}


def rupees(amount):
    return f"₹{amount:,.0f}" if amount == int(amount) else f"₹{amount:,.2f}"


def forwards(apps, schema_editor):
    Payment = apps.get_model("rental", "Payment")
    RefundIntent = apps.get_model("rental", "RefundIntent")
    BookingEvent = apps.get_model("rental", "BookingEvent")
    paid = ("paid", "partially_refunded", "refunded")
    rows = []
    for payment in Payment.objects.filter(status__in=paid).select_related("booking__user"):
        if BookingEvent.objects.filter(payment=payment, kind="paid").exists():
            continue
        booking = payment.booking
        rows.append(BookingEvent(
            booking=booking, kind="paid", payment=payment, from_status="Confirmed", to_status="Confirmed",
            actor_id=booking.user.user_id, at=payment.paid_at or payment.created_at,
            note=f"Paid {rupees(payment.amount)} · {LABELS.get(payment.provider, payment.provider)}"))
    for intent in RefundIntent.objects.select_related("payment__booking"):
        booking = intent.payment.booking
        if not BookingEvent.objects.filter(refund=intent, kind="refund_issued").exists():
            rows.append(BookingEvent(
                booking=booking, kind="refund_issued", refund=intent, from_status=booking.status,
                to_status=booking.status, at=intent.created_at + timedelta(seconds=1),  # after the change that caused it
                note=f"Refund of {rupees(intent.amount)} issued ({intent.reason})"))
        if intent.status == "succeeded" and not BookingEvent.objects.filter(refund=intent, kind="refunded").exists():
            rows.append(BookingEvent(
                booking=booking, kind="refunded", refund=intent, from_status=booking.status,
                to_status=booking.status, at=intent.updated_at + timedelta(seconds=2), note=f"{rupees(intent.amount)} refunded"))
    BookingEvent.objects.bulk_create(rows)


def backwards(apps, schema_editor):
    apps.get_model("rental", "BookingEvent").objects.exclude(kind="status").delete()


class Migration(migrations.Migration):
    dependencies = [("rental", "0030_booking_money_events")]
    operations = [migrations.RunPython(forwards, backwards)]
