"""Uploaded media served by Django when there is no proxy in front (debug and local Docker).

Thumbnail file names contain a hash of their content, so a changed thumbnail always gets a new
URL; they are marked immutable for a year. Originals keep a one-day cache. Production serves
the same files from Caddy with the same headers (deploy/Caddyfile).
"""
import mimetypes

from django.conf import settings
from django.http import Http404
from django.views.static import serve

THUMBNAILS = "vehicles/thumbs/"
IMMUTABLE = "public, max-age=31536000, immutable"
ONE_DAY = "public, max-age=86400"

# Python 3.11 does not know .webp; without this every photo goes out as
# application/octet-stream, which strict browsers refuse under nosniff.
mimetypes.add_type("image/webp", ".webp")


def serve_media(request, path):
    if not settings.SERVE_MEDIA:
        raise Http404
    response = serve(request, path, document_root=settings.MEDIA_ROOT)
    response["Cache-Control"] = IMMUTABLE if path.startswith(THUMBNAILS) else ONE_DAY
    return response
