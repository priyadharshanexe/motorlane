from decimal import Decimal

from django import forms
from django.core.validators import MinValueValidator
from django.utils import timezone

from .models import Vehicle


class BookingDatesForm(forms.Form):
    start_date = forms.DateField(widget=forms.DateInput(attrs={"type": "date"}))
    end_date = forms.DateField(widget=forms.DateInput(attrs={"type": "date"}))

    def clean(self):
        data = super().clean()
        start = data.get("start_date")
        end = data.get("end_date")
        if start and start < timezone.localdate():
            self.add_error("start_date", "Choose today or a later date.")
        if start and end and end < start:
            self.add_error("end_date", "End date cannot be before start date.")
        return data


class VehicleForm(forms.ModelForm):
    price_per_day = forms.DecimalField(max_digits=8, decimal_places=2,
                                       validators=[MinValueValidator(Decimal("0.01"))])

    class Meta:
        model = Vehicle
        fields = ("name", "vehicle_type", "fuel_type", "location", "price_per_day", "vehicle_image",
                  "description", "transmission", "seats", "model_year", "pickup_instructions")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.pk:
            self.fields["vehicle_image"].required = False

    def clean_vehicle_image(self):
        image = self.cleaned_data.get("vehicle_image")
        if getattr(image, "image", None):
            if image.size > 5 * 1024 * 1024 or max(image.image.size) > 4096:
                raise forms.ValidationError("Use an image up to 5 MB and 4096 pixels per side.")
            if image.image.format not in {"JPEG", "PNG", "WEBP"}:
                raise forms.ValidationError("Choose a JPEG, PNG, or WebP image.")
        return image


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


class MaintenanceForm(BookingDatesForm):
    reason = forms.CharField(max_length=120)
