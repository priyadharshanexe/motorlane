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
            self.assertRegex(file.name, rf"-{width}-[0-9a-f]{{10}}\.webp$")
            with Image.open(file.path) as image:
                self.assertEqual((image.format, image.width, image.height), ("WEBP", width, round(900 * width / 1600)))
        data = self.client.get(reverse("api_vehicle_detail", args=[self.vehicle.pk]), secure=True).json()
        self.assertRegex(data["vehicle_image"], r"-1200-[0-9a-f]{10}\.webp$")
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


class FastCardImageTests(TestCase):
    def setUp(self):
        self.media = TemporaryDirectory()
        self.override = override_settings(MEDIA_ROOT=self.media.name, SERVE_MEDIA=True)
        self.override.enable()

    def tearDown(self):
        self.override.disable()
        self.media.cleanup()

    def add_real_photo(self):
        from pathlib import Path

        from django.core.files.base import ContentFile

        from .services.photos import add_photo
        vehicle = Vehicle.objects.create(name="City", vehicle_type="Car", price_per_day=2600)
        data = (Path(__file__).parent / "demo_images" / "honda-city.webp").read_bytes()
        return vehicle, add_photo(vehicle, ContentFile(data, name="honda-city.webp"), cover=True)

    def test_card_thumbnail_is_small_hashed_and_described(self):
        vehicle, photo = self.add_real_photo()
        self.assertLess(photo.thumb_small.size, 60 * 1024)
        self.assertRegex(photo.thumb_small.name, r"-400-[0-9a-f]{10}\.webp$")
        self.assertEqual((photo.width, photo.height), (960, 639))
        self.assertRegex(photo.color, r"^#[0-9a-f]{6}$")
        cover = self.client.get(reverse("api_vehicle_list"), secure=True).json()["results"][0]["cover"]
        self.assertTrue(cover["small"].endswith(photo.thumb_small.name.split("/")[-1]))
        self.assertTrue(cover["large"].endswith(photo.thumb_large.name.split("/")[-1]))
        self.assertEqual((cover["width"], cover["height"], cover["color"]), (960, 639, photo.color))

    def test_thumbnails_are_cached_forever_and_originals_for_a_day(self):
        _, photo = self.add_real_photo()
        thumb = self.client.get(f"/media/{photo.thumb_small.name}", secure=True)
        self.assertEqual(thumb["Cache-Control"], "public, max-age=31536000, immutable")
        original = self.client.get(f"/media/{photo.image.name}", secure=True)
        self.assertEqual(original["Cache-Control"], "public, max-age=86400")
        thumb.close()
        original.close()

    def test_regenerate_command_backfills_and_replaces_old_files(self):
        from io import StringIO

        from django.core.management import call_command
        _, photo = self.add_real_photo()
        VehiclePhoto.objects.filter(pk=photo.pk).update(width=None, height=None, color="")
        old_small = photo.thumb_small.name
        out = StringIO()
        call_command("regenerate_thumbnails", "--missing-only", stdout=out)
        self.assertIn("Regenerated 1 photo(s)", out.getvalue())
        photo.refresh_from_db()
        self.assertEqual(photo.width, 960)
        self.assertEqual(photo.thumb_small.name, old_small)  # same content, same hashed name
        self.assertTrue(photo.thumb_small.storage.exists(photo.thumb_small.name))
