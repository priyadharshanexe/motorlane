import logging
from datetime import timedelta

from django import forms
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone

from ..forms import rental_window
from ..models import Booking, Profile, Vehicle
from ..selectors import active_bookings
from .availability import Unavailable, check_availability
from .events import record_event, rupees
from .notifications import notify
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
    if vehicle.owner_id == user_id:
        raise forms.ValidationError("You cannot book your own vehicle.")
    if active.filter(user_id=user_id).count() >= 3:
        raise forms.ValidationError("You can only have 3 active bookings at a time.")
    pickup_at, return_at = rental_window(start_date, end_date, pickup_time, return_time)
    try:
        check_availability(vehicle, pickup_at, return_at)
    except Unavailable as problem:
        error = forms.ValidationError(problem.message)
        error.earliest_pickup = problem.earliest_pickup
        raise error from None
    quote = price_rental(vehicle, pickup_at, return_at)
    booking = Booking.objects.create(
        user_id=user_id, vehicle=vehicle, start_date=start_date, end_date=end_date,
        pickup_time=timezone.localtime(pickup_at).time(), return_time=timezone.localtime(return_at).time(),
        total_price=quote.rental_total, quoted_daily_rate=vehicle.price_per_day,
        deposit_amount=quote.deposit, price_breakdown=quote.as_dict(), payment_required=True,
        expires_at=timezone.now() + timedelta(hours=REQUEST_RESPONSE_HOURS),
    )
    record_event(booking, "", Booking.Status.PENDING, actor=booking.user.user, note="Rental requested.")
    notify("request_received", booking)
    return booking


@transaction.atomic
def transition_booking(actor, booking_id, destination, allowed, *, owner=False):
    profile = rental_profile(actor)
    scope = {"vehicle__owner": profile} if owner else {"user": profile}
    reference = get_object_or_404(Booking, pk=booking_id, **scope)
    vehicle = get_object_or_404(Vehicle.objects.select_for_update(), pk=reference.vehicle_id)
    booking = get_object_or_404(Booking.objects.select_for_update(), pk=booking_id)
    if booking.display_status not in allowed:
        if booking.display_status == Booking.Status.EXPIRED and booking.status != Booking.Status.EXPIRED:
            raise forms.ValidationError("This booking has expired: its time window has passed.")
        raise forms.ValidationError("This booking has changed. Check its current status.")

    from ..payments import service as payments

    today = timezone.localdate()
    extra = {}
    if destination == Booking.Status.CANCELLED and booking.status == Booking.Status.CONFIRMED:
        if timezone.now() >= booking.pickup_at:
            raise forms.ValidationError("Confirmed bookings can be cancelled before the pickup time.")
        extra["fee"], extra["refund"] = payments.refund_cancellation(booking)
    if destination == Booking.Status.CONFIRMED and booking.start_date < today:
        raise forms.ValidationError("The pickup date has passed.")
    if destination == Booking.Status.IN_PROGRESS:
        from django.conf import settings
        now = timezone.now()
        opens = booking.pickup_at - timedelta(minutes=settings.RENTAL_PICKUP_GRACE_MINUTES)
        if now < opens:
            raise forms.ValidationError(f"Pickup opens at {clock(opens)}.")
        if now >= booking.return_at:
            raise forms.ValidationError(f"The rental window ended at {clock(booking.return_at)}; pickup is no longer possible.")
        if Booking.objects.filter(vehicle=vehicle, status=Booking.Status.IN_PROGRESS).exists():
            raise forms.ValidationError("Record the previous rental's return before pickup.")
        if not payments.payment_settled(booking):
            raise forms.ValidationError("The renter has not completed payment yet.")
        booking.picked_up_at = timezone.now()
    if destination == Booking.Status.RETURNED:
        booking.returned_at = timezone.now()
        extra["refund"] = payments.refund_deposit(booking)
    previous = booking.status
    booking.status = destination
    booking.status_changed_at = timezone.now()
    booking.status_changed_by = actor
    booking.save(update_fields=[
        "status", "picked_up_at", "returned_at", "status_changed_at", "status_changed_by",
    ])
    note = ""
    if extra.get("refund"):
        note = f"Refund of {rupees(extra['refund'])} issued" + (f"; {rupees(extra['fee'])} cancellation fee kept." if extra.get("fee") else ".")
    record_event(booking, previous, destination, actor=actor, note=note)
    announce_transition(booking, destination, **extra)
    logger.info("booking_status_changed booking_id=%s actor_id=%s status=%s", booking.pk, actor.pk, destination)
    return booking


def clock(moment):
    local = timezone.localtime(moment)
    return f"{local:%H:%M} on {local.day} {local:%b}"


def announce_transition(booking, destination, **extra):
    from datetime import timedelta

    from django.conf import settings
    Status = Booking.Status
    if destination == Status.CONFIRMED:
        notify("request_approved", booking, due_now=booking.total_price + booking.deposit_amount,
               free_until=booking.pickup_at - timedelta(hours=settings.RENTAL_FREE_CANCELLATION_HOURS))
    elif destination == Status.REJECTED:
        notify("request_rejected", booking)
    elif destination == Status.CANCELLED:
        notify("booking_cancelled", booking, **extra)
        notify("booking_cancelled_owner", booking, **extra)
    elif destination == Status.RETURNED:
        notify("return_received", booking, refund=extra.get("refund"))
        notify("review_request", booking)
