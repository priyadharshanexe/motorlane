import os
from datetime import datetime, time, timedelta
from decimal import Decimal
from pathlib import Path

from allauth.account.models import EmailAddress
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from rental.models import Booking, BookingEvent, Profile, Feedback, MaintenanceBlock, Vehicle
from rental.selectors import active_bookings
from rental.management.commands.refresh_demo_catalog import cover_matches
from rental.services.photos import add_photo
from rental.services.pricing import rental_quote


# What each listing above was called in earlier versions of this command (same order).
PREVIOUS_NAMES = [
    "Hyundai i20", "Honda Activa", "Suzuki Swift", "Royal Enfield Classic 350", "Hyundai i20",
    "Honda Activa", "Honda Activa", "Suzuki Swift", "Royal Enfield Classic 350", "Hyundai i20",
]


class Command(BaseCommand):
    help = "Create local Motorlane demo accounts, listings, and rental histories."

    @transaction.atomic
    def handle(self, *args, **options):
        password = os.getenv("RENTAL_DEMO_PASSWORD")
        if not (settings.DEBUG or settings.DEMO_MODE) or not password or len(password) < 12:
            raise CommandError("Enable local debug and set RENTAL_DEMO_PASSWORD to at least 12 characters.")

        profiles = {}
        for role in ("owner", "renter", "host", "operator", "partner"):
            username = f"rental-demo-{role}"
            email = f"{role}@rental-demo.example"
            account, created = get_user_model().objects.get_or_create(
                username=username, defaults={"email": email, "first_name": "Demo", "last_name": role.title()},
            )
            if not created and account.email != email:
                raise CommandError(f"The demo username {username} is already in use.")
            if created:
                account.set_password(password)
                account.save(update_fields=["password"])
            EmailAddress.objects.get_or_create(
                user=account, email=email, defaults={"primary": True, "verified": True},
            )
            profiles[role], _ = Profile.objects.get_or_create(user=account)

        images = Path(__file__).resolve().parents[2] / "demo_images"
        # Every demo listing is a different model with its own photograph, distinct from the
        # eight models refresh_demo_catalog adds (test_demo_photos checks this).
        listings = [
            ("owner", "Maruti Suzuki Baleno", "Car", "Madurai", "1700.00", "baleno.webp"),
            ("owner", "Honda Activa", "Bike", "Madurai", "550.00", "demo-bike.webp"),
            ("operator", "Tata Nexon", "Car", "Tiruchirappalli", "2200.00", "nexon.webp"),
            ("operator", "Bajaj Pulsar 150", "Bike", "Coimbatore", "800.00", "pulsar-150.webp"),
            ("operator", "Mahindra XUV300", "Car", "Coimbatore", "2300.00", "xuv300.webp"),
            ("partner", "TVS Apache RTR 160", "Bike", "Tiruchirappalli", "850.00", "apache-rtr-160.webp"),
            ("partner", "Royal Enfield Hunter 350", "Bike", "Dindigul", "1000.00", "hunter-350.webp"),
            ("host", "Maruti Suzuki Dzire", "Car", "Chennai", "1900.00", "dzire.webp"),
            ("host", "Bajaj Chetak", "Bike", "Chennai", "700.00", "chetak.webp"),
            ("host", "Tata Punch", "Car", "Salem", "1800.00", "punch.webp"),
        ]
        vehicles = []
        for (role, name, kind, location, rate, photo), old_name in zip(listings, PREVIOUS_NAMES):
            fleet = Vehicle.objects.filter(owner=profiles[role])
            vehicle = fleet.filter(name=name, location=location).order_by("pk").first()
            if vehicle is None:
                # Databases seeded before every listing had its own model: rename in place so
                # booking history stays attached, then give it the new photo below.
                vehicle = fleet.filter(name=old_name, location=location).order_by("pk").first()
                if vehicle is not None:
                    vehicle.name, vehicle.vehicle_type = name, kind
                    vehicle.save(update_fields=["name", "vehicle_type"])
            if vehicle is None and fleet.filter(archived_at__isnull=True).count() < 3:
                vehicle = fleet.create(owner=profiles[role], name=name, location=location, vehicle_type=kind,
                                       fuel_type="Petrol", price_per_day=Decimal(rate))
            if vehicle is not None:
                data = (images / photo).read_bytes()
                if not cover_matches(vehicle.cover_photo, data):
                    add_photo(vehicle, ContentFile(data, name=photo), cover=True)
            vehicles.append(vehicle)

        # Keep scenario dates stable even when the command is run on another day.
        seeded_at = profiles["operator"].user.date_joined
        today = timezone.localdate(seeded_at)
        renter = profiles["renter"]
        status = Booking.Status
        scenarios = [
            (0, -25, -23, status.RETURNED, "Easy pickup in Madurai. The car was clean."),
            (1, -13, -12, status.RETURNED, "Handy for short trips around town."),
            (0, 4, 6, status.PENDING, ""),
            (1, 8, 10, status.CONFIRMED, ""),
            (1, -1, 2, status.IN_PROGRESS, ""),
            (0, -19, -17, status.CANCELLED, ""),
            (1, -8, -7, status.REJECTED, ""),
            (7, -42, -38, status.RETURNED, ""),
        ]
        for index, start_offset, end_offset, state, comment in scenarios:
            vehicle = vehicles[index]
            if vehicle is None:
                continue
            start, end = today + timedelta(days=start_offset), today + timedelta(days=end_offset)
            if Booking.objects.filter(vehicle=vehicle, user=renter, start_date=start, end_date=end).exists():
                continue
            if active_bookings().filter(vehicle=vehicle, start_date__lte=end, end_date__gte=start).exists():
                continue
            if vehicle.maintenance_blocks.filter(start_date__lte=end, end_date__gte=start).exists():
                continue
            if state in (status.PENDING, status.CONFIRMED, status.IN_PROGRESS) and (
                vehicle.archived_at or not vehicle.is_available or active_bookings().filter(user=renter).count() >= 3
            ):
                continue
            _, total = rental_quote(vehicle, start, end)
            pickup = timezone.make_aware(datetime.combine(start, time(9)))
            handback = timezone.make_aware(datetime.combine(end, time(17)))
            changed = {
                status.RETURNED: handback,
                status.IN_PROGRESS: pickup,
                status.CANCELLED: pickup - timedelta(days=2),
                status.REJECTED: pickup - timedelta(days=2),
                status.CONFIRMED: seeded_at,
            }.get(state)
            booking = Booking.objects.create(
                user=renter, vehicle=vehicle, start_date=start, end_date=end,
                quoted_daily_rate=vehicle.price_per_day, total_price=total, status=state,
                expires_at=seeded_at + timedelta(hours=24) if state == status.PENDING else None,
                status_changed_at=changed,
                status_changed_by=(renter.user if state == status.CANCELLED else vehicle.owner.user) if changed else None,
                picked_up_at=pickup if state in (status.IN_PROGRESS, status.RETURNED) else None,
                returned_at=handback if state == status.RETURNED else None,
            )
            requested = min(seeded_at - timedelta(hours=1), pickup - timedelta(days=3))
            booking.created_at = requested
            booking.save(update_fields=["created_at"])
            steps = [("", status.PENDING, renter.user, requested)]
            if state in (status.CONFIRMED, status.IN_PROGRESS, status.RETURNED):
                steps.append((status.PENDING, status.CONFIRMED, vehicle.owner.user,
                              seeded_at if state == status.CONFIRMED else requested + timedelta(hours=2)))
            if state in (status.IN_PROGRESS, status.RETURNED):
                steps.append((status.CONFIRMED, status.IN_PROGRESS, vehicle.owner.user, pickup))
            if state == status.RETURNED:
                steps.append((status.IN_PROGRESS, status.RETURNED, vehicle.owner.user, handback))
            if state in (status.CANCELLED, status.REJECTED):
                steps.append((status.PENDING, state, booking.status_changed_by, changed))
            BookingEvent.objects.bulk_create(
                BookingEvent(booking=booking, from_status=a, to_status=b, actor=actor, at=at, note="Demo history.")
                for a, b, actor, at in steps
            )
            if comment:
                Feedback.objects.create(booking=booking, vehicle=vehicle, user=renter, rating=5, comment=comment)

        for index, offset, reason in ((0, 16, "Scheduled service"), (1, 11, "Tyre replacement"), (7, 21, "Routine inspection")):
            vehicle = vehicles[index]
            if vehicle is None or vehicle.archived_at:
                continue
            start = today + timedelta(days=offset)
            end = start + timedelta(days=1)
            if vehicle.maintenance_blocks.filter(reason=reason).exists():
                continue
            if active_bookings().filter(vehicle=vehicle, start_date__lte=end, end_date__gte=start).exists():
                continue
            if vehicle.maintenance_blocks.filter(start_date__lte=end, end_date__gte=start).exists():
                continue
            MaintenanceBlock.objects.create(vehicle=vehicle, reason=reason, start_date=start, end_date=end)
        self.stdout.write(self.style.SUCCESS("Demo listings, rental histories, and accounts are ready."))
