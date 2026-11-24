"""Every account path through the headless API: sign-in errors without user enumeration, unverified accounts, rate
limits, sign-out (session gone, private endpoints closed, nothing cacheable), password reset, CSRF, session expiry and
the Google switch."""
import re
from urllib.parse import unquote

from allauth.account.models import EmailAddress
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from .models import Profile

PASSWORD = "Kerb-Stone-Example-1987"


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class AuthPathTests(TestCase):
    def setUp(self):
        cache.clear()  # allauth keeps rate-limit counters in the cache
        self.user = get_user_model().objects.create_user(username="paths", email="paths@example.com", password=PASSWORD)
        EmailAddress.objects.create(user=self.user, email=self.user.email, verified=True, primary=True)
        Profile.objects.create(user=self.user)
        self.client = Client(enforce_csrf_checks=True)
        self.csrf = self.session()["csrf_token"]

    def session(self):
        return self.client.get(reverse("api_session"), secure=True).json()

    def auth(self, path, body=None, method="post", csrf=True):
        headers = {"HTTP_X_CSRFTOKEN": self.csrf, "HTTP_REFERER": "https://testserver/"} if csrf else {}
        call = getattr(self.client, method)
        return call(f"/auth/browser/v1/auth/{path}", body or {}, content_type="application/json", secure=True, **headers)

    def login(self, email="paths@example.com", password=PASSWORD):
        response = self.auth("login", {"email": email, "password": password})
        self.csrf = self.session()["csrf_token"]  # Django rotates the token at sign-in, as the app does
        return response

    def test_correct_password_signs_in(self):
        self.assertEqual(self.login().status_code, 200)
        self.assertEqual(self.session()["user"]["id"], self.user.pk)

    def test_wrong_password_and_unknown_email_look_the_same(self):
        wrong = self.login(password="Not-The-Password-1")
        unknown = self.login(email="nobody@example.com", password="Not-The-Password-1")
        self.assertEqual(wrong.status_code, unknown.status_code)
        self.assertEqual(wrong.status_code, 400)
        self.assertEqual(wrong.json()["errors"][0]["message"], unknown.json()["errors"][0]["message"])
        self.assertIsNone(self.session()["user"])

    def test_unverified_account_cannot_sign_in_and_gets_a_fresh_link(self):
        EmailAddress.objects.filter(user=self.user).update(verified=False)
        response = self.login()
        self.assertEqual(response.status_code, 401)
        flows = {f["id"]: f for f in response.json()["data"]["flows"]}
        self.assertTrue(flows["verify_email"].get("is_pending"))
        self.assertIsNone(self.session()["user"])
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("/app/verify-email/", mail.outbox[0].body)
        # Motorlane's own wording and look, not allauth's "[site] ... Thank you for using example.com"
        message = mail.outbox[0]
        self.assertTrue(message.subject.startswith("Motorlane · "), message.subject)
        self.assertNotIn("Thank you for using", message.body)
        self.assertIn("MOTORLANE", message.alternatives[0][0])

    def test_repeated_wrong_passwords_are_rate_limited(self):
        codes = [[e.get("code") for e in self.login(password=f"Wrong-Password-{i}").json()["errors"]] for i in range(6)]
        self.assertNotIn("too_many_login_attempts", codes[0])
        self.assertIn("too_many_login_attempts", codes[-1])  # allauth: 5 failures per email in 5 minutes
        locked = self.login()  # even the right password is refused until the window passes
        self.assertEqual(locked.status_code, 400)
        self.assertIsNone(self.session()["user"])

    def test_sign_out_closes_the_session_and_private_endpoints(self):
        self.login()
        self.assertEqual(self.client.get("/api/v1/bookings/", secure=True).status_code, 200)
        self.assertEqual(self.auth("session", method="delete").status_code, 401)  # allauth: 401 = now signed out
        self.assertIsNone(self.session()["user"])
        self.assertEqual(self.client.get("/api/v1/bookings/", secure=True).status_code, 403)
        self.assertEqual(self.client.get("/api/v1/owner/fleet/", secure=True).status_code, 403)

    def test_private_responses_are_never_stored(self):
        self.login()
        for path in ("/api/v1/session/", "/api/v1/bookings/", "/api/v1/owner/fleet/", "/api/v1/owner/bookings/", "/api/v1/favorites/"):
            response = self.client.get(path, secure=True)
            self.assertIn("no-store", response["Cache-Control"], path)

    def test_password_reset_replaces_the_old_password(self):
        self.assertEqual(self.auth("password/request", {"email": self.user.email}).status_code, 200)
        key = unquote(re.search(r"/app/reset-password/([^\s]+)", mail.outbox[0].body).group(1))
        self.assertEqual(mail.outbox[0].subject, "Motorlane · Reset your password")
        new = "Fresh-Kerb-Example-2468"
        self.assertIn(self.auth("password/reset", {"key": key, "password": new}).status_code, (200, 401))
        self.auth("session", method="delete")
        self.assertEqual(self.login().status_code, 400)
        self.assertEqual(self.login(password=new).status_code, 200)

    def test_reset_request_does_not_reveal_unknown_emails(self):
        self.assertEqual(self.auth("password/request", {"email": "nobody@example.com"}).status_code, 200)

    def test_sign_in_and_sign_out_need_the_csrf_token(self):
        self.assertEqual(self.auth("login", {"email": self.user.email, "password": PASSWORD}, csrf=False).status_code, 403)
        self.login()
        self.assertEqual(self.auth("session", method="delete", csrf=False).status_code, 403)
        self.assertIsNotNone(self.session()["user"])

    def test_an_expired_session_is_signed_out(self):
        self.login()
        session = self.client.session
        session.set_expiry(-1)
        session.save()
        self.assertIsNone(self.session()["user"])
        self.assertEqual(self.client.get("/api/v1/bookings/", secure=True).status_code, 403)

    def test_google_is_advertised_only_when_configured(self):
        with override_settings(GOOGLE_SIGN_IN_ENABLED=False):
            self.assertFalse(self.session()["google_enabled"])
        with override_settings(GOOGLE_SIGN_IN_ENABLED=True):
            self.assertTrue(self.session()["google_enabled"])
