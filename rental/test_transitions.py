"""Every booking action from every status, by every kind of account."""
from datetime import time, timedelta

from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import Booking, Vehicle
from .testing import make_profile, starting_soon

S = Booking.Status
ALL = [S.PENDING, S.CONFIRMED, S.REJECTED, S.EXPIRED, S.CANCELLED, S.IN_PROGRESS, S.RETURNED]
# action -> (who may do it, statuses it is allowed from, resulting status)
RULES = {
    "approve": ("owner", {S.PENDING}, S.CONFIRMED),
    "reject": ("owner", {S.PENDING}, S.REJECTED),
    "cancel": ("renter", {S.PENDING, S.CONFIRMED}, S.CANCELLED),
    "pickup": ("owner", {S.CONFIRMED}, S.IN_PROGRESS),
    "return": ("owner", {S.IN_PROGRESS}, S.RETURNED),
}


class TransitionMatrixTests(TestCase):
    def setUp(self):
        self.owner = make_profile("matrix-owner")
        self.renter = make_profile("matrix-renter")
        self.other_owner = make_profile("matrix-other-owner")
        self.stranger = make_profile("matrix-stranger")
        self.vehicle = Vehicle.objects.create(owner=self.owner, name="Car", vehicle_type="Car", price_per_day=100)
        Vehicle.objects.create(owner=self.other_owner, name="Other", vehicle_type="Car", price_per_day=100)

    def booking(self, status):
        today = timezone.localdate()
        # Pickup today at 00:01 so pickup is allowed; cancellation of confirmed bookings needs a later pickup.
        start = today if status in (S.CONFIRMED, S.IN_PROGRESS) else today + timedelta(days=2)
        return Booking.objects.create(user=self.renter, vehicle=self.vehicle, start_date=start, end_date=start + timedelta(days=1),
                                      pickup_time=time(0, 1), total_price=100, status=status)

    def post(self, profile, booking, action):
        self.client.force_login(profile.user)
        return self.client.post(reverse("api_booking_action", args=[booking.pk, action]), secure=True)

    def test_every_action_from_every_status(self):
        for action, (role, allowed, destination) in RULES.items():
            actor = self.owner if role == "owner" else self.renter
            for status in ALL:
                with self.subTest(action=action, status=status):
                    booking = self.booking(status)
                    if action == "cancel" and status == S.CONFIRMED:
                        Booking.objects.filter(pk=booking.pk).update(start_date=timezone.localdate() + timedelta(days=3),
                                                                     end_date=timezone.localdate() + timedelta(days=4))
                    response = self.post(actor, booking, action)
                    booking.refresh_from_db()
                    if status in allowed:
                        self.assertEqual(response.status_code, 200, response.content)
                        self.assertEqual(booking.status, destination)
                        self.assertEqual(booking.events.filter(kind="status").last().to_status, destination)
                    else:
                        self.assertEqual(response.status_code, 409, response.content)
                        self.assertEqual(booking.status, status)
                        self.assertFalse(booking.events.exists())
                    booking.delete()  # keep one booking per vehicle so pickups do not block each other

    def test_the_wrong_party_gets_404_and_nothing_changes(self):
        for action, (role, allowed, _) in RULES.items():
            status = sorted(allowed)[0]
            wrong = [self.stranger, self.other_owner, self.renter if role == "owner" else self.owner]
            for profile in wrong:
                with self.subTest(action=action, actor=profile.user.username):
                    booking = self.booking(status)
                    self.assertEqual(self.post(profile, booking, action).status_code, 404)
                    booking.refresh_from_db()
                    self.assertEqual(booking.status, status)
                    booking.delete()

    def test_unknown_action_and_get_are_refused(self):
        booking = self.booking(S.PENDING)
        self.assertEqual(self.post(self.owner, booking, "teleport").status_code, 404)
        self.assertEqual(self.client.get(reverse("api_booking_action", args=[booking.pk, "approve"]), secure=True).status_code, 405)

    def test_anonymous_requests_are_refused(self):
        booking = self.booking(S.PENDING)
        self.assertEqual(self.client.post(reverse("api_booking_action", args=[booking.pk, "approve"]), secure=True).status_code, 403)
        self.assertEqual(self.client.get(reverse("api_booking_detail", args=[booking.pk]), secure=True).status_code, 403)

    def test_a_second_pickup_needs_the_first_return(self):
        first = self.booking(S.IN_PROGRESS)
        second = self.booking(S.CONFIRMED)
        self.assertEqual(self.post(self.owner, second, "pickup").json()["detail"],
                         "Record the previous rental's return before pickup.")
        self.post(self.owner, first, "return")
        self.assertEqual(self.post(self.owner, second, "pickup").status_code, 200)

    def test_confirmed_booking_cannot_be_cancelled_after_pickup_time(self):
        booking = self.booking(S.CONFIRMED)
        self.assertEqual(self.post(self.renter, booking, "cancel").status_code, 409)

    def test_owners_only_see_their_own_vehicles_bookings(self):
        self.booking(S.PENDING)
        self.client.force_login(self.other_owner.user)
        self.assertEqual(self.client.get(reverse("api_owner_bookings"), secure=True).json(), [])
        self.client.force_login(self.owner.user)
        self.assertEqual(len(self.client.get(reverse("api_owner_bookings"), secure=True).json()), 1)
        self.client.force_login(self.stranger.user)
        self.assertEqual(self.client.get(reverse("api_bookings"), secure=True).json(), [])

    def test_owners_cannot_edit_others_listings_or_maintenance(self):
        self.client.force_login(self.other_owner.user)
        self.assertEqual(self.client.patch(reverse("api_fleet_vehicle", args=[self.vehicle.pk]), {"is_available": False},
                                           content_type="application/json", secure=True).status_code, 404)
        self.assertEqual(self.client.get(reverse("api_maintenance", args=[self.vehicle.pk]), secure=True).status_code, 404)


