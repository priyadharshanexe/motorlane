"""Replace the local catalog without deleting historical booking records."""
from pathlib import Path
from decimal import Decimal
from django.conf import settings
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from rental.models import Profile, Vehicle
from rental.services.photos import add_photo

CATALOG = [
    ("Hyundai i20", "Car", "Madurai", "1800", "Manual", 5, 2018, "demo-car.webp",
     "A practical five-seat hatchback for city travel and weekend trips."),
    ("Suzuki Swift", "Car", "Tiruchirappalli", "1650", "Manual", 5, 2017, "swift.webp",
     "A compact five-seat hatchback for everyday errands and short road trips."),
    ("Royal Enfield Classic 350", "Bike", "Coimbatore", "950", "Manual", 2, 2019, "classic-350.webp",
     "A classic-style motorcycle for relaxed rides and exploring local roads."),
    ("Hero Honda Splendor", "Bike", "Madurai", "500", "Manual", 2, 2005, "splendor.webp",
     "A lightweight commuter motorcycle for getting around town. Image is an illustrative studio render."),
    ("Honda City", "Car", "Chennai", "2600", "Automatic", 5, 2022, "honda-city.webp",
     "A comfortable sedan for city journeys and longer weekend drives. White exterior with a spacious five-seat cabin. Image is an illustrative studio render."),
    ("Hyundai Venue", "Car", "Coimbatore", "2400", "Manual", 5, 2023, "hyundai-venue.webp",
     "A compact SUV for everyday travel and weekend getaways. Blue exterior with a raised seating position. Image is an illustrative studio render."),
    ("TVS Jupiter", "Bike", "Salem", "600", "Automatic", 2, 2022, "tvs-jupiter.webp",
     "An easy-to-ride automatic scooter for short city trips and daily errands. Bronze exterior and a comfortable two-person seat. Image is an illustrative studio render."),
    ("Yamaha MT-15", "Bike", "Tiruchirappalli", "1100", "Manual", 2, 2023, "yamaha-mt15.webp",
     "A sporty street motorcycle with an upright riding position, cyan accents and a lightweight profile. Image is an illustrative studio render."),
]

class Command(BaseCommand):
    help = "Archive the existing local catalog and create complete illustrative demo listings."
    def add_arguments(self, parser):
        parser.add_argument("--archive-existing", action="store_true", help="Also archive listings outside the demo catalog.")

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("This catalog reset is for local development only.")
        owner = Profile.objects.get(user__username="rental-demo-owner")
        root = Path(__file__).resolve().parents[2] / "demo_images"
        # Validate every image before changing database state.
        images = {row[7]: (root / row[7]).read_bytes() for row in CATALOG}
        marker = "Illustrative demo listing."
        current = list(Vehicle.objects.filter(owner=owner, description__startswith=marker))
        keep = [v.pk for v in current]
        count = 0
        if options["archive_existing"]:
            count = Vehicle.objects.filter(archived_at__isnull=True).exclude(pk__in=keep).update(
                archived_at=timezone.now(), is_available=False)
        for name, kind, city, rate, transmission, seats, year, image, description in CATALOG:
            vehicle = next((v for v in current if v.name == name), None)
            if vehicle is None:
                vehicle = Vehicle(owner=owner, name=name)
            vehicle.vehicle_type = kind
            vehicle.location = city
            vehicle.price_per_day = Decimal(rate)
            vehicle.fuel_type = "Petrol"
            vehicle.transmission = transmission
            vehicle.seats = seats
            vehicle.model_year = year
            vehicle.description = f"{marker} Specifications and pricing are sample data for testing, not a verified real-world rental offer. {description}"
            vehicle.pickup_instructions = f"Demo pickup in {city}. Arrange the exact meeting point and handoff time with the owner after confirmation."
            vehicle.is_available = True
            vehicle.archived_at = None
            vehicle.full_clean()
            vehicle.save()
            cover = vehicle.cover_photo
            if cover is None or Path(cover.image.name).stem.split("_")[0] != Path(image).stem:
                add_photo(vehicle, ContentFile(images[image], name=image), cover=True)
        self.stdout.write(self.style.SUCCESS(f"Archived {count} old listings; {len(CATALOG)} complete demo listings ready. Booking history preserved."))
