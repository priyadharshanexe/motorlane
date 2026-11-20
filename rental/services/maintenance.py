from django import forms

from .availability import block_window, conflicting_blocks, conflicting_bookings


def schedule_maintenance(vehicle, start_date, end_date, reason):
    """Block whole days for maintenance. Hold the vehicle's row lock when calling."""
    block = vehicle.maintenance_blocks.model(vehicle=vehicle, start_date=start_date, end_date=end_date, reason=reason)
    window = block_window(block)
    if conflicting_bookings(vehicle, *window) or conflicting_blocks(vehicle, *window):
        raise forms.ValidationError("Those dates overlap an existing rental or maintenance block.")
    block.save()
    return block
