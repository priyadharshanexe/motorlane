from django.core.management.base import BaseCommand

from rental.models import VehiclePhoto
from rental.services.photos import make_thumbnails


class Command(BaseCommand):
    help = "Re-render every photo's WebP thumbnails and record its size and placeholder colour."

    def add_arguments(self, parser):
        parser.add_argument("--missing-only", action="store_true", help="Only photos without dimensions yet.")

    def handle(self, *args, missing_only=False, **options):
        photos = VehiclePhoto.objects.order_by("pk")
        if missing_only:
            photos = photos.filter(width__isnull=True)
        done, failed = 0, 0
        for photo in photos.iterator():
            try:
                make_thumbnails(photo)
                done += 1
            except OSError as error:  # the original file is missing from storage
                failed += 1
                self.stderr.write(f"Photo {photo.pk}: {error}")
        self.stdout.write(f"Regenerated {done} photo(s); {failed} could not be read.")
