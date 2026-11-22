#!/bin/sh
# Production start: refuse unsafe settings, apply migrations, seed an empty demo, then serve.
set -eu
python manage.py check --deploy --fail-level ERROR
python manage.py migrate --noinput
if [ "${DJANGO_DEMO_MODE:-0}" = "1" ] && [ -n "${RENTAL_DEMO_PASSWORD:-}" ]; then
    # First boot of a demo deployment: create the demo accounts and catalog once.
    python manage.py shell -c "from rental.models import Vehicle; raise SystemExit(0 if Vehicle.objects.exists() else 3)" \
        || python manage.py reset_demo  # also records today's reset, so the scheduler does not repeat it
fi
exec gunicorn --bind=0.0.0.0:8000 --workers="${GUNICORN_WORKERS:-3}" --access-logfile - vehicle_rental.wsgi:application
