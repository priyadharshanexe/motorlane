"""OpenAPI documentation for the function-based API views (served at /api/schema and /api/docs)."""
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema, inline_serializer
from rest_framework import serializers as s

from .serializers import (
    BookingDetailSerializer, BookingEventSerializer, BookingSerializer, FleetVehicleSerializer, PhotoSerializer,
    VehicleSerializer,
)

Detail = inline_serializer("Detail", {"detail": s.CharField()})
FieldErrors = OpenApiResponse(OpenApiTypes.OBJECT, description="Validation errors keyed by field name.")
NOT_FOUND = OpenApiResponse(Detail, description="Not found, or a row another account owns.")
CONFLICT = OpenApiResponse(Detail, description="The request conflicts with the current state (availability, status, limits).")
SIGNED_IN_ERRORS = {403: OpenApiResponse(Detail, description="Not signed in, or the CSRF token is missing.")}

class QuoteLine(s.Serializer):
    kind = s.ChoiceField(["rental", "weekday", "weekend", "discount", "deposit"])
    label = s.CharField()
    amount = s.DecimalField(max_digits=10, decimal_places=2)


class MaintenanceBlockSchema(s.Serializer):
    id = s.IntegerField(read_only=True)
    start_date = s.DateField()
    end_date = s.DateField()
    reason = s.CharField()


MaintenanceBlock = MaintenanceBlockSchema
Quote = inline_serializer("Quote", {
    "days": s.IntegerField(help_text="Billable 24-hour periods, rounded up."),
    "lines": QuoteLine(many=True),
    "subtotal": s.DecimalField(max_digits=10, decimal_places=2),
    "discount": s.DecimalField(max_digits=10, decimal_places=2),
    "rental_total": s.DecimalField(max_digits=10, decimal_places=2, help_text="Rental charge, excluding the deposit."),
    "deposit": s.DecimalField(max_digits=10, decimal_places=2, help_text="Refundable; returned after the rental."),
    "due_now": s.DecimalField(max_digits=10, decimal_places=2, help_text="Charged at payment: rental plus deposit."),
    "total_price": s.DecimalField(max_digits=10, decimal_places=2, help_text="Same as rental_total (older clients)."),
})
WINDOW = [
    OpenApiParameter("start_date", OpenApiTypes.DATE, required=True, description="Pickup date."),
    OpenApiParameter("end_date", OpenApiTypes.DATE, required=True, description="Return date."),
    OpenApiParameter("pickup_time", OpenApiTypes.TIME, description="Local pickup time, default 09:00."),
    OpenApiParameter("return_time", OpenApiTypes.TIME, description="Local return time, default 18:00."),
]
BookingRequest = inline_serializer("BookingRequest", {
    "vehicle_id": s.IntegerField(), "start_date": s.DateField(), "end_date": s.DateField(),
    "pickup_time": s.TimeField(required=False), "return_time": s.TimeField(required=False),
    "contact_name": s.CharField(), "contact_phone": s.CharField(),
    "pickup_notes": s.CharField(required=False), "accepted_conditions": s.BooleanField(),
})
Checkout = inline_serializer("CheckoutOptions", {
    "provider": s.ChoiceField(["fake", "razorpay"]), "key_id": s.CharField(),
    "order_id": s.CharField(), "amount": s.IntegerField(help_text="In paise."), "currency": s.CharField(),
})
CheckoutResult = inline_serializer("CheckoutResult", {
    "order_id": s.CharField(), "payment_id": s.CharField(),
    "signature": s.CharField(help_text="hex HMAC-SHA256 of 'order_id|payment_id' with the key secret."),
})
ListingForm = inline_serializer("ListingForm", {
    "name": s.CharField(), "vehicle_type": s.ChoiceField(["Car", "Bike"]), "fuel_type": s.CharField(),
    "location": s.CharField(), "price_per_day": s.DecimalField(max_digits=8, decimal_places=2),
    "weekend_price_per_day": s.DecimalField(max_digits=8, decimal_places=2, required=False),
    "deposit": s.DecimalField(max_digits=8, decimal_places=2, required=False),
    "vehicle_image": s.ImageField(help_text="Cover photo. Required when creating."),
    "description": s.CharField(required=False), "transmission": s.CharField(required=False),
    "seats": s.IntegerField(required=False), "model_year": s.IntegerField(required=False),
    "pickup_instructions": s.CharField(required=False),
})
TAG_CATALOG, TAG_RENTER, TAG_OWNER, TAG_PAY, TAG_ACCOUNT = "Catalog", "Renter bookings", "Owner", "Payments", "Account"

