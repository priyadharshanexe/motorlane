from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django import forms
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import Booking, Vehicle
from .services.booking import reserve_vehicle
from .services.pricing import price_rental
from .testing import make_profile


def at(day, hour=9, minute=0):
    return timezone.make_aware(datetime.combine(day, time(hour, minute)))


def next_weekday(weekday, weeks_ahead=1):
    today = timezone.localdate()
    return today + timedelta(days=(weekday - today.weekday()) % 7 + 7 * weeks_ahead)


MONDAY = 0
SATURDAY = 5


@override_settings(RENTAL_LONG_RENTAL_DISCOUNTS=((30, 20), (7, 10)))
class PricingTests(TestCase):
    def setUp(self):
        self.vehicle = Vehicle(name="Car", vehicle_type="Car", price_per_day=Decimal("1000"))

    def test_partial_days_round_up_and_one_day_minimum(self):
        monday = next_weekday(MONDAY)
        self.assertEqual(price_rental(self.vehicle, at(monday, 9), at(monday, 11)).days, 1)
        self.assertEqual(price_rental(self.vehicle, at(monday, 9), at(monday + timedelta(days=1), 9)).days, 1)
        self.assertEqual(price_rental(self.vehicle, at(monday, 9), at(monday + timedelta(days=1), 10)).days, 2)

    def test_weekend_rate_applies_to_saturday_and_sunday_only(self):
        self.vehicle.weekend_price_per_day = Decimal("1500")
        friday = next_weekday(SATURDAY) - timedelta(days=1)
        quote = price_rental(self.vehicle, at(friday, 9), at(friday + timedelta(days=3), 9))  # Fri, Sat, Sun
        self.assertEqual((quote.weekday_days, quote.weekend_days), (1, 2))
        self.assertEqual(quote.rental_total, Decimal("4000.00"))
        self.assertEqual([line["kind"] for line in quote.lines], ["weekday", "weekend"])
        self.assertEqual(quote.lines[1], {"kind": "weekend", "label": "2 weekend days × ₹1,500", "amount": "3000.00"})

    def test_without_weekend_rate_there_is_a_single_line(self):
        saturday = next_weekday(SATURDAY)
        quote = price_rental(self.vehicle, at(saturday), at(saturday + timedelta(days=2)))
        self.assertEqual(quote.lines, [{"kind": "rental", "label": "2 days × ₹1,000", "amount": "2000.00"}])

    def test_long_rental_discount_tiers(self):
        monday = next_weekday(MONDAY)
        for days, percent in ((6, 0), (7, 10), (29, 10), (30, 20), (45, 20)):
            quote = price_rental(self.vehicle, at(monday), at(monday + timedelta(days=days)))
            self.assertEqual(quote.days, days)
            self.assertEqual(quote.discount_percent, percent)
            self.assertEqual(quote.rental_total, Decimal(1000 * days) * (100 - percent) / 100)
            self.assertEqual(any(line["kind"] == "discount" for line in quote.lines), bool(percent))

    def test_discount_applies_to_mixed_weekend_subtotal_and_rounds_to_paise(self):
        self.vehicle.price_per_day = Decimal("999.99")
        self.vehicle.weekend_price_per_day = Decimal("1234.56")
        monday = next_weekday(MONDAY)
        quote = price_rental(self.vehicle, at(monday), at(monday + timedelta(days=7)))
        subtotal = Decimal("999.99") * 5 + Decimal("1234.56") * 2
        self.assertEqual(quote.subtotal, subtotal)
        self.assertEqual(quote.discount, (subtotal / 10).quantize(Decimal("0.01")))
        self.assertEqual(quote.rental_total + quote.discount, quote.subtotal)

    def test_deposit_is_a_separate_refundable_line(self):
        self.vehicle.deposit = Decimal("5000")
        monday = next_weekday(MONDAY)
        quote = price_rental(self.vehicle, at(monday), at(monday + timedelta(days=1)))
        self.assertEqual(quote.rental_total, Decimal("1000.00"))
        self.assertEqual(quote.deposit, Decimal("5000.00"))
        self.assertEqual(quote.due_now, Decimal("6000.00"))
        self.assertEqual(quote.lines[-1]["kind"], "deposit")
        self.assertEqual(quote.as_dict()["total_price"], "1000.00")

    def test_rejects_return_before_pickup(self):
        monday = next_weekday(MONDAY)
        with self.assertRaises(forms.ValidationError):
            price_rental(self.vehicle, at(monday, 12), at(monday, 9))


