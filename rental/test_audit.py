"""Regression tests for the November 2026 audit (docs/audit-2026-11-22.md)."""
from datetime import time, timedelta
from io import BytesIO
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core import mail
from django.db import connection, transaction
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone

from .models import Booking, Feedback, MaintenanceBlock, Payment, RefundIntent, Vehicle, VehiclePhoto
from .services.booking import reserve_vehicle
from .testing import make_profile, pay

FAKE = dict(PAYMENT_PROVIDER="fake", DEMO_MODE=True)


@override_settings(**FAKE)
class MoneyAfterCloseTests(TestCase):
    """A-01, A-03: money that arrives after a booking closed is refunded; failed orders are reused."""

    def setUp(self):
        self.owner, self.renter = make_profile("a1-owner"), make_profile("a1-renter")
        self.vehicle = Vehicle.objects.create(owner=self.owner, name="Car", vehicle_type="Car", price_per_day=1000,
                                              deposit=500)
        day = timezone.localdate() + timedelta(days=10)
        self.booking = reserve_vehicle(self.renter.pk, self.vehicle.pk, day, day)
        self.client.force_login(self.owner.user)
        self.client.post(reverse("api_booking_action", args=[self.booking.pk, "approve"]), secure=True)
        self.client.force_login(self.renter.user)

    def test_paying_after_cancelling_refunds_the_full_amount(self):
        self.client.post(reverse("api_payment_start", args=[self.booking.pk]), secure=True)
        signed = self.client.post(reverse("api_payment_fake_checkout", args=[self.booking.pk]), secure=True).json()
        self.assertEqual(self.client.post(reverse("api_booking_action", args=[self.booking.pk, "cancel"]),
                                          secure=True).status_code, 200)
        with self.assertLogs("rental.payments.service", "WARNING"):
            response = self.client.post(reverse("api_payment_confirm", args=[self.booking.pk]), signed, secure=True)
        self.assertEqual(response.status_code, 200)
        payment = Payment.objects.get()
        self.assertEqual((payment.status, payment.refunded_amount), ("refunded", payment.amount))
        self.assertEqual(RefundIntent.objects.get().reason, "booking_closed")

    def test_a_failed_payment_is_retried_on_the_same_order(self):
        first = self.client.post(reverse("api_payment_start", args=[self.booking.pk]), secure=True).json()
        Payment.objects.update(status=Payment.Status.FAILED)
        second = self.client.post(reverse("api_payment_start", args=[self.booking.pk]), secure=True).json()
        self.assertEqual(first["order_id"], second["order_id"])
        self.assertEqual(Payment.objects.get().status, "created")


