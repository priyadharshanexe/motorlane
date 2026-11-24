"""The /app/ page's first-paint extras: route preloads, the first photo, inline API data and a static headline."""
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.test import TestCase, override_settings

from .models import Vehicle

INDEX = '<!doctype html><html><head><title>x</title><!--route-hints--></head><body><div id="root"></div></body></html>'
MANIFEST = {"home": ["/static/react/assets/Home.js"], "catalog": ["/static/react/assets/Catalog.js"],
            "detail": ["/static/react/assets/VehicleDetail.js"], "fonts": []}


class FirstPaintTests(TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        build = Path(folder.name)
        (build / "index.html").write_text(INDEX, encoding="utf-8")
        (build / "preload-manifest.json").write_text(json.dumps(MANIFEST), encoding="utf-8")
        override = override_settings(FRONTEND_BUILD=build)
        override.enable()
        self.addCleanup(override.disable)
        self.vehicle = Vehicle.objects.create(name="Splendor </script>", vehicle_type="Bike", price_per_day=500)

    def get(self, path):
        response = self.client.get(path, secure=True, HTTP_ACCEPT="text/html")
        self.assertEqual(response.status_code, 200)
        return response.content.decode()

    def initial(self, html):
        start = html.index('<script id="initial-data" type="application/json">') + len('<script id="initial-data" type="application/json">')
        return json.loads(html[start:html.index("</script>", start)])

    def test_home_gets_its_chunks_and_a_static_headline(self):
        html = self.get("/app/")
        self.assertIn('<link rel="modulepreload" crossorigin href="/static/react/assets/Home.js">', html)
        self.assertIn('<div id="root"><div class="od-app static-first"', html)
        self.assertIn('<div class="od-hero-copy"><h1>Your next', html)
        self.assertNotIn("initial-data", html)

    def test_catalog_inlines_its_api_data_with_the_same_query(self):
        html = self.get("/app/vehicles?type=Bike")
        data = self.initial(html)
        self.assertEqual(list(data), ["vehicles/?type=Bike"])
        self.assertEqual(data["vehicles/?type=Bike"]["count"], 1)
        self.assertIn("<h1>Life on two wheels.</h1>", html)

    def test_detail_inlines_the_vehicle_and_escapes_it_in_html(self):
        html = self.get(f"/app/vehicles/{self.vehicle.pk}")
        self.assertEqual(self.initial(html)[f"vehicles/{self.vehicle.pk}/"]["name"], "Splendor </script>")
        self.assertIn("<h1>Splendor &lt;/script&gt;</h1>", html)
        self.assertEqual(html.count("</script>"), 2)  # the data block and the theme script: the name cannot add one

    def test_a_missing_vehicle_or_a_failure_still_serves_the_page(self):
        self.assertIn('<div id="root"></div>', self.get("/app/vehicles/999999"))
        with patch("rental.views._route_hints", side_effect=RuntimeError("boom")):
            self.assertIn('<div id="root"></div>', self.get("/app/vehicles"))

    def test_other_routes_are_untouched(self):
        html = self.get("/app/owner")
        self.assertIn('<div id="root"></div>', html)
        self.assertNotIn("modulepreload", html)

    def test_signed_in_pages_are_never_stored(self):
        from .testing import make_profile
        self.assertEqual(self.client.get("/app/", secure=True)["Cache-Control"], "no-cache")
        self.client.force_login(make_profile("first-paint-renter").user)
        self.assertEqual(self.client.get("/app/bookings", secure=True)["Cache-Control"], "no-store, private")


    def test_the_first_frame_uses_the_app_shell_and_real_card_sizes(self):
        """The static first frame must lay out like the page: the app's classes (so its stylesheets size everything),
        each photo inside its card, the first one the small rendition, nothing full-bleed, and the theme set before
        paint by a script that carries the page's CSP nonce."""
        import re
        html = self.get("/app/vehicles")
        frame = html[html.index('<div id="root">'):]
        self.assertIn('<header class="od-header">', frame)
        self.assertIn('<div class="od-catalog-body"><aside class="od-rail">', frame)
        self.assertNotIn('class="wide"', frame)
        cards = re.findall(r'<article class="od-tag".*?</article>', frame, flags=re.S)
        self.assertEqual(len(cards), 1)
        self.assertIn('<div class="od-tag-media loaded"><a href="/app/vehicles/', cards[0])
        imgs = re.findall(r"<img [^>]*>", frame)
        self.assertTrue(all("od-tag-media" in frame[:frame.index(img)].rsplit("<article", 1)[-1] for img in imgs))
        nonce = re.search(r"script-src 'self' 'nonce-([^']+)'", self.client.get("/app/vehicles", secure=True)["Content-Security-Policy"])
        self.assertIsNotNone(nonce)
        self.assertRegex(frame, r'<script nonce="[^"]+">\(function\(a\)\{var t;try\{t=localStorage')
        # the stylesheets that size the frame load before first paint (not as preloads)
        self.assertNotIn('rel="preload" as="style"', html)
