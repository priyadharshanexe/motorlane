"""Server-rendered pages in the Motorlane design: error pages, the allauth fallbacks, the staff dashboard, the
booking PDF and the emails."""
import io

from django.core import mail
from django.test import TestCase, override_settings

from .models import Booking, Payment, Vehicle
from .services.booking import reserve_vehicle
from .services.events import record_paid
from .testing import make_profile, starting_soon


class ServerPagesTests(TestCase):
    @override_settings(DEBUG=False, ALLOWED_HOSTS=["testserver"])
    def test_404_outside_the_app_is_a_road_sign_in_the_brand(self):
        response = self.client.get("/no-such-place/", secure=True)
        self.assertEqual(response.status_code, 404)
        self.assertContains(response, "go anywhere.", status_code=404)
        self.assertContains(response, "rental/odometer.css", status_code=404)
        self.assertNotContains(response, "bootstrap", status_code=404)

    def test_every_error_template_renders(self):
        from django.template.loader import render_to_string
        for name, words in (("403.html", "No entry"), ("500.html", "Diversion ahead"), ("403_csrf.html", "The form expired"), ("404.html", "go anywhere")):
            self.assertIn(words, render_to_string(name, {}))

    def test_allauth_pages_use_the_brand(self):
        response = self.client.get("/accounts/login/", secure=True)
        self.assertContains(response, "rental/odometer.css")
        self.assertContains(response, "/app/sign-in")

    def test_staff_dashboard_uses_the_brand(self):
        staff = make_profile("brand-staff").user
        staff.is_staff = True
        staff.save()
        self.client.force_login(staff)
        response = self.client.get("/admin-dashboard/", secure=True)
        self.assertContains(response, "od-stat")
        self.assertContains(response, "rental/odometer.css")


class DocumentsTests(TestCase):
    def setUp(self):
        self.owner = make_profile("doc-owner")
        self.renter = make_profile("doc-renter")
        self.vehicle = Vehicle.objects.create(owner=self.owner, name="Honda City", vehicle_type="Car", price_per_day=1000, deposit=500)
        self.booking = reserve_vehicle(self.renter.pk, self.vehicle.pk, *starting_soon())

    def test_the_pdf_builds_with_payment_and_timeline(self):
        from .receipts import render_booking_summary
        Booking.objects.filter(pk=self.booking.pk).update(status="Confirmed")
        self.booking.refresh_from_db()
        payment = Payment.objects.create(booking=self.booking, provider="fake", order_id="doc-order", amount=1500,
                                         status=Payment.Status.PAID, paid_at=self.booking.created_at)
        record_paid(payment, self.booking)
        stream = io.BytesIO()
        render_booking_summary(stream, self.booking)
        pdf = stream.getvalue()
        self.assertTrue(pdf.startswith(b"%PDF"))
        self.assertGreater(len(pdf), 2000)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_emails_carry_the_brand_and_link_to_the_booking(self):
        from datetime import timedelta
        from django.utils import timezone
        from .services.notifications import deliver_due
        deliver_due(now=timezone.now() + timedelta(minutes=5))
        self.assertTrue(mail.outbox)
        message = mail.outbox[0]
        html = message.alternatives[0][0]
        self.assertIn("MOTORLANE", html)
        self.assertIn(f"Trip ticket · #{self.booking.pk}", html)
        self.assertIn(f"/app/owner/bookings/{self.booking.pk}", html)
        self.assertIn(f"/app/owner/bookings/{self.booking.pk}", message.body)


class OldRoutesTests(TestCase):
    def test_the_old_dashboard_url_lands_in_the_new_app(self):
        response = self.client.get("/app/dashboard", secure=True)
        self.assertRedirects(response, "/app/bookings", fetch_redirect_response=False)
