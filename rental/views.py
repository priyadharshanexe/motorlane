"""Server-rendered pages. Business logic lives in services/ and selectors.py."""
import json
from decimal import Decimal
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
    """The first photo's small rendition, which the static first frame shows (see _photo)."""
    return f'<link rel="preload" as="image" fetchpriority="high" href="{escape(small)}">'


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
    return "".join(tags), _static_first(route, next(iter(parsed.values()), None), getattr(request, "csp_nonce", ""), request.GET.get("type"))


HANG = [-1.4, 0.6, 1.2, -0.8, 1.6, -1.1]  # the key tags' resting angles (frontend/src/odo/KeyTag.tsx)


def _odometer(value, label):
    """Server copy of the app's Odometer: one wheel per digit, so the count has its real size on first paint."""
    wheels = "".join(
        f'<span class="odo-wheel" aria-hidden="true"><span class="odo-strip" style="--digit: {c}">'
        + "".join(f"<span>{d}</span>" for d in range(10)) + "</span></span>"
        if c.isdigit() else f'<span class="odo-sep" aria-hidden="true">{escape(c)}</span>' for c in value)
    return f'<span class="odo odo-md" aria-label="{escape(label)}" role="img">{wheels}</span>'


def _photo(vehicle, sizes, first=False, extra_style=""):
    cover = vehicle.get("cover")
    if not cover:
        return f'<div class="photo placeholder">{escape(vehicle.get("vehicle_type", ""))}</div>'
    dims = f' width="{cover["width"]}" height="{cover["height"]}"' if cover.get("width") and cover.get("height") else ""
    colour = f"background-color: {escape(cover['color'])};" if cover.get("color") else ""
    if first:  # the small rendition paints at the card's real size within a second; the app's sharp copy replaces it
        return (f'<img class="photo" src="{escape(cover["small"])}"{dims} alt="{escape(vehicle.get("name", ""))}" fetchpriority="high" '
                f'loading="eager" decoding="async" style="{colour}{extra_style}">')
    return (f'<img class="photo" src="{escape(cover["small"])}" srcset="{escape(cover["small"])} 400w, {escape(cover["large"])} 1200w" '
            f'sizes="{sizes}"{dims} alt="{escape(vehicle.get("name", ""))}" loading="lazy" decoding="async" style="{colour}{extra_style}">')


def _key_tag(vehicle, index):
    """Server copy of the app's KeyTag markup (same classes, so the same size and place in the grid)."""
    meta = " · ".join(x for x in (vehicle.get("location") or "Location on request", vehicle.get("transmission"),
                                    f'{vehicle["seats"]} seats' if vehicle.get("seats") else None, vehicle.get("fuel_type")) if x)
    price = f"{Decimal(vehicle.get('price_per_day') or 0):,.0f}"
    rating = (f'<span aria-hidden="true">★</span> {Decimal(vehicle["rating"]):.1f} · {vehicle["review_count"]} review{"" if vehicle["review_count"] == 1 else "s"}'
              if vehicle.get("rating") else " New listing")
    url = f'/app/vehicles/{vehicle["id"]}'
    return (f'<article class="od-tag" data-vehicle-type="{escape(vehicle.get("vehicle_type", ""))}" style="--hang: {HANG[index % len(HANG)]}deg">'
            '<span class="od-tag-hole" aria-hidden="true"></span>'
            f'<div class="od-tag-media loaded"><a href="{url}" tabindex="-1" aria-label="View {escape(vehicle.get("name", ""))}">{_photo(vehicle, CARD_SIZES, index == 0)}</a>'
            f'<span class="od-tag-type">{escape(vehicle.get("vehicle_type", ""))}</span></div>'
            f'<span class="od-plate mono" aria-hidden="true">ML·{vehicle["id"]:04d}</span>'
            f'<h3><a href="{url}">{escape(vehicle.get("name", ""))}</a></h3>'
            f'<p class="od-tag-meta">{escape(meta)}</p>'
            f'<div class="od-tag-foot"><span class="od-tag-price"><span class="mono">₹{price}</span><small>per day</small></span>'
            f'<span class="vehicle-rating">{rating}</span></div></article>')


