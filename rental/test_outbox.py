from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.core import mail
from django.core.management import call_command
from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone

from .models import Booking, NotificationOutbox, Vehicle
from .services.notifications import MAX_ATTEMPTS, deliver, deliver_due, notify
from .services.reminders import send_pickup_reminders
from .testing import make_profile

SMTP_DOWN = patch("django.core.mail.EmailMultiAlternatives.send", side_effect=OSError("smtp down"))


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class NotificationOutboxTests(TestCase):
    def setUp(self):
        self.owner = make_profile("outbox-owner", email="owner@example.com")
        self.renter = make_profile("outbox-renter", email="renter@example.com")
        vehicle = Vehicle.objects.create(owner=self.owner, name="Venue", vehicle_type="Car", price_per_day=900)
        tomorrow = timezone.localdate() + timedelta(days=1)
        self.booking = Booking.objects.create(user=self.renter, vehicle=vehicle, start_date=tomorrow, end_date=tomorrow,
                                              total_price=900, status=Booking.Status.CONFIRMED)

    def test_failed_send_is_kept_and_retried_with_backoff(self):
        with SMTP_DOWN, self.assertLogs("rental.services.notifications", "ERROR"), \
                self.captureOnCommitCallbacks(execute=True):
            with transaction.atomic():
                notify("request_approved", self.booking, due_now=900, free_until=timezone.now())
        message = NotificationOutbox.objects.get()
        self.assertEqual((message.status, message.attempts), ("pending", 1))
        self.assertIn("smtp down", message.last_error)
        self.assertGreater(message.next_attempt_at, timezone.now())
        self.assertEqual(deliver_due(), 0)  # not due yet
        self.assertEqual(deliver_due(now=timezone.now() + timedelta(minutes=2)), 1)
        message.refresh_from_db()
        self.assertEqual((message.status, message.attempts, message.last_error), ("sent", 2, ""))
        self.assertEqual(len(mail.outbox), 1)

    def test_gives_up_after_the_last_attempt(self):
        message = notify("request_rejected", self.booking)
        NotificationOutbox.objects.filter(pk=message.pk).update(attempts=MAX_ATTEMPTS - 1)
        with SMTP_DOWN, self.assertLogs("rental.services.notifications", "ERROR"):
            deliver(message.pk)
        message.refresh_from_db()
        self.assertEqual(message.status, "failed")

    def test_enqueueing_twice_keeps_one_message_and_it_is_sent_once(self):
        first = notify("request_rejected", self.booking)
        self.assertIsNone(notify("request_rejected", self.booking))
        self.assertEqual(NotificationOutbox.objects.count(), 1)
        self.assertTrue(deliver(first.pk))
        self.assertFalse(deliver(first.pk))
        self.assertEqual(len(mail.outbox), 1)

    def test_nothing_is_queued_when_the_transaction_rolls_back(self):
        try:
            with transaction.atomic():
                notify("request_rejected", self.booking)
                raise RuntimeError("abort")
        except RuntimeError:
            pass
        self.assertFalse(NotificationOutbox.objects.exists())

    def test_reminder_is_marked_sent_only_after_delivery(self):
        with SMTP_DOWN, self.assertLogs("rental.services.notifications", "ERROR"), \
                self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(send_pickup_reminders(), [self.booking.pk])
        self.booking.refresh_from_db()
        self.assertIsNone(self.booking.reminder_sent_at)
        # The next scheduler runs neither duplicate the reminder nor lose it.
        self.assertEqual(send_pickup_reminders(), [])
        self.assertEqual(NotificationOutbox.objects.filter(kind="pickup_reminder").count(), 1)
        call_command("send_notifications", stdout=StringIO())  # still inside the backoff window
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(deliver_due(now=timezone.now() + timedelta(minutes=2)), 1)
        self.booking.refresh_from_db()
        self.assertIsNotNone(self.booking.reminder_sent_at)
        self.assertEqual(mail.outbox[0].subject, "Reminder: pick up your Venue tomorrow")

    def test_scheduler_runs_the_outbox_and_refund_jobs(self):
        notify("request_rejected", self.booking)
        out = StringIO()
        call_command("run_scheduled_jobs", stdout=out)
        self.assertIn("Queued 1 pickup reminder(s).", out.getvalue())
        self.assertIn("Delivered 2 queued email(s).", out.getvalue())
        self.assertIn("Sent 0 refund(s).", out.getvalue())
        self.assertIn("Reconciled refunds", out.getvalue())
