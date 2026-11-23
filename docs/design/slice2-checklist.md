# Slice 2 checklist (checkout, payment, bookings, auth, empty and error states)

Every element and animation that `docs/design-direction.md` (section 4) and the review brief ask for on these pages.
Each line is checked in a browser before slice 2 is reported. Status: ✅ present and verified · 🟡 partial · ❌ missing.
The **Verified** column says how it was checked (still name, or the scripted check).

Shared with slice 1: the shell (Lenis + ScrollTrigger, theme, header, toll-plaza footer), the backdrop, the HUD with
chapters, the odometer and the key tag.

## Checkout: the trip sheet

| # | Element / animation | Status | Verified |
| --- | --- | --- | --- |
| C1 | Two-column trip sheet: trip on the left (vehicle tag, pickup/return slots, contact, conditions); sticky breakdown on the right | ✅ | c1-trip-sheet |
| C2 | Time road per day in 30-minute ticks, replacing the native time inputs | ✅ | c1, c2 |
| C3 | Booked / cleaning time shown as blocked road with a hatched kerb; free time is open road | ✅ | c5-conflict (hatched cleaning kerb) |
| C4 | Drag a car marker for pickup (start day) and a second for return (end day), spring snap to ticks | ✅ | rec1 drag, c2 |
| C5 | Dropping on blocked or cleaning time springs back with a clear message; the hatched kerb pulses once | ✅ | c6-spring-back, message checked in script |
| C6 | `earliest_pickup` from the API shows as a glowing marker ("Earliest pickup 13:00"); one tap moves both markers there and keeps the rental length | ✅ | c5 marker 'Earliest pickup 20:00', c7 after use |
| C7 | Keyboard: arrows move 30 minutes; Page Up / Page Down move a day | ✅ | rec1 ArrowLeft x2 → 13:00; PageUp/Down in slice2.test |
| C8 | The breakdown odometer rolls live as a marker is dragged | ✅ | rec1 (odometer rolls during drag) |
| C9 | Breakdown lines enter like a receipt printing (mask reveal, line by line); totals roll | ✅ | rec1, c4 |
| C10 | The deposit line has a "returned after the trip" tag that swings in | ✅ | c4 |
| C11 | Inline validation: errors slide out under the field (height spring), no shaking; API validation messages shown | ✅ | c3-inline-error; API conflict message c5 |
| C12 | Accepting the conditions turns the request button "on" (ignition fill wipe) | ✅ | c4-ignition-on |
| C13 | Submit tears the ticket stub and opens the booking page | ✅ | rec1 → /bookings/24 |

## Payment

| # | Element / animation | Status | Verified |
| --- | --- | --- | --- |
| P1 | A "pay at the counter" sheet over the booking: amount in large odometer digits, breakdown, provider label (demo / Razorpay test) | ✅ | p2-sheet-open, provider 'Demo payment, no real money' |
| P2 | The sheet rises with a spring (bottom sheet on phones) | ✅ | rec2; bottom sheet at 375 |
| P3 | The amount rolls up from 0 on open | ✅ | p1-sheet-rolling |
| P4 | Processing: lane dashes run on the button | ✅ | rec2 |
| P5 | Success: a key tag drops, swings on its ring and settles; a check stamp; the state becomes Confirmed and paid; no confetti | ✅ | p4, p5-paid |
| P6 | Failure or cancellation: the tag swings away, with the message and Retry | ✅ | p3-failed (forced network failure), retry succeeded |

## Bookings list (renter)

| # | Element / animation | Status | Verified |
| --- | --- | --- | --- |
| B1 | Trip tickets grouped by lane: Upcoming, On the road, Completed, Closed | ✅ | b1-trips (4 lanes) |
| B2 | Tickets tilt slightly towards the cursor (2–3°) | ✅ | rec2 (pointer only) |
| B3 | Status is a word plus colour and icon, never colour alone | ✅ | b1 |
| B4 | Empty lane / no bookings as a road sign with one action | ✅ | e1/e2 road signs; empty-lane sign in code |

