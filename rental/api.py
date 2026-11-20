"""HTTP layer: parse input, call services/selectors, serialize output."""
from collections.abc import Mapping

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.http import Http404
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.cache import never_cache
from rest_framework import generics, serializers, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.exceptions import Throttled
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from .forms import BookingDatesForm, FeedbackForm, MaintenanceForm, PhotoForm, ReportDatesForm, VehicleForm
from .models import Booking, Favorite, Feedback, Vehicle
from .permissions import (
    PUBLIC, SESSION_AUTH, SIGNED_IN, owned_vehicles, owner_bookings, renter_bookings,
)
from .selectors import (
    active_bookings, completed_booking_values, listed_vehicles, search_vehicles, verified_reviews,
    with_review_summary,
)
from .serializers import (
    BookingDetailSerializer, BookingEventSerializer, PhotoSerializer, BookingSerializer, CheckoutContactSerializer, FleetVehicleSerializer, VehicleSerializer,
)
from .services.booking import reserve_vehicle, transition_booking
from .services.listing import archive_listing, create_listing
from .services.photos import add_photo, delete_photo, reorder, replace_cover, set_cover
from .services.maintenance import schedule_maintenance
from .services.pricing import price_rental
from .services.profiles import rental_profile


class BookingCreationThrottle(UserRateThrottle):
    scope = "booking_creation"
    rate = "10/min"


def conflict(error):
    return Response({"detail": error.messages[0]}, status=status.HTTP_409_CONFLICT)


@never_cache
@api_view(["GET"])
@authentication_classes(SESSION_AUTH)
@permission_classes(PUBLIC)
def session(request):
    user = request.user
    return Response({
        "csrf_token": get_token(request),
        "google_enabled": settings.GOOGLE_SIGN_IN_ENABLED,
        "user": {"id": user.pk, "name": user.get_full_name() or user.username}
        if user.is_authenticated else None,
    })


class CatalogPagination(PageNumberPagination):
    page_size = 12


class VehicleList(generics.ListAPIView):
    pagination_class = CatalogPagination
    authentication_classes = SESSION_AUTH
    permission_classes = PUBLIC
    serializer_class = VehicleSerializer
    queryset = listed_vehicles().prefetch_related("photos").order_by("name", "pk")

    def list(self, request, *args, **kwargs):
        vehicles, _, errors = search_vehicles(request.query_params)
        if errors:
            return Response(errors, status=400)
        rows = self.paginate_queryset(vehicles)
        return self.get_paginated_response(self.get_serializer(rows, many=True).data)


@never_cache
@api_view(["GET", "POST"])
@authentication_classes(SESSION_AUTH)
@permission_classes(SIGNED_IN)
def bookings(request):
    profile = rental_profile(request.user)
    if request.method == "GET":
        rows = Booking.objects.filter(user=profile).select_related("vehicle", "user__user", "review", "payment").order_by(
            "-start_date", "-pk")
        return Response(BookingSerializer(rows, many=True, context={"request": request}).data)
    throttle = BookingCreationThrottle()
    if not throttle.allow_request(request, None):
        raise Throttled(wait=throttle.wait())
    if not isinstance(request.data, Mapping):
        return Response({"detail": "Expected an object."}, status=status.HTTP_400_BAD_REQUEST)
    contact = CheckoutContactSerializer(data=request.data)
    if not contact.is_valid():
        return Response(contact.errors, status=400)
    try:
        pk = serializers.IntegerField(min_value=1).run_validation(request.data.get("vehicle_id"))
    except serializers.ValidationError as error:
        return Response({"vehicle_id": error.detail}, status=status.HTTP_400_BAD_REQUEST)
    vehicle = get_object_or_404(Vehicle, pk=pk)
    dates = BookingDatesForm(request.data)
    if not dates.is_valid():
        return Response(dates.errors, status=status.HTTP_400_BAD_REQUEST)
    try:
        with transaction.atomic():
            booking = reserve_vehicle(profile.pk, vehicle.pk, **dates.cleaned_data)
            for field in ("contact_name", "contact_phone", "pickup_notes"):
                setattr(booking, field, contact.validated_data.get(field, ""))
            booking.conditions_accepted_at = timezone.now()
            booking.conditions_version = "rental-conditions-v1"
            booking.save(update_fields=[
                "contact_name", "contact_phone", "pickup_notes",
                "conditions_accepted_at", "conditions_version",
            ])
    except ValidationError as error:
        return conflict(error)
    return Response(BookingSerializer(booking, context={"request": request}).data, status=status.HTTP_201_CREATED)


