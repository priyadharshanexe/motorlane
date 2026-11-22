"""Payment providers behind one interface.

* `RazorpayTestProvider` talks to Razorpay's API, and only ever with TEST keys
  (`rzp_test_...`). Live keys are refused at start-up so no real money can move.
* `FakeProvider` is used when no Razorpay test keys are configured. It signs checkouts
  and webhooks exactly like Razorpay (HMAC-SHA256), so the same verification code runs
  in both modes, and it never makes a network call.

Signatures:
  checkout  hex(HMAC_SHA256(key_secret, f"{order_id}|{payment_id}"))
  webhook   hex(HMAC_SHA256(webhook_secret, raw_body)), header X-Razorpay-Signature
"""
import hashlib
import hmac
import secrets
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


class PaymentError(Exception):
    """The provider refused or could not be reached."""


def to_paise(amount):
    return int((Decimal(amount) * 100).to_integral_value())


def sign(secret, message):
    if isinstance(message, str):
        message = message.encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


class Provider:
    name = ""
    key_id = ""

    def __init__(self, key_secret, webhook_secret):
        self.key_secret = key_secret
        self.webhook_secret = webhook_secret

    def create_order(self, payment):  # -> order id
        raise NotImplementedError

    def refund(self, payment, amount, idempotency_key):
        """Ask for a refund. Returns (provider refund id, provider status). Must be idempotent per key."""
        raise NotImplementedError

    def find_refund(self, payment, idempotency_key):
        """(id, status) of a refund already made with this key, or None. Used after a crash or timeout."""
        raise NotImplementedError

    def refund_status(self, refund_id):
        """Current provider status of a refund: 'processed', 'pending' or 'failed'."""
        raise NotImplementedError

    def verify_checkout(self, order_id, payment_id, signature):
        expected = sign(self.key_secret, f"{order_id}|{payment_id}")
        return bool(signature) and hmac.compare_digest(expected, signature)

    def verify_webhook(self, body, signature):
        return bool(signature and self.webhook_secret) and hmac.compare_digest(sign(self.webhook_secret, body), signature)

    def checkout_options(self, payment):
        return {"provider": self.name, "key_id": self.key_id, "order_id": payment.order_id,
                "amount": to_paise(payment.amount), "currency": payment.currency}


class FakeProvider(Provider):
    name = "fake"
    key_id = "fake_key"

    def create_order(self, payment):
        return f"fake_order_{secrets.token_hex(8)}"

    def refund(self, payment, amount, idempotency_key):
        # Deterministic per key, so repeating a request is harmless, as with a real idempotent API.
        return f"fake_rfnd_{hashlib.sha256(idempotency_key.encode()).hexdigest()[:16]}", "processed"

    def find_refund(self, payment, idempotency_key):
        return None  # the fake keeps no state; refund() itself is idempotent

    def refund_status(self, refund_id):
        return "processed"

    def simulate_checkout(self, payment):
        """What the checkout widget would return after the renter pays (fake mode only)."""
        payment_id = f"fake_pay_{secrets.token_hex(8)}"
        return {"order_id": payment.order_id, "payment_id": payment_id,
                "signature": sign(self.key_secret, f"{payment.order_id}|{payment_id}")}


class RazorpayTestProvider(Provider):
    name = "razorpay"
    api = "https://api.razorpay.com/v1"

    def __init__(self, key_id, key_secret, webhook_secret):
        super().__init__(key_secret, webhook_secret)
        self.key_id = key_id

    def _post(self, path, payload):
        import requests
        try:
            response = requests.post(f"{self.api}{path}", json=payload, auth=(self.key_id, self.key_secret), timeout=10)
        except requests.RequestException as error:
            raise PaymentError("The payment provider could not be reached.") from error
        if response.status_code >= 400:
            raise PaymentError("The payment provider refused the request.")
        return response.json()

    def create_order(self, payment):
        return self._post("/orders", {"amount": to_paise(payment.amount), "currency": payment.currency,
                                      "receipt": f"booking-{payment.booking_id}"})["id"]

    def _get(self, path):
        import requests
        try:
            response = requests.get(f"{self.api}{path}", auth=(self.key_id, self.key_secret), timeout=10)
        except requests.RequestException as error:
            raise PaymentError("The payment provider could not be reached.") from error
        if response.status_code >= 400:
            raise PaymentError("The payment provider refused the request.")
        return response.json()

    def refund(self, payment, amount, idempotency_key):
        # The key travels as the refund receipt so find_refund can recognise it after a crash.
        data = self._post(f"/payments/{payment.payment_id}/refund", {
            "amount": to_paise(amount), "receipt": idempotency_key, "notes": {"idempotency_key": idempotency_key}})
        return data["id"], data.get("status", "pending")

    def find_refund(self, payment, idempotency_key):
        for item in self._get(f"/payments/{payment.payment_id}/refunds").get("items", []):
            if item.get("receipt") == idempotency_key:
                return item["id"], item.get("status", "pending")
        return None

    def refund_status(self, refund_id):
        return self._get(f"/refunds/{refund_id}").get("status", "pending")


def derived_secret(purpose):
    return sign(settings.SECRET_KEY, f"motorlane-fake-payments:{purpose}")


def fake_payments_allowed():
    return settings.DEBUG or settings.DEMO_MODE


def get_provider():
    """The configured provider. Never falls back: a misconfiguration raises instead of faking payments."""
    name = settings.PAYMENT_PROVIDER
    key_id, key_secret = settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET
    if key_id.startswith("rzp_live_"):
        raise ImproperlyConfigured("Live Razorpay keys are not allowed. Use rzp_test_ keys only.")
    if name == "razorpay":
        if not (key_id.startswith("rzp_test_") and key_secret and settings.PAYMENT_WEBHOOK_SECRET):
            raise ImproperlyConfigured(
                "PAYMENT_PROVIDER=razorpay needs RAZORPAY_KEY_ID (rzp_test_...), RAZORPAY_KEY_SECRET "
                "and PAYMENT_WEBHOOK_SECRET.")
        return RazorpayTestProvider(key_id, key_secret, settings.PAYMENT_WEBHOOK_SECRET)
    if name == "fake":
        if not fake_payments_allowed():
            raise ImproperlyConfigured(
                "The fake payment provider marks bookings paid without money moving. It runs only with "
                "DJANGO_DEBUG=1 or on a demo deployment (DJANGO_DEMO_MODE=1).")
        return FakeProvider(derived_secret("checkout"), settings.PAYMENT_WEBHOOK_SECRET or derived_secret("webhook"))
    raise ImproperlyConfigured("Set PAYMENT_PROVIDER to 'fake' or 'razorpay'.")
