import json
from datetime import time, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import Booking, Payment, RefundIntent as Refund, Vehicle, WebhookEvent
from .payments.providers import FakeProvider, RazorpayTestProvider, get_provider, sign
from .services.booking import reserve_vehicle
from .testing import make_profile

WEBHOOK_SECRET = "whsec-test-only"


@override_settings(PAYMENT_PROVIDER="fake", DEMO_MODE=True, PAYMENT_WEBHOOK_SECRET=WEBHOOK_SECRET, RAZORPAY_KEY_ID="", RAZORPAY_KEY_SECRET="",
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

    def test_provider_outage_does_not_block_cancellation_and_the_refund_is_retried(self):
        from .payments.providers import PaymentError
        from .payments.service import process_due_refunds
        booking = self.book()
        self.checkout(booking)
        with patch.object(FakeProvider, "refund", side_effect=PaymentError("down")) as refund_call, \
                self.assertLogs("rental.payments.service", "WARNING"), self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.act(booking, "cancel", self.renter).status_code, 200)
        self.assertEqual(refund_call.call_count, 1)
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.CANCELLED)
        intent = Refund.objects.get()
        self.assertEqual((intent.status, intent.attempts, intent.last_error), ("pending", 1, "down"))
        self.assertEqual(process_due_refunds(), [])  # still inside the backoff window
        later = timezone.now() + timedelta(minutes=2)
        self.assertEqual(len(process_due_refunds(now=later)), 1)
        intent.refresh_from_db()
        self.assertEqual((intent.status, intent.attempts), ("succeeded", 2))
        self.assertTrue(intent.provider_refund_id.startswith("fake_rfnd_"))


@override_settings(PAYMENT_PROVIDER="fake", DEMO_MODE=True, PAYMENT_WEBHOOK_SECRET=WEBHOOK_SECRET, RAZORPAY_KEY_ID="", RAZORPAY_KEY_SECRET="")
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
        refund = Refund.objects.create(payment=self.payment, provider_refund_id="fake_rfnd_1", amount=100, reason="deposit",
                                       idempotency_key="k1", status="sent")
        self.deliver("evt_4", "refund.processed", "refund", {"id": "fake_rfnd_1", "payment_id": "fake_pay_1"})
        refund.refresh_from_db()
        self.assertEqual(refund.status, "succeeded")
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
    @override_settings(PAYMENT_PROVIDER="fake", DEMO_MODE=True, RAZORPAY_KEY_ID="", RAZORPAY_KEY_SECRET="")
    def test_fake_provider_when_explicitly_chosen(self):
        self.assertIsInstance(get_provider(), FakeProvider)

    @override_settings(PAYMENT_PROVIDER="fake", DEBUG=False, DEMO_MODE=False)
    def test_fake_provider_is_refused_outside_debug_and_demo(self):
        from django.core.checks import run_checks
        with self.assertRaises(ImproperlyConfigured):
            get_provider()
        self.assertIn("rental.E009", {m.id for m in run_checks()})

    @override_settings(PAYMENT_PROVIDER="", RAZORPAY_KEY_ID="", RAZORPAY_KEY_SECRET="")
    def test_there_is_no_implicit_fallback(self):
        from django.core.checks import run_checks
        with self.assertRaises(ImproperlyConfigured):
            get_provider()
        self.assertIn("rental.E008", {m.id for m in run_checks()})

    @override_settings(PAYMENT_PROVIDER="razorpay", RAZORPAY_KEY_ID="", RAZORPAY_KEY_SECRET="")
    def test_razorpay_without_keys_does_not_degrade_to_fake(self):
        with self.assertRaises(ImproperlyConfigured):
            get_provider()

    @override_settings(PAYMENT_PROVIDER="razorpay", RAZORPAY_KEY_ID="rzp_test_abc", RAZORPAY_KEY_SECRET="test-secret",
                       PAYMENT_WEBHOOK_SECRET="whsec")
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


RAZORPAY_TEST = dict(PAYMENT_PROVIDER="razorpay", RAZORPAY_KEY_ID="rzp_test_unit", RAZORPAY_KEY_SECRET="unit-test-secret",
                     PAYMENT_WEBHOOK_SECRET=WEBHOOK_SECRET)


