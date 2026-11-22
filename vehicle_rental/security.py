"""Content-Security-Policy middleware (Django 5.2 has no built-in CSP).

Scripts must come from this origin or carry the per-request nonce (`request.csp_nonce`), so
an injected inline <script> cannot run. Third parties are allowed only where a feature needs
them: Google Fonts and the Bootstrap stylesheet for the server-rendered account pages, Google
for OAuth redirects, and Razorpay's checkout only when Razorpay test keys are configured.
"""
import secrets

from django.conf import settings


def build_policy(nonce):
    razorpay = settings.PAYMENT_PROVIDER == "razorpay"
    directives = {
        "default-src": ["'self'"],
        "script-src": ["'self'", f"'nonce-{nonce}'", *(["https://checkout.razorpay.com"] if razorpay else [])],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'", *(["https://api.razorpay.com", "https://lumberjack.razorpay.com"] if razorpay else [])],
        "frame-src": ["https://api.razorpay.com", "https://checkout.razorpay.com"] if razorpay else ["'none'"],
        "form-action": ["'self'", "https://accounts.google.com"],
        "frame-ancestors": ["'none'"],
        "base-uri": ["'self'"],
        "object-src": ["'none'"],
    }
    return "; ".join(f"{name} {' '.join(values)}" for name, values in directives.items())


class ContentSecurityPolicyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.csp_nonce = secrets.token_urlsafe(16)
        response = self.get_response(request)
        header = "Content-Security-Policy-Report-Only" if settings.CSP_REPORT_ONLY else "Content-Security-Policy"
        response.headers.setdefault(header, build_policy(request.csp_nonce))
        return response
