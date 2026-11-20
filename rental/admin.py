from django.contrib import admin

from .models import Booking, BookingEvent, CustomUser, Vehicle

admin.site.register(CustomUser)
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
