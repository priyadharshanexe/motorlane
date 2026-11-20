"""Shared test fixtures."""
from django.contrib.auth import get_user_model

from .models import Profile


def make_profile(username, email=None, name=""):
    first, _, last = name.partition(" ")
    user = get_user_model().objects.create_user(
        username=username, email=email or f"{username}@example.com", first_name=first, last_name=last,
    )
    return Profile.objects.create(user=user)


def pay(booking):
    """Complete the fake-provider checkout for a confirmed booking."""
    from .payments.providers import get_provider
    from .payments.service import confirm_checkout, start_payment
    booking.refresh_from_db()
    payment = start_payment(booking)
    checkout = get_provider().simulate_checkout(payment)
    return confirm_checkout(booking, **checkout)
