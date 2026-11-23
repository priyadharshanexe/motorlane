"""The paid and refund stops on a booking's timeline: recorded once, idempotent, backfilled."""
import importlib
from datetime import timedelta

from django.apps import apps as global_apps
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import Booking, BookingEvent, Payment, Vehicle
from .services.booking import reserve_vehicle
from . import test_payments as tp
from .test_payments import WEBHOOK_SECRET
from .testing import make_profile


def kinds(booking):
    return list(BookingEvent.objects.filter(booking=booking).exclude(kind="status").values_list("kind", flat=True))


@override_settings(PAYMENT_PROVIDER="fake", DEMO_MODE=True, PAYMENT_WEBHOOK_SECRET=WEBHOOK_SECRET, RAZORPAY_KEY_ID="",
                   RAZORPAY_KEY_SECRET="", RENTAL_FREE_CANCELLATION_HOURS=48, RENTAL_CANCELLATION_FEE_PERCENT=20)
class PaidStopTests(TestCase):
    setUp = tp.PaymentFlowTests.setUp
    book, checkout, act = tp.PaymentFlowTests.book, tp.PaymentFlowTests.checkout, tp.PaymentFlowTests.act

    def test_checkout_records_one_paid_stop_in_the_timeline_api(self):
        booking = self.book()
        self.checkout(booking)
        timeline = self.client.get(reverse("api_booking_timeline", args=[booking.pk]), secure=True).json()
        timeline = timeline.get("results", timeline) if isinstance(timeline, dict) else timeline
        paid = [e for e in timeline if e["kind"] == "paid"]
        self.assertEqual(len(paid), 1)
        self.assertEqual((paid[0]["actor"], paid[0]["note"]), ("renter", "Paid ₹3,000 · demo payment"))
        self.assertTrue(all(e["kind"] == "status" for e in timeline if e is not paid[0]))
        # confirming the same checkout again does not add a second stop
        from .payments.service import mark_paid
        self.assertFalse(mark_paid(Payment.objects.get(booking=booking), "again"))
        self.assertEqual(kinds(booking), ["paid"])

    def test_cancel_records_refund_issued_then_refunded(self):
        booking = self.book()
        self.checkout(booking)
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.act(booking, "cancel", self.renter).status_code, 200)
        self.assertEqual(kinds(booking), ["paid", "refund_issued", "refunded"])
        notes = list(BookingEvent.objects.filter(booking=booking, kind__in=["refund_issued", "refunded"])
                     .values_list("note", flat=True))
        self.assertEqual(notes, ["Refund of ₹3,000 issued (cancellation)", "₹3,000 refunded"])


@override_settings(PAYMENT_PROVIDER="fake", DEMO_MODE=True, PAYMENT_WEBHOOK_SECRET=WEBHOOK_SECRET, RAZORPAY_KEY_ID="", RAZORPAY_KEY_SECRET="")
class PaidWebhookTests(TestCase):
    setUp, deliver = tp.WebhookTests.setUp, tp.WebhookTests.deliver

    def test_duplicate_and_redelivered_capture_add_one_paid_stop(self):
        self.deliver("evt_1", "payment.captured")
        self.deliver("evt_1", "payment.captured")  # same event id: duplicate
        self.deliver("evt_2", "order.paid")  # a different event for the same payment
        self.assertEqual(kinds(self.booking), ["paid"])


class BackfillTests(TestCase):
    def test_backfill_adds_paid_stops_once_and_reverses(self):
        migration = importlib.import_module("rental.migrations.0031_backfill_money_events")
        renter = make_profile("fill-renter")
        vehicle = Vehicle.objects.create(name="Old", vehicle_type="Car", price_per_day=700)
        day = timezone.localdate() + timedelta(days=6)
        booking = reserve_vehicle(renter.pk, vehicle.pk, day, day)
        Booking.objects.filter(pk=booking.pk).update(status=Booking.Status.CONFIRMED)
        Payment.objects.create(booking=booking, provider="fake", order_id="old_order", amount=700,
                               status=Payment.Status.PAID, paid_at=timezone.now())
        migration.forwards(global_apps, None)
        migration.forwards(global_apps, None)
        self.assertEqual(kinds(booking), ["paid"])
        self.assertEqual(BookingEvent.objects.get(kind="paid").note, "Paid ₹700 · demo payment")
        migration.backwards(global_apps, None)
        self.assertEqual(kinds(booking), [])
        self.assertTrue(BookingEvent.objects.filter(booking=booking, kind="status").exists())
