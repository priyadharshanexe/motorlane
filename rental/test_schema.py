import re

from django.test import TestCase

from . import api_urls


class OpenApiTests(TestCase):
    def test_schema_documents_every_api_route_with_responses(self):
        response = self.client.get("/api/schema", {"format": "json"}, secure=True)
        self.assertEqual(response.status_code, 200)
        schema = response.json()
        documented = set(schema["paths"])
        for pattern in api_urls.urlpatterns:
            path = "/api/v1/" + re.sub(r"<(?:\w+:)?(\w+)>", r"{\1}", str(pattern.pattern))
            path = path.replace("{pk}", "{id}")
            self.assertIn(path, documented)
        for path, operations in schema["paths"].items():
            for method, operation in operations.items():
                self.assertTrue(operation.get("summary") or operation.get("description"), f"{method} {path}")
                self.assertTrue(operation["responses"], f"{method} {path}")

    def test_docs_page_is_served_without_a_cdn(self):
        response = self.client.get("/api/docs", secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "swagger-ui")
        self.assertNotContains(response, "cdn.jsdelivr.net")

    def test_docs_and_schema_work_with_and_without_a_trailing_slash(self):
        for url in ("/api/docs", "/api/docs/", "/api/schema", "/api/schema/"):
            self.assertEqual(self.client.get(url, secure=True).status_code, 200, url)