class EndToEndApiTests(TestCase):
    """The whole rental through the public API, the way the browser client drives it."""

    def test_search_quote_book_approve_pay_pickup_return_review(self):
        from django.core import mail
        from django.test import override_settings

        owner, renter = make_profile("e2e-owner", name="Asha Owner"), make_profile("e2e-renter", name="Ravi Renter")
        with override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"):
            self.client.force_login(owner.user)
            from io import BytesIO

            from django.core.files.uploadedfile import SimpleUploadedFile
            from PIL import Image
            image = BytesIO()
            Image.new("RGB", (64, 48), "teal").save(image, format="PNG")
            from tempfile import TemporaryDirectory
            with TemporaryDirectory() as media, override_settings(MEDIA_ROOT=media):
                listing = self.client.post(reverse("api_fleet"), {
                    "name": "Jupiter", "vehicle_type": "Bike", "fuel_type": "Petrol", "price_per_day": "600",
                    "deposit": "1000", "location": "Salem",
                    "vehicle_image": SimpleUploadedFile("j.png", image.getvalue(), "image/png")}, secure=True)
            self.assertEqual(listing.status_code, 201, listing.content)
            vehicle_id = listing.json()["id"]

            start, end, pickup, dropoff = starting_soon()
            window = {"start_date": start.isoformat(), "end_date": end.isoformat(),
                      "pickup_time": pickup.strftime("%H:%M"), "return_time": dropoff.strftime("%H:%M")}
            self.client.force_login(renter.user)
            found = self.client.get(reverse("api_vehicle_list"), {**window, "location": "salem"}, secure=True).json()
            self.assertEqual([v["id"] for v in found["results"]], [vehicle_id])
            quote = self.client.get(reverse("api_quote", args=[vehicle_id]), window, secure=True).json()
            self.assertEqual((quote["rental_total"], quote["due_now"]), ("600.00", "1600.00"))
            with self.captureOnCommitCallbacks(execute=True):
                booking = self.client.post(reverse("api_bookings"), {
                    **window, "vehicle_id": vehicle_id, "contact_name": "Ravi", "contact_phone": "+91 98765 43210",
                    "accepted_conditions": True}, secure=True)
            self.assertEqual(booking.status_code, 201, booking.content)
            booking_id = booking.json()["id"]

            def act(profile, action):
                self.client.force_login(profile.user)
                with self.captureOnCommitCallbacks(execute=True):
                    response = self.client.post(reverse("api_booking_action", args=[booking_id, action]), secure=True)
                self.assertEqual(response.status_code, 200, response.content)
                return response.json()

            act(owner, "approve")
            self.client.force_login(renter.user)
            self.assertEqual(self.client.post(reverse("api_payment_start", args=[booking_id]), secure=True).json()["amount"], 160000)
            signed = self.client.post(reverse("api_payment_fake_checkout", args=[booking_id]), secure=True).json()
            self.assertEqual(self.client.post(reverse("api_payment_confirm", args=[booking_id]), signed, secure=True).json()["status"], "paid")
            act(owner, "pickup")
            returned = act(owner, "return")
            self.assertEqual(returned["payment"]["refunded"], "1000.00")
            self.client.force_login(renter.user)
            review = self.client.post(reverse("api_review", args=[booking_id]), {"rating": 5, "comment": "Great"}, secure=True)
            self.assertEqual(review.status_code, 201)
            detail = self.client.get(reverse("api_booking_detail", args=[booking_id]), secure=True).json()
            self.assertEqual([e["to_status"] for e in detail["timeline"] if e["kind"] == "status"],
                             ["Pending", "Confirmed", "In progress", "Returned"])
            self.assertIn("paid", [e["kind"] for e in detail["timeline"]])
            self.assertTrue(detail["reviewed"])
            vehicle = self.client.get(reverse("api_vehicle_detail", args=[vehicle_id]), secure=True).json()
            self.assertEqual((vehicle["rating"], vehicle["review_count"]), (5.0, 1))
            self.assertEqual([m.subject for m in mail.outbox], [
                "New rental request for your Jupiter", "Your Jupiter rental is confirmed",
                "We received your Jupiter back", "How was your Jupiter rental?"])


