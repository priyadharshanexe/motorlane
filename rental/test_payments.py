import json
from datetime import time, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import Booking, Payment, Refund, Vehicle, WebhookEvent
from .payments.providers import FakeProvider, RazorpayTestProvider, get_provider, sign
from .services.booking import reserve_vehicle
from .testing import make_profile

WEBHOOK_SECRET = "whsec-test-only"


@override_settings(PAYMENT_WEBHOOK_SECRET=WEBHOOK_SECRET, RAZORPAY_KEY_ID="", RAZORPAY_KEY_SECRET="",
                   RENTAL_FREE_CANCELLATION_HOURS=48, RENTAL_CANCELLATION_FEE_PERCENT=20)
class PaymentFlowTests(TestCase):
    def setUp(self):
        self.owner = make_profile("pay-owner")
        self.renter = make_profile("pay-renter")
        self.stranger = make_profile("pay-stranger")
        self.vehicle = Vehicle.objects.create(owner=self.owner, name="City", vehicle_type="Car",
                                              price_per_day=1000, deposit=2000)

    def book(self, days_ahead=5, pickup=time(10)):
        day = timezone.localdate() + timedelta(days=days_ahead)
        booking = reserve_vehicle(self.renter.pk, self.vehicle.pk, day, day + timedelta(days=1), pickup, pickup)
        self.client.force_login(self.owner.user)
        self.assertEqual(self.client.post(reverse("api_booking_action", args=[booking.pk, "approve"]), secure=True).status_code, 200)
        return booking

    def checkout(self, booking):
        self.client.force_login(self.renter.user)
        options = self.client.post(reverse("api_payment_start", args=[booking.pk]), secure=True)
        self.assertEqual(options.status_code, 200, options.content)
        result = self.client.post(reverse("api_payment_fake_checkout", args=[booking.pk]), secure=True).json()
        confirmed = self.client.post(reverse("api_payment_confirm", args=[booking.pk]), result, secure=True)
        self.assertEqual(confirmed.status_code, 200, confirmed.content)
        return options.json(), result

    def act(self, booking, action, profile):
        self.client.force_login(profile.user)
        return self.client.post(reverse("api_booking_action", args=[booking.pk, action]), secure=True)

    def test_payment_opens_only_after_approval_and_only_for_the_renter(self):
        day = timezone.localdate() + timedelta(days=3)
        booking = reserve_vehicle(self.renter.pk, self.vehicle.pk, day, day)
        self.client.force_login(self.renter.user)
        self.assertEqual(self.client.post(reverse("api_payment_start", args=[booking.pk]), secure=True).status_code, 409)
        self.act(booking, "approve", self.owner)
        for profile in (self.owner, self.stranger):
            self.client.force_login(profile.user)
            self.assertEqual(self.client.post(reverse("api_payment_start", args=[booking.pk]), secure=True).status_code, 404)

    def test_checkout_charges_rental_plus_deposit_and_is_idempotent(self):
        booking = self.book()
        options, _ = self.checkout(booking)
        self.assertEqual(options["provider"], "fake")
        self.assertEqual(options["amount"], 300000)  # paise: 1 day (24 h) x 1000 + 2000 deposit
        payment = Payment.objects.get()
        self.assertEqual((payment.status, payment.amount, payment.deposit), ("paid", Decimal("3000.00"), Decimal("2000.00")))
        self.client.force_login(self.renter.user)
        self.assertEqual(self.client.post(reverse("api_payment_start", args=[booking.pk]), secure=True).status_code, 409)

    def test_forged_checkout_signature_is_rejected(self):
        booking = self.book()
        self.client.force_login(self.renter.user)
        order = self.client.post(reverse("api_payment_start", args=[booking.pk]), secure=True).json()["order_id"]
        forged = {"order_id": order, "payment_id": "fake_pay_x", "signature": sign("guess", f"{order}|fake_pay_x")}
        self.assertEqual(self.client.post(reverse("api_payment_confirm", args=[booking.pk]), forged, secure=True).status_code, 400)
        self.assertEqual(Payment.objects.get().status, "created")

    def test_pickup_requires_payment(self):
        booking = self.book(days_ahead=0, pickup=time(0, 30))
        response = self.act(booking, "pickup", self.owner)
        self.assertEqual(response.status_code, 409)
        self.assertIn("payment", response.json()["detail"])
        self.checkout(booking)
        self.assertEqual(self.act(booking, "pickup", self.owner).status_code, 200)

    def test_free_cancellation_refunds_everything(self):
        booking = self.book(days_ahead=5)
        self.checkout(booking)
        preview = self.client.get(reverse("api_cancellation_preview", args=[booking.pk]), secure=True).json()
        self.assertEqual((preview["fee"], preview["refund"]), ("0.00", "3000.00"))
        self.assertEqual(self.act(booking, "cancel", self.renter).status_code, 200)
        payment = Payment.objects.get()
        self.assertEqual((payment.status, payment.refunded_amount, payment.cancellation_fee),
                         ("refunded", Decimal("3000.00"), Decimal("0.00")))
        self.assertEqual(booking.events.last().note, "Refund of ₹3000.00 issued.")

    def test_late_cancellation_keeps_a_fee_but_returns_the_deposit(self):
        booking = self.book(days_ahead=1, pickup=time(23))  # less than 48 hours away
        self.checkout(booking)
        self.assertEqual(self.act(booking, "cancel", self.renter).status_code, 200)
        payment = Payment.objects.get()
        self.assertEqual(payment.cancellation_fee, Decimal("200.00"))  # 20% of the 1000 rental, not of the deposit
        self.assertEqual(payment.refunded_amount, Decimal("2800.00"))
        self.assertEqual(payment.status, "partially_refunded")
        self.assertEqual(Refund.objects.get().reason, "cancellation")

    def test_unpaid_cancellation_refunds_nothing(self):
        booking = self.book()
        self.assertEqual(self.act(booking, "cancel", self.renter).status_code, 200)
        self.assertFalse(Refund.objects.exists())

    def test_return_refunds_the_deposit_once(self):
        booking = self.book(days_ahead=0, pickup=time(0, 30))
        self.checkout(booking)
        self.act(booking, "pickup", self.owner)
        self.assertEqual(self.act(booking, "return", self.owner).status_code, 200)
        payment = Payment.objects.get()
        self.assertEqual((payment.refunded_amount, payment.status), (Decimal("2000.00"), "partially_refunded"))
        self.assertEqual(list(Refund.objects.values_list("reason", flat=True)), ["deposit"])

    def test_refund_failure_keeps_the_booking_unchanged(self):
        from .payments.providers import PaymentError
        booking = self.book()
        self.checkout(booking)
        with patch.object(FakeProvider, "refund", side_effect=PaymentError("down")):
            self.assertEqual(self.act(booking, "cancel", self.renter).status_code, 409)
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.CONFIRMED)
        self.assertEqual(Payment.objects.get().status, "paid")