class VehicleDetail(generics.RetrieveAPIView):
    authentication_classes = SESSION_AUTH
    permission_classes = PUBLIC
    serializer_class = VehicleSerializer
    queryset = VehicleList.queryset.select_related("owner")

    def retrieve(self, request, *args, **kwargs):
        vehicle = self.get_object()
        host_name = vehicle.owner.name.strip() if vehicle.owner else ""
        return Response({
            **self.get_serializer(vehicle).data,
            "host_name": host_name if "@" not in host_name else "",
            "unavailable": [
                *active_bookings().filter(vehicle=vehicle).values("start_date", "end_date"),
                *vehicle.maintenance_blocks.values("start_date", "end_date"),
            ],
            "reviews": list(verified_reviews(vehicle).order_by("-created_at").values("id", "rating", "comment")[:5]),
        })


class OwnerBookings(generics.ListAPIView):
    authentication_classes = SESSION_AUTH
    permission_classes = SIGNED_IN
    serializer_class = BookingSerializer

    def get_queryset(self):
        return owner_bookings(self.request.user).select_related("vehicle", "user__user", "review", "payment").order_by("start_date", "pk")


def visible_booking(user, pk):
    """A booking the account rented or whose vehicle it owns; anything else is a 404."""
    from django.db.models import Q
    return get_object_or_404(
        Booking.objects.filter(Q(user__user=user) | Q(vehicle__owner__user=user))
        .select_related("vehicle", "user__user", "review", "payment").select_related("vehicle__owner").prefetch_related("events"),
        pk=pk,
    )


@never_cache
@api_view(["GET"])
@authentication_classes(SESSION_AUTH)
@permission_classes(SIGNED_IN)
def booking_detail(request, pk):
    booking = visible_booking(request.user, pk)
    return Response(BookingDetailSerializer(booking, context={"request": request}).data)


@never_cache
@api_view(["GET"])
@authentication_classes(SESSION_AUTH)
@permission_classes(SIGNED_IN)
def booking_timeline(request, pk):
    booking = visible_booking(request.user, pk)
    events = booking.events.all()
    for event in events:
        event.booking = booking
    return Response(BookingEventSerializer(events, many=True).data)


BOOKING_ACTIONS = {
    # action: (destination, allowed current statuses, performed by the vehicle owner?)
    "cancel": (Booking.Status.CANCELLED, (Booking.Status.PENDING, Booking.Status.CONFIRMED), False),
    "approve": (Booking.Status.CONFIRMED, (Booking.Status.PENDING,), True),
    "reject": (Booking.Status.REJECTED, (Booking.Status.PENDING,), True),
    "pickup": (Booking.Status.IN_PROGRESS, (Booking.Status.CONFIRMED,), True),
    "return": (Booking.Status.RETURNED, (Booking.Status.IN_PROGRESS,), True),
}


@api_view(["POST"])
@authentication_classes(SESSION_AUTH)
@permission_classes(SIGNED_IN)
def booking_action(request, pk, action):
    if action not in BOOKING_ACTIONS:
        raise Http404
    destination, allowed, owner = BOOKING_ACTIONS[action]
    try:
        booking = transition_booking(request.user, pk, destination, allowed, owner=owner)
    except ValidationError as error:
        return conflict(error)
    return Response(BookingSerializer(booking, context={"request": request}).data)


@api_view(["GET", "POST"])
@authentication_classes(SESSION_AUTH)
@permission_classes(SIGNED_IN)
def fleet(request):
    owner = rental_profile(request.user)
    if request.method == "GET":
        vehicles = Vehicle.objects.filter(owner=owner).order_by("archived_at", "name", "pk")
        return Response(FleetVehicleSerializer(vehicles, many=True, context={"request": request}).data)
    form = VehicleForm(request.data, request.FILES)
    if not form.is_valid():
        return Response(form.errors, status=400)
    try:
        vehicle = create_listing(owner, form)
    except ValidationError as error:
        return conflict(error)
    return Response(FleetVehicleSerializer(vehicle, context={"request": request}).data, status=201)


@api_view(["PATCH", "DELETE"])
@authentication_classes(SESSION_AUTH)
@permission_classes(SIGNED_IN)
@transaction.atomic
def fleet_vehicle(request, pk):
    vehicle = get_object_or_404(owned_vehicles(request.user).select_for_update(), pk=pk, archived_at__isnull=True)
    if request.method == "DELETE":
        try:
            archive_listing(vehicle)
        except ValidationError as error:
            return conflict(error)
        return Response(status=204)
    if set(request.data) == {"is_available"}:
        try:
            vehicle.is_available = serializers.BooleanField().run_validation(request.data["is_available"])
        except serializers.ValidationError as error:
            return Response({"is_available": error.detail}, status=400)
        vehicle.save(update_fields=["is_available"])
        return Response(FleetVehicleSerializer(vehicle, context={"request": request}).data)
    data = {field: request.data.get(field, getattr(vehicle, field)) for field in VehicleForm.Meta.fields}
    form = VehicleForm(data, request.FILES, instance=vehicle)
    if not form.is_valid():
        return Response(form.errors, status=400)
    vehicle = form.save()
    if form.cleaned_data.get("vehicle_image"):
        try:
            replace_cover(vehicle, form.cleaned_data["vehicle_image"])
        except ValidationError as error:
            return conflict(error)
    return Response(FleetVehicleSerializer(vehicle, context={"request": request}).data)


