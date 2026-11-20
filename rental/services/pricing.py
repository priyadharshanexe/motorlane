"""Server-side rental pricing. The client only ever displays what this returns.

A quote walks every billable day (24-hour periods from pickup, rounded up), charging the
vehicle's weekend rate on Saturdays and Sundays when it has one. Long rentals get the
largest matching discount from `RENTAL_LONG_RENTAL_DISCOUNTS` on the rental subtotal. The
refundable deposit is shown as its own line: it is collected with the payment and returned
after the vehicle comes back, so it is never part of the rental charge (`total_price`).
"""
from dataclasses import dataclass, field
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from django import forms
from django.conf import settings

from ..models import billable_days

CENT = Decimal("0.01")
MAX_TOTAL = Decimal("99999999.99")


def money(value):
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass
class Quote:
    days: int
    weekday_days: int
    weekend_days: int
    daily_rate: Decimal
    weekend_rate: Decimal
    subtotal: Decimal
    discount_percent: int
    discount: Decimal
    rental_total: Decimal
    deposit: Decimal
    lines: list = field(default_factory=list)

    @property
    def due_now(self):
        return self.rental_total + self.deposit

    def as_dict(self):
        return {
            "days": self.days,
            "lines": self.lines,
            "subtotal": str(self.subtotal),
            "discount": str(self.discount),
            "rental_total": str(self.rental_total),
            "deposit": str(self.deposit),
            "due_now": str(self.due_now),
            # Kept for existing clients: the rental charge, excluding the refundable deposit.
            "total_price": str(self.rental_total),
        }


def discount_percent_for(days):
    for minimum, percent in settings.RENTAL_LONG_RENTAL_DISCOUNTS:
        if days >= minimum and percent > 0:
            return minimum, percent
    return None, 0


def price_rental(vehicle, pickup_at, return_at):
    if return_at <= pickup_at:
        raise forms.ValidationError("The return time must be after the pickup time.")
    days = billable_days(pickup_at, return_at)
    weekday_rate = money(vehicle.price_per_day)
    weekend_rate = money(vehicle.weekend_price_per_day if vehicle.weekend_price_per_day is not None
                         else vehicle.price_per_day)
    first_day = pickup_at.date()
    weekend_days = sum((first_day + timedelta(days=i)).weekday() >= 5 for i in range(days))
    weekday_days = days - weekend_days

    lines = []
    if weekend_rate == weekday_rate:
        lines.append(line("rental", f"{days} day{'s' if days != 1 else ''} × ₹{weekday_rate}", weekday_rate * days))
    else:
        if weekday_days:
            lines.append(line("weekday", f"{weekday_days} weekday{'s' if weekday_days != 1 else ''} × ₹{weekday_rate}",
                              weekday_rate * weekday_days))
        if weekend_days:
            lines.append(line("weekend", f"{weekend_days} weekend day{'s' if weekend_days != 1 else ''} × ₹{weekend_rate}",
                              weekend_rate * weekend_days))
    subtotal = money(weekday_rate * weekday_days + weekend_rate * weekend_days)
    minimum, percent = discount_percent_for(days)
    discount = money(subtotal * percent / 100)
    if discount:
        lines.append(line("discount", f"{minimum}+ day discount ({percent}%)", -discount))
    rental_total = subtotal - discount
    deposit = money(vehicle.deposit or 0)
    if deposit:
        lines.append(line("deposit", "Refundable security deposit", deposit))
    if not 0 < rental_total <= MAX_TOTAL:
        raise forms.ValidationError("This rental cannot be priced for the selected dates.")
    return Quote(days, weekday_days, weekend_days, weekday_rate, weekend_rate, subtotal, percent, discount,
                 rental_total, deposit, lines)


def line(kind, label, amount):
    return {"kind": kind, "label": label, "amount": str(money(amount))}


def rental_quote(vehicle, start_date, end_date, pickup_time=None, return_time=None):
    """Backwards-compatible helper: (billable days, rental total) for a date range."""
    from ..forms import rental_window
    quote = price_rental(vehicle, *rental_window(start_date, end_date, pickup_time, return_time))
    return quote.days, quote.rental_total
