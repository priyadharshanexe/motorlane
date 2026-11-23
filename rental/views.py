"""Server-rendered pages. Business logic lives in services/ and selectors.py."""
import json
import logging
import re

from django.conf import settings
from django.contrib.admin.views.decorators import staff_member_required
from django.contrib.auth.decorators import login_required
from django.http import FileResponse, Http404, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.utils.html import escape

from .models import Booking, NotificationOutbox, RefundIntent
from .selectors import active_bookings
from .services.profiles import rental_profile

logger = logging.getLogger(__name__)


@staff_member_required
def admin_dashboard(request):
    return render(request, "rental/admin_dashboard.html", {
        "pending_count": active_bookings().filter(status=Booking.Status.PENDING).count(),
        "overdue_count": Booking.objects.filter(
            status=Booking.Status.IN_PROGRESS, end_date__lt=timezone.localdate(),
        ).count(),
        "recent_bookings": Booking.objects.select_related("user__user", "vehicle").order_by("-pk")[:15],
        "failed_refunds": RefundIntent.objects.filter(status=RefundIntent.Status.FAILED)
        .select_related("payment").order_by("-updated_at")[:20],
        "failed_emails": NotificationOutbox.objects.filter(status=NotificationOutbox.Status.FAILED)
        .order_by("-next_attempt_at")[:20],
        "failed_refund_count": RefundIntent.objects.filter(status=RefundIntent.Status.FAILED).count(),
        "failed_email_count": NotificationOutbox.objects.filter(status=NotificationOutbox.Status.FAILED).count(),
    })


@login_required
def download_receipt(request, booking_id):
    user_id = rental_profile(request.user).pk
    booking = get_object_or_404(Booking, id=booking_id, user_id=user_id)
    response = HttpResponse(content_type="application/pdf")
    response["Content-Disposition"] = 'attachment; filename="booking-summary.pdf"'
    from .receipts import render_booking_summary
    render_booking_summary(response, booking)
    return response


def home(request):
    return redirect("/app/")


ROUTE_HINTS = "<!--route-hints-->"
CARD_SIZES = "(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 400px"
GALLERY_SIZES = "(max-width: 900px) 100vw, 60vw"


def _preload_manifest():
    path = settings.FRONTEND_BUILD / "preload-manifest.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _api_json(view, request, **kwargs):
    """Run a public read-only API view in-process (same request, same query string) for the first paint."""
    accept = request.META.get("HTTP_ACCEPT")
    request.META["HTTP_ACCEPT"] = "application/json"  # not the browsable HTML renderer a browser would get
    try:
        response = view(request, **kwargs)
        response.render()
    except Exception:  # never let the speed-up break the page
        logger.exception("initial_data_failed path=%s", request.path)
        return None
    finally:
        if accept is None:
            request.META.pop("HTTP_ACCEPT", None)
        else:
            request.META["HTTP_ACCEPT"] = accept
    return response.content.decode() if response.status_code == 200 else None


def _image_preload(small, large, sizes):
    return (f'<link rel="preload" as="image" fetchpriority="high" href="{escape(large)}" '
            f'imagesrcset="{escape(small)} 400w, {escape(large)} 1200w" imagesizes="{sizes}">')


def _route_hints(request, rest):
    """Per-route extras for the HTML: the route's own JS chunks, the first image the page will show (so it downloads
    in parallel with the JS instead of after it), and that page's API data inline (one round trip fewer)."""
    from . import api as api_views
    manifest, tags, data = _preload_manifest(), [], {}
    route = "home" if rest in ("", "/") else "catalog" if rest.rstrip("/") == "/vehicles" else (
        "detail" if re.fullmatch(r"/vehicles/\d+/?", rest) else None)
    # Home's first paint is text, so its chunks can load at once; on the catalog and a vehicle page the first paint is
    # a photo, which should not share the bandwidth with JS that the static paint makes unnecessary for it.
    if route == "home":
        tags += [f'<link rel="modulepreload" crossorigin href="{href}">' for href in manifest.get(route, [])]
    if route == "catalog":
        body = _api_json(api_views.VehicleList.as_view(), request)
        if body:
            data[f"vehicles/?{request.GET.urlencode()}"] = body
            first = (json.loads(body).get("results") or [None])[0]
            if first and first.get("cover"):
                tags.insert(0, _image_preload(first["cover"]["small"], first["cover"]["large"], CARD_SIZES))
    elif route == "detail":
        pk = int(re.search(r"\d+", rest).group())
        body = _api_json(api_views.VehicleDetail.as_view(), request, pk=pk)
        if body:
            data[f"vehicles/{pk}/"] = body
            # same order as the gallery: the cover first, then by position
            photos = sorted(json.loads(body).get("photos") or [], key=lambda p: (not p.get("is_cover"), p.get("order", 0)))
            if photos:
                tags.insert(0, _image_preload(photos[0]["small"], photos[0]["large"], GALLERY_SIZES))
    parsed = {k: json.loads(v) for k, v in data.items()}
    if parsed:
        payload = json.dumps(parsed).replace("</", "<\\/")
        tags.append(f'<script id="initial-data" type="application/json">{payload}</script>')
    return "".join(tags), _static_first(route, next(iter(parsed.values()), None))


def _img(photo, sizes, alt, ratio=None, wide=False):
    style = f' style="aspect-ratio: {ratio}"' if ratio else ""
    return (f'<img src="{escape(photo["large"])}" srcset="{escape(photo["small"])} 400w, {escape(photo["large"])} 1200w" '
            f'sizes="{sizes}" alt="{escape(alt)}" fetchpriority="high"{style}' + (' class="wide"' if wide else "") + '>')


def _static_first(route, data):
    """The page's headline (and first photo) as plain HTML, so it paints before the JS has loaded."""
    if route == "home":
        return ('<div class="static-first"><h1>Your next <br>stretch <br>of <em>road.</em></h1>'
                '<p>Cars and bikes from local owners across Tamil Nadu. Pick your dates, see what is free, take the keys.</p></div>')
    if route == "catalog" and data:
        first = (data.get("results") or [None])[0]
        photo = first and first.get("cover")
        return ('<div class="static-first"><h1>Where to next?</h1>'
                + (_img(photo, CARD_SIZES, first["name"], "1.52", wide=True) if photo else "") + "</div>")
    if route == "detail" and data:
        photos = sorted(data.get("photos") or [], key=lambda p: (not p.get("is_cover"), p.get("order", 0)))
        cover = data.get("cover") or {}
        ratio = f'{int(cover["width"])} / {int(cover["height"])}' if cover.get("width") and cover.get("height") else "3 / 2"
        return (f'<div class="static-first"><h1>{escape(data.get("name", ""))}</h1>'
                + (_img(photos[0], GALLERY_SIZES, data.get("name", ""), ratio, wide=True) if photos else "") + "</div>")
    return ""


def react_app(request):
    index = settings.FRONTEND_BUILD / "index.html"
    if not index.is_file():
        raise Http404("Build the frontend before opening the marketplace.")
    html = index.read_text(encoding="utf-8")
    if ROUTE_HINTS in html:
        try:
            hints, static = _route_hints(request, request.path[len("/app"):])
        except Exception:  # the page must still load without its speed-ups
            logger.exception("route_hints_failed path=%s", request.path)
            hints, static = "", ""
        html = html.replace(ROUTE_HINTS, hints, 1).replace('<div id="root"></div>', f'<div id="root">{static}</div>', 1)
    response = HttpResponse(html, content_type="text/html")
    response["Cache-Control"] = "no-cache"
    return response