@api_view(["GET", "POST", "DELETE"])
@authentication_classes(SESSION_AUTH)
@permission_classes(SIGNED_IN)
@transaction.atomic
def maintenance(request, pk, block_id=None):
    vehicles = owned_vehicles(request.user)
    if request.method != "GET":
        vehicles = vehicles.select_for_update()
    vehicle = get_object_or_404(vehicles, pk=pk, archived_at__isnull=True)
    blocks = vehicle.maintenance_blocks.order_by("start_date", "pk")
    if request.method == "DELETE":
        get_object_or_404(blocks, pk=block_id).delete()
        return Response(status=204)
    if request.method == "GET":
        return Response(list(blocks.values("id", "start_date", "end_date", "reason")))
    form = MaintenanceForm(request.data)
    if not form.is_valid():
        return Response(form.errors, status=400)
    try:
        block = schedule_maintenance(vehicle, **form.cleaned_data)
    except ValidationError as error:
        return conflict(error)
    return Response({"id": block.pk, **form.cleaned_data}, status=201)


@api_view(["GET"])
@authentication_classes(SESSION_AUTH)
@permission_classes(SIGNED_IN)
def booking_values(request):
    form = ReportDatesForm(request.query_params)
    if not form.is_valid():
        return Response(form.errors, status=400)
    rows = completed_booking_values(rental_profile(request.user), form)
    for row in rows:
        row["value"] = str(row["value"])
    return Response(rows)


@api_view(["POST"])
@authentication_classes(SESSION_AUTH)
@permission_classes(SIGNED_IN)
@transaction.atomic
def review(request, pk):
    booking = get_object_or_404(renter_bookings(request.user).select_for_update(), pk=pk,
                                status=Booking.Status.RETURNED)
    if Feedback.objects.filter(booking=booking).exists():
        return Response({"detail": "You have already reviewed this booking."}, status=409)
    form = FeedbackForm(request.data)
    if not form.is_valid():
        return Response(form.errors, status=400)
    Feedback.objects.create(booking=booking, vehicle_id=booking.vehicle_id,
                            user_id=booking.user_id, **form.cleaned_data)
    return Response(status=201)


@api_view(["GET"])
@authentication_classes(SESSION_AUTH)
@permission_classes(PUBLIC)
def quote(request, pk):
    vehicle = get_object_or_404(VehicleList.queryset, pk=pk)
    form = BookingDatesForm(request.query_params)
    if not form.is_valid():
        return Response(form.errors, status=400)
    try:
        quote = price_rental(vehicle, *form.window)
    except ValidationError as error:
        return conflict(error)
    return Response(quote.as_dict())


@api_view(["GET", "POST", "DELETE"])
@authentication_classes(SESSION_AUTH)
@permission_classes(SIGNED_IN)
def favorites(request, pk=None):
    if request.method == "GET":
        rows = listed_vehicles().filter(favorite__user=request.user)
        return Response(VehicleSerializer(rows, many=True, context={"request": request}).data)
    vehicle = get_object_or_404(listed_vehicles(), pk=pk)
    if request.method == "DELETE":
        Favorite.objects.filter(user=request.user, vehicle=vehicle).delete()
        return Response(status=204)
    Favorite.objects.get_or_create(user=request.user, vehicle=vehicle)
    return Response({"saved": True})


# Payments ---------------------------------------------------------------------------------

def renter_booking_locked(user, pk):
    return get_object_or_404(renter_bookings(user).select_for_update(), pk=pk)


@api_view(["POST"])
@authentication_classes(SESSION_AUTH)
@permission_classes(SIGNED_IN)
@transaction.atomic
def payment_start(request, pk):
    """Open (or reopen) checkout for a confirmed booking. Returns what the checkout widget needs."""
    from .payments.providers import get_provider
    from .payments.service import start_payment
    booking = renter_booking_locked(request.user, pk)
    try:
        payment = start_payment(booking)
    except ValidationError as error:
        return conflict(error)
    return Response(get_provider().checkout_options(payment))


class CheckoutResultSerializer(serializers.Serializer):
    order_id = serializers.CharField(max_length=64)
    payment_id = serializers.CharField(max_length=64)
    signature = serializers.CharField(max_length=128)


