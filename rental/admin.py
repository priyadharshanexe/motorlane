from django.contrib import admin

from .models import Booking, BookingEvent, NotificationOutbox, Payment, Profile, RefundIntent, Vehicle

admin.site.register(Profile)
admin.site.register(Vehicle)


class BookingEventInline(admin.TabularInline):
    model = BookingEvent
    extra = 0
    can_delete = False
    readonly_fields = ("from_status", "to_status", "actor", "at", "note")

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ("id", "vehicle", "user", "start_date", "end_date", "status")
    list_filter = ("status",)
    inlines = [BookingEventInline]



@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("id", "booking", "provider", "amount", "refunded_amount", "status", "paid_at")
    list_filter = ("status", "provider")
    readonly_fields = [field.name for field in Payment._meta.fields]


@admin.register(RefundIntent)
class RefundIntentAdmin(admin.ModelAdmin):
    """Refunds owed. Filter by status=failed to see the ones that need a person."""

    list_display = ("id", "booking_link", "amount", "reason", "status", "attempts", "next_attempt_at", "last_error")
    list_filter = ("status", "reason")
    search_fields = ("idempotency_key", "provider_refund_id")
    readonly_fields = [field.name for field in RefundIntent._meta.fields]
    actions = ["retry_now"]

    @admin.display(description="Booking")
    def booking_link(self, intent):
        return intent.payment.booking_id

    @admin.action(description="Retry the selected failed refunds now")
    def retry_now(self, request, queryset):
        from .payments.service import process_due_refunds, retry_failed_refunds
        requeued = retry_failed_refunds(ids=list(queryset.values_list("pk", flat=True)))
        sent = process_due_refunds()
        self.message_user(request, f"Requeued {requeued} refund(s); {len(sent)} accepted by the provider.")


@admin.register(NotificationOutbox)
class NotificationOutboxAdmin(admin.ModelAdmin):
    """Queued emails. Filter by status=failed to see the ones that gave up."""

    list_display = ("id", "kind", "booking", "to", "status", "attempts", "next_attempt_at", "last_error")
    list_filter = ("status", "kind")
    search_fields = ("to", "dedupe_key")
    readonly_fields = [field.name for field in NotificationOutbox._meta.fields]
    actions = ["retry_now"]

    @admin.action(description="Retry the selected failed emails now")
    def retry_now(self, request, queryset):
        from .services.notifications import deliver_due, retry_failed
        requeued = retry_failed(ids=list(queryset.values_list("pk", flat=True)))
        self.message_user(request, f"Requeued {requeued} email(s); {deliver_due()} delivered.")
