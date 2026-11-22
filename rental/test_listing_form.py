from io import BytesIO
from tempfile import TemporaryDirectory

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from PIL import Image

from .models import Vehicle
from .testing import make_profile


def image():
    data = BytesIO()
    Image.new("RGB", (80, 50), "olive").save(data, format="PNG")
    return SimpleUploadedFile("v.png", data.getvalue(), "image/png")


class ListingPricingFieldTests(TestCase):
    def setUp(self):
        self.media = TemporaryDirectory()
        self.override = override_settings(MEDIA_ROOT=self.media.name)
        self.override.enable()
        self.owner = make_profile("form-owner")
        self.client.force_login(self.owner.user)
        self.base = {"name": "Nexon", "vehicle_type": "Car", "fuel_type": "Diesel", "price_per_day": "2000",
                     "location": "Salem"}

    def tearDown(self):
        self.override.disable()
        self.media.cleanup()

    def create(self, **fields):
        return self.client.post(reverse("api_fleet"), {**self.base, **fields, "vehicle_image": image()}, secure=True)

    def test_create_with_weekend_rate_and_deposit(self):
        response = self.create(weekend_price_per_day="2500", deposit="3000")
        self.assertEqual(response.status_code, 201, response.content)
        vehicle = Vehicle.objects.get()
        self.assertEqual((str(vehicle.weekend_price_per_day), str(vehicle.deposit)), ("2500.00", "3000.00"))

    def test_blank_optional_fields_mean_no_weekend_rate_and_no_deposit(self):
        self.assertEqual(self.create(weekend_price_per_day="", deposit="").status_code, 201)
        vehicle = Vehicle.objects.get()
        self.assertIsNone(vehicle.weekend_price_per_day)
        self.assertEqual(vehicle.deposit, 0)

    def test_invalid_amounts_are_rejected(self):
        for fields in ({"deposit": "-1"}, {"weekend_price_per_day": "0"}, {"weekend_price_per_day": "-50"},
                       {"deposit": "100000000"}, {"price_per_day": "0"}):
            response = self.create(**fields)
            self.assertEqual(response.status_code, 400, fields)
        self.assertFalse(Vehicle.objects.exists())

    def test_edit_changes_and_clears_the_weekend_rate(self):
        self.create(weekend_price_per_day="2500", deposit="3000")
        vehicle = Vehicle.objects.get()
        url = reverse("api_fleet_vehicle", args=[vehicle.pk])
        response = self.patch(url, {"weekend_price_per_day": "", "deposit": "1500"})
        self.assertEqual(response.status_code, 200, response.content)
        vehicle.refresh_from_db()
        self.assertIsNone(vehicle.weekend_price_per_day)
        self.assertEqual(str(vehicle.deposit), "1500.00")
        self.assertEqual(self.patch(url, {"deposit": "-5"}).status_code, 400)

    def patch(self, url, data):
        from django.test.client import BOUNDARY, MULTIPART_CONTENT, encode_multipart
        return self.client.patch(url, encode_multipart(BOUNDARY, data), content_type=MULTIPART_CONTENT, secure=True)