class PaymentConfigTests(TestCase):
    @override_settings(PAYMENT_PROVIDER="fake", DEMO_MODE=True)
    def test_fake_mode_is_labelled_as_a_demo(self):
        data = self.client.get(reverse("api_payment_config"), secure=True).json()
        self.assertEqual((data["provider"], data["demo"], data["key_id"]), ("fake", True, ""))
        self.assertEqual(data["label"], "Demo payment, no real money")

    @override_settings(**RAZORPAY_TEST)
    def test_razorpay_mode_exposes_only_the_public_key_id(self):
        data = self.client.get(reverse("api_payment_config"), secure=True).json()
        self.assertEqual((data["provider"], data["demo"], data["key_id"]), ("razorpay", False, "rzp_test_unit"))
        self.assertNotIn("unit-test-secret", str(data))


@override_settings(**RAZORPAY_TEST)
class RazorpayCheckoutTests(TestCase):
    """Razorpay test mode end to end, with the Razorpay API mocked (no network, no real keys)."""

    def setUp(self):
        self.owner = make_profile("rzp-owner")
        self.renter = make_profile("rzp-renter")
        vehicle = Vehicle.objects.create(owner=self.owner, name="City", vehicle_type="Car", price_per_day=1000, deposit=500)
        day = timezone.localdate() + timedelta(days=6)
        self.booking = reserve_vehicle(self.renter.pk, vehicle.pk, day, day)
        Booking.objects.filter(pk=self.booking.pk).update(status=Booking.Status.CONFIRMED)
        self.client.force_login(self.renter.user)

    def start(self):
        with patch("requests.post") as post:
            post.return_value.status_code = 200
            post.return_value.json.return_value = {"id": "order_TEST123"}
            response = self.client.post(reverse("api_payment_start", args=[self.booking.pk]), secure=True)
        self.assertEqual(post.call_args.args[0], "https://api.razorpay.com/v1/orders")
        return response.json()

    def test_order_then_signed_checkout_result_marks_paid(self):
        options = self.start()
        self.assertEqual(options, {"provider": "razorpay", "key_id": "rzp_test_unit", "order_id": "order_TEST123",
                                   "amount": 150000, "currency": "INR"})
        self.assertEqual(self.client.post(reverse("api_payment_fake_checkout", args=[self.booking.pk]),
                                          secure=True).status_code, 404)
        result = {"order_id": "order_TEST123", "payment_id": "pay_TEST456",
                  "signature": sign("unit-test-secret", "order_TEST123|pay_TEST456")}
        response = self.client.post(reverse("api_payment_confirm", args=[self.booking.pk]), result, secure=True)
        self.assertEqual(response.json()["status"], "paid")
        self.assertEqual(Payment.objects.get().payment_id, "pay_TEST456")

    def test_signature_made_with_another_secret_is_rejected(self):
        self.start()
        forged = {"order_id": "order_TEST123", "payment_id": "pay_X", "signature": sign("other", "order_TEST123|pay_X")}
        self.assertEqual(self.client.post(reverse("api_payment_confirm", args=[self.booking.pk]), forged,
                                          secure=True).status_code, 400)
        self.assertEqual(Payment.objects.get().status, "created")