@override_settings(PAYMENT_WEBHOOK_SECRET=WEBHOOK_SECRET, RAZORPAY_KEY_ID="", RAZORPAY_KEY_SECRET="")
class WebhookTests(TestCase):
    def setUp(self):
        renter = make_profile("hook-renter")
        vehicle = Vehicle.objects.create(name="Bike", vehicle_type="Bike", price_per_day=500)
        day = timezone.localdate() + timedelta(days=4)
        self.booking = reserve_vehicle(renter.pk, vehicle.pk, day, day)
        Booking.objects.filter(pk=self.booking.pk).update(status=Booking.Status.CONFIRMED)
        self.payment = Payment.objects.create(booking=self.booking, provider="fake", order_id="fake_order_1", amount=500)

    def deliver(self, event_id, event, entity_key="payment", entity=None, secret=WEBHOOK_SECRET):
        body = json.dumps({"event": event, "payload": {entity_key: {"entity": entity or {
            "id": "fake_pay_1", "order_id": "fake_order_1", "amount": 50000}}}}).encode()
        return self.client.post(reverse("api_payment_webhook"), body, content_type="application/json", secure=True,
                                HTTP_X_RAZORPAY_SIGNATURE=sign(secret, body), HTTP_X_RAZORPAY_EVENT_ID=event_id)

    def test_captured_event_marks_paid_and_duplicates_are_ignored(self):
        first = self.deliver("evt_1", "payment.captured")
        self.assertEqual(first.json(), {"result": "processed"})
        self.payment.refresh_from_db()
        self.assertEqual((self.payment.status, self.payment.payment_id), ("paid", "fake_pay_1"))
        paid_at = self.payment.paid_at
        again = self.deliver("evt_1", "payment.captured")
        self.assertEqual((again.status_code, again.json()), (200, {"result": "duplicate"}))
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.paid_at, paid_at)
        self.assertEqual(WebhookEvent.objects.count(), 1)

    def test_bad_signature_is_rejected_and_not_recorded(self):
        self.assertEqual(self.deliver("evt_2", "payment.captured", secret="wrong").status_code, 400)
        response = self.client.post(reverse("api_payment_webhook"), b"{}", content_type="application/json", secure=True)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(WebhookEvent.objects.exists())
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.status, "created")

    def test_failed_and_refund_events(self):
        self.assertEqual(self.deliver("evt_3", "payment.failed").json(), {"result": "processed"})
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.status, "failed")
        refund = Refund.objects.create(payment=self.payment, provider_refund_id="fake_rfnd_1", amount=100, reason="deposit")
        self.deliver("evt_4", "refund.processed", "refund", {"id": "fake_rfnd_1", "payment_id": "fake_pay_1"})
        refund.refresh_from_db()
        self.assertTrue(refund.processed)
        self.assertEqual(self.deliver("evt_5", "something.else").json(), {"result": "ignored"})

    def test_webhook_needs_no_session_or_csrf(self):
        from django.test import Client
        body = json.dumps({"event": "payment.captured", "payload": {"payment": {"entity": {
            "id": "p", "order_id": "fake_order_1"}}}}).encode()
        response = Client(enforce_csrf_checks=True).post(
            reverse("api_payment_webhook"), body, content_type="application/json", secure=True,
            HTTP_X_RAZORPAY_SIGNATURE=sign(WEBHOOK_SECRET, body), HTTP_X_RAZORPAY_EVENT_ID="evt_csrf")
        self.assertEqual(response.status_code, 200)