session = extend_schema(tags=[TAG_ACCOUNT], summary="Session and CSRF token", responses=inline_serializer("Session", {
    "csrf_token": s.CharField(), "google_enabled": s.BooleanField(),
    "user": inline_serializer("SessionUser", {"id": s.IntegerField(), "name": s.CharField()}, allow_null=True),
}))
vehicle_list = extend_schema(tags=[TAG_CATALOG], summary="Search listed vehicles", parameters=[
    OpenApiParameter("q", str, description="Name contains."),
    OpenApiParameter("type", str, enum=["Car", "Bike"]),
    OpenApiParameter("fuel", str),
    OpenApiParameter("location", str, description="Comma-separated places; case-insensitive prefix match on the city."),
    OpenApiParameter("min_price", float), OpenApiParameter("max_price", float),
    OpenApiParameter("sort", str, enum=["name", "price", "-price", "rating", "newest"]),
    *[OpenApiParameter(p.name, p.type, description=f"{p.description} With both dates, vehicles booked or under "
                       "maintenance in the window (plus the cleaning buffer) are excluded.") for p in WINDOW],
], responses={200: VehicleSerializer(many=True), 400: FieldErrors})
vehicle_detail = extend_schema(tags=[TAG_CATALOG], summary="Vehicle details, unavailable dates and recent reviews")
quote = extend_schema(tags=[TAG_CATALOG], summary="Price a rental, line by line", parameters=WINDOW,
                      responses={200: Quote, 400: FieldErrors, 404: NOT_FOUND, 409: CONFLICT})
bookings_list = extend_schema(tags=[TAG_RENTER], summary="My bookings", operation_id="bookings_list",
                              methods=["GET"], responses={200: BookingSerializer(many=True), **SIGNED_IN_ERRORS})
bookings_create = extend_schema(tags=[TAG_RENTER], summary="Request a booking", operation_id="bookings_create",
                                methods=["POST"], request=BookingRequest,
                                description="Prices the rental server-side, stores the breakdown, and notifies the owner. "
                                            "The owner has 24 hours to respond. Limited to 10 requests a minute.",
                                responses={201: BookingSerializer, 400: FieldErrors, 409: CONFLICT,
                                           429: OpenApiResponse(Detail, description="Too many requests."), **SIGNED_IN_ERRORS})
booking_detail = extend_schema(tags=[TAG_RENTER], summary="One booking with its timeline (renter or owner)",
                               operation_id="booking_detail", responses={200: BookingDetailSerializer, 404: NOT_FOUND})
booking_timeline = extend_schema(tags=[TAG_RENTER], summary="A booking's audit timeline (renter or owner)",
                                 responses={200: BookingEventSerializer(many=True), 404: NOT_FOUND})
booking_action = extend_schema(
    tags=[TAG_RENTER, TAG_OWNER], summary="Change a booking's status", operation_id="booking_action", request=None,
    parameters=[OpenApiParameter("action", str, OpenApiParameter.PATH,
                                 enum=["cancel", "approve", "reject", "pickup", "return"])],
    description="Renters may `cancel` (pending, or confirmed before pickup; paid bookings are refunded under the "
                "cancellation policy). Owners may `approve` or `reject` pending requests, record `pickup` (needs a "
                "completed payment) and `return` (refunds the deposit). Anyone else gets 404.",
    responses={200: BookingSerializer, 404: NOT_FOUND, 409: CONFLICT},
)
cancellation_preview = extend_schema(tags=[TAG_RENTER], summary="What cancelling now would cost",
                                     responses=inline_serializer("CancellationTerms", {
                                         "fee": s.DecimalField(max_digits=10, decimal_places=2),
                                         "refund": s.DecimalField(max_digits=10, decimal_places=2),
                                         "free_until": s.DateTimeField(), "fee_percent": s.IntegerField()}))
review = extend_schema(tags=[TAG_RENTER], summary="Review a returned booking (once)",
                       request=inline_serializer("ReviewRequest", {"rating": s.IntegerField(min_value=1, max_value=5),
                                                                   "comment": s.CharField(max_length=500)}),
                       responses={201: None, 400: FieldErrors, 404: NOT_FOUND, 409: CONFLICT})
favorites_list = extend_schema(tags=[TAG_RENTER], summary="Saved vehicles", responses=VehicleSerializer(many=True))
favorite = extend_schema(tags=[TAG_RENTER], summary="Save (POST) or unsave (DELETE) a vehicle", request=None,
                         responses={200: inline_serializer("Saved", {"saved": s.BooleanField()}), 204: None, 404: NOT_FOUND})
owner_bookings = extend_schema(tags=[TAG_OWNER], summary="Bookings for my vehicles")
fleet = extend_schema(tags=[TAG_OWNER], summary="My listings (GET) or create a listing (POST, multipart)",
                      request={"multipart/form-data": ListingForm},
                      responses={200: FleetVehicleSerializer(many=True), 201: FleetVehicleSerializer, 400: FieldErrors,
                                 409: CONFLICT})
