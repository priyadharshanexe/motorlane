# Motorlane redesign: design direction

**Status: proposal for approval. No application code changes until it is approved.**

The brief: a modern, interactive Motorlane with bold motion everywhere, built with the best
tools for it. Lessons carried over from Relay and HAR Triage:

- No "tidy but flat" pages and no fade/slide-in-only motion.
- Nothing that reads as AI-generated: no gradient blobs, glassmorphism, purple-blue
  gradients, emoji, stock illustrations, identical rounded cards or centred-everything layouts.
- Every visual comes from the product: vehicles, roads, keys, the booking and its timeline.
- Motion is reviewed through screen recordings.
- It must look like neither Relay (warm paper and signal orange, delivery map) nor HAR Triage
  (cool navy and archive blue, redaction bars).

---

## 1. Concept: **Odometer**

A rental is a stretch of road with a start and an end, measured in time and money. The whole
interface is built from three things everyone recognises from driving:

| Product idea | Becomes in the UI |
| --- | --- |
| **The odometer**: mechanical digit wheels that roll | Every number that changes (price, days, deposit, totals, counts, the clock in the slot picker) rolls like an odometer instead of snapping. It is the brand's motion signature, and it is meaningful: numbers are what renters decide on. |
| **Lane markings**: dashed lines, kerb stripes, chevrons | Structure and progress. The booking timeline is a road drawn as an SVG path, with dashes that advance as the rental moves. Dividers are lane dashes, the cleaning window is a hatched kerb, and blocked dates are double lines. |
| **The key tag**: the stamped tag on a rental key | The vehicle card and the booking "ticket". Cards are tags (a punched hole, a stamped plate number for the listing id, a slight hang angle), not identical rounded rectangles. Handing over the key is the pickup moment. |

Why this concept: it is specific to vehicles and renting, it gives every animation a reason
(numbers roll, roads draw, keys swing and hand over), and it is unlike both Relay's paper map
and HAR Triage's archive. The name for the system is **Odometer**.

What it deliberately avoids: 3D gloss, glass panels, blob gradients, illustrated people and
decorative particles. All texture comes from tarmac, paint and stamped metal, used sparingly.

---

## 2. Typography and colour

### Fonts (all OFL, self-hosted with `@fontsource`, subset to Latin and ₹)

| Role | Font | Why |
| --- | --- | --- |
| Display | **Archivo**, variable `wdth` 62–125, `wght` 100–900 | Its wide axis gives the expanded "motorway signage" feel for headlines, and the width can animate (headings stretch as you scroll, like speed). |
| Text and UI | **Public Sans** | Neutral, highly legible government-signage lineage, good on small phones; not the overused Inter. |
| Numbers | **JetBrains Mono** (tabular) | Fixed-width digits make the odometer roll clean and keep prices aligned in breakdowns. |

Scale: 12 / 14 / 16 / 20 / 28 / 40 / 64 / 96 px, 1.5 line height for text and 1.0 for display.

### Palette: tarmac and lane paint

Neither warm paper with orange nor navy with blue. A charcoal "tarmac" with **lane-marking
yellow** as the one loud colour, and the road's own signal colours for states.

| Token | Dark (default) | Light | Use |
| --- | --- | --- | --- |
| `--tarmac` (background) | `#121417` | `#F3F1EC` | Page |
| `--tarmac-raised` | `#1B1E22` | `#FFFFFF` | Surfaces, tags |
| `--kerb` (lines) | `#2C3036` | `#D9D5CC` | Borders, lane dashes |
| `--chalk` (text) | `#EDEAE3` | `#16181B` | Primary text (contrast 15.9:1 / 16.4:1) |
| `--dust` (muted text) | `#A3A7AE` | `#5A5E66` | Secondary text (7.4:1 / 6.3:1) |
| `--lane` (brand) | `#FFC531` | `#FFC531` fill, `#7A5600` text | Primary actions and highlights. On dark, yellow text is 11.6:1; on light, yellow is a fill only (with `#16181B` text, 12.2:1), and links use `#7A5600` (7.0:1). |
| `--reflector` (focus) | `#FFE38A` | `#16181B` | 3 px focus ring |

**Booking states** (each also has an icon and a word, never colour alone):