class ProviderSelectionTests(TestCase):
    @override_settings(RAZORPAY_KEY_ID="", RAZORPAY_KEY_SECRET="")
    def test_fake_provider_without_keys(self):
        self.assertIsInstance(get_provider(), FakeProvider)

    @override_settings(RAZORPAY_KEY_ID="rzp_test_abc", RAZORPAY_KEY_SECRET="test-secret")
    def test_razorpay_test_keys_use_razorpay_and_post_paise(self):
        provider = get_provider()
        self.assertIsInstance(provider, RazorpayTestProvider)
        payment = Payment(booking_id=7, amount=Decimal("1234.50"), currency="INR")
        with patch("requests.post") as post:
            post.return_value.status_code = 200
            post.return_value.json.return_value = {"id": "order_test_1"}
            self.assertEqual(provider.create_order(payment), "order_test_1")
        self.assertEqual(post.call_args.kwargs["json"]["amount"], 123450)
        self.assertEqual(post.call_args.kwargs["auth"], ("rzp_test_abc", "test-secret"))

    @override_settings(RAZORPAY_KEY_ID="rzp_live_abc", RAZORPAY_KEY_SECRET="live-secret")
    def test_live_keys_are_refused(self):
        with self.assertRaises(ImproperlyConfigured):
            get_provider()