class QuoteAndBookingApiTests(TestCase):
    def setUp(self):
        self.renter = make_profile("pricing-renter")
        self.vehicle = Vehicle.objects.create(name="Car", vehicle_type="Car", price_per_day=1000,
                                              weekend_price_per_day=1200, deposit=3000)

    def test_quote_breakdown_matches_the_stored_booking(self):
        monday = next_weekday(MONDAY)
        params = {"start_date": monday - timedelta(days=2), "end_date": monday, "pickup_time": "10:00",
                  "return_time": "10:00"}
        quote = self.client.get(reverse("api_quote", args=[self.vehicle.pk]), params, secure=True).json()
        self.assertEqual(quote["days"], 2)
        self.assertEqual(quote["rental_total"], "2400.00")
        self.assertEqual(quote["due_now"], "5400.00")
        self.client.force_login(self.renter.user)
        response = self.client.post(reverse("api_bookings"), {
            **params, "vehicle_id": self.vehicle.pk, "contact_name": "R", "contact_phone": "+91 99999 00000",
            "accepted_conditions": True,
        }, secure=True)
        self.assertEqual(response.status_code, 201, response.content)
        booking = Booking.objects.get()
        self.assertEqual(booking.price_breakdown, {k: v for k, v in quote.items()
                                                   if k not in ("available", "unavailable_reason", "earliest_pickup")})
        self.assertEqual((booking.total_price, booking.deposit_amount), (Decimal("2400.00"), Decimal("3000.00")))
        self.assertEqual((booking.pickup_time, booking.return_time), (time(10), time(10)))

    def test_same_day_return_must_follow_pickup(self):
        day = (timezone.localdate() + timedelta(days=3)).isoformat()
        response = self.client.get(reverse("api_quote", args=[self.vehicle.pk]), {
            "start_date": day, "end_date": day, "pickup_time": "15:00", "return_time": "11:00"}, secure=True)
        self.assertEqual(response.status_code, 400)
        self.assertIn("return_time", response.json())


@override_settings(RENTAL_TURNAROUND_MINUTES=120)
class TurnaroundTests(TestCase):
    def setUp(self):
        self.vehicle = Vehicle.objects.create(name="Bike", vehicle_type="Bike", price_per_day=500)
        self.day = timezone.localdate() + timedelta(days=5)
        self.first = reserve_vehicle(make_profile("first").pk, self.vehicle.pk, self.day, self.day, time(9), time(12))

    def reserve(self, start, end, day=None):
        return reserve_vehicle(make_profile(f"r{start.hour}{end.hour}{day or ''}").pk, self.vehicle.pk,
                               day or self.day, day or self.day, start, end)

    def test_same_day_rentals_need_the_cleaning_buffer(self):
        with self.assertRaisesMessage(forms.ValidationError, "cleaning window after the previous rental"):
            self.reserve(time(13), time(15))
        with self.assertRaisesMessage(forms.ValidationError, "cleaning window before the next rental"):
            self.reserve(time(6), time(8))
        self.assertEqual(self.reserve(time(14), time(18)).status, "Pending")

    def test_buffer_also_separates_maintenance(self):
        from .services.maintenance import schedule_maintenance
        next_day = self.day + timedelta(days=1)
        late = self.reserve(time(14), time(23), day=None)
        with self.assertRaises(forms.ValidationError):
            schedule_maintenance(self.vehicle, next_day, next_day, "Service")
        late.status = Booking.Status.CANCELLED
        late.save()
        schedule_maintenance(self.vehicle, next_day, next_day, "Service")
        with self.assertRaisesMessage(forms.ValidationError, "cleaning window before scheduled maintenance"):
            reserve_vehicle(make_profile("blocked").pk, self.vehicle.pk, self.day, self.day, time(18), time(22, 30))

    def test_search_hides_vehicles_inside_the_buffer(self):
        url = reverse("api_vehicle_list")
        day = self.day.isoformat()
        busy = {"start_date": day, "end_date": day, "pickup_time": "13:00", "return_time": "15:00"}
        free = {**busy, "pickup_time": "14:00", "return_time": "16:00"}
        self.assertEqual(self.client.get(url, busy, secure=True).json()["results"], [])
        self.assertEqual(len(self.client.get(url, free, secure=True).json()["results"]), 1)


