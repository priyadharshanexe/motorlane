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

    def refund(self, payment, amount):  # -> provider refund id
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

    def refund(self, payment, amount):
        return f"fake_rfnd_{secrets.token_hex(8)}"

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

    def refund(self, payment, amount):
        return self._post(f"/payments/{payment.payment_id}/refund", {"amount": to_paise(amount)})["id"]


def derived_secret(purpose):
    return sign(settings.SECRET_KEY, f"motorlane-fake-payments:{purpose}")


def get_provider():
    key_id, key_secret = settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET
    if key_id.startswith("rzp_live_"):
        raise ImproperlyConfigured("Live Razorpay keys are not allowed. Use rzp_test_ keys only.")
    if key_id and key_secret:
        if not key_id.startswith("rzp_test_"):
            raise ImproperlyConfigured("RAZORPAY_KEY_ID must be a test key (rzp_test_...).")
        return RazorpayTestProvider(key_id, key_secret, settings.PAYMENT_WEBHOOK_SECRET)
    return FakeProvider(derived_secret("checkout"), settings.PAYMENT_WEBHOOK_SECRET or derived_secret("webhook"))
