from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("rental", "0018_booking_contact")]
    operations = [
        migrations.AddField(
            model_name="booking", name="conditions_accepted_at",
            field=models.DateTimeField(blank=True, editable=False, null=True),
        ),
        migrations.AddField(
            model_name="booking", name="conditions_version",
            field=models.CharField(blank=True, editable=False, max_length=40),
        ),
    ]