## Booking detail

| # | Element / animation | Status | Verified |
| --- | --- | --- | --- |
| D1 | Timeline road down the left edge, one stop per `BookingEvent`, future stops as dashed ghost road | ✅ | d1, d2 |
| D2 | The road draws to the current stop, scrubbed by scroll and tied to the eye line; a car marker follows the path | ✅ | rec1/rec2 scroll |
| D3 | Viewer-aware labels: "You requested", "The owner approved", "Automatically expired" | ✅ | 'You requested', 'Owner approved' |
| D4 | Notes (refunds, fees) hang off stops as small tags | ✅ | d1 note tag |
| D5 | Refund status as a gauge: pending (needle moving), delayed (needle at red with a note), refunded (full) | ✅ | final pass: pending (final/s2-refund-pending), delayed (final/s2-refund-delayed) and refunded (d4) on real cancellations |
| D6 | Pay now opens the payment sheet (P1–P6) | ✅ | rec2 |
| D7 | Receipt download | ✅ | link to /download-receipt/24/ (existing endpoint) |
| D8 | Cancel: the fee and refund roll in (from the cancellation preview) before you confirm | ✅ | d3-cancel-preview, d4 |
| D9 | Review: star rating and comment after a completed rental | ✅ | d5-review, published |
| D10 | Status change while viewing (refocus): the ticket flips to the new state | ✅ | final pass: owner approved while the renter watched; the ticket flipped Pending → Confirmed (final/s2-ticket-flip). The page also polls every 15 s while a trip can change |

## Auth

| # | Element / animation | Status | Verified |
| --- | --- | --- | --- |
| A1 | Split screen: form on the left, a real vehicle photo framed as a key tag on the right | ✅ | a1 |
| A2 | Sign in (email + password, show/hide), Google when enabled, links to sign up and reset | 🟡 | email/password/show-hide/links ✅. Google shows only when GOOGLE_CLIENT_ID/SECRET are set; not enabled here (needs a Google OAuth client, which needs an account) |
| A3 | Sign up with inline validation (on blur, then live); server errors mapped to their fields | ✅ | a2-register-inline |
| A4 | Password strength as a fuel gauge | ✅ | a3-fuel-gauge ('Full') |
| A5 | Verify email: an indicator that blinks until verified; "Resend verification email" with a 60-second cooldown ring | ✅ | final pass: two emails reached a new test address (sign-up + resend after the 60 s ring); resend re-attempts sign-in, which makes allauth send a fresh link (the code-only resend endpoint returned 409) |
| A6 | Reset password: request a link, then choose a new password | ✅ | a4-reset |
| A7 | Success morphs into the next page (sign-in → destination) | ✅ | guard → /sign-in?next=%2Fbookings, returns with viewTransition |

## Empty and error states

| # | Element / animation | Status | Verified |
| --- | --- | --- | --- |
| E1 | Road signs drawn on screen, each with one action: Road ends, Diversion (error, retry), No entry (sign in), Closed for maintenance | ✅ | e1-sign-end, e2-sign-diversion (retry); No entry via guard |

## Quality bar

| # | Check | Status | Verified |
| --- | --- | --- | --- |
| Q1 | Every existing flow works: request, pay (demo), cancel, review, receipt, sign-in/up, verify, reset | ✅ | request, pay (fail + retry), cancel, review recorded; auth pages checked |
| Q2 | Backend API unchanged; Django tests (168) and frontend tests pass | ✅ | Django 168 OK, vitest 14, tsc, build; no API change |
| Q3 | 1920×870, 1366×768 and 375 px, both themes; reduced motion shows final states | ✅ | q-*-{1920,1366,375}-{light,dark}, q-reduced-motion-*; no horizontal overflow |
| Q4 | CLS about 0; no console errors | ✅ | CLS ≤ 0.003 on all 24 loads; 0 page errors |
