import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase, override_settings

from .models import Vehicle

DEMO_IMAGES = Path(__file__).resolve().parent / "demo_images"


def digest(data):
    return hashlib.sha256(data).hexdigest()


class DemoPhotoTests(TestCase):
    def test_bundled_photos_are_all_different(self):
        files = sorted(DEMO_IMAGES.glob("*.webp"))
        hashes = {}
        for file in files:
            hashes.setdefault(digest(file.read_bytes()), []).append(file.name)
        self.assertEqual([names for names in hashes.values() if len(names) > 1], [])

    @patch.dict("os.environ", {"RENTAL_DEMO_PASSWORD": "local-test-demo-only"})
    @override_settings(DEBUG=True)
    def test_no_two_demo_listings_share_a_cover_or_a_model(self):
        with TemporaryDirectory() as media, override_settings(MEDIA_ROOT=media):
            call_command("seed_demo", stdout=open(Path(media) / "out.txt", "w"))
            call_command("refresh_demo_catalog", stdout=open(Path(media) / "out2.txt", "w"))
            call_command("seed_demo", stdout=open(Path(media) / "out3.txt", "w"))
            listed = Vehicle.objects.filter(archived_at__isnull=True).prefetch_related("photos")
            covers = {}
            for vehicle in listed:
                with vehicle.cover_photo.image.open("rb") as image:
                    covers.setdefault(digest(image.read()), []).append(f"{vehicle.name} ({vehicle.location})")
        self.assertEqual(listed.count(), 18)
        self.assertEqual([names for names in covers.values() if len(names) > 1], [])
        self.assertEqual(len(set(listed.values_list("name", flat=True))), 18)

    @patch.dict("os.environ", {"RENTAL_DEMO_PASSWORD": "local-test-demo-only"})
    @override_settings(DEBUG=True)
    def test_public_demo_owner_can_still_list_a_vehicle(self):
        from .services.listing import MAX_ACTIVE_LISTINGS
        with TemporaryDirectory() as media, override_settings(MEDIA_ROOT=media):
            call_command("seed_demo", stdout=open(Path(media) / "out.txt", "w"))
            call_command("refresh_demo_catalog", stdout=open(Path(media) / "out2.txt", "w"))
        owned = Vehicle.objects.filter(owner__user__username="rental-demo-owner", archived_at__isnull=True)
        self.assertLess(owned.count(), MAX_ACTIVE_LISTINGS)
