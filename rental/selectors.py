"""Read-only queries shared by the API, admin views and management commands."""
from django.db import models
from django.db.models import Avg, Count, F, Q
from django.utils import timezone

from .forms import BookingDatesForm, SearchForm
from .models import Booking, Feedback, Vehicle


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


SORTS = {
    "name": ("name", "pk"),
    "price": ("price_per_day", "name", "pk"),
    "-price": ("-price_per_day", "name", "pk"),
    "rating": (F("review_average").desc(nulls_last=True), "-review_total", "name", "pk"),
    "newest": ("-created_at", "-pk"),
}


def location_filter(value):
    """Comma-separated places; each matches a listing's city case-insensitively, by prefix."""
    query = Q()
    for place in (part.strip() for part in value.split(",")):
        if place:
            query |= Q(location__istartswith=place) | Q(location__icontains=f", {place}")
    return query


def search_vehicles(params):
    """Filter, check availability for the requested window, and sort. Returns (rows, filters, errors)."""
    from .services.availability import unavailable_vehicle_ids

    vehicles = with_review_summary(listed_vehicles())
    keys = ("q", "type", "fuel", "location", "start_date", "end_date", "min_price", "max_price", "sort")
    filters = {key: params.get(key, "").strip() for key in keys}
    for key, lookup in (("q", "name__icontains"), ("type", "vehicle_type"), ("fuel", "fuel_type__icontains")):
        if filters[key]:
            vehicles = vehicles.filter(**{lookup: filters[key]})
    if filters["location"]:
        vehicles = vehicles.filter(location_filter(filters["location"]))
    form = SearchForm(params)
    dates = BookingDatesForm(params if filters["start_date"] or filters["end_date"] else None)
    errors = {}
    if not form.is_valid():
        errors.update(form.errors)
    if dates.is_bound and not dates.is_valid():
        errors.update(dates.errors)
    if errors:
        return vehicles.none(), filters, errors
    for key, lookup in (("min_price", "price_per_day__gte"), ("max_price", "price_per_day__lte")):
        if form.cleaned_data[key] is not None:
            vehicles = vehicles.filter(**{lookup: form.cleaned_data[key]})
    if dates.is_bound:
        vehicles = vehicles.exclude(pk__in=unavailable_vehicle_ids(*dates.window))
    return vehicles.order_by(*SORTS[form.cleaned_data["sort"] or "name"]), filters, None


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
