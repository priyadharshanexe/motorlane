from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.core import mail
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import Booking, Vehicle
from .services.booking import reserve_vehicle
from .testing import make_profile


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend", SITE_URL="https://motorlane.test")
class NotificationTests(TestCase):
    def setUp(self):
        self.owner = make_profile("owner", email="owner@example.com", name="Olive Owner")
        self.renter = make_profile("renter", email="renter@example.com", name="Ravi O'Renter")
        self.vehicle = Vehicle.objects.create(owner=self.owner, name="Swift", vehicle_type="Car", price_per_day=1000)
        self.day = timezone.localdate()

    def request(self, day=None):
        with self.captureOnCommitCallbacks(execute=True):
            return reserve_vehicle(self.renter.pk, self.vehicle.pk, day or self.day, day or self.day)

    def act(self, booking, action, profile=None):
        self.client.force_login((profile or self.owner).user)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(reverse("api_booking_action", args=[booking.pk, action]), secure=True)
        self.assertEqual(response.status_code, 200, response.content)

    def test_new_request_goes_to_owner_as_text_and_html(self):
        self.request()
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.to, ["owner@example.com"])
        self.assertEqual(message.subject, "New rental request for your Swift")
        self.assertIn("Ravi O'Renter asked to rent your Swift", message.body)
        self.assertIn("https://motorlane.test/app/owner", message.body)
        html, mimetype = message.alternatives[0]
        self.assertEqual(mimetype, "text/html")
        self.assertIn("Ravi O&#x27;Renter", html)

    def test_full_lifecycle_emails_reach_the_right_person(self):
        booking = self.request()
        for action in ("approve", "pickup", "return"):
            self.act(booking, action)
        sent = [(m.to[0], m.subject) for m in mail.outbox]
        self.assertEqual(sent, [
            ("owner@example.com", "New rental request for your Swift"),
            ("renter@example.com", "Your Swift rental is confirmed"),
            ("renter@example.com", "We received your Swift back"),
            ("renter@example.com", "How was your Swift rental?"),
        ])

    def test_rejection_and_cancellation(self):
        rejected = self.request()
        self.act(rejected, "reject")
        cancelled = self.request(self.day + timedelta(days=3))
        self.act(cancelled, "cancel", self.renter)
        subjects = [(m.to[0], m.subject) for m in mail.outbox[1:]]
        self.assertIn(("renter@example.com", "Your Swift request was declined"), subjects)
        self.assertIn(("renter@example.com", "Your Swift booking is cancelled"), subjects)
        self.assertIn(("owner@example.com", "A Swift booking was cancelled"), subjects)

    def test_nothing_is_sent_when_the_transaction_rolls_back(self):
        from django.db import transaction
        with self.captureOnCommitCallbacks(execute=True):
            try:
                with transaction.atomic():
                    reserve_vehicle(self.renter.pk, self.vehicle.pk, self.day, self.day)
                    raise RuntimeError("abort")
            except RuntimeError:
                pass
        self.assertEqual(mail.outbox, [])
        self.assertEqual(Booking.objects.count(), 0)

    def test_mail_failure_is_logged_not_raised(self):
        with patch("django.core.mail.EmailMultiAlternatives.send", side_effect=OSError("smtp down")):
            with self.assertLogs("rental.services.notifications", "ERROR"):
                booking = self.request()
        self.assertEqual(Booking.objects.get().pk, booking.pk)

    def test_pickup_reminder_is_sent_once_the_day_before(self):
        tomorrow = self.day + timedelta(days=1)
        booking = self.request(tomorrow)
        later = self.request(tomorrow + timedelta(days=3))
        Booking.objects.filter(pk__in=[booking.pk, later.pk]).update(status=Booking.Status.CONFIRMED)
        mail.outbox.clear()
        with self.captureOnCommitCallbacks(execute=True):
            call_command("send_pickup_reminders", stdout=StringIO())
        with self.captureOnCommitCallbacks(execute=True):
            call_command("run_scheduled_jobs", stdout=StringIO())
        self.assertEqual([(m.to[0], m.subject) for m in mail.outbox],
                         [("renter@example.com", "Reminder: pick up your Swift tomorrow")])
        booking.refresh_from_db()
        self.assertIsNotNone(booking.reminder_sent_at)
