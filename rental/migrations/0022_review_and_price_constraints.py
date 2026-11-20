"""Enforce review and price rules in the database.

Legacy Feedback rows written before reviews were tied to bookings are attached to the
renter's most recent returned, not-yet-reviewed booking of the same vehicle. Rows with no
such booking cannot be verified and were already hidden from every page, so they are
deleted. Out-of-range ratings are clamped to 1..5 before the check constraint is added.
"""
from django.db import migrations, models
from django.db.models import deletion


def attach_or_remove_legacy_reviews(apps, schema_editor):
    Feedback = apps.get_model("rental", "Feedback")
    Booking = apps.get_model("rental", "Booking")
    alias = schema_editor.connection.alias
    reviews = Feedback.objects.using(alias)
    reviews.filter(rating__lt=1).update(rating=1)
    reviews.filter(rating__gt=5).update(rating=5)
    for review in reviews.filter(booking__isnull=True).order_by("created_at", "pk"):
        booking = (Booking.objects.using(alias)
                   .filter(user_id=review.user_id, vehicle_id=review.vehicle_id, status="Returned", review__isnull=True)
                   .order_by("-end_date", "-pk").first())
        if booking is None:
            review.delete()
        else:
            review.booking_id = booking.pk
            review.save(update_fields=["booking"])


class Migration(migrations.Migration):
    dependencies = [("rental", "0021_backfill_booking_events")]

    operations = [
        migrations.RunPython(attach_or_remove_legacy_reviews, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="feedback", name="booking",
            field=models.OneToOneField(on_delete=deletion.CASCADE, related_name="review", to="rental.booking"),
        ),
        migrations.AddConstraint(
            model_name="feedback",
            constraint=models.CheckConstraint(condition=models.Q(rating__gte=1, rating__lte=5), name="feedback_rating_1_to_5"),
        ),
        migrations.AddConstraint(
            model_name="vehicle",
            constraint=models.CheckConstraint(condition=models.Q(price_per_day__gte=0), name="vehicle_price_non_negative"),
        ),
        migrations.AddConstraint(
            model_name="booking",
            constraint=models.CheckConstraint(condition=models.Q(total_price__gte=0), name="booking_total_non_negative"),
        ),
        migrations.AddConstraint(
            model_name="booking",
            constraint=models.CheckConstraint(
                condition=models.Q(quoted_daily_rate__isnull=True) | models.Q(quoted_daily_rate__gte=0),
                name="booking_daily_rate_non_negative",
            ),
        ),
    ]
