from django.core.management.base import BaseCommand

from rental.payments.service import process_due_refunds


class Command(BaseCommand):
    help = "Send due refund intents to the payment provider (with their idempotency keys)."

    def handle(self, *args, **options):
        self.stdout.write(f"Sent {len(process_due_refunds())} refund(s).")