| State | Dark | Light | Road meaning |
| --- | --- | --- | --- |
| Pending | `#FFC531` | `#7A5600` | Amber light: waiting |
| Confirmed | `#4FB3FF` | `#0B5CA8` | Blue info sign |
| In progress | `#3DDC97` | `#0E7A4E` | Green light: on the road |
| Returned | `#C8CCD2` | `#3D4148` | Parked |
| Cancelled / Rejected | `#FF6B6B` | `#B3261E` | Red light: stop |
| Expired | `#8E939B` | `#6B7078` | Faded paint |

**Price breakdown**: weekday days in `--chalk`; weekend days in `#FFB86B` (dark) / `#8A4B00`
(light), marked with a small "Sat/Sun" plate; the discount in `#3DDC97` / `#0E7A4E` with a
minus sign; the refundable deposit in `#4FB3FF` / `#0B5CA8` with a "returned after the rental"
tag; the total in `--lane`, in the mono font and rolling. Refund delayed uses the Cancelled red
with an explanation and never colour alone. All pairs were checked at WCAG AA (4.5:1 for text,
3:1 for large text and UI marks).

---

## 3. Tools (the stack and why)

Figma can't be operated from here, so the **design tool is code**: a `/lab` route with live,
animated prototypes of each signature interaction, built on the real API data. The user reviews
**screen recordings** (Playwright video, 1440 px and 390 px) plus the live `/lab` page.
(The lab was removed in the final pass once every prototype lived in the real pages.)

| Need | Choice | Why (and the alternatives considered) |
| --- | --- | --- |
| Layout, shared-element and spring motion; gestures | **Motion** (motion.dev, `motion/react`) | `layoutId` shared-element morphs (card → detail), springs, drag with inertia, `AnimatePresence` exits, and good React 19 support. Tree-shakeable, about 18 KB for the parts used. |
| Scroll-driven storytelling | **GSAP 3 + ScrollTrigger** (now free, including the plugins) | Scrubbed timelines, pinning and `DrawSVG`/`MorphSVG` for the road paths. Motion's `useScroll` handles simple cases; GSAP for the hero sequence and the timeline road. |
| Smooth scrolling | **Lenis** | Light (about 3 KB), and it syncs with ScrollTrigger. Off for `prefers-reduced-motion`, and native scrolling on touch devices (`syncTouch: false`). |
| Route transitions | **View Transitions API** via React Router v7's `viewTransition` | Native cross-fade/morph between routes, with named transitions for the vehicle photo. Where unsupported (older Firefox/Safari) a Motion crossfade takes over. |
| One signature 3D moment | **React Three Fiber + drei**, lazy-loaded on the home page only | A procedural **3D road** (no downloaded models) that streams under the hero and speeds up with scroll velocity. Loaded after LCP, about 160 KB gzip, with a static SVG/CSS road as the fallback, under reduced motion, and on low-end devices (`navigator.hardwareConcurrency <= 4` or Save-Data). A rotating 3D *vehicle* was rejected: it needs licensed per-model 3D assets, and the real photos are the product. |
| Lottie | **Not used** | Everything is product geometry (paths, digits, tags) that SVG, CSS and Motion handle; Lottie would add 60 KB and an export pipeline for nothing. |
| Numbers | A small in-house `<Odometer>` component (CSS transforms with a Motion spring per digit) | Libraries such as NumberFlow are close but don't match the mechanical look. |

---

## 4. Pages: layout, signature interaction and animations

Layouts are asymmetric 12-column grids, left-weighted, with the road and its lane dashes as the
recurring structural line. Nothing is centred except the confirmation moment.

