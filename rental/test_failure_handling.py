from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import Booking, NotificationOutbox, Payment, RefundIntent, Vehicle
from .payments.providers import FakeProvider, PaymentError
from .services.notifications import MAX_ATTEMPTS, deliver, notify
from .testing import make_profile


@override_settings(PAYMENT_PROVIDER="fake", DEMO_MODE=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class FailedRefundAndEmailTests(TestCase):
    """Work that gave up is visible to staff, logged at ERROR, and can be retried by hand."""

    def setUp(self):
        renter = make_profile("fail-renter", email="renter@example.com")
        vehicle = Vehicle.objects.create(name="Car", vehicle_type="Car", price_per_day=1000)
        day = timezone.localdate() + timedelta(days=9)
        self.booking = Booking.objects.create(user=renter, vehicle=vehicle, start_date=day, end_date=day,
                                              total_price=1000, status=Booking.Status.CANCELLED)
        payment = Payment.objects.create(booking=self.booking, provider="fake", order_id="o-fail", amount=1000,
                                         status="refunded", payment_id="p1", refunded_amount=1000)
        self.intent = RefundIntent.objects.create(payment=payment, amount=1000, reason="cancellation",
                                                  idempotency_key="k-fail", status="pending", attempts=5)
        self.staff = get_user_model().objects.create_user("ops", password="x", is_staff=True, is_superuser=True)

    def give_up_refund(self):
        from .payments.service import process_refund
        with patch.object(FakeProvider, "refund", side_effect=PaymentError("bank offline")), \
                patch.object(FakeProvider, "find_refund", return_value=None), \
                self.assertLogs("rental.payments.service", "ERROR") as logs:
            process_refund(self.intent.pk)
        self.intent.refresh_from_db()
        self.assertEqual(self.intent.status, "failed")
        self.assertTrue(any("refund_gave_up" in line for line in logs.output))

    def give_up_email(self):
        message = notify("request_rejected", self.booking)
        NotificationOutbox.objects.filter(pk=message.pk).update(attempts=MAX_ATTEMPTS - 1)
        with patch("django.core.mail.EmailMultiAlternatives.send", side_effect=OSError("smtp down")), \
                self.assertLogs("rental.services.notifications", "ERROR") as logs:
            deliver(message.pk)
        self.assertTrue(any("notification_gave_up" in line for line in logs.output))
        return message

    def test_staff_dashboard_lists_failed_refunds_and_emails(self):
        self.give_up_refund()
        self.give_up_email()
        self.client.force_login(self.staff)
        page = self.client.get(reverse("admin_dashboard"), secure=True)
        self.assertContains(page, "1 failed refund ·")
        self.assertContains(page, "1 failed email.")
        self.assertContains(page, "bank offline")
        self.assertContains(page, "smtp down")
        listing = self.client.get(reverse("admin:rental_refundintent_changelist") + "?status__exact=failed", secure=True)
        self.assertContains(listing, "bank offline")

    def test_failed_refund_can_be_retried_from_the_command(self):
        self.give_up_refund()
        out = StringIO()
        call_command("reconcile_refunds", "--retry-failed", stdout=out)
        self.assertIn("Requeued 1 failed refund(s); 1 sent now.", out.getvalue())
        self.intent.refresh_from_db()
        self.assertEqual(self.intent.status, "succeeded")

    def test_failed_refund_can_be_retried_from_the_admin(self):
        self.give_up_refund()
        self.client.force_login(self.staff)
        self.client.post(reverse("admin:rental_refundintent_changelist"), {
            "action": "retry_now", "_selected_action": [self.intent.pk]}, secure=True)
        self.intent.refresh_from_db()
        self.assertEqual(self.intent.status, "succeeded")

    def test_failed_email_can_be_retried(self):
        message = self.give_up_email()
        message.refresh_from_db()
        self.assertEqual(message.status, "failed")
        out = StringIO()
        call_command("send_notifications", "--retry-failed", stdout=out)
        self.assertIn("Requeued 1 failed email(s).", out.getvalue())
        self.assertIn("Delivered 1 queued email(s).", out.getvalue())
        message.refresh_from_db()
        self.assertEqual(message.status, "sent")
        self.assertEqual(len(mail.outbox), 1)
