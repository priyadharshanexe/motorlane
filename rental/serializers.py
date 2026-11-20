from django.utils import timezone
from rest_framework import serializers

from .models import Booking, BookingEvent, Vehicle
from .selectors import verified_reviews


class VehicleSerializer(serializers.ModelSerializer):
    rating = serializers.SerializerMethodField()
    review_count = serializers.SerializerMethodField()

    def get_rating(self, vehicle) -> float | None:
        return self._reviews(vehicle)["average"]

    def get_review_count(self, vehicle) -> int:
        return self._reviews(vehicle)["count"]

    def _reviews(self, vehicle):
        if hasattr(vehicle, "review_average"):
            return {"average": vehicle.review_average, "count": vehicle.review_total}
        if not hasattr(vehicle, "_review_summary"):
            from django.db.models import Avg, Count
            vehicle._review_summary = verified_reviews(vehicle).aggregate(average=Avg("rating"), count=Count("id"))
        return vehicle._review_summary

    class Meta:
        model = Vehicle
        fields = ("id", "name", "vehicle_type", "fuel_type", "location", "price_per_day", "vehicle_image",
                  "description", "transmission", "seats", "model_year", "pickup_instructions", "rating",
                  "review_count")


class FleetVehicleSerializer(VehicleSerializer):
    class Meta(VehicleSerializer.Meta):
        fields = (*VehicleSerializer.Meta.fields, "is_available", "archived_at")


class CheckoutContactSerializer(serializers.Serializer):
    contact_name = serializers.CharField(max_length=100)
    contact_phone = serializers.RegexField(r"^\+?[0-9 ()-]{7,30}$")
    pickup_notes = serializers.CharField(max_length=1000, required=False, allow_blank=True)
    accepted_conditions = serializers.BooleanField()

    def validate_accepted_conditions(self, value):
        if not value:
            raise serializers.ValidationError("Review and accept the rental conditions before requesting.")
        return value


class BookingSerializer(serializers.ModelSerializer):
    vehicle = VehicleSerializer(read_only=True)
    status = serializers.CharField(source="display_status")
    renter_name = serializers.CharField(source="user.name")
    reviewed = serializers.SerializerMethodField()
    overdue = serializers.SerializerMethodField()

    def get_overdue(self, booking) -> bool:
        return booking.status == Booking.Status.IN_PROGRESS and booking.end_date < timezone.localdate()

    def get_reviewed(self, booking) -> bool:
        return hasattr(booking, "review")

    class Meta:
        model = Booking
        fields = ("id", "vehicle", "start_date", "end_date", "status", "total_price", "quoted_daily_rate",
                  "renter_name", "contact_name", "contact_phone", "pickup_notes", "picked_up_at",
                  "returned_at", "reviewed", "overdue", "status_changed_at")


class BookingEventSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField(
        help_text="Who made the change: renter, owner, staff, or system (scheduled jobs).")

    def get_actor(self, event) -> str:
        if event.actor_id is None:
            return "system"
        booking = event.booking
        if event.actor_id == booking.user.user_id:
            return "renter"
        if booking.vehicle.owner and event.actor_id == booking.vehicle.owner.user_id:
            return "owner"
        return "staff"

    class Meta:
        model = BookingEvent
        fields = ("id", "from_status", "to_status", "actor", "at", "note")


class BookingDetailSerializer(BookingSerializer):
    timeline = BookingEventSerializer(source="events", many=True, read_only=True)

    class Meta(BookingSerializer.Meta):
        fields = (*BookingSerializer.Meta.fields, "created_at", "timeline")
