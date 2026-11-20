import json
import logging
from unittest.mock import patch

from django.core.checks import run_checks
from django.test import TestCase, override_settings

from vehicle_rental.log_format import JsonFormatter


class HealthTests(TestCase):
    def test_liveness_and_readiness(self):
        self.assertEqual(self.client.get("/healthz").json(), {"status": "ok"})
        ready = self.client.get("/readyz")
        self.assertEqual(ready.status_code, 200)
        self.assertEqual(ready.json()["checks"], {"database": "ok", "migrations": "ok"})

    @override_settings(SECURE_SSL_REDIRECT=True)
    def test_probes_are_not_redirected_to_https(self):
        self.assertEqual(self.client.get("/healthz").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/session/").status_code, 301)

    def test_readiness_fails_when_the_database_is_down(self):
        with patch("django.db.backends.utils.CursorWrapper.execute", side_effect=OSError("down")),                 self.assertLogs("rental.health", "WARNING"):
            response = self.client.get("/readyz")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "unavailable")


class SecurityHeaderTests(TestCase):
    def test_csp_blocks_inline_scripts_except_with_the_request_nonce(self):
        response = self.client.get("/accounts/password/reset/", secure=True)
        policy = response["Content-Security-Policy"]
        self.assertIn("script-src 'self' 'nonce-", policy)
        self.assertIn("frame-ancestors 'none'", policy)
        self.assertIn("object-src 'none'", policy)
        self.assertNotIn("unsafe-eval", policy)
        nonce = policy.split("'nonce-")[1].split("'")[0]
        self.assertContains(response, f'<script nonce="{nonce}">')
        other = self.client.get("/accounts/password/reset/", secure=True)["Content-Security-Policy"]
        self.assertNotEqual(nonce, other.split("'nonce-")[1].split("'")[0])

    @override_settings(RAZORPAY_KEY_ID="rzp_test_x")
    def test_razorpay_checkout_is_allowed_only_in_razorpay_mode(self):
        self.assertIn("https://checkout.razorpay.com", self.client.get("/healthz")["Content-Security-Policy"])

    def test_razorpay_is_not_allowed_by_default(self):
        self.assertNotIn("razorpay", self.client.get("/healthz")["Content-Security-Policy"])

    def test_production_hsts_is_one_year_with_preload(self):
        from django.conf import settings
        if settings.DEBUG:
            self.skipTest("HSTS is off in debug")
        self.assertEqual(settings.SECURE_HSTS_SECONDS, 31536000)
        self.assertTrue(settings.SECURE_HSTS_PRELOAD and settings.SECURE_HSTS_INCLUDE_SUBDOMAINS)
        response = self.client.get("/healthz", secure=True)
        self.assertEqual(response["Strict-Transport-Security"], "max-age=31536000; includeSubDomains; preload")


class SettingsValidationTests(TestCase):
    def ids(self, **kwargs):
        with override_settings(**kwargs):
            return {message.id for message in run_checks()}

    def test_valid_defaults_pass(self):
        self.assertFalse({i for i in self.ids() if i.startswith("rental.E")})

    def test_bad_policy_and_live_keys_are_errors(self):
        self.assertIn("rental.E001", self.ids(RENTAL_TURNAROUND_MINUTES=-5))
        self.assertIn("rental.E002", self.ids(RENTAL_CANCELLATION_FEE_PERCENT=150))
        self.assertIn("rental.E004", self.ids(RENTAL_LONG_RENTAL_DISCOUNTS=((7, 120),)))
        self.assertIn("rental.E005", self.ids(RAZORPAY_KEY_ID="rzp_live_abc"))
        self.assertIn("rental.E007", self.ids(RAZORPAY_KEY_ID="rzp_test_abc", RAZORPAY_KEY_SECRET=""))

    def test_deploy_warnings(self):
        with override_settings(SITE_URL="http://example.com", PAYMENT_WEBHOOK_SECRET=""):
            ids = {message.id for message in run_checks(include_deployment_checks=True)}
        self.assertTrue({"rental.W002", "rental.W004"} <= ids)

    def test_non_numeric_environment_values_fail_clearly(self):
        from django.core.exceptions import ImproperlyConfigured

        from vehicle_rental.settings import env_int
        with patch.dict("os.environ", {"RENTAL_TURNAROUND_MINUTES": "two hours"}):
            with self.assertRaisesMessage(ImproperlyConfigured, "RENTAL_TURNAROUND_MINUTES must be a whole number"):
                env_int("RENTAL_TURNAROUND_MINUTES", 120)


class JsonLoggingTests(TestCase):
    def test_key_value_messages_become_json_fields(self):
        record = logging.makeLogRecord({"name": "rental.services.expiry", "levelname": "INFO", "levelno": 20,
                                        "msg": "bookings_expired count=%s ids=%s", "args": (2, [4, 5])})
        entry = json.loads(JsonFormatter().format(record))
        self.assertEqual(entry["event"], "bookings_expired")
        self.assertEqual(entry["count"], "2")
        self.assertEqual(entry["logger"], "rental.services.expiry")
        self.assertIn("time", entry)

    def test_exceptions_are_included(self):
        try:
            raise ValueError("boom")
        except ValueError:
            import sys
            record = logging.makeLogRecord({"msg": "failed", "levelname": "ERROR", "exc_info": sys.exc_info()})
        self.assertIn("ValueError: boom", json.loads(JsonFormatter().format(record))["exception"])