# Theme before paint. HEAD_BOOT is the first thing in <head>, ahead of every stylesheet: it picks the theme (saved
# choice, else the system) and puts it on <html> with the matching background, so even a half-streamed page on a slow
# connection never paints in the wrong colours. THEME_SCRIPT is the static shell's first child: it copies that theme
# onto the shell before its header is parsed; THEME_LABEL then sets the header's Day/Night button.
PICK_THEME = ("var t;try{t=localStorage.getItem('motorlane-theme')}catch(e){}"
              "if(t!=='dark'&&t!=='light')t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';")
HEAD_STYLE = ("<style>html{background:#121417;color:#EDEAE3;color-scheme:dark}"
              "html[data-theme=light]{background:#F3F1EC;color:#16181B;color-scheme:light}</style>")
THEME_SCRIPT = ("(function(a){var t=document.documentElement.dataset.theme;if(t!=='dark'&&t!=='light'){" + PICK_THEME + "}"
                "a.dataset.theme=t;if(matchMedia('(prefers-reduced-motion: reduce)').matches)a.dataset.motion='reduced';"
                "})(document.currentScript.parentElement)")
THEME_LABEL = ("(function(a){if(a.dataset.theme==='light'){var b=a.querySelector('.od-theme');"
               "b.firstChild.textContent='☾';b.lastChild.textContent='Night'}})(document.currentScript.parentElement)")


def head_boot(nonce):
    return (f'{HEAD_STYLE}<script nonce="{escape(nonce)}">(function(d){{{PICK_THEME}d.dataset.theme=t}})'
            f'(document.documentElement)</script>')


def _shell(nonce, page):
    """The app's shell (theme, skip link, header) around a page, with the app's own classes."""
    header = (
        '<a class="od-skip" href="#main">Skip to content</a>'
        '<header class="od-header"><a class="od-brand" href="/app/"><svg class="od-lanemark" viewBox="0 0 40 40" aria-hidden="true">'
        '<path class="od-lanemark-m" d="M6 34 L6 6 L20 22 L34 6 L34 34"></path><path class="od-lanemark-lane" d="M20 25 V34"></path></svg> '
        '<span>MOTORLANE</span></a><nav class="od-nav" aria-label="Main navigation"><a href="/app/">Discover</a>'
        '<a href="/app/vehicles?type=Car">Cars</a><a href="/app/vehicles?type=Bike">Bikes</a></nav>'
        '<div class="od-header-actions"><a class="od-host" href="/app/owner/fleet?edit=new">List your vehicle</a>'
        '<button type="button" class="od-theme" aria-label="Switch colours"><span aria-hidden="true">☀</span><span class="od-theme-label">Day</span></button>'
        '<details class="od-menu"><summary aria-label="Open navigation menu"><span class="od-burger" aria-hidden="true"><i></i><i></i><i></i></span>'
        '<span class="od-menu-label">Menu</span></summary></details></div></header>')
    return (f'<div class="od-app static-first" data-theme="dark" data-motion="full"><script nonce="{escape(nonce)}">{THEME_SCRIPT}</script>'
            f'{header}<script nonce="{escape(nonce)}">{THEME_LABEL}</script>'
            f'<main id="main" class="od-main">{page}</main>'
            '<div class="od-spinner" role="status"><span class="od-spinner-gauge" aria-hidden="true"><i></i></span>'
            '<span class="od-spinner-text"><span class="od-spinner-label">Starting engine</span>'
            '<span class="od-spinner-lane" aria-hidden="true"><i></i></span></span></div></div>')