@api_view(["POST"])
@authentication_classes(SESSION_AUTH)
@permission_classes(SIGNED_IN)
@transaction.atomic
def payment_confirm(request, pk):
    """Verify the checkout signature and mark the booking paid."""
    from .payments.service import confirm_checkout
    booking = renter_booking_locked(request.user, pk)
    data = CheckoutResultSerializer(data=request.data)
    data.is_valid(raise_exception=True)
    try:
        payment = confirm_checkout(booking, **data.validated_data)
    except ValidationError as error:
        return Response({"detail": error.messages[0]}, status=400)
    return Response({"status": payment.status, "amount": str(payment.amount)})


@api_view(["POST"])
@authentication_classes(SESSION_AUTH)
@permission_classes(SIGNED_IN)
@transaction.atomic
def payment_fake_checkout(request, pk):
    """Fake provider only: stands in for the checkout widget and returns a signed result."""
    from .models import Payment
    from .payments.providers import FakeProvider, get_provider
    provider = get_provider()
    if not isinstance(provider, FakeProvider):
        raise Http404
    booking = renter_booking_locked(request.user, pk)
    payment = get_object_or_404(Payment, booking=booking, status=Payment.Status.CREATED)
    return Response(provider.simulate_checkout(payment))


@never_cache
@api_view(["GET"])
@authentication_classes(SESSION_AUTH)
@permission_classes(SIGNED_IN)
def cancellation_preview(request, pk):
    """What cancelling now would cost: the fee kept and the amount refunded."""
    from datetime import timedelta

    from .payments.service import cancellation_terms
    booking = get_object_or_404(renter_bookings(request.user), pk=pk)
    fee, refund = cancellation_terms(booking)
    free_until = booking.pickup_at - timedelta(hours=settings.RENTAL_FREE_CANCELLATION_HOURS)
    return Response({"fee": str(fee), "refund": str(refund), "free_until": free_until,
                     "fee_percent": settings.RENTAL_CANCELLATION_FEE_PERCENT})


@api_view(["POST"])
@authentication_classes([])
@permission_classes(PUBLIC)
def payment_webhook(request):
    """Provider webhook. Authenticated by the X-Razorpay-Signature HMAC, not by session."""
    from .payments.service import handle_webhook
    try:
        result = handle_webhook(request.body, request.headers.get("X-Razorpay-Signature", ""),
                                request.headers.get("X-Razorpay-Event-Id", ""))
    except PermissionError:
        return Response({"detail": "Invalid signature."}, status=400)
    except ValueError:
        return Response({"detail": "Malformed event."}, status=400)
    return Response({"result": result})


# Photos -----------------------------------------------------------------------------------

@api_view(["GET", "POST"])
@authentication_classes(SESSION_AUTH)
@permission_classes(SIGNED_IN)
def fleet_photos(request, pk):
    """List a listing's photos, or upload one (multipart `image`, optional `cover`)."""
    vehicle = get_object_or_404(owned_vehicles(request.user), pk=pk, archived_at__isnull=True)
    if request.method == "GET":
        return Response(PhotoSerializer(vehicle.photos.all(), many=True, context={"request": request}).data)
    form = PhotoForm(request.data, request.FILES)
    if not form.is_valid():
        return Response(form.errors, status=400)
    try:
        photo = add_photo(vehicle, form.cleaned_data["image"], cover=form.cleaned_data["cover"])
    except ValidationError as error:
        return conflict(error)
    return Response(PhotoSerializer(photo, context={"request": request}).data, status=201)


@api_view(["PATCH", "DELETE"])
@authentication_classes(SESSION_AUTH)
@permission_classes(SIGNED_IN)
def fleet_photo(request, pk, photo_id):
    """PATCH {"cover": true} to make this the cover; DELETE to remove it."""
    vehicle = get_object_or_404(owned_vehicles(request.user), pk=pk, archived_at__isnull=True)
    get_object_or_404(vehicle.photos, pk=photo_id)
    try:
        if request.method == "DELETE":
            delete_photo(vehicle, photo_id)
            return Response(status=204)
        if request.data.get("cover") in (True, "true", "1", 1):
            set_cover(vehicle, photo_id)
    except ValidationError as error:
        return conflict(error)
    return Response(PhotoSerializer(vehicle.photos.get(pk=photo_id), context={"request": request}).data)


@api_view(["POST"])
@authentication_classes(SESSION_AUTH)
@permission_classes(SIGNED_IN)
def fleet_photo_order(request, pk):
    """Body {"order": [photo ids in display order]}."""
    vehicle = get_object_or_404(owned_vehicles(request.user), pk=pk, archived_at__isnull=True)
    ids = serializers.ListField(child=serializers.IntegerField()).run_validation(request.data.get("order"))
    try:
        reorder(vehicle, ids)
    except ValidationError as error:
        return Response({"order": error.messages}, status=400)
    return Response(PhotoSerializer(vehicle.photos.all(), many=True, context={"request": request}).data)