@override_settings(PAYMENT_PROVIDER="fake", DEMO_MODE=True)
class RefundIntentTests(TestCase):
    """Refunds are recorded in the booking transaction and sent to the provider only after commit."""

    def setUp(self):
        renter = make_profile("intent-renter")
        vehicle = Vehicle.objects.create(name="Car", vehicle_type="Car", price_per_day=1000)
        day = timezone.localdate() + timedelta(days=8)
        self.booking = reserve_vehicle(renter.pk, vehicle.pk, day, day)
        self.payment = Payment.objects.create(booking=self.booking, provider="fake", order_id="o1", amount=1000,
                                              status="paid", payment_id="p1")

    def issue(self):
        from django.db import transaction

        from .payments.service import issue_refund
        with transaction.atomic():
            return issue_refund(self.payment, 400, "cancellation")

    def test_rollback_leaves_no_intent_and_calls_no_provider(self):
        from django.db import transaction

        from .payments.service import issue_refund
        with patch.object(FakeProvider, "refund") as refund_call, self.captureOnCommitCallbacks(execute=True):
            try:
                with transaction.atomic():
                    issue_refund(self.payment, 400, "cancellation")
                    raise RuntimeError("the booking change failed")
            except RuntimeError:
                pass
        refund_call.assert_not_called()
        self.assertFalse(Refund.objects.exists())
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.refunded_amount, 0)

    def test_after_commit_the_provider_gets_the_stable_idempotency_key(self):
        with patch.object(FakeProvider, "refund", return_value=("rf_1", "pending")) as refund_call, \
                self.captureOnCommitCallbacks(execute=True):
            intent = self.issue()
        self.assertEqual(refund_call.call_args.args[2], f"motorlane-refund-{self.payment.pk}-cancellation")
        intent.refresh_from_db()
        self.assertEqual((intent.status, intent.provider_refund_id), ("sent", "rf_1"))

    def test_the_same_refund_cannot_be_recorded_twice(self):
        from django.db import IntegrityError, transaction
        self.issue()
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.issue()

    def test_crash_after_the_provider_accepted_does_not_refund_twice(self):
        """The provider refunded, then the process died before saving. The retry finds the refund instead."""
        from .payments.service import process_due_refunds
        intent = self.issue()
        Refund.objects.filter(pk=intent.pk).update(attempts=1)  # an attempt was claimed, its outcome never saved
        with patch.object(FakeProvider, "find_refund", return_value=("rf_existing", "processed")), \
                patch.object(FakeProvider, "refund") as refund_call:
            process_due_refunds()
        refund_call.assert_not_called()
        intent.refresh_from_db()
        self.assertEqual((intent.status, intent.provider_refund_id), ("succeeded", "rf_existing"))

    def test_repeated_processing_sends_once(self):
        from .payments.service import process_refund
        intent = self.issue()
        with patch.object(FakeProvider, "refund", return_value=("rf_1", "processed")) as refund_call:
            process_refund(intent.pk)
            process_refund(intent.pk)
        self.assertEqual(refund_call.call_count, 1)

    def test_gives_up_after_the_last_attempt(self):
        from .payments.providers import PaymentError
        from .payments.service import MAX_REFUND_ATTEMPTS, process_refund
        intent = self.issue()
        Refund.objects.filter(pk=intent.pk).update(attempts=MAX_REFUND_ATTEMPTS - 1)
        with patch.object(FakeProvider, "refund", side_effect=PaymentError("refused")), \
                patch.object(FakeProvider, "find_refund", return_value=None), \
                self.assertLogs("rental.payments.service", "ERROR"):
            process_refund(intent.pk)
        intent.refresh_from_db()
        self.assertEqual(intent.status, "failed")

    def test_reconcile_updates_sent_refunds(self):
        from io import StringIO

        from django.core.management import call_command
        sent = self.issue()
        Refund.objects.filter(pk=sent.pk).update(status="sent", provider_refund_id="rf_sent", attempts=1)
        out = StringIO()
        with patch.object(FakeProvider, "refund_status", return_value="processed"):
            call_command("reconcile_refunds", stdout=out)
        sent.refresh_from_db()
        self.assertEqual(sent.status, "succeeded")
        self.assertIn("succeeded 1", out.getvalue())


class ProductionPaymentGuardTests(TestCase):
    """With DEBUG off and no demo flag, the fake provider cannot be reached in any way."""

    def setUp(self):
        self.renter = make_profile("guard-renter")
        vehicle = Vehicle.objects.create(name="Car", vehicle_type="Car", price_per_day=1000)
        day = timezone.localdate() + timedelta(days=5)
        self.booking = reserve_vehicle(self.renter.pk, vehicle.pk, day, day)
        Booking.objects.filter(pk=self.booking.pk).update(status=Booking.Status.CONFIRMED)
        Payment.objects.create(booking=self.booking, provider="fake", order_id="fake_order_guard", amount=1000)
        self.client.force_login(self.renter.user)

    @override_settings(PAYMENT_PROVIDER="fake", DEBUG=False, DEMO_MODE=False)
    def test_fake_checkout_is_unreachable_and_payment_endpoints_fail_closed(self):
        with self.assertRaises(ImproperlyConfigured):
            get_provider()
        self.assertEqual(self.client.post(reverse("api_payment_fake_checkout", args=[self.booking.pk]),
                                          secure=True).status_code, 404)
        with self.assertLogs("rental.api_errors", "ERROR"):
            response = self.client.post(reverse("api_payment_confirm", args=[self.booking.pk]), {
                "order_id": "fake_order_guard", "payment_id": "fake_pay_x", "signature": "0" * 64}, secure=True)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("DEBUG", response.json()["detail"])
        self.assertEqual(Payment.objects.get().status, "created")
        with self.assertLogs("rental.api_errors", "ERROR"):
            self.assertEqual(self.client.get(reverse("api_payment_config"), secure=True).status_code, 503)

    @override_settings(PAYMENT_PROVIDER="razorpay", RAZORPAY_KEY_ID="", RAZORPAY_KEY_SECRET="")
    def test_system_check_e010_razorpay_without_key(self):
        from django.core.checks import run_checks
        self.assertIn("rental.E010", {message.id for message in run_checks()})

    @override_settings(PAYMENT_PROVIDER="paypal")
    def test_unknown_provider_is_e008(self):
        from django.core.checks import run_checks
        self.assertIn("rental.E008", {message.id for message in run_checks()})


