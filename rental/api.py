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

from .forms import BookingDatesForm, FeedbackForm, MaintenanceForm, ReportDatesForm, VehicleForm
from .models import Booking, Favorite, Feedback, Vehicle
from .permissions import (
    PUBLIC, SESSION_AUTH, SIGNED_IN, owned_vehicles, owner_bookings, renter_bookings,
)
from .selectors import (
    active_bookings, completed_booking_values, listed_vehicles, search_vehicles, verified_reviews,
    with_review_summary,
)
from .serializers import (
    BookingDetailSerializer, BookingEventSerializer, BookingSerializer, CheckoutContactSerializer, FleetVehicleSerializer, VehicleSerializer,
)
from .services.booking import reserve_vehicle, transition_booking
from .services.listing import archive_listing, create_listing
from .services.maintenance import schedule_maintenance
from .services.pricing import rental_quote
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
    queryset = listed_vehicles().order_by("name", "pk")

    def list(self, request, *args, **kwargs):
        vehicles, _, dates = search_vehicles(request.query_params)
        if dates.is_bound and not dates.is_valid():
            return Response(dates.errors, status=400)
        rows = self.paginate_queryset(with_review_summary(vehicles).order_by("name", "pk"))
        return self.get_paginated_response(self.get_serializer(rows, many=True).data)


@never_cache
@api_view(["GET", "POST"])
@authentication_classes(SESSION_AUTH)
@permission_classes(SIGNED_IN)
def bookings(request):
    profile = rental_profile(request.user)
    if request.method == "GET":
        rows = Booking.objects.filter(user=profile).select_related("vehicle", "user", "review").order_by(
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
        return owner_bookings(self.request.user).select_related("vehicle", "user", "review").order_by("start_date", "pk")


def visible_booking(user, pk):
    """A booking the account rented or whose vehicle it owns; anything else is a 404."""
    from django.db.models import Q
    return get_object_or_404(
        Booking.objects.filter(Q(user__account=user) | Q(vehicle__owner__account=user))
        .select_related("vehicle", "user", "review").select_related("vehicle__owner").prefetch_related("events"),
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
    data = {field: request.data.get(field, getattr(vehicle, field)) for field in VehicleForm.Meta.fields
            if field != "vehicle_image"}
    form = VehicleForm(data, request.FILES, instance=vehicle)
    if not form.is_valid():
        return Response(form.errors, status=400)
    vehicle = form.save()
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
        days, total = rental_quote(vehicle, **form.cleaned_data)
    except ValidationError as error:
        return conflict(error)
    return Response({"days": days, "total_price": str(total)})


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
