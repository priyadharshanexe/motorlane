from django.core.management.base import BaseCommand

from rental.services.reminders import send_pickup_reminders


class Command(BaseCommand):
    help = "Email renters whose confirmed rental starts tomorrow. Each booking is reminded once."

    def handle(self, *args, **options):
        self.stdout.write(f"Queued {len(send_pickup_reminders())} pickup reminder(s).")
