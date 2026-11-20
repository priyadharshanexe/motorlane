"""Read-only queries shared by the API, admin views and management commands."""
from django.db import models
from django.db.models import Avg, Count, Q
from django.utils import timezone

from .forms import BookingDatesForm
from .models import Booking, Feedback, MaintenanceBlock, Vehicle


def active_bookings():
    """Bookings that still hold the vehicle: in progress, upcoming confirmed, or live requests."""
    today = timezone.localdate()
    return Booking.objects.filter(
        models.Q(status=Booking.Status.IN_PROGRESS)
        | models.Q(status=Booking.Status.CONFIRMED, end_date__gte=today)
        | (
            models.Q(status=Booking.Status.PENDING, start_date__gte=today)
            & (models.Q(expires_at__isnull=True) | models.Q(expires_at__gt=timezone.now()))
        )
    )


def listed_vehicles():
    return Vehicle.objects.filter(is_available=True, archived_at__isnull=True)


def with_review_summary(vehicles):
    verified = Q(feedback__booking__isnull=False)
    return vehicles.annotate(
        review_average=Avg("feedback__rating", filter=verified),
        review_total=Count("feedback", filter=verified),
    )


def verified_reviews(vehicle):
    return Feedback.objects.filter(vehicle=vehicle)


def search_vehicles(params):
    vehicles = listed_vehicles()
    filters = {key: params.get(key, "").strip() for key in
               ("q", "type", "fuel", "location", "start_date", "end_date")}
    for key, lookup in (("q", "name__icontains"), ("type", "vehicle_type"),
                        ("fuel", "fuel_type__icontains"), ("location", "location__icontains")):
        if filters[key]:
            vehicles = vehicles.filter(**{lookup: filters[key]})
    dates = BookingDatesForm(params if filters["start_date"] or filters["end_date"] else None)
    if dates.is_bound and dates.is_valid():
        conflicting = active_bookings().filter(
            start_date__lte=dates.cleaned_data["end_date"],
            end_date__gte=dates.cleaned_data["start_date"],
        )
        blocked = MaintenanceBlock.objects.filter(
            start_date__lte=dates.cleaned_data["end_date"], end_date__gte=dates.cleaned_data["start_date"],
        )
        vehicles = vehicles.exclude(pk__in=conflicting.values("vehicle_id")).exclude(
            pk__in=blocked.values("vehicle_id")
        )
    return vehicles, filters, dates


def completed_booking_values(owner, form):
    completed = Booking.objects.filter(vehicle__owner=owner, status=Booking.Status.RETURNED)
    if form.is_valid():
        for field, lookup in (("start_date", "gte"), ("end_date", "lte")):
            if value := form.cleaned_data[field]:
                completed = completed.filter(
                    models.Q(**{f"returned_at__date__{lookup}": value})
                    | models.Q(returned_at__isnull=True, **{f"end_date__{lookup}": value})
                )
    return list(completed.values("vehicle_id", "vehicle__name").annotate(
        bookings=models.Count("pk"), value=models.Sum("total_price"),
    ).order_by("vehicle__name", "vehicle_id"))
