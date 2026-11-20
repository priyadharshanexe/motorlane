"""Settings validation, run by `manage.py check` and before migrate, runserver and tests.

Errors are configurations that would misbehave anywhere (live payment keys, impossible
policy numbers). Deploy-tagged warnings cover production hardening and are reported by
`manage.py check --deploy`.
"""
from django.conf import settings
from django.core.checks import Error, Tags, Warning, register


@register()
def rental_policy(app_configs, **kwargs):
    errors = []
    if not 0 <= settings.RENTAL_TURNAROUND_MINUTES <= 24 * 60:
        errors.append(Error("RENTAL_TURNAROUND_MINUTES must be between 0 and 1440.", id="rental.E001"))
    if not 0 <= settings.RENTAL_CANCELLATION_FEE_PERCENT <= 100:
        errors.append(Error("RENTAL_CANCELLATION_FEE_PERCENT must be between 0 and 100.", id="rental.E002"))
    if settings.RENTAL_FREE_CANCELLATION_HOURS < 0:
        errors.append(Error("RENTAL_FREE_CANCELLATION_HOURS cannot be negative.", id="rental.E003"))
    for minimum, percent in settings.RENTAL_LONG_RENTAL_DISCOUNTS:
        if minimum < 1 or not 0 <= percent < 100:
            errors.append(Error("Long-rental discounts need a minimum of 1+ days and 0-99 percent.", id="rental.E004"))
    key = settings.RAZORPAY_KEY_ID
    if key.startswith("rzp_live_"):
        errors.append(Error("Live Razorpay keys are refused. Use rzp_test_ keys only.", id="rental.E005"))
    elif key and not key.startswith("rzp_test_"):
        errors.append(Error("RAZORPAY_KEY_ID must start with rzp_test_.", id="rental.E006"))
    elif key and not (settings.RAZORPAY_KEY_SECRET and settings.PAYMENT_WEBHOOK_SECRET):
        errors.append(Error("Razorpay test mode needs RAZORPAY_KEY_SECRET and PAYMENT_WEBHOOK_SECRET.", id="rental.E007"))
    return errors


@register(Tags.security, deploy=True)
def production_settings(app_configs, **kwargs):
    warnings = []
    if len(settings.SECRET_KEY) < 50:
        warnings.append(Warning("DJANGO_SECRET_KEY is shorter than 50 characters.", id="rental.W001"))
    if not settings.SITE_URL.startswith("https://"):
        warnings.append(Warning("SITE_URL should use https:// so email links are secure.", id="rental.W002"))
    if "console" in settings.EMAIL_BACKEND or "locmem" in settings.EMAIL_BACKEND:
        warnings.append(Warning("Emails are not delivered with the console or locmem backend.", id="rental.W003"))
    if not settings.PAYMENT_WEBHOOK_SECRET:
        warnings.append(Warning("Set PAYMENT_WEBHOOK_SECRET so webhook signatures use a dedicated secret.", id="rental.W004"))
    if settings.CSP_REPORT_ONLY:
        warnings.append(Warning("The Content-Security-Policy is in report-only mode.", id="rental.W005"))
    return warnings