def _static_first(route, data, nonce="", request_type=None):
    """The page's first frame as plain HTML with the app's own classes and stylesheets, so it paints at its real
    size and place before the JS has loaded; main.tsx keeps it until the app has drawn the same frame."""
    if route == "home":
        return _shell(nonce, '<section class="od-hero"><div class="od-hero-stage"><div class="od-hero-scene"><div class="od-hero-poster"></div></div>'
                             '<div class="od-hero-copy"><h1>Your next <br>stretch <br>of <em>road.</em></h1>'
                             '<p>Cars and bikes from local owners across Tamil Nadu. Pick your dates, see what is free, take the keys.</p>'
                             '</div></div></section>')
    if route == "catalog" and data:
        results = data.get("results") or []
        count = data.get("count", len(results))
        kind = (request_type or "").capitalize()
        heading = "Discover your next car." if kind == "Car" else "Life on two wheels." if kind == "Bike" else "Where to next?"
        head = ('<header class="od-catalog-head"><span class="od-eyebrow">A ride for every reason</span>'
                f'<h1>{heading}</h1>'
                f'<div class="od-catalog-count">{_odometer(f"{count:02d}", f"{count} rides")}<span>{"ride" if count == 1 else "rides"} match</span></div>'
                '<ul class="od-signs" aria-label="Active filters"></ul></header>')
        rail = ('<aside class="od-rail"><details class="od-sheet"><summary>Refine your search</summary></details>'
                '<div class="od-rail-desk"><span class="od-eyebrow">Gearbox</span><div class="od-skel od-rail-skel"></div></div></aside>')
        tags = "".join(_key_tag(v, i) for i, v in enumerate(results))
        return _shell(nonce, f'<div class="od-catalog">{head}<div class="od-catalog-body">{rail}<section class="od-results">'
                             f'<div class="od-tags od-tags-grid">{tags}</div></section></div></div>')
    if route == "detail" and data:
        photos = sorted(data.get("photos") or [], key=lambda p: (not p.get("is_cover"), p.get("order", 0)))
        cover = data.get("cover") or {}
        ratio = f'{int(cover["width"])} / {int(cover["height"])}' if cover.get("width") and cover.get("height") else "3 / 2"
        first = photos[0] if photos else None
        image = (f'<img src="{escape(first["small"])}" alt="{escape(data.get("name", ""))}" fetchpriority="high" loading="eager" decoding="async"'
                 + (f' style="background-color: {escape(cover["color"])}"' if cover.get("color") else "") + '>') if first else ""
        gallery = (f'<div class="od-gallery"><div class="od-gallery-viewport" style="aspect-ratio: {ratio}">'
                   f'<div class="od-gallery-track">{image}</div></div></div>')
        head = (f'<header class="od-detail-head"><span class="od-plate mono">ML·{data["id"]:04d}</span><h1>{escape(data.get("name", ""))}</h1>'
                f'<p class="od-detail-where"><span aria-hidden="true">◉</span> {escape(data.get("location") or "Location on request")} · hosted by '
                f'{escape(data.get("host_name") or "a local owner")}</p></header>')
        return _shell(nonce, f'<div class="od-detail"><nav class="od-crumbs" aria-label="Breadcrumb"><a href="/app/vehicles">← Explore vehicles</a>'
                             f'<span aria-current="page">{escape(data.get("name", ""))}</span></nav>'
                             f'<section class="od-detail-main">{gallery}{head}</section></div>')
    return ""


def react_app(request):
    index = settings.FRONTEND_BUILD / "index.html"
    if not index.is_file():
        raise Http404("Build the frontend before opening the marketplace.")
    html = index.read_text(encoding="utf-8")
    html = html.replace("<head>", "<head>" + head_boot(getattr(request, "csp_nonce", "")), 1)
    if ROUTE_HINTS in html:
        try:
            hints, static = _route_hints(request, request.path[len("/app"):])
        except Exception:  # the page must still load without its speed-ups
            logger.exception("route_hints_failed path=%s", request.path)
            hints, static = "", ""
        html = html.replace(ROUTE_HINTS, hints, 1).replace('<div id="root"></div>', f'<div id="root">{static}</div>', 1)
    response = HttpResponse(html, content_type="text/html")
    # Signed in: never keep the page (including the back-forward cache), so Back after signing out cannot show it.
    response["Cache-Control"] = "no-store, private" if request.user.is_authenticated else "no-cache"
    return response
