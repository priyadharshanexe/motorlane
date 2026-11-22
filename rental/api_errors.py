"""API error responses.

A payment misconfiguration (for example the demo provider on a non-demo deployment) must not
surface as a 500 with a stack trace: the API answers 503 with a short message and logs the cause.
"""
import logging

from django.core.exceptions import ImproperlyConfigured
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


def api_exception_handler(exc, context):
    if isinstance(exc, ImproperlyConfigured):
        logger.error("api_misconfigured view=%s error=%s", context["view"].__class__.__name__, exc)
        return Response({"detail": "Payments are not available right now."}, status=503)
    return exception_handler(exc, context)