@override_settings(PAYMENT_PROVIDER="fake", DEMO_MODE=True, PAYMENT_WEBHOOK_SECRET=WEBHOOK_SECRET)
class LockOrderAndRefundTruthTests(TestCase):
    def setUp(self):
        self.renter = make_profile("lock-renter")
        vehicle = Vehicle.objects.create(name="Car", vehicle_type="Car", price_per_day=1000)
        day = timezone.localdate() + timedelta(days=9)
        self.booking = reserve_vehicle(self.renter.pk, vehicle.pk, day, day)
        Booking.objects.filter(pk=self.booking.pk).update(status=Booking.Status.CONFIRMED)
        self.payment = Payment.objects.create(booking=self.booking, provider="fake", order_id="fake_order_lock", amount=1000)

    def test_webhook_locks_the_booking_before_the_payment(self):
        """Same global order as booking transitions (booking -> payment), so they cannot deadlock."""
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        body = json.dumps({"event": "payment.captured", "payload": {"payment": {"entity": {
            "id": "pay_lock", "order_id": "fake_order_lock"}}}}).encode()
        with CaptureQueriesContext(connection) as ctx:
            self.client.post(reverse("api_payment_webhook"), body, content_type="application/json", secure=True,
                             HTTP_X_RAZORPAY_SIGNATURE=sign(WEBHOOK_SECRET, body), HTTP_X_RAZORPAY_EVENT_ID="evt_lock")
        locks = [q["sql"] for q in ctx.captured_queries if "FOR UPDATE" in q["sql"]]
        tables = ["booking" if "rental_booking" in sql.split("FROM", 1)[1][:40] else
                  "payment" if "rental_payment" in sql.split("FROM", 1)[1][:40] else "other" for sql in locks]
        self.assertEqual(tables[:2], ["booking", "payment"], locks)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.status, "paid")

    def test_refund_that_gave_up_is_shown_as_delayed_not_refunded(self):
        from .payments.providers import PaymentError
        from .payments.service import MAX_REFUND_ATTEMPTS, process_refund
        Payment.objects.filter(pk=self.payment.pk).update(status="paid")
        self.client.force_login(self.renter.user)
        with patch.object(FakeProvider, "refund", side_effect=PaymentError("bank offline")), \
                self.assertLogs("rental.payments.service", "WARNING"), self.captureOnCommitCallbacks(execute=True):
            self.client.post(reverse("api_booking_action", args=[self.booking.pk, "cancel"]), secure=True)
        intent = Refund.objects.get()

        def shown():
            return self.client.get(reverse("api_booking_detail", args=[self.booking.pk]), secure=True).json()["payment"]

        self.assertEqual((shown()["refund_status"], shown()["refund_confirmed"]), ("pending", "0.00"))
        Refund.objects.filter(pk=intent.pk).update(attempts=MAX_REFUND_ATTEMPTS - 1, next_attempt_at=timezone.now())
        with patch.object(FakeProvider, "refund", side_effect=PaymentError("bank offline")), \
                patch.object(FakeProvider, "find_refund", return_value=None), \
                self.assertLogs("rental.payments.service", "ERROR"):
            process_refund(intent.pk)
        data = shown()
        self.assertEqual((data["refund_status"], data["refund_confirmed"], data["refunded"]), ("delayed", "0.00", "1000.00"))
        Refund.objects.filter(pk=intent.pk).update(status="succeeded")
        self.assertEqual((shown()["refund_status"], shown()["refund_confirmed"]), ("refunded", "1000.00"))
        self.assertIn("refund_status", self.client.get(reverse("api_bookings"), secure=True).json()[0]["payment"])
