from django.core.management.base import BaseCommand

from rental.payments.service import process_due_refunds, reconcile_refunds, retry_failed_refunds


class Command(BaseCommand):
    help = "Check pending and sent refund intents against the payment provider and record the outcome."

    def add_arguments(self, parser):
        parser.add_argument("--retry-failed", action="store_true",
                            help="Requeue refunds that gave up after their last attempt, and try them now.")

    def handle(self, *args, retry_failed=False, **options):
        if retry_failed:
            requeued = retry_failed_refunds()
            sent = process_due_refunds()
            self.stdout.write(f"Requeued {requeued} failed refund(s); {len(sent)} sent now.")
        counts = reconcile_refunds()
        self.stdout.write("Reconciled refunds: " + ", ".join(f"{k} {v}" for k, v in counts.items()) + ".")
