from datetime import datetime, time
from decimal import Decimal

from django import forms
from django.core.validators import MinValueValidator
from django.utils import timezone

from .models import Vehicle


DEFAULT_PICKUP_TIME = time(9, 0)
DEFAULT_RETURN_TIME = time(18, 0)


def rental_window(start_date, end_date, pickup_time=None, return_time=None):
    """Aware pickup and return datetimes. Times default to 09:00 pickup and 18:00 return."""
    pickup = datetime.combine(start_date, pickup_time or DEFAULT_PICKUP_TIME)
    dropoff = datetime.combine(end_date, return_time or DEFAULT_RETURN_TIME)
    return timezone.make_aware(pickup), timezone.make_aware(dropoff)


class BookingDatesForm(forms.Form):
    start_date = forms.DateField(widget=forms.DateInput(attrs={"type": "date"}))
    end_date = forms.DateField(widget=forms.DateInput(attrs={"type": "date"}))
    pickup_time = forms.TimeField(required=False, help_text="Local time, default 09:00.")
    return_time = forms.TimeField(required=False, help_text="Local time, default 18:00.")

    def clean(self):
        data = super().clean()
        start = data.get("start_date")
        end = data.get("end_date")
        if start and start < timezone.localdate():
            self.add_error("start_date", "Choose today or a later date.")
        if start and end and end < start:
            self.add_error("end_date", "End date cannot be before start date.")
        elif start and end:
            data["pickup_time"] = data.get("pickup_time") or DEFAULT_PICKUP_TIME
            data["return_time"] = data.get("return_time") or DEFAULT_RETURN_TIME
            if start == end and data["return_time"] <= data["pickup_time"]:
                self.add_error("return_time", "The return time must be after the pickup time.")
        return data

    @property
    def window(self):
        data = self.cleaned_data
        return rental_window(data["start_date"], data["end_date"], data["pickup_time"], data["return_time"])


class VehicleForm(forms.ModelForm):
    price_per_day = forms.DecimalField(max_digits=8, decimal_places=2,
                                       validators=[MinValueValidator(Decimal("0.01"))])
    weekend_price_per_day = forms.DecimalField(max_digits=8, decimal_places=2, required=False,
                                               validators=[MinValueValidator(Decimal("0.01"))])
    deposit = forms.DecimalField(max_digits=8, decimal_places=2, required=False,
                                 validators=[MinValueValidator(Decimal("0"))])

    vehicle_image = forms.ImageField(help_text="Becomes the listing's cover photo.")

    def clean_deposit(self):
        return self.cleaned_data.get("deposit") or Decimal("0")

    class Meta:
        model = Vehicle
        fields = ("name", "vehicle_type", "fuel_type", "location", "price_per_day", "weekend_price_per_day",
                  "deposit",
                  "description", "transmission", "seats", "model_year", "pickup_instructions")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.pk:
            self.fields["vehicle_image"].required = False

    def clean_vehicle_image(self):
        from .services.photos import validate_upload
        image = self.cleaned_data.get("vehicle_image")
        return validate_upload(image) if image else image


class ReportDatesForm(forms.Form):
    start_date = forms.DateField(required=False, widget=forms.DateInput(attrs={"type": "date"}))
    end_date = forms.DateField(required=False, widget=forms.DateInput(attrs={"type": "date"}))

    def clean(self):
        data = super().clean()
        if data.get("start_date") and data.get("end_date") and data["end_date"] < data["start_date"]:
            self.add_error("end_date", "Return date must be on or after the start date.")
        return data


class FeedbackForm(forms.Form):
    rating = forms.TypedChoiceField(choices=[(i, i) for i in range(1, 6)], coerce=int)
    comment = forms.CharField(max_length=500, widget=forms.Textarea(attrs={"rows": 4}))


class MaintenanceForm(forms.Form):
    """Maintenance blocks whole days: from 00:00 on the start date to 24:00 on the end date."""
    start_date = forms.DateField()
    end_date = forms.DateField()
    reason = forms.CharField(max_length=120)

    def clean(self):
        data = super().clean()
        start, end = data.get("start_date"), data.get("end_date")
        if start and start < timezone.localdate():
            self.add_error("start_date", "Choose today or a later date.")
        if start and end and end < start:
            self.add_error("end_date", "End date cannot be before start date.")
        return data


class SearchForm(forms.Form):
    min_price = forms.DecimalField(required=False, min_value=0, max_digits=10, decimal_places=2)
    max_price = forms.DecimalField(required=False, min_value=0, max_digits=10, decimal_places=2)
    sort = forms.ChoiceField(required=False, choices=[(s, s) for s in ("name", "price", "-price", "rating", "newest")])

    def clean(self):
        data = super().clean()
        low, high = data.get("min_price"), data.get("max_price")
        if low is not None and high is not None and high < low:
            self.add_error("max_price", "The maximum price must be at least the minimum price.")
        return data


class PhotoForm(forms.Form):
    image = forms.ImageField()
    cover = forms.BooleanField(required=False)

    def clean_image(self):
        from .services.photos import validate_upload
        return validate_upload(self.cleaned_data["image"])
