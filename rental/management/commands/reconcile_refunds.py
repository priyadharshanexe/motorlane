from django.core.management.base import BaseCommand

from rental.payments.service import reconcile_refunds


class Command(BaseCommand):
    help = "Check pending and sent refund intents against the payment provider and record the outcome."

    def handle(self, *args, **options):
        counts = reconcile_refunds()
        self.stdout.write("Reconciled refunds: " + ", ".join(f"{k} {v}" for k, v in counts.items()) + ".")
