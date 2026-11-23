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
        self.assertIn('<div id="root"><div class="static-first"><h1>Your next', html)
        self.assertNotIn("initial-data", html)

    def test_catalog_inlines_its_api_data_with_the_same_query(self):
        html = self.get("/app/vehicles?type=Bike")
        data = self.initial(html)
        self.assertEqual(list(data), ["vehicles/?type=Bike"])
        self.assertEqual(data["vehicles/?type=Bike"]["count"], 1)
        self.assertIn("<h1>Where to next?</h1>", html)

    def test_detail_inlines_the_vehicle_and_escapes_it_in_html(self):
        html = self.get(f"/app/vehicles/{self.vehicle.pk}")
        self.assertEqual(self.initial(html)[f"vehicles/{self.vehicle.pk}/"]["name"], "Splendor </script>")
        self.assertIn("<h1>Splendor &lt;/script&gt;</h1>", html)
        self.assertEqual(html.count("</script>"), 1)  # the name cannot close the data block early

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
