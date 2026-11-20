"""Who may see or act on which rows.

Object scoping is done in the queryset (a row you may not touch is a 404, never a 403),
so these helpers return querysets restricted to the requesting account.
"""
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny, IsAuthenticated

from .models import Booking, Vehicle

SESSION_AUTH = [SessionAuthentication]
PUBLIC = [AllowAny]
SIGNED_IN = [IsAuthenticated]


def owned_vehicles(user):
    """Vehicles listed by this account."""
    return Vehicle.objects.filter(owner__user=user)


def renter_bookings(user):
    """Bookings this account requested."""
    return Booking.objects.filter(user__user=user)


def owner_bookings(user):
    """Bookings for vehicles this account lists."""
    return Booking.objects.filter(vehicle__owner__user=user)
