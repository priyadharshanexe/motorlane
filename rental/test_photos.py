from io import BytesIO
from tempfile import TemporaryDirectory

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from PIL import Image

from .models import Vehicle, VehiclePhoto
from .testing import make_profile


def upload(name="car.png", size=(1600, 900), color="navy", fmt="PNG"):
    data = BytesIO()
    Image.new("RGB", size, color).save(data, format=fmt)
    return SimpleUploadedFile(name, data.getvalue(), f"image/{fmt.lower()}")


class PhotoTests(TestCase):
    def setUp(self):
        self.media = TemporaryDirectory()
        self.settings_override = override_settings(MEDIA_ROOT=self.media.name)
        self.settings_override.enable()
        self.owner = make_profile("photo-owner")
        self.other = make_profile("photo-other")
        self.client.force_login(self.owner.user)
        response = self.client.post(reverse("api_fleet"), {
            "name": "Venue", "vehicle_type": "Car", "fuel_type": "Petrol", "price_per_day": "2400",
            "location": "Coimbatore", "vehicle_image": upload(),
        }, secure=True)
        self.assertEqual(response.status_code, 201, response.content)
        self.vehicle = Vehicle.objects.get()

    def tearDown(self):
        self.settings_override.disable()
        self.media.cleanup()

    def photos_url(self):
        return reverse("api_fleet_photos", args=[self.vehicle.pk])

    def test_listing_image_becomes_cover_with_two_webp_thumbnails(self):
        photo = VehiclePhoto.objects.get()
        self.assertTrue(photo.is_cover)
        for field, width in (("thumb_small", 400), ("thumb_large", 1200)):
            file = getattr(photo, field)
            self.assertTrue(file.name.endswith(f"-{width}.webp"))
            with Image.open(file.path) as image:
                self.assertEqual((image.format, image.width, image.height), ("WEBP", width, round(900 * width / 1600)))
        data = self.client.get(reverse("api_vehicle_detail", args=[self.vehicle.pk]), secure=True).json()
        self.assertTrue(data["vehicle_image"].endswith("-1200.webp"))
        self.assertEqual(len(data["photos"]), 1)

    def test_small_images_are_not_upscaled(self):
        self.client.post(self.photos_url(), {"image": upload("tiny.jpg", (300, 200), fmt="JPEG")}, secure=True)
        photo = VehiclePhoto.objects.order_by("-pk").first()
        with Image.open(photo.thumb_large.path) as image:
            self.assertEqual(image.size, (300, 200))

    def test_add_reorder_set_cover_and_delete(self):
        second = self.client.post(self.photos_url(), {"image": upload("b.png")}, secure=True).json()
        third = self.client.post(self.photos_url(), {"image": upload("c.png"), "cover": "true"}, secure=True).json()
        self.assertTrue(third["is_cover"])
        self.assertEqual(VehiclePhoto.objects.filter(is_cover=True).count(), 1)
        first = VehiclePhoto.objects.order_by("pk").first().pk
        order = [third["id"], first, second["id"]]
        response = self.client.post(reverse("api_fleet_photo_order", args=[self.vehicle.pk]), {"order": order},
                                    content_type="application/json", secure=True)
        self.assertEqual([p["id"] for p in response.json()], order)
        bad = self.client.post(reverse("api_fleet_photo_order", args=[self.vehicle.pk]), {"order": order[:2]},
                               content_type="application/json", secure=True)
        self.assertEqual(bad.status_code, 400)
        self.client.patch(reverse("api_fleet_photo", args=[self.vehicle.pk, second["id"]]), {"cover": True},
                          content_type="application/json", secure=True)
        self.assertEqual(VehiclePhoto.objects.get(is_cover=True).pk, second["id"])
        self.assertEqual(self.client.delete(reverse("api_fleet_photo", args=[self.vehicle.pk, second["id"]]),
                                            secure=True).status_code, 204)
        self.assertEqual(VehiclePhoto.objects.filter(is_cover=True).count(), 1)

    def test_last_photo_cannot_be_deleted_and_limits_apply(self):
        only = VehiclePhoto.objects.get()
        self.assertEqual(self.client.delete(reverse("api_fleet_photo", args=[self.vehicle.pk, only.pk]),
                                            secure=True).status_code, 409)
        for i in range(7):
            self.client.post(self.photos_url(), {"image": upload(f"{i}.png", (40, 30))}, secure=True)
        self.assertEqual(self.client.post(self.photos_url(), {"image": upload("x.png", (40, 30))},
                                          secure=True).status_code, 409)
        bad = SimpleUploadedFile("x.gif", b"GIF89a", "image/gif")
        self.assertEqual(self.client.post(self.photos_url(), {"image": bad}, secure=True).status_code, 400)

    def test_only_the_owner_can_manage_photos(self):
        self.client.force_login(self.other.user)
        self.assertEqual(self.client.post(self.photos_url(), {"image": upload()}, secure=True).status_code, 404)
        photo = VehiclePhoto.objects.get()
        self.assertEqual(self.client.delete(reverse("api_fleet_photo", args=[self.vehicle.pk, photo.pk]),
                                            secure=True).status_code, 404)