### Home / hero
**Layout:** a full-bleed tarmac band. On the left, a huge Archivo Expanded headline ("Your next
stretch of road"). On the right, the procedural road vanishing to the horizon, with the search
"dashboard" sitting on it like an instrument cluster (location · pickup · return · type). Below
that, the six newest listings hang as key tags along a horizontal lane you can drag.
**Signature: "Put it in drive."** As the page scrolls, the road accelerates. The headline's
width axis stretches from 100 to 125 (speed), the lane dashes blur into streaks, and the
odometer in the search cluster counts available vehicles for the chosen dates.
Animations:
1. The road streams under the hero, its speed tied to scroll velocity (R3F, or the CSS fallback).
2. The headline width and weight animate with scroll (GSAP scrub).
3. The search cluster's needles sweep in on load (SVG stroke draw, about 600 ms).
4. The available count rolls on the odometer whenever dates change.
5. Key tags swing slightly on hover (a spring rotate around their punched hole) and are draggable with inertia.
6. The "how it works" section draws one road path through three stops (Choose → Request → Drive) as you scroll (DrawSVG scrub).

### Catalog with filters
**Layout:** a left filter rail (a sticky "gearbox" panel; a bottom sheet on phones), results as
a masonry of key tags (a 3-column grid with varied tag heights from the real photo ratios), and
a map-free "lane" header showing the active filters as road signs you can remove.
**Bug fix:** the vehicle-type filter is rebuilt as a controlled segmented switch (All / Cars /
Bikes) bound to the URL query, with a regression test (the old select lost its value between the
form and the URL).
**Signature: "Shuffle lanes."** Changing filters reflows the tags with FLIP layout animation, so
cards slide into their new places instead of re-rendering. Removed cards drop out of the lane
downward, and new ones merge in from the side like traffic.
Animations:
1. The FLIP reflow of results on filter, sort and date change (Motion `layout`).
2. Filter chips appear as road signs that flip in (a 3D rotateX on mount) and fold away on removal.
3. The price-range slider handle has a magnetic snap to round values, and the price odometer rolls.
4. A skeleton morphs into content: skeleton tags keep their exact size and the photo is revealed with a lane-wipe clip-path.
5. On phones, a gesture-driven filter sheet (drag to dismiss, rubber-band at the edges).
6. "No vehicles": the road ends in a barrier that draws itself, with one action to widen the search.

### Vehicle detail with a gallery
**Layout:** the photo takes the left 60%, with a tag-shaped spec plate and the booking panel on
the right (sticky). Specs read like a registration plate (year, seats, fuel, transmission).
**Signature: card → detail morph.** The key tag's photo, name and price morph into the detail
layout (Motion `layoutId` plus the View Transition named `vehicle-photo`), so the vehicle never
disappears between pages.
Animations:
1. The shared-element morph from the catalog tag.
2. A swipe/drag gallery with momentum and snap; thumbnails as a film strip; pinch-to-zoom on phones.
3. Spec plates stamp in one by one (scale 1.08 → 1 with a short spring, like a punch).
4. The availability calendar draws blocked days as double lines and free days as dashes; hovering a date shows its slots.
5. The price odometer rolls as dates and times change; weekend days light up in the weekend colour.
6. Reviews slide on a horizontal lane, with star ratings that fill like a fuel gauge.

### Checkout with the slot picker
**Layout:** a two-column "trip sheet". On the left: the trip (vehicle tag, pickup and return
slots, contact, conditions); on the right: the sticky breakdown with a rolling total.
**Slot picker (replaces the native time input):** a horizontal **time road** for the chosen day,
in 30-minute ticks. Booked periods are solid blocks, the **cleaning window is a hatched kerb**
on each side of them, and free time is open road. The renter drags a "car" marker along the road
for pickup and a second marker for return; markers can't be dropped on blocked or hatched road
and spring back with a clear message. If the window is unavailable, the API's `earliest_pickup`
shows as a glowing marker with "Earliest pickup 13:00". One tap moves both markers there and keeps
the rental length. Keyboard: arrow keys move by 30 minutes, and Page Up/Down by a day.
**Signature: "Drive the slot."** Dragging the pickup marker rolls the breakdown odometer live, and
the hatched kerb pulses once when you bump into it.
Animations:
1. Marker drag with spring snap to ticks, and a bounce-back off blocked or cleaning time.
2. The breakdown lines enter as a receipt printing out (a mask reveal line by line); totals roll.
3. The deposit line gets a "returned after the trip" tag that swings in.
4. Inline field validation slides the error out from under the field (height spring); no shaking.
5. Accepting the conditions turns the request button "on" (a fill wipe from left to right, like an ignition light).
6. On submit, the ticket stub tears (a clip-path split) and the timeline page opens with the stub in place (shared element).

### Payment (demo / Razorpay)
**Layout:** a single "pay at the counter" sheet over the booking: the amount in large odometer
digits, a breakdown, and the provider label ("Demo payment, no real money" or "Razorpay test
mode").
**Signature: "Hand over the keys."** On success, a key tag drops from the top, swings on its
ring and settles on the booking. The booking state changes to Confirmed and paid, with the
timeline road advancing one segment. This is the celebratory moment, with no confetti.
Animations:
1. The sheet rises with a spring (a draggable bottom sheet on phones).
2. The amount rolls up from 0 on open.
3. A processing state: the lane dashes on the button run like road passing under a car.
4. Success: the key tag drop and swing (a physics spring), then a check stamp.
5. Failure or cancellation: the tag swings away, with the message and a retry.

### Bookings and the booking detail timeline
**Layout:** the list is a stack of trip tickets grouped by lane (Upcoming, On the road,
Completed, Closed). The detail page puts **the timeline road** down the left edge: one SVG road
from Requested to Returned, with stops for every `BookingEvent`. Each stop shows who acted, and
the labels know the viewer ("You requested", "Asha (owner) approved", "Automatically expired").
Notes (refunds, fees) hang off stops as small tags.
**Signature: "The road so far."** On load, the road draws from the first stop to the current one
(DrawSVG), a car marker drives to the current position, and future stops are dashed ghost road.
Animations:
1. The road path draws to the current stop, with the car marker following the path (MotionPath).
2. Stops appear as each segment reaches them (staggered by real event times, compressed).
3. Refund status shows as a gauge (pending: needle moving; delayed: needle at red with a note; refunded: full).
4. Ticket stubs in the list tilt slightly towards the cursor (a 2–3° magnetic tilt).
5. Status change while viewing (polling or refocus): the ticket flips to the new state.
6. Cancel shows the fee and refund rolling in before you confirm.

### Owner workspace
**Layout:** an "instrument cluster" overview: gauges for pending requests, pickups today, active
rentals and this month's booking value (rolling). Below it, a booking **queue as a departures
board** sorted by pickup time, with each row's pickup window shown as a bar that fills as the
window opens. Fleet is a grid of key tags with status plates. The listing form is a two-step
sheet (details, then photos).
**Signature: "Departures board."** Rows flip like split-flap characters when a booking changes
state. The "Record pickup" button appears exactly when the pickup window opens (an hour before),
with a countdown until then.
Animations:
1. The gauges sweep to their values on load (SVG arcs with a spring overshoot), and numbers roll.
2. Split-flap transitions on queue rows when a state changes.
3. The pickup-window bar fills in real time; the button slides out when it opens.
4. Photo manager: drag to reorder with a layout spring, drop the cover onto the "cover plate" slot, upload progress as a road filling, and a lane-wipe reveal on the new thumbnail.
5. Deposit and weekend rate fields show a live preview tag ("Sat–Sun ₹550 · deposit ₹800") that rolls as you type.
6. Maintenance: dragging across the calendar paints hatched blocks; conflicts flash the clashing booking.
7. Value report: bars grow from the road edge; hovering shows the rolling total.

### Auth
**Layout:** a split screen. The form is on the left; on the right, a real vehicle photo framed as
a key tag (no illustration).
**Signature:** password strength as a fuel gauge, and the verification wait as an indicator
that blinks until the email is confirmed (polling the session), then turns green.
Animations: inline validation messages that unfold under the fields; the email domain is checked
as you type; a "Resend verification email" button with a 60-second cooldown shown as a ring
countdown; sign-in success morphs the form into the next page's header.

### Empty and error states
Each empty or error state is a road sign, drawn on screen, with one useful action: "Road ends"
(no results, widen the search), "Diversion" (an error, retry), "No entry" (sign in required),
"Closed for maintenance" (a vehicle under maintenance, other dates). No illustrations of people,
no emoji.

---

## 5. The nine UI issues from the audit, solved

| # | Issue (docs/audit-2026-11-22.md) | Solution |
| --- | --- | --- |
| 1 | Sign-up errors only via the browser popup | Inline validation (on blur, then live) with messages that unfold under fields; the server's errors are mapped to fields |
| 2 | No "resend verification" | A resend button on the sign-in and register success screens, with a 60 s cooldown ring, using allauth's headless resend endpoint |
| 3 | Field errors prefixed with raw names | A field map with human labels ("Return date", "Minimum price") and errors shown next to their field, not in a list |
| 4 | Workspace tabs cut off on phones | A scrollable tab road with edge fades and a snap, or a bottom tab bar on phones for the 4 main destinations |
| 5 | Vehicle-type filter not applying | A controlled segmented switch bound to the URL, with a regression test |
| 6 | Native time inputs | The time-road slot picker (section 4, checkout) with free, booked and cleaning-window time and `earliest_pickup` |
| 7 | Timeline doesn't know the viewer | Labels from the session user: "You", "the owner"/"the renter" by name, "Automatically" |
| 8 | Booking lists not paginated | Server pagination (cursor) with infinite scroll and skeleton tickets; API change included in the build |
| 9 | Skip link visible after focus changes | The skip link only shows on keyboard focus (`:focus-visible`), and route changes move focus to the page heading |

---

## 6. Performance and accessibility budgets

| Budget | Target |
| --- | --- |
| LCP (4G, mid-range phone) | ≤ 2.0 s home and catalog; ≤ 2.5 s detail |
| INP | ≤ 200 ms |
| CLS | ≤ 0.05 (all media sized; skeletons keep their exact size) |
| JS per route (gzip) | Shared shell ≤ 95 KB (React, router, query, Motion core); home +40 KB (GSAP, ScrollTrigger, Lenis) with the 3D road loaded **after** LCP (+160 KB, skipped on low-end devices); catalog +20 KB; detail +25 KB; checkout +25 KB; owner +35 KB. Each route is a lazy chunk. |
| Frame rate | 60 fps on a mid-range Android (Moto G-class): only `transform`/`opacity`/`clip-path` animate, there are no animated filters or blurs on large areas, and `will-change` is used briefly |
| Fonts | Three self-hosted WOFF2 files, subset, `font-display: swap`, display font preloaded |

Accessibility:
- **`prefers-reduced-motion`**: the road becomes static, the odometer swaps numbers with a
  150 ms crossfade, morphs become instant crossfades, Lenis and scroll scrubbing are off, and
  the gauges show their final values. A "Reduce motion" toggle in the account menu overrides it.
- Keyboard: every drag interaction (gallery, slot markers, photo reorder, maintenance painting)
  has a keyboard path. Focus is visible (a 3 px reflector ring), and route changes move focus to
  `<h1>` with a polite announcement.
- Screen readers: the odometer exposes the final value (`aria-live="polite"` on totals only);
  the timeline is an ordered list with the SVG `aria-hidden`; states carry text, not colour alone.
- Contrast is AA as listed in section 2, and touch targets are at least 44 px.

---

## 7. Logo and wordmark

The current blue "M" tile doesn't fit a tarmac-and-lane-yellow system. Three options (the
proposal recommends **A**):

- **A. Lane M**: the M drawn as two lane lines converging into one (the Ms' middle strokes
  are a dashed centre line). It works as a favicon, and the dashes animate on load (they draw in).
- **B. Odometer wordmark**: MOTORLANE in Archivo Expanded with the "O"s as odometer digit
  wheels that roll once on load; the mark alone is a single digit wheel reading "M".
- **C. Key tag**: a key-tag silhouette with a punched hole and "ML" stamped in; it echoes the
  card language but is weaker as a favicon.

---

## 8. Rollout

1. **Approve this direction** (through the coordinating session).
2. **Foundation and first slice:** tokens, fonts, motion primitives (`<Odometer>`, road path,
   key tag, spring presets, reduced-motion handling), then **home + catalog + the card → detail
   morph** with the type-filter fix. Delivered as a screen recording (desktop and phone, with
   and without reduced motion) plus a `/lab` page with every primitive. Lighthouse numbers are
   checked against the budgets above.
3. After approval of that slice: **checkout with the slot picker + payment + bookings/timeline**,
   then the recordings again.
4. Then **the owner workspace, auth and empty/error states**, then the logo and the final pass:
   performance, accessibility (axe plus a keyboard-only run), and refreshed README screenshots and GIF.

Each step keeps the backend contract and the 168-test suite green, adds frontend tests for the
new logic (the slot picker's blocked-time maths, the filter bound to the URL), and is pushed in
small commits.

Concept frames for this direction are in `docs/design/` (static stills from a throwaway
prototype: the hero, a key-tag card with the rolling price, and the timeline road). They show
the look, not the motion; the motion is judged from the first slice's recording.
