from django.core.management.base import BaseCommand

from rental.services.expiry import expire_bookings


class Command(BaseCommand):
    help = "Mark stale pending requests and never-picked-up confirmed bookings as Expired. Safe to re-run."

    def handle(self, *args, **options):
        expired = expire_bookings()
        self.stdout.write(f"Expired {len(expired)} booking(s).")
