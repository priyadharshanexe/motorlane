"""Server-rendered pages. Business logic lives in services/ and selectors.py."""
from django.conf import settings
from django.contrib.admin.views.decorators import staff_member_required
from django.contrib.auth.decorators import login_required
from django.http import FileResponse, Http404, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone

from .models import Booking, NotificationOutbox, RefundIntent
from .selectors import active_bookings
from .services.profiles import rental_profile


@staff_member_required
def admin_dashboard(request):
    return render(request, "rental/admin_dashboard.html", {
        "pending_count": active_bookings().filter(status=Booking.Status.PENDING).count(),
        "overdue_count": Booking.objects.filter(
            status=Booking.Status.IN_PROGRESS, end_date__lt=timezone.localdate(),
        ).count(),
        "recent_bookings": Booking.objects.select_related("user__user", "vehicle").order_by("-pk")[:15],
        "failed_refunds": RefundIntent.objects.filter(status=RefundIntent.Status.FAILED)
        .select_related("payment").order_by("-updated_at")[:20],
        "failed_emails": NotificationOutbox.objects.filter(status=NotificationOutbox.Status.FAILED)
        .order_by("-next_attempt_at")[:20],
        "failed_refund_count": RefundIntent.objects.filter(status=RefundIntent.Status.FAILED).count(),
        "failed_email_count": NotificationOutbox.objects.filter(status=NotificationOutbox.Status.FAILED).count(),
    })


@login_required
def download_receipt(request, booking_id):
    user_id = rental_profile(request.user).pk
    booking = get_object_or_404(Booking, id=booking_id, user_id=user_id)
    response = HttpResponse(content_type="application/pdf")
    response["Content-Disposition"] = 'attachment; filename="booking-summary.pdf"'
    from .receipts import render_booking_summary
    render_booking_summary(response, booking)
    return response


def home(request):
    return redirect("/app/")


def react_app(request):
    index = settings.FRONTEND_BUILD / "index.html"
    if not index.is_file():
        raise Http404("Build the frontend before opening the marketplace.")
    response = FileResponse(index.open("rb"), content_type="text/html")
    response["Cache-Control"] = "no-cache"
    return response