fleet_vehicle = extend_schema(tags=[TAG_OWNER], summary="Edit (PATCH) or archive (DELETE) a listing",
                              description="PATCH with only `is_available` toggles visibility; otherwise any listing "
                                          "fields. A new `vehicle_image` becomes the cover photo.",
                              request={"multipart/form-data": ListingForm},
                              responses={200: FleetVehicleSerializer, 204: None, 400: FieldErrors, 404: NOT_FOUND,
                                         409: CONFLICT})
fleet_photos = extend_schema(tags=[TAG_OWNER], summary="List (GET) or upload (POST) listing photos",
                             request={"multipart/form-data": inline_serializer("PhotoUpload", {
                                 "image": s.ImageField(), "cover": s.BooleanField(required=False)})},
                             responses={200: PhotoSerializer(many=True), 201: PhotoSerializer, 400: FieldErrors,
                                        404: NOT_FOUND, 409: CONFLICT})
fleet_photo = extend_schema(tags=[TAG_OWNER], summary="Make a photo the cover (PATCH) or delete it (DELETE)",
                            request=inline_serializer("PhotoUpdate", {"cover": s.BooleanField()}),
                            responses={200: PhotoSerializer, 204: None, 404: NOT_FOUND, 409: CONFLICT})
fleet_photo_order = extend_schema(tags=[TAG_OWNER], summary="Reorder photos",
                                  request=inline_serializer("PhotoOrder", {"order": s.ListField(child=s.IntegerField())}),
                                  responses={200: PhotoSerializer(many=True), 400: FieldErrors, 404: NOT_FOUND})
maintenance_list = extend_schema(tags=[TAG_OWNER], summary="Maintenance blocks (GET) or schedule one (POST)",
                                 request=MaintenanceBlock,
                                 responses={200: MaintenanceBlock(many=True), 201: MaintenanceBlock, 400: FieldErrors,
                                            404: NOT_FOUND, 409: CONFLICT})
maintenance_block = extend_schema(tags=[TAG_OWNER], summary="Remove a maintenance block", responses={204: None, 404: NOT_FOUND})
booking_values = extend_schema(tags=[TAG_OWNER], summary="Completed rental value per vehicle", parameters=[
    OpenApiParameter("start_date", OpenApiTypes.DATE), OpenApiParameter("end_date", OpenApiTypes.DATE)],
    responses=inline_serializer("VehicleValue", {"vehicle_id": s.IntegerField(), "vehicle__name": s.CharField(),
                                                 "bookings": s.IntegerField(), "value": s.DecimalField(max_digits=12, decimal_places=2)},
                                many=True))
payment_start = extend_schema(tags=[TAG_PAY], summary="Open checkout for a confirmed booking", request=None,
                              responses={200: Checkout, 404: NOT_FOUND, 409: CONFLICT})
payment_confirm = extend_schema(tags=[TAG_PAY], summary="Confirm the checkout result (signature verified)",
                                request=CheckoutResult,
                                responses={200: inline_serializer("PaymentStatus", {"status": s.CharField(), "amount": s.CharField()}),
                                           400: FieldErrors, 404: NOT_FOUND})
payment_fake_checkout = extend_schema(tags=[TAG_PAY], summary="Fake provider only: simulate the checkout widget",
                                      request=None, responses={200: CheckoutResult, 404: NOT_FOUND})
payment_webhook = extend_schema(
    tags=[TAG_PAY], summary="Payment provider webhook", auth=[], request=OpenApiTypes.OBJECT,
    description="Authenticated by `X-Razorpay-Signature` (hex HMAC-SHA256 of the raw body with the webhook secret). "
                "Each `X-Razorpay-Event-Id` is applied once; redeliveries return `duplicate`.",
    parameters=[OpenApiParameter("X-Razorpay-Signature", str, OpenApiParameter.HEADER, required=True),
                OpenApiParameter("X-Razorpay-Event-Id", str, OpenApiParameter.HEADER)],
    responses={200: inline_serializer("WebhookResult", {"result": s.ChoiceField(["processed", "duplicate", "ignored"])}),
               400: Detail},
)
payment_config = extend_schema(
    tags=[TAG_PAY], summary="Active payment provider and checkout settings", auth=[],
    responses=inline_serializer("PaymentConfig", {
        "provider": s.ChoiceField(["fake", "razorpay"]), "key_id": s.CharField(help_text="Razorpay test key id; empty for fake."),
        "currency": s.CharField(), "demo": s.BooleanField(), "label": s.CharField()}),
)
