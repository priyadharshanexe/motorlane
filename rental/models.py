from datetime import datetime, time
from decimal import Decimal
from math import ceil

from django.conf import settings
from django.db import models
from django.utils import timezone


class Profile(models.Model):
    """Marketplace details for an auth user. Name and email live on the auth user only."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="profile")
    phone = models.CharField(max_length=15, blank=True)

    @property
    def name(self):
        return (self.user.get_full_name() or self.user.email or self.user.username)[:100]

    @property
    def email(self):
        return self.user.email

    def __str__(self):
        return self.name

def billable_days(pickup_at, return_at):
    """Whole 24-hour periods, rounded up, minimum one day."""
    seconds = (return_at - pickup_at).total_seconds()
    return max(1, ceil(seconds / 86400))


class Vehicle(models.Model):

    VEHICLE_TYPE_CHOICES = [
        ('Bike', 'Bike'),
        ('Car', 'Car'),
    ]

    owner = models.ForeignKey(Profile, on_delete=models.CASCADE, null=True, blank=True)

    name = models.CharField(max_length=100)
    vehicle_type = models.CharField(max_length=10, choices=VEHICLE_TYPE_CHOICES)
    price_per_day = models.DecimalField(max_digits=8, decimal_places=2)
    weekend_price_per_day = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True,
        help_text="Daily rate for Saturdays and Sundays. Empty means the weekday rate applies.",
    )
    deposit = models.DecimalField(
        max_digits=8, decimal_places=2, default=Decimal("0"),
        help_text="Refundable security deposit collected with the first payment and returned after the rental.",
    )
    fuel_type = models.CharField(max_length=50)
    location = models.CharField(max_length=100, null=True, blank=True)
    description = models.TextField(blank=True, max_length=3000)
    transmission = models.CharField(max_length=30, blank=True)
    seats = models.PositiveSmallIntegerField(null=True, blank=True)
    model_year = models.PositiveSmallIntegerField(null=True, blank=True)
    pickup_instructions = models.TextField(blank=True, max_length=1000)
    is_available = models.BooleanField(default=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(price_per_day__gte=0), name="vehicle_price_non_negative"),
            models.CheckConstraint(
                condition=models.Q(weekend_price_per_day__isnull=True) | models.Q(weekend_price_per_day__gte=0),
                name="vehicle_weekend_price_non_negative",
            ),
            models.CheckConstraint(condition=models.Q(deposit__gte=0), name="vehicle_deposit_non_negative"),
        ]
        indexes = [
            models.Index(fields=["is_available", "archived_at", "price_per_day"], name="vehicle_listed_price"),
            models.Index(fields=["is_available", "archived_at", "created_at"], name="vehicle_listed_newest"),
            models.Index(fields=["location"], name="vehicle_location"),
            models.Index(fields=["vehicle_type", "price_per_day"], name="vehicle_type_price"),
        ]

    @property
    def cover_photo(self):
        photos = list(self.photos.all())  # uses prefetch_related("photos") when present
        return next((p for p in photos if p.is_cover), photos[0] if photos else None)

    def __str__(self):
        return self.name


class VehiclePhoto(models.Model):
    """One of a vehicle's photos. Thumbnails are WebP renditions generated on upload."""

    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE, related_name="photos")
    image = models.ImageField(upload_to="vehicles/")
    thumb_small = models.ImageField(upload_to="vehicles/thumbs/", blank=True)
    thumb_large = models.ImageField(upload_to="vehicles/thumbs/", blank=True)
    order = models.PositiveSmallIntegerField(default=0)
    is_cover = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["order", "pk"]
        indexes = [models.Index(fields=["vehicle", "order"])]


