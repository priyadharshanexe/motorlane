from decimal import Decimal

from django import forms


def rental_quote(vehicle, start_date, end_date):
    days = (end_date - start_date).days + 1
    total_price = days * vehicle.price_per_day
    if not 0 < total_price <= Decimal("99999999.99"):
        raise forms.ValidationError("This rental cannot be priced for the selected dates.")
    return days, total_price
