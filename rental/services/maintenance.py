from django import forms

from ..selectors import active_bookings


def schedule_maintenance(vehicle, start_date, end_date, reason):
    overlap = {"start_date__lte": end_date, "end_date__gte": start_date}
    blocks = vehicle.maintenance_blocks
    if active_bookings().filter(vehicle=vehicle, **overlap).exists() or blocks.filter(**overlap).exists():
        raise forms.ValidationError("Those dates overlap an existing rental or maintenance block.")
    return blocks.create(start_date=start_date, end_date=end_date, reason=reason)
