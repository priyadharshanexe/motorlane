from django.core.management.base import BaseCommand

from rental.services.notifications import deliver_due
from rental.services.notifications import retry_failed as requeue_failed


class Command(BaseCommand):
    help = "Deliver queued emails that are due, retrying failed ones with backoff."

    def add_arguments(self, parser):
        parser.add_argument("--retry-failed", action="store_true",
                            help="Requeue emails that gave up after their last attempt before delivering.")

    def handle(self, *args, retry_failed=False, **options):
        if retry_failed:
            self.stdout.write(f"Requeued {requeue_failed()} failed email(s).")
        self.stdout.write(f"Delivered {deliver_due()} queued email(s).")
