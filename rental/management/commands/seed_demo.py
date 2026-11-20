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
from rental.services.pricing import rental_quote


class Command(BaseCommand):
    help = "Create local Motorlane demo accounts, listings, and rental histories."

    @transaction.atomic
    def handle(self, *args, **options):
        password = os.getenv("RENTAL_DEMO_PASSWORD")
        if not settings.DEBUG or not password or len(password) < 12:
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
        listings = [
            ("owner", "Hyundai i20", "Car", "Madurai", "1800.00"),
            ("owner", "Honda Activa", "Bike", "Madurai", "550.00"),
            ("operator", "Suzuki Swift", "Car", "Tiruchirappalli", "1650.00"),
            ("operator", "Royal Enfield Classic 350", "Bike", "Coimbatore", "950.00"),
            ("operator", "Hyundai i20", "Car", "Coimbatore", "2100.00"),
            ("partner", "Honda Activa", "Bike", "Tiruchirappalli", "590.00"),
            ("partner", "Honda Activa", "Bike", "Dindigul", "490.00"),
            ("host", "Suzuki Swift", "Car", "Chennai", "2350.00"),
            ("host", "Royal Enfield Classic 350", "Bike", "Chennai", "1100.00"),
            ("host", "Hyundai i20", "Car", "Salem", "1900.00"),
        ]
        photo_names = {
            "Hyundai i20": "demo-car.webp",
            "Honda Activa": "demo-bike.webp",
            "Suzuki Swift": "swift.webp",
            "Royal Enfield Classic 350": "classic-350.webp",
        }
        vehicles = []
        for role, name, kind, location, rate in listings:
            fleet = Vehicle.objects.filter(owner=profiles[role])
            vehicle = fleet.filter(name=name, location=location).order_by("pk").first()
            if vehicle is None and fleet.filter(archived_at__isnull=True).count() < 3:
                vehicle = fleet.create(owner=profiles[role], name=name, location=location, vehicle_type=kind,
                                       fuel_type="Petrol", price_per_day=Decimal(rate))
                image = images / photo_names[name]
                vehicle.vehicle_image.save(image.name, ContentFile(image.read_bytes()))
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
