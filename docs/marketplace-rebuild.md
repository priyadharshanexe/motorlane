# Motorlane marketplace rebuild

Current state of the marketplace after the backend rework (November 2026). The README has
the short version; this page explains how the pieces fit and how they were verified.

## Frontend

- React + TypeScript (Vite) served by Django under `/app/`, same origin as the API, using the
  session cookie and a CSRF token.
- Marketplace, catalog with location/date/type search, vehicle detail with a rental calendar,
  checkout, renter workspace (bookings, saved vehicles, account) and owner workspace
  (requests, fleet, maintenance, completed booking value with CSV export).
- Checkout lets the renter choose **pickup and return times** (15-minute steps). The price is
  the server's line-by-line quote: weekday and weekend days, long-rental discount, rental
  total, refundable deposit and the amount due at payment. Booking detail shows the stored
  breakdown; bookings, the owner's queue and the PDF receipt show dates with times.
- After the owner confirms, the renter pays from the booking. The button asks the backend
  which provider is active (`GET /api/v1/payments/config/`): Razorpay Checkout in test mode,
  or the demo provider, which is labelled "Demo payment, no real money".
- The homepage hero is a studio render (see CREDITS.md). Every catalog listing has its own
  real, credited Wikimedia Commons photograph; a test fails if two demo listings share one.

## Backend

| Area | How it works |
| --- | --- |
| Layers | `api.py` parses and serializes; rules live in `services/` (booking, pricing, availability, notifications, expiry, reminders, photos, listing, maintenance) and `payments/`; queries in `selectors.py`; access scoping in `permissions.py` (another account's rows answer 404). |
| Availability | Bookings hold their vehicle from pickup to return plus a cleaning buffer (`RENTAL_TURNAROUND_MINUTES`, default 120) on both sides; maintenance blocks whole days and gets the same buffer. Writers lock the vehicle row, so concurrent requests cannot double-book. |
| Pricing | Weekend rate when set, 10% off 7+ days and 20% off 30+ days, refundable deposit. The quote is stored on the booking. |
| Status machine | Pending → Confirmed / Rejected / Expired / Cancelled; Confirmed → In progress → Returned. Every change, including expiry, is written to the `BookingEvent` timeline. Money events are stops too: `kind` is `status`, `paid` (once per payment, idempotent against redelivered webhooks), `refund_issued` or `refunded` (once per refund intent); for money stops `from_status` = `to_status` = the booking's status at that moment. `kind` is an additive field on `GET /api/v1/bookings/<id>/` (`timeline[]`) and `GET /api/v1/bookings/<id>/timeline/`. |
| Payments | `PAYMENT_PROVIDER` must be set explicitly: `razorpay` (test keys only; live keys are refused) or `fake`. `fake` is refused by `manage.py check` unless `DJANGO_DEBUG=1` or `DJANGO_DEMO_MODE=1`. Pickup needs a completed payment. Checkout results and webhooks are verified by HMAC; each webhook event id is applied once. |
| Refunds | A cancellation (free until 48 hours before pickup, then 20% of the rental kept; the deposit is always returned) or a return records a `RefundIntent` in the same transaction. The provider is called only after commit, with a stable idempotency key; failures retry with backoff, and `reconcile_refunds` checks pending and sent intents against the provider, so a rollback, crash or outage cannot lose or duplicate a refund. |
| Email | Messages are rendered into `NotificationOutbox` inside the transaction and delivered after commit. Failures retry with backoff (1, 5, 15, 60, 240 minutes) before being marked failed. Pickup reminders count as sent only after delivery. |
| Scheduler | A separate container runs `run_scheduled_jobs` every `SCHEDULER_INTERVAL_SECONDS`: `expire_bookings`, `send_pickup_reminders`, `send_notifications`, `process_refunds`, `reconcile_refunds`. Every job is idempotent. |
| Photos | Up to eight photos per listing with one cover; WebP thumbnails at 400 and 1200 px are generated on upload. |
| Operations | `/healthz` (liveness) and `/readyz` (database and migrations), OpenAPI at `/api/schema` and `/api/docs`, CSP with per-request nonces, one-year HSTS with preload, JSON logs, pooled connections, and settings checks. |

## Deliberate boundaries

No real money moves: only Razorpay test mode or the demo provider. Insurance and tax
invoicing are not part of the product. Favorites are a saved collection, not a cart.
Email delivery is at-least-once: a crash between the mail server accepting a message and
the outbox recording it can send that message twice, which is preferred to losing it.

## Verification

- 123 Django tests on MySQL 8.4: every status transition and permission, pricing, the
  turnaround buffer and concurrency (row locks under parallel requests), expiry, payments
  and webhooks (including duplicate delivery and forged signatures), refund intents
  (rollback, retry, crash after the provider accepted, reconciliation), the email outbox
  (failure then retry, duplicates, reminders), OpenAPI coverage and settings checks.
- Frontend lint, type check, unit tests (including the Razorpay Checkout handshake with a
  stubbed widget) and production build.
- CI on every push: settings and migration checks (forward and reverse), OpenAPI validation,
  the Django suite, a Docker build that starts the stack and probes it, and the frontend checks.
- Browser walkthroughs on Docker + MySQL as a renter and an owner: listing a vehicle with a
  photo, search, times, booking, approval, demo payment, pickup, return, review, free and
  late cancellation with refunds, maintenance, value report and the receipt.
- Razorpay test mode is covered with a mocked Razorpay API; no live or test keys are stored
  in the repository.
