from django.utils import timezone

from ..models import BookingEvent


def record_event(booking, from_status, to_status, actor=None, note="", at=None):
    """Append one row to the booking's audit trail. Call inside the same transaction as the change."""
    return BookingEvent.objects.create(
        booking=booking, from_status=from_status or "", to_status=to_status,
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        at=at or timezone.now(), note=note[:255],
    )
