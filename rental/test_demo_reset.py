from datetime import datetime
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from .management.commands.reset_demo import reset_is_due
from .models import Vehicle

ENV = {"RENTAL_DEMO_PASSWORD": "local-test-demo-only"}


class DemoResetTests(TransactionTestCase):
    @override_settings(DEBUG=False, DEMO_MODE=False, DEMO_DAILY_RESET=False)
    def test_refuses_outside_demo_mode_and_scheduler_call_is_a_no_op(self):
        get_user_model().objects.create_user("visitor")
        with self.assertRaises(CommandError):
            call_command("reset_demo")
        call_command("reset_demo", if_due=True)
        self.assertTrue(get_user_model().objects.filter(username="visitor").exists())

    @override_settings(DEBUG=False, DEMO_MODE=True, DEMO_DAILY_RESET=False)
    def test_demo_mode_alone_does_not_reset_on_schedule(self):
        get_user_model().objects.create_user("visitor")
        call_command("reset_demo", if_due=True)
        self.assertTrue(get_user_model().objects.filter(username="visitor").exists())

    @patch.dict("os.environ", ENV)
    def test_daily_reset_wipes_visitor_data_and_reseeds_once_a_day(self):
        with TemporaryDirectory() as media, override_settings(
                MEDIA_ROOT=media, DEBUG=False, DEMO_MODE=True, DEMO_DAILY_RESET=True, DEMO_RESET_HOUR=0):
            get_user_model().objects.create_user("visitor")
            call_command("reset_demo", if_due=True, stdout=StringIO())
            self.assertFalse(get_user_model().objects.filter(username="visitor").exists())
            self.assertEqual(Vehicle.objects.filter(archived_at__isnull=True).count(), 18)
            self.assertTrue((Path(media) / ".demo-reset-date").exists())
            get_user_model().objects.create_user("later-visitor")
            call_command("reset_demo", if_due=True, stdout=StringIO())  # already reset today
            self.assertTrue(get_user_model().objects.filter(username="later-visitor").exists())

    def test_not_due_before_the_reset_hour(self):
        early = timezone.make_aware(datetime(2026, 11, 22, 1, 0))
        with TemporaryDirectory() as media, override_settings(MEDIA_ROOT=media, DEMO_RESET_HOUR=3):
            self.assertFalse(reset_is_due(early))
            self.assertTrue(reset_is_due(early.replace(hour=4)))
