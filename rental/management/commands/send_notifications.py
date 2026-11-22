from django.core.management.base import BaseCommand

from rental.services.notifications import deliver_due


class Command(BaseCommand):
    help = "Deliver queued emails that are due, retrying failed ones with backoff."

    def handle(self, *args, **options):
        self.stdout.write(f"Delivered {deliver_due()} queued email(s).")
