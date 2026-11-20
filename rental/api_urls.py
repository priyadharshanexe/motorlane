from django.urls import path

from . import api

urlpatterns = [
    path("favorites/", api.favorites),
    path("favorites/<int:pk>/", api.favorites),
    path("session/", api.session, name="api_session"),
    path("vehicles/", api.VehicleList.as_view(), name="api_vehicle_list"),
    path("vehicles/<int:pk>/quote/", api.quote, name="api_quote"),
    path("vehicles/<int:pk>/", api.VehicleDetail.as_view(), name="api_vehicle_detail"),
    path("owner/bookings/", api.OwnerBookings.as_view(), name="api_owner_bookings"),
    path("owner/fleet/", api.fleet, name="api_fleet"),
    path("owner/fleet/<int:pk>/", api.fleet_vehicle, name="api_fleet_vehicle"),
    path("owner/fleet/<int:pk>/maintenance/", api.maintenance, name="api_maintenance"),
    path("owner/fleet/<int:pk>/maintenance/<int:block_id>/", api.maintenance, name="api_maintenance_block"),
    path("owner/value/", api.booking_values, name="api_booking_values"),
    path("bookings/<int:pk>/", api.booking_detail, name="api_booking_detail"),
    path("bookings/<int:pk>/timeline/", api.booking_timeline, name="api_booking_timeline"),
    path("bookings/<int:pk>/payment/", api.payment_start, name="api_payment_start"),
    path("bookings/<int:pk>/payment/confirm/", api.payment_confirm, name="api_payment_confirm"),
    path("bookings/<int:pk>/payment/fake-checkout/", api.payment_fake_checkout, name="api_payment_fake_checkout"),
    path("bookings/<int:pk>/cancellation/", api.cancellation_preview, name="api_cancellation_preview"),
    path("payments/webhook/", api.payment_webhook, name="api_payment_webhook"),
    path("bookings/<int:pk>/review/", api.review, name="api_review"),
    path("bookings/<int:pk>/<str:action>/", api.booking_action, name="api_booking_action"),
    path("bookings/", api.bookings, name="api_bookings"),
]
