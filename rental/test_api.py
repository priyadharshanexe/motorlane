from datetime import date, time, timedelta
from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Vehicle


class BookingApiTests(TestCase):
    def test_booking_requires_session_and_csrf_and_reuses_overlap_check(self):
        client = Client(enforce_csrf_checks=True)
        url = reverse("api_bookings")
        self.assertEqual(client.get(url, secure=True).status_code, 403)
        vehicle = Vehicle.objects.create(name="Car", vehicle_type="Car", price_per_day=125)
        user = get_user_model().objects.create_user(username="renter")
        client.force_login(user)
        today = (timezone.localdate() + timedelta(days=1)).isoformat()  # a pickup time today may have passed
        data = {"vehicle_id": vehicle.pk, "start_date": today, "end_date": today}
        self.assertEqual(client.post(url, data, secure=True).status_code, 403)
        csrf = client.get(reverse("api_session"), secure=True).json()["csrf_token"]
        self.assertEqual(client.post(url, data, secure=True, HTTP_X_CSRFTOKEN=csrf,
                                     HTTP_REFERER="https://testserver/").status_code, 400)
        data.update(contact_name="Test renter", contact_phone="+91 99999 00000", accepted_conditions=True)
        response = client.post(url, data, secure=True, HTTP_X_CSRFTOKEN=csrf,
                               HTTP_REFERER="https://testserver/")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["total_price"], "125.00")
        response = client.post(url, data, secure=True, HTTP_X_CSRFTOKEN=csrf,
                               HTTP_REFERER="https://testserver/")
        self.assertEqual(response.status_code, 409)

    def test_a_pickup_time_that_has_passed_today_is_refused(self):
        from unittest.mock import patch
        from datetime import datetime
        vehicle = Vehicle.objects.create(name="Car", vehicle_type="Car", price_per_day=125)
        self.client.force_login(get_user_model().objects.create_user(username="late-renter"))
        noon = timezone.make_aware(datetime.combine(timezone.localdate(), time(12, 0)))
        base = {"vehicle_id": vehicle.pk, "start_date": noon.date().isoformat(), "end_date": noon.date().isoformat(),
                "contact_name": "Test renter", "contact_phone": "+91 99999 00000", "accepted_conditions": True}
        with patch("django.utils.timezone.now", return_value=noon):
            response = self.client.post(reverse("api_bookings"), {**base, "pickup_time": "09:00", "return_time": "11:00"}, secure=True)
            self.assertContains(response, "That pickup time has passed", status_code=400)
            response = self.client.post(reverse("api_bookings"), {**base, "pickup_time": "13:00", "return_time": "18:00"}, secure=True)
            self.assertEqual(response.status_code, 201)


class FavoritesApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='saved-renter')
        self.other = get_user_model().objects.create_user(username='other-renter')
        self.vehicle = Vehicle.objects.create(name='Touring', vehicle_type='Car', price_per_day=500)

    def test_saved_collection_is_private_idempotent_and_removable(self):
        from .models import Favorite
        path = f'/api/v1/favorites/{self.vehicle.pk}/'
        self.assertEqual(self.client.get('/api/v1/favorites/', secure=True).status_code, 403)
        self.client.force_login(self.user)
        self.assertEqual(self.client.post(path, secure=True).status_code, 200)
        self.assertEqual(self.client.post(path, secure=True).status_code, 200)
        self.assertEqual(Favorite.objects.count(), 1)
        self.assertEqual(len(self.client.get('/api/v1/favorites/', secure=True).json()), 1)
        self.client.force_login(self.other)
        self.assertEqual(self.client.get('/api/v1/favorites/', secure=True).json(), [])
        self.client.delete(path, secure=True)
        self.assertEqual(Favorite.objects.count(), 1)
        self.client.force_login(self.user)
        self.client.delete(path, secure=True)
        self.assertEqual(Favorite.objects.count(), 0)

    def test_unpublished_favorites_are_hidden(self):
        from .models import Favorite
        Favorite.objects.create(user=self.user, vehicle=self.vehicle)
        self.vehicle.is_available = False
        self.vehicle.save()
        self.client.force_login(self.user)
        self.assertEqual(self.client.get('/api/v1/favorites/', secure=True).json(), [])
        self.assertEqual(self.client.post(f'/api/v1/favorites/{self.vehicle.pk}/', secure=True).status_code, 404)

    def test_vehicle_details_and_rating_have_no_fabricated_defaults(self):
        self.vehicle.description = 'A comfortable touring car.'
        self.vehicle.transmission = 'Automatic'
        self.vehicle.save()
        data = self.client.get(f'/api/v1/vehicles/{self.vehicle.pk}/', secure=True).json()
        self.assertEqual(data['description'], self.vehicle.description)
        self.assertEqual(data['transmission'], 'Automatic')
        self.assertIsNone(data['rating'])
        self.assertEqual(data['review_count'], 0)

class CheckoutApiTests(TestCase):
    def test_checkout_requires_contact_and_acceptance_and_preserves_snapshot(self):
        from .models import Booking
        user = get_user_model().objects.create_user(username='checkout-renter')
        self.client.force_login(user)
        vehicle = Vehicle.objects.create(name='Car', vehicle_type='Car', price_per_day=125)
        day = (timezone.localdate() + timedelta(days=1)).isoformat()
        data = {'vehicle_id': vehicle.pk, 'start_date': day, 'end_date': day, 'checkout': True}
        response = self.client.post(reverse('api_bookings'), data, secure=True)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Booking.objects.count(), 0)
        data.update(contact_name='Rental Customer', contact_phone='+91 99999 00000', accepted_conditions=False)
        self.assertEqual(self.client.post(reverse('api_bookings'), data, secure=True).status_code, 400)
        data.update(accepted_conditions=True, pickup_notes='Please discuss pickup time.')
        response = self.client.post(reverse('api_bookings'), data, secure=True)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['contact_name'], 'Rental Customer')
        self.assertEqual(response.json()['total_price'], '125.00')
        booking = Booking.objects.get()
        self.assertEqual(booking.pickup_notes, data['pickup_notes'])
        self.assertEqual(booking.conditions_version, 'rental-conditions-v1')
        self.assertIsNotNone(booking.conditions_accepted_at)


class BookingThrottleTests(TestCase):
    def test_booking_posts_are_limited_without_blocking_history(self):
        from django.core.cache import cache
        cache.clear()
        user = get_user_model().objects.create_user(username="throttle-renter")
        self.client.force_login(user)
        url = reverse("api_bookings")
        for _ in range(10):
            self.assertEqual(self.client.post(url, {}, secure=True).status_code, 400)
        response = self.client.post(url, {}, secure=True)
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response)
        self.assertEqual(self.client.get(url, secure=True).status_code, 200)
        cache.clear()