@override_settings(RENTAL_TURNAROUND_MINUTES=120)
class CleaningWindowMessageTests(TestCase):
    """Buffer-only conflicts explain the cleaning window and suggest the earliest workable pickup."""

    def setUp(self):
        self.vehicle = Vehicle.objects.create(name="Bike", vehicle_type="Bike", price_per_day=500)
        self.day = timezone.localdate() + timedelta(days=6)
        reserve_vehicle(make_profile("first-rental").pk, self.vehicle.pk, self.day, self.day, time(9), time(14))
        self.renter = make_profile("next-renter")

    def book(self, start, end):
        self.client.force_login(self.renter.user)
        return self.client.post(reverse("api_bookings"), {
            "vehicle_id": self.vehicle.pk, "start_date": self.day, "end_date": self.day, "pickup_time": start,
            "return_time": end, "contact_name": "R", "contact_phone": "+91 99999 00000", "accepted_conditions": True,
        }, secure=True)

    def test_pickup_too_soon_after_the_previous_rental_names_the_earliest_pickup(self):
        response = self.book("15:00", "17:00")
        self.assertEqual(response.status_code, 409)
        label = f"16:00 on {self.day.day} {self.day:%b}"
        self.assertEqual(response.json()["detail"],
                         f"This vehicle needs a 2-hour cleaning window after the previous rental: earliest pickup is {label}.")
        self.assertTrue(response.json()["earliest_pickup"].startswith(f"{self.day.isoformat()}T16:00:00"))
        self.assertEqual(self.book("16:00", "18:00").status_code, 201)

    def test_return_too_close_to_the_next_rental_names_the_latest_return(self):
        later = make_profile("later")
        reserve_vehicle(later.pk, self.vehicle.pk, self.day, self.day, time(19), time(22))
        response = self.book("16:00", "18:00")
        self.assertEqual(response.status_code, 409)
        self.assertIn("cleaning window before the next rental: return by 17:00", response.json()["detail"])

    def test_a_real_overlap_keeps_the_plain_message_but_still_suggests_a_time(self):
        response = self.book("10:00", "12:00")
        self.assertEqual(response.json()["detail"], "Vehicle already booked for these dates.")
        self.assertTrue(response.json()["earliest_pickup"].startswith(f"{self.day.isoformat()}T16:00:00"))

    def test_quote_reports_availability_and_the_suggestion(self):
        url = reverse("api_quote", args=[self.vehicle.pk])
        params = {"start_date": self.day, "end_date": self.day, "pickup_time": "15:00", "return_time": "17:00"}
        busy = self.client.get(url, params, secure=True).json()
        self.assertFalse(busy["available"])
        self.assertIn("cleaning window", busy["unavailable_reason"])
        self.assertTrue(busy["earliest_pickup"].startswith(f"{self.day.isoformat()}T16:00:00"))
        free = self.client.get(url, {**params, "pickup_time": "16:30", "return_time": "18:00"}, secure=True).json()
        self.assertEqual((free["available"], free["earliest_pickup"]), (True, None))
