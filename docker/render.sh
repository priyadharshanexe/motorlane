#!/bin/sh
# Render free tier: one container runs the scheduler beside the web server, and the
# disk is wiped whenever the service sleeps. A fresh disk has no vehicle photos, so
# a demo deployment rebuilds the demo before serving (reset_demo restores them).
set -eu
if [ "${DJANGO_DEMO_MODE:-0}" = "1" ] && [ -n "${RENTAL_DEMO_PASSWORD:-}" ] \
    && [ -z "$(ls -A /app/media 2>/dev/null)" ]; then
    python manage.py migrate --noinput
    python manage.py reset_demo
fi
sh docker/scheduler.sh &
exec sh docker/web.sh
