# Motorlane demo script (5 minutes)

A walkthrough for interviews or a screen recording. Use two browser windows (or one normal
and one private window): one signed in as the **renter**, one as the **owner**.

Demo accounts (after `seed_demo`): `renter@rental-demo.example` and
`owner@rental-demo.example`, with the password from `RENTAL_DEMO_PASSWORD`.

## 1. The marketplace (30 s)

- Open `/app/`. Point out the search by location, dates and vehicle type.
- Open **Browse bikes** and filter by a city. Every listing has its own real, credited photo.

> "It's a two-sided rental marketplace: React on the front, Django and MySQL behind it."

## 2. Book with times and see the price (60 s)

- Open a vehicle, pick dates, continue to checkout.
- Change the pickup and return times and watch the quote update line by line: weekday and
  weekend days, the long-rental discount for 7+ days, the refundable deposit.
- Request the booking.

> "Pricing runs on the server, the quote is stored on the booking, and availability includes a
> cleaning buffer between rentals, enforced with row locks so two people can't book the same slot."

## 3. The owner side (60 s)

- In the owner window open **Rental requests** and approve.
- Try **Record pickup**: it is refused until the renter pays.
- Show **Fleet**, **Maintenance** (block a day) and **Booking value**.

## 4. Pay, ride, return (60 s)

- Renter: open the booking, press **Pay now**. In the demo it is labelled "Demo payment, no
  real money"; with Razorpay test keys the real Razorpay Checkout opens instead.
- Owner: record pickup, then return. The deposit refund appears on the booking.
- Renter: leave a review and download the PDF booking summary.

> "Refunds are durable intents: written in the same transaction as the status change, sent to
> the provider only after commit with an idempotency key, retried and reconciled. Emails go
> through an outbox the same way, so an SMTP outage delays mail instead of losing it."

## 5. Under the hood (60 s)

- Open `/api/docs` (OpenAPI for every endpoint) and the booking's timeline in the API.
- Show the GitHub Actions run: settings and migration checks, OpenAPI validation, 120+ tests
  on MySQL, a Docker build that boots the stack, and the frontend checks.
- Mention `/healthz` and `/readyz`, the CSP with nonces, HSTS, JSON logs, and the Caddy
  production stack in `deploy/`.

## Questions worth preparing

- Why row locks instead of a unique constraint for overlapping bookings? (Overlap with a time
  buffer isn't an equality, so a constraint can't express it; MySQL has no exclusion constraints.)
- What happens if the payment provider is down during a cancellation? (The cancellation
  commits, and the refund intent is retried with backoff and reconciled.)
- How is the fake payment provider kept out of production? (An explicit `PAYMENT_PROVIDER`
  with no fallback, and a startup check that refuses it outside debug or demo mode.)
