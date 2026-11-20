from datetime import timedelta

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Booking, Feedback, Vehicle
from .testing import make_profile


class SearchTests(TestCase):
    def setUp(self):
        now = timezone.now()
        self.cheap = Vehicle.objects.create(name="Scooter", vehicle_type="Bike", price_per_day=400,
                                            location="Madurai", created_at=now - timedelta(days=3))
        self.mid = Vehicle.objects.create(name="Hatchback", vehicle_type="Car", price_per_day=1500,
                                          location="Chennai, Adyar", created_at=now - timedelta(days=1))
        self.dear = Vehicle.objects.create(name="Sedan", vehicle_type="Car", price_per_day=3000,
                                           location="Coimbatore", created_at=now - timedelta(days=2))
        renter = make_profile("searcher")
        for vehicle, rating in ((self.cheap, 3), (self.dear, 5)):
            booking = Booking.objects.create(user=renter, vehicle=vehicle, start_date=timezone.localdate(),
                                             end_date=timezone.localdate(), total_price=1, status="Returned")
            Feedback.objects.create(booking=booking, user=renter, vehicle=vehicle, rating=rating, comment="ok")

    def names(self, **params):
        response = self.client.get(reverse("api_vehicle_list"), params, secure=True)
        self.assertEqual(response.status_code, 200, response.content)
        return [row["name"] for row in response.json()["results"]]

    def test_price_range(self):
        self.assertEqual(self.names(min_price=1000, sort="price"), ["Hatchback", "Sedan"])
        self.assertEqual(self.names(max_price=1500, sort="price"), ["Scooter", "Hatchback"])
        self.assertEqual(self.names(min_price=500, max_price=2000), ["Hatchback"])

    def test_sorts(self):
        self.assertEqual(self.names(sort="price"), ["Scooter", "Hatchback", "Sedan"])
        self.assertEqual(self.names(sort="-price"), ["Sedan", "Hatchback", "Scooter"])
        self.assertEqual(self.names(sort="rating"), ["Sedan", "Scooter", "Hatchback"])
        self.assertEqual(self.names(sort="newest"), ["Hatchback", "Sedan", "Scooter"])
        self.assertEqual(self.names(), ["Hatchback", "Scooter", "Sedan"])

    def test_location_is_case_insensitive_prefix_and_accepts_several_places(self):
        self.assertEqual(self.names(location="madu"), ["Scooter"])
        self.assertEqual(self.names(location="adyar"), ["Hatchback"])
        self.assertEqual(self.names(location="chennai, coimbatore", sort="price"), ["Hatchback", "Sedan"])
        self.assertEqual(self.names(location="durai"), [])

    def test_invalid_parameters_are_400(self):
        url = reverse("api_vehicle_list")
        for params in ({"sort": "random"}, {"min_price": "-1"}, {"min_price": 500, "max_price": 100}):
            self.assertEqual(self.client.get(url, params, secure=True).status_code, 400, params)
