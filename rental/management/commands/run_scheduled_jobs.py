import logging

from django.core.management import call_command
from django.core.management.base import BaseCommand

logger = logging.getLogger(__name__)

# Every job here must be idempotent: the scheduler may run them again at any time.
JOBS = ["expire_bookings", "send_pickup_reminders"]


class Command(BaseCommand):
    help = "Run every periodic job once. The scheduler container calls this in a loop."

    def handle(self, *args, **options):
        failed = []
        for job in JOBS:
            try:
                call_command(job, stdout=self.stdout)
            except Exception:
                logger.exception("scheduled_job_failed job=%s", job)
                failed.append(job)
        if failed:
            raise SystemExit(1)
