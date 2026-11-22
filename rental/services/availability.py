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


class Unavailable(Exception):
    """Why a window cannot be booked, plus the earliest pickup that would work for the same duration."""

    def __init__(self, message, earliest_pickup=None):
        super().__init__(message)
        self.message = message
        self.earliest_pickup = earliest_pickup


def gap_label():
    minutes = int(turnaround().total_seconds() // 60)
    if minutes % 60 == 0:
        return f"{minutes // 60}-hour"
    return f"{minutes}-minute"


def when(moment):
    local = timezone.localtime(moment)
    return f"{local:%H:%M} on {local.day} {local:%b}"


def occupied_windows(vehicle, after, exclude=None):
    """(start, end) of every booking and maintenance block of the vehicle that ends after `after`."""
    since = timezone.localtime(after).date() - timedelta(days=1)  # a late return the day before still needs cleaning
    windows = [(b.pickup_at, b.return_at) for b in active_bookings().filter(vehicle=vehicle, end_date__gte=since)
               .exclude(pk=exclude)]
    windows += [block_window(b) for b in MaintenanceBlock.objects.filter(vehicle=vehicle, end_date__gte=since)]
    return sorted(w for w in windows if w[1] > after - timedelta(days=1))


def earliest_pickup(vehicle, pickup_at, return_at, exclude=None, horizon=timedelta(days=60)):
    """The earliest pickup at or after `pickup_at` for which a rental of the same length fits, or None."""
    duration, gap = return_at - pickup_at, turnaround()
    windows = occupied_windows(vehicle, pickup_at, exclude)
    candidates = sorted({pickup_at, *(end + gap for _, end in windows if end + gap > pickup_at)})
    for start in candidates:
        if start - pickup_at > horizon:
            break
        end = start + duration
        if not any(overlaps(a, b, start, end, gap) for a, b in windows):
            return start
    return None


def check_availability(vehicle, pickup_at, return_at, exclude=None):
    """Raise Unavailable with a precise reason when the window cannot be booked."""
    bookings = conflicting_bookings(vehicle, pickup_at, return_at, exclude)
    blocks = conflicting_blocks(vehicle, pickup_at, return_at)
    if not bookings and not blocks:
        return
    suggestion = earliest_pickup(vehicle, pickup_at, return_at, exclude)
    windows = [(b.pickup_at, b.return_at) for b in bookings] + [block_window(b) for b in blocks]
    zero = timedelta(0)
    if any(overlaps(a, b, pickup_at, return_at, zero) for a, b in windows):
        raise Unavailable(BOOKED if any(overlaps(b.pickup_at, b.return_at, pickup_at, return_at, zero)
                                        for b in bookings) else MAINTENANCE, suggestion)
    # Only the cleaning buffer is in the way.
    kinds = [(start, end, "rental") for start, end in windows[:len(bookings)]]
    kinds += [(start, end, "maintenance") for start, end in windows[len(bookings):]]
    before = [(end, kind) for start, end, kind in kinds if end <= pickup_at]
    if before and suggestion:
        what = "the previous rental" if max(before)[1] == "rental" else "maintenance"
        raise Unavailable(f"This vehicle needs a {gap_label()} cleaning window after {what}: "
                          f"earliest pickup is {when(suggestion)}.", suggestion)
    after = [(start, kind) for start, end, kind in kinds if start >= return_at]
    next_start, next_kind = min(after) if after else (None, "rental")
    latest_return = next_start - turnaround() if next_start else None
    what = "the next rental" if next_kind == "rental" else "scheduled maintenance"
    message = f"This vehicle needs a {gap_label()} cleaning window before {what}"
    message += f": return by {when(latest_return)}." if latest_return and latest_return > pickup_at else "."
    raise Unavailable(message, suggestion)


def availability_problem(vehicle, pickup_at, return_at, exclude=None):
    """The first reason the vehicle cannot be rented for this window, or None."""
    try:
        check_availability(vehicle, pickup_at, return_at, exclude)
    except Unavailable as problem:
        return problem.message
    return None


def unavailable_vehicle_ids(pickup_at, return_at):
    """Vehicles with a booking or maintenance block inside the window (for search)."""
    gap = turnaround()
    ids = {b.vehicle_id for b in nearby(active_bookings(), pickup_at, return_at)
           if overlaps(b.pickup_at, b.return_at, pickup_at, return_at, gap)}
    ids |= {b.vehicle_id for b in nearby(MaintenanceBlock.objects.all(), pickup_at, return_at)
            if overlaps(*block_window(b), pickup_at, return_at, gap)}
    return ids
