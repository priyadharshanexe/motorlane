from django.urls import path

from . import api

urlpatterns = [
    path("favorites/", api.favorites, name="api_favorites"),
    path("favorites/<int:pk>/", api.favorite, name="api_favorite"),
    path("session/", api.session, name="api_session"),
    path("vehicles/", api.VehicleList.as_view(), name="api_vehicle_list"),
    path("vehicles/<int:pk>/quote/", api.quote, name="api_quote"),
    path("vehicles/<int:pk>/", api.VehicleDetail.as_view(), name="api_vehicle_detail"),
    path("owner/bookings/", api.OwnerBookings.as_view(), name="api_owner_bookings"),
    path("owner/fleet/", api.fleet, name="api_fleet"),
    path("owner/fleet/<int:pk>/", api.fleet_vehicle, name="api_fleet_vehicle"),
    path("owner/fleet/<int:pk>/photos/", api.fleet_photos, name="api_fleet_photos"),
    path("owner/fleet/<int:pk>/photos/order/", api.fleet_photo_order, name="api_fleet_photo_order"),
    path("owner/fleet/<int:pk>/photos/<int:photo_id>/", api.fleet_photo, name="api_fleet_photo"),
    path("owner/fleet/<int:pk>/maintenance/", api.maintenance, name="api_maintenance"),
    path("owner/fleet/<int:pk>/maintenance/<int:block_id>/", api.maintenance_block, name="api_maintenance_block"),
    path("owner/value/", api.booking_values, name="api_booking_values"),
    path("bookings/<int:pk>/", api.booking_detail, name="api_booking_detail"),
    path("bookings/<int:pk>/timeline/", api.booking_timeline, name="api_booking_timeline"),
    path("bookings/<int:pk>/payment/", api.payment_start, name="api_payment_start"),
    path("bookings/<int:pk>/payment/confirm/", api.payment_confirm, name="api_payment_confirm"),
    path("bookings/<int:pk>/payment/fake-checkout/", api.payment_fake_checkout, name="api_payment_fake_checkout"),
    path("bookings/<int:pk>/cancellation/", api.cancellation_preview, name="api_cancellation_preview"),
    path("payments/config/", api.payment_config, name="api_payment_config"),
    path("payments/webhook/", api.payment_webhook, name="api_payment_webhook"),
    path("bookings/<int:pk>/review/", api.review, name="api_review"),
    path("bookings/<int:pk>/<str:action>/", api.booking_action, name="api_booking_action"),
    path("bookings/", api.bookings, name="api_bookings"),
]
