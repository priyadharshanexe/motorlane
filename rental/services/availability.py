"""Time-aware availability with a cleaning buffer between rentals.

A booking occupies its vehicle from pickup to return, plus `RENTAL_TURNAROUND_MINUTES`
on both sides, so back-to-back rentals always leave time to clean the vehicle. A
maintenance block occupies whole days (00:00 on its start date to 24:00 on its end date)
and gets the same buffer.

Queries first narrow candidates in SQL by date (a day either side covers any buffer up to
24 hours), then compare exact datetimes in Python. Callers that write must hold the
vehicle's row lock (`select_for_update`) so two requests cannot both pass the check.
"""
from datetime import datetime, time, timedelta

from django.conf import settings
from django.utils import timezone

from ..models import MaintenanceBlock
from ..selectors import active_bookings

BOOKED = "Vehicle already booked for these dates."
MAINTENANCE = "This vehicle has scheduled maintenance for those dates."


def turnaround():
    return timedelta(minutes=min(max(settings.RENTAL_TURNAROUND_MINUTES, 0), 24 * 60))


def block_window(block):
    start = timezone.make_aware(datetime.combine(block.start_date, time.min))
    end = timezone.make_aware(datetime.combine(block.end_date + timedelta(days=1), time.min))
    return start, end


def overlaps(start_a, end_a, start_b, end_b, gap):
    return start_a < end_b + gap and start_b < end_a + gap


def nearby(queryset, pickup_at, return_at):
    first = timezone.localtime(pickup_at).date() - timedelta(days=1)
    last = timezone.localtime(return_at).date() + timedelta(days=1)
    return queryset.filter(start_date__lte=last, end_date__gte=first)


def conflicting_bookings(vehicle, pickup_at, return_at, exclude=None):
    rows = nearby(active_bookings().filter(vehicle=vehicle), pickup_at, return_at)
    if exclude is not None:
        rows = rows.exclude(pk=exclude)
    gap = turnaround()
    return [b for b in rows if overlaps(b.pickup_at, b.return_at, pickup_at, return_at, gap)]


def conflicting_blocks(vehicle, pickup_at, return_at):
    rows = nearby(MaintenanceBlock.objects.filter(vehicle=vehicle), pickup_at, return_at)
    gap = turnaround()
    return [b for b in rows if overlaps(*block_window(b), pickup_at, return_at, gap)]


def availability_problem(vehicle, pickup_at, return_at, exclude=None):
    """The first reason the vehicle cannot be rented for this window, or None."""
    if conflicting_bookings(vehicle, pickup_at, return_at, exclude):
        return BOOKED
    if conflicting_blocks(vehicle, pickup_at, return_at):
        return MAINTENANCE
    return None


def unavailable_vehicle_ids(pickup_at, return_at):
    """Vehicles with a booking or maintenance block inside the window (for search)."""
    gap = turnaround()
    ids = {b.vehicle_id for b in nearby(active_bookings(), pickup_at, return_at)
           if overlaps(b.pickup_at, b.return_at, pickup_at, return_at, gap)}
    ids |= {b.vehicle_id for b in nearby(MaintenanceBlock.objects.all(), pickup_at, return_at)
            if overlaps(*block_window(b), pickup_at, return_at, gap)}
    return ids
