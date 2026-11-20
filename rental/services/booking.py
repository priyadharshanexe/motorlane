import logging
from datetime import timedelta

from django import forms
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone

from ..forms import rental_window
from ..models import Booking, Profile, Vehicle
from ..selectors import active_bookings
from .availability import availability_problem
from .events import record_event
from .pricing import price_rental
from .profiles import rental_profile

logger = logging.getLogger(__name__)

REQUEST_RESPONSE_HOURS = 24


@transaction.atomic
def reserve_vehicle(user_id, vehicle_id, start_date, end_date, pickup_time=None, return_time=None):
    # Lock in a consistent order so requests serialize per renter and vehicle.
    Profile.objects.select_for_update().get(pk=user_id)
    vehicle = get_object_or_404(Vehicle.objects.select_for_update(), pk=vehicle_id)
    active = active_bookings()
    if end_date < start_date or start_date < timezone.localdate():
        raise forms.ValidationError("Choose a valid pickup and return date.")
    if not vehicle.is_available or vehicle.archived_at:
        raise forms.ValidationError("This vehicle is no longer available.")
    if active.filter(user_id=user_id).count() >= 3:
        raise forms.ValidationError("You can only have 3 active bookings at a time.")
    pickup_at, return_at = rental_window(start_date, end_date, pickup_time, return_time)
    if problem := availability_problem(vehicle, pickup_at, return_at):
        raise forms.ValidationError(problem)
    quote = price_rental(vehicle, pickup_at, return_at)
    booking = Booking.objects.create(
        user_id=user_id, vehicle=vehicle, start_date=start_date, end_date=end_date,
        pickup_time=timezone.localtime(pickup_at).time(), return_time=timezone.localtime(return_at).time(),
        total_price=quote.rental_total, quoted_daily_rate=vehicle.price_per_day,
        deposit_amount=quote.deposit, price_breakdown=quote.as_dict(),
        expires_at=timezone.now() + timedelta(hours=REQUEST_RESPONSE_HOURS),
    )
    record_event(booking, "", Booking.Status.PENDING, actor=booking.user.user, note="Rental requested.")
    return booking


@transaction.atomic
def transition_booking(actor, booking_id, destination, allowed, *, owner=False):
    profile = rental_profile(actor)
    scope = {"vehicle__owner": profile} if owner else {"user": profile}
    reference = get_object_or_404(Booking, pk=booking_id, **scope)
    vehicle = get_object_or_404(Vehicle.objects.select_for_update(), pk=reference.vehicle_id)
    booking = get_object_or_404(Booking.objects.select_for_update(), pk=booking_id)
    if booking.display_status not in allowed:
        raise forms.ValidationError("This booking has changed. Check its current status.")

    today = timezone.localdate()
    if (destination == Booking.Status.CANCELLED and booking.status == Booking.Status.CONFIRMED
            and today >= booking.start_date):
        raise forms.ValidationError("Confirmed bookings can be cancelled before the pickup date.")
    if destination == Booking.Status.CONFIRMED and booking.start_date < today:
        raise forms.ValidationError("The pickup date has passed.")
    if destination == Booking.Status.IN_PROGRESS:
        if not booking.start_date <= today <= booking.end_date:
            raise forms.ValidationError("Pickup must be within the booked dates.")
        if Booking.objects.filter(vehicle=vehicle, status=Booking.Status.IN_PROGRESS).exists():
            raise forms.ValidationError("Record the previous rental's return before pickup.")
        booking.picked_up_at = timezone.now()
    if destination == Booking.Status.RETURNED:
        booking.returned_at = timezone.now()
    previous = booking.status
    booking.status = destination
    booking.status_changed_at = timezone.now()
    booking.status_changed_by = actor
    booking.save(update_fields=[
        "status", "picked_up_at", "returned_at", "status_changed_at", "status_changed_by",
    ])
    record_event(booking, previous, destination, actor=actor)
    logger.info("booking_status_changed booking_id=%s actor_id=%s status=%s", booking.pk, actor.pk, destination)
    return booking
