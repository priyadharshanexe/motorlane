from datetime import timedelta
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Booking, BookingEvent, CustomUser, Vehicle
from .services.booking import reserve_vehicle
from .services.expiry import NO_SHOW, PICKUP_DATE_PASSED, REQUEST_TIMED_OUT, expire_bookings


def make_profile(username):
    account = get_user_model().objects.create_user(username=username, email=f"{username}@example.com")
    return CustomUser.objects.create(account=account, name=username.title(), email=account.email)


class ExpiryTests(TestCase):
    def setUp(self):
        self.owner = make_profile("owner")
        self.renter = make_profile("renter")
        self.vehicle = Vehicle.objects.create(owner=self.owner, name="Car", vehicle_type="Car", price_per_day=100)
        self.today = timezone.localdate()

    def booking(self, status, start, end, **extra):
        return Booking.objects.create(user=self.renter, vehicle=self.vehicle, start_date=start, end_date=end,
                                      total_price=100, status=status, **extra)

    def test_expires_stale_requests_and_no_shows_once(self):
        past = self.today - timedelta(days=1)
        future = self.today + timedelta(days=3)
        timed_out = self.booking("Pending", future, future, expires_at=timezone.now() - timedelta(minutes=1))
        missed_start = self.booking("Pending", past, future)
        no_show = self.booking("Confirmed", past - timedelta(days=2), past)
        late_pickup_still_possible = self.booking("Confirmed", past, future)
        live = self.booking("Pending", future, future, expires_at=timezone.now() + timedelta(hours=1))
        renting = self.booking("In progress", past, past, picked_up_at=timezone.now())

        out = StringIO()
        call_command("expire_bookings", stdout=out)
        self.assertIn("Expired 3 booking(s).", out.getvalue())
        call_command("expire_bookings", stdout=out)
        self.assertIn("Expired 0 booking(s).", out.getvalue())

        expected = {timed_out: REQUEST_TIMED_OUT, missed_start: PICKUP_DATE_PASSED, no_show: NO_SHOW}
        for booking, note in expected.items():
            booking.refresh_from_db()
            self.assertEqual(booking.status, Booking.Status.EXPIRED)
            event = booking.events.get()
            self.assertEqual((event.to_status, event.note, event.actor), ("Expired", note, None))
        for booking in (late_pickup_still_possible, live, renting):
            status = booking.status
            booking.refresh_from_db()
            self.assertEqual(booking.status, status)
        self.assertEqual(BookingEvent.objects.count(), 3)

    def test_expired_rows_free_the_vehicle_and_are_logged(self):
        self.booking("Pending", self.today, self.today, expires_at=timezone.now() - timedelta(seconds=1))
        with self.assertLogs("rental.services.expiry", "INFO") as logs:
            self.assertEqual(len(expire_bookings()), 1)
        self.assertIn("bookings_expired count=1", logs.output[0])
        other = make_profile("other")
        self.assertEqual(reserve_vehicle(other.pk, self.vehicle.pk, self.today, self.today).status, "Pending")


class TimelineTests(TestCase):
    def setUp(self):
        self.owner = make_profile("host")
        self.renter = make_profile("guest")
        self.stranger = make_profile("stranger")
        self.vehicle = Vehicle.objects.create(owner=self.owner, name="Bike", vehicle_type="Bike", price_per_day=50)

    def test_every_transition_is_recorded_and_visible_to_both_parties_only(self):
        today = timezone.localdate()
        booking = reserve_vehicle(self.renter.pk, self.vehicle.pk, today, today)
        self.client.force_login(self.owner.account)
        for action in ("approve", "pickup", "return"):
            url = reverse("api_booking_action", args=[booking.pk, action])
            self.assertEqual(self.client.post(url, secure=True).status_code, 200)
        timeline = self.client.get(reverse("api_booking_timeline", args=[booking.pk]), secure=True).json()
        self.assertEqual([(e["from_status"], e["to_status"], e["actor"]) for e in timeline], [
            ("", "Pending", "renter"), ("Pending", "Confirmed", "owner"),
            ("Confirmed", "In progress", "owner"), ("In progress", "Returned", "owner"),
        ])
        self.client.force_login(self.renter.account)
        detail = self.client.get(reverse("api_booking_detail", args=[booking.pk]), secure=True).json()
        self.assertEqual(len(detail["timeline"]), 4)
        self.client.force_login(self.stranger.account)
        self.assertEqual(self.client.get(reverse("api_booking_timeline", args=[booking.pk]), secure=True).status_code, 404)

    def test_failed_transition_records_nothing(self):
        today = timezone.localdate()
        booking = reserve_vehicle(self.renter.pk, self.vehicle.pk, today, today)
        self.client.force_login(self.owner.account)
        self.assertEqual(self.client.post(reverse("api_booking_action", args=[booking.pk, "return"]), secure=True).status_code, 409)
        self.assertEqual(booking.events.count(), 1)


class ConstraintTests(TestCase):
    def test_database_rejects_bad_ratings_duplicate_reviews_and_negative_prices(self):
        from django.db import IntegrityError, transaction

        from .models import Feedback
        renter = make_profile("rater")
        vehicle = Vehicle.objects.create(name="Car", vehicle_type="Car", price_per_day=100)
        booking = Booking.objects.create(user=renter, vehicle=vehicle, start_date=timezone.localdate(),
                                         end_date=timezone.localdate(), total_price=100, status="Returned")
        for rating in (0, 6):
            with self.assertRaises(IntegrityError), transaction.atomic():
                Feedback.objects.create(booking=booking, user=renter, vehicle=vehicle, rating=rating, comment="x")
        Feedback.objects.create(booking=booking, user=renter, vehicle=vehicle, rating=5, comment="Good")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Feedback.objects.create(booking=booking, user=renter, vehicle=vehicle, rating=4, comment="Again")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Vehicle.objects.filter(pk=vehicle.pk).update(price_per_day=-1)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Booking.objects.filter(pk=booking.pk).update(total_price=-5)