@override_settings(RENTAL_PICKUP_GRACE_MINUTES=60)
class PickupWindowTests(TestCase):
    """Pickup opens a grace period before the agreed time and closes at the agreed return time."""

    def setUp(self):
        self.owner, self.renter = make_profile("pw-owner"), make_profile("pw-renter")
        self.vehicle = Vehicle.objects.create(owner=self.owner, name="Car", vehicle_type="Car", price_per_day=100)
        self.client.force_login(self.owner.user)

    def booking(self, minutes_until_pickup, hours=4):
        start, end, pickup, dropoff = starting_soon(minutes=minutes_until_pickup, hours=hours)
        return Booking.objects.create(user=self.renter, vehicle=self.vehicle, start_date=start, end_date=end,
                                      pickup_time=pickup, return_time=dropoff, total_price=100, status="Confirmed")

    def pickup(self, booking):
        return self.client.post(reverse("api_booking_action", args=[booking.pk, "pickup"]), secure=True)

    def test_early_pickup_is_refused_with_the_opening_time(self):
        early = self.booking(minutes_until_pickup=180)
        response = self.pickup(early)
        self.assertEqual(response.status_code, 409)
        opens = timezone.localtime(early.pickup_at - timedelta(minutes=60))
        self.assertEqual(response.json()["detail"], f"Pickup opens at {opens:%H:%M} on {opens.day} {opens:%b}.")
        early.refresh_from_db()
        self.assertIsNone(early.picked_up_at)

    def test_pickup_inside_the_grace_window_and_late_pickup_are_allowed(self):
        self.assertEqual(self.pickup(self.booking(minutes_until_pickup=45)).status_code, 200)
        Booking.objects.update(status="Returned")
        self.assertEqual(self.pickup(self.booking(minutes_until_pickup=-90)).status_code, 200)  # 90 min late

    def test_pickup_after_the_return_time_is_refused(self):
        over = self.booking(minutes_until_pickup=-300, hours=2)
        Booking.objects.filter(pk=over.pk).update(status="Confirmed")
        response = self.pickup(over)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "This booking has expired: its time window has passed.")

    def test_requests_and_no_shows_expire_by_time_not_by_date(self):
        from .services.expiry import expire_bookings
        missed = self.booking(minutes_until_pickup=-120, hours=1)  # return was an hour ago
        Booking.objects.filter(pk=missed.pk).update(status="Confirmed")
        waiting = self.booking(minutes_until_pickup=-30, hours=4)
        Booking.objects.filter(pk=waiting.pk).update(status="Pending")
        still_on = self.booking(minutes_until_pickup=-30, hours=4)
        expired = expire_bookings()
        self.assertCountEqual(expired, [missed.pk, waiting.pk])
        still_on.refresh_from_db()
        self.assertEqual(still_on.status, "Confirmed")
