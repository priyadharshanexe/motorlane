"""Reset a public demo deployment to its seeded state.

Only runs with DJANGO_DEMO_MODE=1 (or DEBUG). It flushes the whole database, deletes uploaded
vehicle media, and re-creates the demo accounts, listings and bookings, so anything a
visitor created is gone. With --if-due it runs at most once per day, at or after
DEMO_RESET_HOUR (local time), and only when DEMO_DAILY_RESET=1 as well; the scheduler
calls it that way every cycle.
"""
import shutil
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

MARKER = ".demo-reset-date"


def marker_path():
    return Path(settings.MEDIA_ROOT) / MARKER


def reset_is_due(now=None):
    now = timezone.localtime(now)
    if now.hour < settings.DEMO_RESET_HOUR:
        return False
    try:
        return marker_path().read_text().strip() != now.date().isoformat()
    except OSError:
        return True


class Command(BaseCommand):
    help = "Wipe the demo deployment and re-seed it. Demo mode only."

    def add_arguments(self, parser):
        parser.add_argument("--if-due", action="store_true", help="Only reset once a day, after DEMO_RESET_HOUR.")

    def handle(self, *args, if_due=False, **options):
        if if_due and not settings.DEMO_DAILY_RESET:
            return  # the scheduler calls this everywhere; only an opted-in demo deployment resets
        if not settings.DEMO_MODE:
            if not settings.DEBUG:
                raise CommandError("reset_demo wipes the database. It runs only with DJANGO_DEMO_MODE=1 or DEBUG.")
        if if_due and not reset_is_due():
            return
        call_command("flush", interactive=False, verbosity=0)
        vehicles = Path(settings.MEDIA_ROOT) / "vehicles"
        if vehicles.is_dir():
            shutil.rmtree(vehicles)
        call_command("seed_demo", stdout=self.stdout)
        call_command("refresh_demo_catalog", stdout=self.stdout)
        marker_path().parent.mkdir(parents=True, exist_ok=True)
        marker_path().write_text(timezone.localdate().isoformat())
        self.stdout.write(self.style.SUCCESS("Demo data reset."))
