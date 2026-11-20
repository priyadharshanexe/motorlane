"""Rebuild a best-effort timeline for bookings created before the audit table existed.

Older rows only kept the latest status change plus pickup and return times, so the
backfill reconstructs the steps those fields prove happened and marks every row as
backfilled. Requests are dated from when the renter accepted the conditions, or from
the 24-hour request expiry, falling back to the start of the pickup day.
"""
from datetime import datetime, time, timedelta

from django.db import migrations
from django.utils import timezone

NOTE = "Backfilled from the booking record."


def request_time(booking):
    if booking.conditions_accepted_at:
        return booking.conditions_accepted_at
    if booking.expires_at:
        return booking.expires_at - timedelta(hours=24)
    return timezone.make_aware(datetime.combine(booking.start_date, time.min))


def backfill(apps, schema_editor):
    Booking = apps.get_model("rental", "Booking")
    BookingEvent = apps.get_model("rental", "BookingEvent")
    alias = schema_editor.connection.alias
    events = []
    bookings = Booking.objects.using(alias).select_related("user").filter(events__isnull=True)
    for booking in bookings.iterator():
        created = request_time(booking)
        renter = booking.user.account_id
        owner_change = booking.status_changed_by_id
        steps = [("", "Pending", renter, created)]
        reached_confirmed = booking.status in ("Confirmed", "In progress", "Returned") or booking.picked_up_at
        if reached_confirmed:
            confirmed_at = booking.status_changed_at if booking.status == "Confirmed" else None
            steps.append(("Pending", "Confirmed", owner_change if booking.status == "Confirmed" else None,
                          confirmed_at or created))
        if booking.picked_up_at:
            steps.append(("Confirmed", "In progress", None, booking.picked_up_at))
        if booking.returned_at:
            steps.append(("In progress", "Returned", None, booking.returned_at))
        if booking.status in ("Rejected", "Cancelled", "Expired"):
            previous = steps[-1][1]
            steps.append((previous, booking.status, owner_change, booking.status_changed_at or created))
        if booking.created_at is None or booking.created_at > created:
            booking.created_at = created
            booking.save(update_fields=["created_at"])
        events += [
            BookingEvent(booking_id=booking.pk, from_status=a, to_status=b, actor_id=actor, at=at, note=NOTE)
            for a, b, actor, at in steps
        ]
    BookingEvent.objects.using(alias).bulk_create(events, batch_size=500)


class Migration(migrations.Migration):
    dependencies = [("rental", "0020_booking_events")]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
