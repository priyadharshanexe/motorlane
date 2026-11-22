"""Turn Refund into RefundIntent, keeping every existing refund.

Refunds recorded before this change were already accepted by the provider, so they
become `sent` (or `succeeded` when a webhook had confirmed them) with one attempt and a
legacy idempotency key.
"""
from django.db import migrations, models
from django.utils import timezone


def mark_existing(apps, schema_editor):
    RefundIntent = apps.get_model("rental", "RefundIntent")
    for refund in RefundIntent.objects.using(schema_editor.connection.alias).iterator():
        refund.idempotency_key = f"legacy-refund-{refund.pk}"
        refund.status = "succeeded" if refund.processed else "sent"
        refund.attempts = 1
        refund.save(update_fields=["idempotency_key", "status", "attempts"])


def unmark(apps, schema_editor):
    RefundIntent = apps.get_model("rental", "RefundIntent")
    alias = schema_editor.connection.alias
    RefundIntent.objects.using(alias).filter(status="succeeded").update(processed=True)
    # Intents never accepted by the provider have no provider id; the old table required one.
    RefundIntent.objects.using(alias).filter(provider_refund_id__isnull=True).delete()


class Migration(migrations.Migration):
    dependencies = [("rental", "0026_vehicle_photos")]

    operations = [
        migrations.RenameModel("Refund", "RefundIntent"),
        migrations.AlterField("refundintent", "provider_refund_id",
                              models.CharField(blank=True, max_length=64, null=True, unique=True)),
        migrations.AddField("refundintent", "idempotency_key", models.CharField(max_length=80, null=True)),
        migrations.AddField("refundintent", "status", models.CharField(
            choices=[("pending", "Pending"), ("sent", "Sent"), ("succeeded", "Succeeded"), ("failed", "Failed")],
            default="pending", max_length=12)),
        migrations.AddField("refundintent", "attempts", models.PositiveSmallIntegerField(default=0)),
        migrations.AddField("refundintent", "next_attempt_at", models.DateTimeField(default=timezone.now)),
        migrations.AddField("refundintent", "last_error", models.CharField(blank=True, max_length=255)),
        migrations.AddField("refundintent", "updated_at", models.DateTimeField(auto_now=True)),
        migrations.RunPython(mark_existing, unmark),
        migrations.AlterField("refundintent", "idempotency_key", models.CharField(max_length=80, unique=True)),
        migrations.RemoveField("refundintent", "processed"),
        migrations.AddIndex("refundintent", models.Index(fields=["status", "next_attempt_at"], name="refund_due")),
        migrations.AddConstraint("refundintent", models.CheckConstraint(
            condition=models.Q(amount__gt=0), name="refund_amount_positive")),
    ]
