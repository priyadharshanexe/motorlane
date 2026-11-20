#!/bin/sh
# Runs Motorlane's periodic jobs in a loop. One instance per deployment is enough;
# every job is idempotent, so an extra instance or a restart mid-run is harmless.
set -u
interval="${SCHEDULER_INTERVAL_SECONDS:-300}"
echo "scheduler: running periodic jobs every ${interval}s"
while true; do
    python manage.py run_scheduled_jobs || echo "scheduler: run failed, retrying next cycle" >&2
    sleep "$interval"
done
