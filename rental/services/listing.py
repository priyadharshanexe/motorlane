from django import forms
from django.db import transaction
from django.utils import timezone

from ..models import Profile, Vehicle
from ..selectors import active_bookings
from .photos import add_photo

MAX_ACTIVE_LISTINGS = 3


@transaction.atomic
def create_listing(owner, form):
    Profile.objects.select_for_update().get(pk=owner.pk)
    if Vehicle.objects.filter(owner=owner, archived_at__isnull=True).count() >= MAX_ACTIVE_LISTINGS:
        raise forms.ValidationError("You can list up to three vehicles at a time.")
    vehicle = form.save(commit=False)
    vehicle.owner = owner
    vehicle.save()
    add_photo(vehicle, form.cleaned_data["vehicle_image"], cover=True)
    return vehicle


def archive_listing(vehicle):
    if active_bookings().filter(vehicle=vehicle).exists():
        raise forms.ValidationError("Resolve open bookings before archiving this vehicle.")
    if vehicle.archived_at is None:
        vehicle.archived_at = timezone.now()
        vehicle.is_available = False
        vehicle.save(update_fields=["archived_at", "is_available"])