@override_settings(**FAKE, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class NoShowAndExpiryTests(TestCase):
    """A-02, A-08: a no-show keeps the rental charge but returns the deposit, and renters are told."""

    def test_no_show_refunds_the_deposit_and_emails_the_renter(self):
        from .services.expiry import expire_bookings
        owner, renter = make_profile("ns-owner"), make_profile("ns-renter", email="ns@example.com")
        vehicle = Vehicle.objects.create(owner=owner, name="Van", vehicle_type="Car", price_per_day=1000, deposit=700)
        day = timezone.localdate() + timedelta(days=3)
        booking = reserve_vehicle(renter.pk, vehicle.pk, day, day)
        Booking.objects.filter(pk=booking.pk).update(status=Booking.Status.CONFIRMED)
        pay(booking)
        past = timezone.localdate() - timedelta(days=2)
        Booking.objects.filter(pk=booking.pk).update(start_date=past, end_date=past)
        mail.outbox.clear()
        with self.captureOnCommitCallbacks(execute=True):
            expire_bookings()
        payment = Payment.objects.get()
        self.assertEqual(payment.refunded_amount, 700)
        self.assertEqual(RefundIntent.objects.get().reason, "deposit")
        self.assertIn("Deposit of ₹700.00 refunded.", booking.events.filter(kind="status").last().note)
        self.assertEqual([m.subject for m in mail.outbox], ["Your Van booking expired"])

    def test_expired_request_emails_the_renter(self):
        from .services.expiry import expire_bookings
        renter = make_profile("ex-renter", email="ex@example.com")
        vehicle = Vehicle.objects.create(name="Bike", vehicle_type="Bike", price_per_day=300)
        day = timezone.localdate() + timedelta(days=3)
        booking = reserve_vehicle(renter.pk, vehicle.pk, day, day)
        Booking.objects.filter(pk=booking.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        with self.captureOnCommitCallbacks(execute=True):
            expire_bookings()
        self.assertIn("Your Bike request expired", [m.subject for m in mail.outbox])


class ValidationLimitTests(TestCase):
    """A-05, A-06: rental length, lead time and self-booking."""

    def setUp(self):
        self.owner = make_profile("val-owner")
        self.vehicle = Vehicle.objects.create(owner=self.owner, name="Car", vehicle_type="Car", price_per_day=100)

    def quote(self, start, end):
        return self.client.get(reverse("api_quote", args=[self.vehicle.pk]),
                               {"start_date": start, "end_date": end}, secure=True)

    @override_settings(RENTAL_MAX_DAYS=90, RENTAL_MAX_ADVANCE_DAYS=365)
    def test_too_long_or_too_far_ahead_is_a_field_error(self):
        today = timezone.localdate()
        long = self.quote(today + timedelta(days=1), today + timedelta(days=95))
        self.assertEqual(long.status_code, 400)
        self.assertIn("up to 90 days", str(long.json()))
        far = self.quote(today + timedelta(days=400), today + timedelta(days=401))
        self.assertIn("365 days ahead", str(far.json()))
        self.assertEqual(self.quote(today + timedelta(days=1), today + timedelta(days=90)).status_code, 200)
        past = self.quote(today - timedelta(days=1), today)
        self.assertEqual(past.status_code, 400)

    def test_owners_cannot_book_their_own_vehicle(self):
        from django.core.exceptions import ValidationError
        day = timezone.localdate() + timedelta(days=2)
        with self.assertRaisesMessage(ValidationError, "You cannot book your own vehicle."):
            reserve_vehicle(self.owner.pk, self.vehicle.pk, day, day)


@override_settings(**FAKE)
class WebhookShapeTests(TestCase):
    """A-07: a signed webhook whose JSON is not an object is a 400, not a 500."""

    @override_settings(PAYMENT_WEBHOOK_SECRET="whsec-audit")
    def test_non_object_body(self):
        from .payments.providers import sign
        for body in (b"[]", b"42", b'"text"'):
            response = self.client.post(reverse("api_payment_webhook"), body, content_type="application/json", secure=True,
                                        HTTP_X_RAZORPAY_SIGNATURE=sign("whsec-audit", body), HTTP_X_RAZORPAY_EVENT_ID="e1")
            self.assertEqual(response.status_code, 400, body)


class PhotoDeletionTests(TestCase):
    """A-04: photo files are removed only after the deletion commits."""

    def test_rolled_back_deletion_keeps_the_files(self):
        from django.core.files.base import ContentFile
        from PIL import Image

        from .services.photos import add_photo, delete_photo
        with TemporaryDirectory() as media, override_settings(MEDIA_ROOT=media):
            vehicle = Vehicle.objects.create(name="Car", vehicle_type="Car", price_per_day=100)
            images = []
            for color in ("red", "blue"):
                data = BytesIO()
                Image.new("RGB", (40, 30), color).save(data, format="PNG")
                images.append(add_photo(vehicle, ContentFile(data.getvalue(), name=f"{color}.png")))
            photo = images[1]
            with self.captureOnCommitCallbacks(execute=False) as callbacks:
                try:
                    with transaction.atomic():
                        delete_photo(vehicle, photo.pk)
                        raise RuntimeError("rollback")
                except RuntimeError:
                    pass
            self.assertEqual(callbacks, [])
            self.assertTrue(VehiclePhoto.objects.filter(pk=photo.pk).exists())
            self.assertTrue(photo.image.storage.exists(photo.image.name))
            with self.captureOnCommitCallbacks(execute=True):
                delete_photo(vehicle, photo.pk)
            self.assertFalse(photo.image.storage.exists(photo.image.name))


class QueryCountTests(TestCase):
    """A-09: list endpoints run a fixed number of queries, however many rows they return."""

    def setUp(self):
        self.owner, self.renter = make_profile("q-owner"), make_profile("q-renter")

    def add(self, count):
        for i in range(count):
            vehicle = Vehicle.objects.create(owner=self.owner, name=f"Car {i}", vehicle_type="Car", price_per_day=100)
            day = timezone.localdate() - timedelta(days=30 + i)
            booking = Booking.objects.create(user=self.renter, vehicle=vehicle, start_date=day, end_date=day,
                                             total_price=100, status="Returned")
            Feedback.objects.create(booking=booking, user=self.renter, vehicle=vehicle, rating=4, comment="ok")
            VehiclePhoto.objects.create(vehicle=vehicle, image=f"vehicles/{i}.webp", is_cover=True)

    def queries(self, profile, url):
        self.client.force_login(profile.user)
        with CaptureQueriesContext(connection) as ctx:
            self.assertEqual(self.client.get(url, secure=True).status_code, 200)
        return len(ctx)

    def test_bookings_owner_bookings_and_fleet_do_not_grow_with_rows(self):
        self.add(2)
        small = [self.queries(self.renter, reverse("api_bookings")), self.queries(self.owner, reverse("api_owner_bookings")),
                 self.queries(self.owner, reverse("api_fleet"))]
        self.add(6)
        large = [self.queries(self.renter, reverse("api_bookings")), self.queries(self.owner, reverse("api_owner_bookings")),
                 self.queries(self.owner, reverse("api_fleet"))]
        self.assertEqual(small, large)


@override_settings(**FAKE)
class AuthorizationMatrixTests(TestCase):
    """A-10 (tester): every endpoint that touches someone's data refuses other accounts and anonymous users."""

    def setUp(self):
        self.owner, self.renter, self.stranger = make_profile("m-owner"), make_profile("m-renter"), make_profile("m-x")
        self.vehicle = Vehicle.objects.create(owner=self.owner, name="Car", vehicle_type="Car", price_per_day=100)
        self.photo = VehiclePhoto.objects.create(vehicle=self.vehicle, image="vehicles/x.webp", is_cover=True)
        self.block = MaintenanceBlock.objects.create(vehicle=self.vehicle, start_date=timezone.localdate() + timedelta(days=50),
                                                     end_date=timezone.localdate() + timedelta(days=50), reason="Service")
        day = timezone.localdate() + timedelta(days=5)
        self.booking = reserve_vehicle(self.renter.pk, self.vehicle.pk, day, day, time(9), time(18))

    def endpoints(self):
        b, v = self.booking.pk, self.vehicle.pk
        return [
            ("get", reverse("api_booking_detail", args=[b])), ("get", reverse("api_booking_timeline", args=[b])),
            ("get", reverse("api_cancellation_preview", args=[b])), ("post", reverse("api_payment_start", args=[b])),
            ("post", reverse("api_payment_fake_checkout", args=[b])), ("post", reverse("api_review", args=[b])),
            ("post", reverse("api_booking_action", args=[b, "cancel"])), ("post", reverse("api_booking_action", args=[b, "approve"])),
            ("patch", reverse("api_fleet_vehicle", args=[v])), ("delete", reverse("api_fleet_vehicle", args=[v])),
            ("get", reverse("api_fleet_photos", args=[v])), ("post", reverse("api_fleet_photos", args=[v])),
            ("delete", reverse("api_fleet_photo", args=[v, self.photo.pk])), ("post", reverse("api_fleet_photo_order", args=[v])),
            ("get", reverse("api_maintenance", args=[v])), ("delete", reverse("api_maintenance_block", args=[v, self.block.pk])),
            ("get", f"/download-receipt/{b}/"),
        ]

    def test_strangers_get_404_and_anonymous_users_are_refused(self):
        for method, url in self.endpoints():
            self.client.force_login(self.stranger.user)
            response = getattr(self.client, method)(url, secure=True)
            self.assertEqual(response.status_code, 404, f"stranger {method} {url}")
        self.client.logout()
        for method, url in self.endpoints():
            response = getattr(self.client, method)(url, secure=True)
            self.assertIn(response.status_code, (302, 403), f"anonymous {method} {url}")
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, "Pending")
        self.assertTrue(VehiclePhoto.objects.filter(pk=self.photo.pk).exists())

    def test_renter_cannot_act_as_owner_and_owner_cannot_act_as_renter(self):
        self.client.force_login(self.renter.user)
        for action in ("approve", "reject", "pickup", "return"):
            self.assertEqual(self.client.post(reverse("api_booking_action", args=[self.booking.pk, action]),
                                              secure=True).status_code, 404)
        self.client.force_login(self.owner.user)
        self.assertEqual(self.client.post(reverse("api_booking_action", args=[self.booking.pk, "cancel"]),
                                          secure=True).status_code, 404)
        self.assertEqual(self.client.post(reverse("api_payment_start", args=[self.booking.pk]), secure=True).status_code, 404)
        self.assertEqual(self.client.get(f"/download-receipt/{self.booking.pk}/", secure=True).status_code, 404)

    def test_archived_vehicles_are_hidden_and_unbookable(self):
        from django.core.exceptions import ValidationError
        Vehicle.objects.filter(pk=self.vehicle.pk).update(archived_at=timezone.now(), is_available=False)
        self.assertEqual(self.client.get(reverse("api_vehicle_detail", args=[self.vehicle.pk]), secure=True).status_code, 404)
        self.client.force_login(self.stranger.user)
        self.assertEqual(self.client.post(f"/api/v1/favorites/{self.vehicle.pk}/", secure=True).status_code, 404)
        with self.assertRaises(ValidationError):
            day = timezone.localdate() + timedelta(days=20)
            reserve_vehicle(self.stranger.pk, self.vehicle.pk, day, day)


class InputEdgeTests(TestCase):
    """Tester: malformed and hostile input is rejected cleanly."""

    def setUp(self):
        self.renter = make_profile("edge-renter")
        self.vehicle = Vehicle.objects.create(name="Car", vehicle_type="Car", price_per_day=100)
        self.client.force_login(self.renter.user)

    def book(self, **fields):
        from django.core.cache import cache
        cache.clear()  # the booking throttle (10 a minute) is tested elsewhere
        day = (timezone.localdate() + timedelta(days=3)).isoformat()
        data = {"vehicle_id": self.vehicle.pk, "start_date": day, "end_date": day, "contact_name": "R",
                "contact_phone": "+91 99999 00000", "accepted_conditions": True, **fields}
        return self.client.post(reverse("api_bookings"), data, content_type="application/json", secure=True)

    def test_bad_booking_payloads(self):
        for fields in ({"vehicle_id": "abc"}, {"vehicle_id": -1}, {"start_date": "2020-01-01"}, {"end_date": "nope"},
                       {"pickup_time": "25:00"}, {"contact_phone": "call me"}, {"contact_name": "x" * 101},
                       {"pickup_notes": "x" * 1001}, {"accepted_conditions": False}):
            self.assertEqual(self.book(**fields).status_code, 400, fields)
        self.assertEqual(self.book(vehicle_id=999999).status_code, 404)
        response = self.client.post(reverse("api_bookings"), "[1, 2]", content_type="application/json", secure=True)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Booking.objects.count(), 0)

    def test_review_validation(self):
        day = timezone.localdate() - timedelta(days=3)
        booking = Booking.objects.create(user=self.renter, vehicle=self.vehicle, start_date=day, end_date=day,
                                         total_price=100, status="Returned")
        url = reverse("api_review", args=[booking.pk])
        for data in ({"rating": 0, "comment": "x"}, {"rating": 6, "comment": "x"}, {"rating": 5, "comment": ""},
                     {"rating": 5, "comment": "x" * 501}, {"rating": "five", "comment": "x"}):
            self.assertEqual(self.client.post(url, data, secure=True).status_code, 400, data)
        self.assertFalse(Feedback.objects.exists())

    def test_oversized_and_fake_images_are_refused(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from PIL import Image
        owner = make_profile("img-owner")
        self.client.force_login(owner.user)
        base = {"name": "Car", "vehicle_type": "Car", "fuel_type": "Petrol", "price_per_day": "100"}
        huge = BytesIO()
        Image.new("RGB", (5000, 10), "white").save(huge, format="PNG")
        for upload in (SimpleUploadedFile("x.png", b"not an image", "image/png"),
                       SimpleUploadedFile("x.png", huge.getvalue(), "image/png"),
                       SimpleUploadedFile("x.svg", b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml")):
            response = self.client.post(reverse("api_fleet"), {**base, "vehicle_image": upload}, secure=True)
            self.assertEqual(response.status_code, 400, upload.name)
        self.assertFalse(Vehicle.objects.filter(owner=owner).exists())

    def test_errors_do_not_leak_internals(self):
        response = self.client.get(reverse("api_quote", args=[self.vehicle.pk]), {"start_date": "x"}, secure=True)
        self.assertNotIn("Traceback", response.content.decode())
        self.assertEqual(self.client.get("/api/v1/vehicles/?page=999", secure=True).status_code, 404)