class Booking(models.Model):

    class Status(models.TextChoices):
        PENDING = "Pending"
        CONFIRMED = "Confirmed"
        REJECTED = "Rejected"
        EXPIRED = "Expired"
        CANCELLED = "Cancelled"
        IN_PROGRESS = "In progress"
        RETURNED = "Returned"

    user = models.ForeignKey(Profile, on_delete=models.CASCADE)
    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT)
    start_date = models.DateField()
    end_date = models.DateField()
    pickup_time = models.TimeField(default=time(9, 0))
    return_time = models.TimeField(default=time(18, 0))
    contact_name = models.CharField(max_length=100, blank=True)
    contact_phone = models.CharField(max_length=30, blank=True)
    conditions_accepted_at = models.DateTimeField(null=True, blank=True, editable=False)
    conditions_version = models.CharField(max_length=40, blank=True, editable=False)
    pickup_notes = models.CharField(max_length=1000, blank=True)
    total_price = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    quoted_daily_rate = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    deposit_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    price_breakdown = models.JSONField(default=dict, blank=True,
                                       help_text="The quote shown to the renter, line by line, at booking time.")
    reminder_sent_at = models.DateTimeField(null=True, blank=True, editable=False)
    payment_required = models.BooleanField(
        default=False, help_text="Set for bookings made through checkout; pickup then needs a completed payment.",
    )
    expires_at = models.DateTimeField(null=True, blank=True)
    status_changed_at = models.DateTimeField(null=True, blank=True)
    status_changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
    )
    picked_up_at = models.DateTimeField(null=True, blank=True)
    returned_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(end_date__gte=models.F("start_date")),
                                   name="booking_dates_in_order"),
            models.CheckConstraint(
                condition=models.Q(status__in=["Pending", "Confirmed", "Rejected", "Expired",
                                               "Cancelled", "In progress", "Returned"]),
                name="booking_status_valid",
            ),
            models.CheckConstraint(condition=models.Q(total_price__gte=0), name="booking_total_non_negative"),
            models.CheckConstraint(condition=models.Q(deposit_amount__gte=0), name="booking_deposit_non_negative"),
            models.CheckConstraint(
                condition=models.Q(quoted_daily_rate__isnull=True) | models.Q(quoted_daily_rate__gte=0),
                name="booking_daily_rate_non_negative",
            ),
        ]
        indexes = [
            models.Index(fields=["vehicle", "status", "start_date"]),
            models.Index(fields=["user", "status"]),
        ]

    @property
    def display_status(self):
        if self.status == self.Status.PENDING and (
            self.start_date < timezone.localdate()
            or (self.expires_at and self.expires_at <= timezone.now())
        ):
            return self.Status.EXPIRED
        if self.status == self.Status.CONFIRMED and self.end_date < timezone.localdate():
            return self.Status.EXPIRED
        return self.status

    @property
    def pickup_at(self):
        return timezone.make_aware(datetime.combine(self.start_date, self.pickup_time))

    @property
    def return_at(self):
        return timezone.make_aware(datetime.combine(self.end_date, self.return_time))

    @property
    def days(self):
        return billable_days(self.pickup_at, self.return_at)

    def __str__(self):
        return f"{self.user.name} - {self.vehicle.name}"

class BookingEvent(models.Model):
    """Append-only audit trail: one row per creation, status change or expiry."""

    booking = models.ForeignKey(Booking, on_delete=models.CASCADE, related_name="events")
    from_status = models.CharField(max_length=20, blank=True)
    to_status = models.CharField(max_length=20, choices=Booking.Status.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        help_text="Empty when the system (for example the expiry job) made the change.",
    )
    at = models.DateTimeField(default=timezone.now)
    note = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["at", "pk"]
        indexes = [models.Index(fields=["booking", "at"])]

    def __str__(self):
        return f"#{self.booking_id} {self.from_status or 'new'} -> {self.to_status}"


class MaintenanceBlock(models.Model):
    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE, related_name="maintenance_blocks")
    start_date = models.DateField()
    end_date = models.DateField()
    reason = models.CharField(max_length=120)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(end_date__gte=models.F("start_date")),
                                   name="maintenance_dates_in_order"),
        ]


class Feedback(models.Model):
    # One verified review per completed booking: the one-to-one makes the booking unique.
    booking = models.OneToOneField(Booking, on_delete=models.CASCADE, related_name="review")
    user = models.ForeignKey(Profile, on_delete=models.CASCADE)
    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE)
    rating = models.IntegerField()
    comment = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(rating__gte=1, rating__lte=5), name="feedback_rating_1_to_5"),
        ]

    def __str__(self):
        return f"{self.user.name} - {self.vehicle.name}"

class Favorite(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "vehicle"], name="unique_saved_vehicle")]


class Payment(models.Model):
    """One payment per booking: rental charge plus refundable deposit, and any refunds."""

    class Status(models.TextChoices):
        CREATED = "created"
        PAID = "paid"
        PARTIALLY_REFUNDED = "partially_refunded"
        REFUNDED = "refunded"
        FAILED = "failed"

    booking = models.OneToOneField(Booking, on_delete=models.PROTECT, related_name="payment")
    provider = models.CharField(max_length=20)
    order_id = models.CharField(max_length=64, unique=True)
    payment_id = models.CharField(max_length=64, blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    deposit = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    currency = models.CharField(max_length=3, default="INR")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.CREATED)
    refunded_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    cancellation_fee = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    created_at = models.DateTimeField(default=timezone.now)
    paid_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="payment_amount_positive"),
            models.CheckConstraint(condition=models.Q(refunded_amount__gte=0) & models.Q(refunded_amount__lte=models.F("amount")),
                                   name="payment_refund_within_amount"),
        ]

    @property
    def is_paid(self):
        return self.status in (self.Status.PAID, self.Status.PARTIALLY_REFUNDED, self.Status.REFUNDED)


class Refund(models.Model):
    payment = models.ForeignKey(Payment, on_delete=models.PROTECT, related_name="refunds")
    provider_refund_id = models.CharField(max_length=64, unique=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    reason = models.CharField(max_length=40)
    processed = models.BooleanField(default=False, help_text="Set when the provider confirms it by webhook.")
    created_at = models.DateTimeField(default=timezone.now)


class WebhookEvent(models.Model):
    """Every provider event id we have processed, so a redelivered webhook is applied once."""

    provider = models.CharField(max_length=20)
    event_id = models.CharField(max_length=100)
    event_type = models.CharField(max_length=60)
    payload = models.JSONField()
    received_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["provider", "event_id"], name="unique_provider_event")]
