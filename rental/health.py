"""Liveness and readiness probes for containers and load balancers.

/healthz answers as long as the process serves requests; it never touches the database, so a
database outage does not get healthy web containers restarted. /readyz checks that the
database answers and that every migration is applied, and returns 503 otherwise.
"""
import logging

from django.db import DEFAULT_DB_ALIAS, connections
from django.db.migrations.executor import MigrationExecutor
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

logger = logging.getLogger(__name__)


@never_cache
@require_GET
def healthz(request):
    return JsonResponse({"status": "ok"})


@never_cache
@require_GET
def readyz(request):
    checks = {}
    try:
        connection = connections[DEFAULT_DB_ALIAS]
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        checks["database"] = "ok"
        executor = MigrationExecutor(connection)
        pending = executor.migration_plan(executor.loader.graph.leaf_nodes())
        checks["migrations"] = "ok" if not pending else f"{len(pending)} pending"
    except Exception as error:  # any failure means "not ready"; details go to the log only
        logger.warning("readiness_failed error=%s", type(error).__name__)
        checks.setdefault("database", "unavailable")
    ready = all(value == "ok" for value in checks.values()) and "migrations" in checks
    return JsonResponse({"status": "ok" if ready else "unavailable", "checks": checks}, status=200 if ready else 503)
