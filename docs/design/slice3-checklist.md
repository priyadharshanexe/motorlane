# Slice 3 checklist (owner workspace)

Every element and animation that `docs/design-direction.md` (section 4, "Owner workspace" and "Empty and error
states") and the slice-3 brief ask for. Each line is checked in a browser before slice 3 is reported.
Status: ✅ present and verified · 🟡 partial · ❌ missing. **Verified** names the still or scripted check.

Shared with slices 1–2: the shell, backdrop, HUD, odometer, key tag, road signs, the payment and timeline pieces.

## Overview: instrument cluster

| # | Element / animation | Status | Verified |
| --- | --- | --- | --- |
| O1 | Gauges: pending requests, pickups today, active rentals, this month's booking value | ✅ | f0-cluster, q-overview-* |
| O2 | Gauges sweep to their values on load (SVG arcs, spring overshoot); numbers roll | ✅ | arcs and needles spring past and settle (1.3 s); values roll on odometers; recording |

## Booking queue: departures board

| # | Element / animation | Status | Verified |
| --- | --- | --- | --- |
| Q1 | Queue as a departures board sorted by pickup time (vehicle, renter, pickup, state) | ✅ | o2-board, f7, f8 (sorted: on the road, pickups, requests, then by pickup time) |
| Q2 | Split-flap characters flip when a row's state changes | ✅ | rows re-flap on a state change (Pending → Confirmed in the recording, f8) |
| Q3 | Each row's pickup window as a bar that fills in real time as the window opens | ✅ | ticks every second: 'Pickup opens in 0m 06s' (w1), then open (w2); return bar for rentals on the road |
| Q4 | Approve / reject on pending rows; record return on rentals in progress | ✅ | final pass: reject on the board (final/s3-rejected); approve, pickup, return in the recording |
| Q5 | "Record pickup" appears exactly when the pickup window opens (an hour before), with a countdown until then; it slides out | ✅ | w1 → w2: with the page clock 8 s before the window, the button slides in when the countdown ends |
| Q6 | Actions respect the API rules (payment settled, window); API errors shown inline | ✅ | unpaid confirmed booking shows 'Awaiting payment' instead of the button (f8); API errors show inline under the row (by code, not triggered) |
| Q7 | The owner's view of a booking: timeline road with owner-side labels ("Renter paid ₹X", "You approved") | ✅ | f12: 'Renter requested', 'You approved', 'Renter paid ₹5,200', 'You handed over the keys' |

## Fleet and listing

| # | Element / animation | Status | Verified |
| --- | --- | --- | --- |
| F1 | Fleet as a grid of key tags with status plates (listed, paused, under maintenance) | ✅ | final pass: 'In the workshop' and 'Paused' plates live (final/s3-plates); 'Listed' in f6 |
| F2 | Listing form as a two-step sheet: details, then photos | ✅ | f1 (details) → f3 (photos), step tabs |
| F3 | Deposit and weekend rate fields with a live preview tag ("Sat–Sun ₹550 · deposit ₹800") that rolls as you type | ✅ | f1: Mon–Fri ₹2200 · Sat–Sun ₹2600 · deposit ₹3000, rolling while typing |
| F4 | Photo manager: drag to reorder with a layout spring (keyboard reorder too) | ✅ | drag reorder (recording); final pass: arrow key moved photo 1 → 2 and C made it the cover, both saved (final/s3-keyboard-reorder) |
| F5 | Drop a photo on the "cover plate" slot to make it the cover | ✅ | f4 plate highlights under the drag; f5 cover changed (API confirmed) |
| F6 | Upload progress as a road filling; lane-wipe reveal on the new thumbnail | ✅ | f2 road fills with XHR upload progress; new thumbnail wipes in |
| F7 | Maintenance: drag across a calendar to paint hatched blocks; a conflict flashes the clashing booking | ✅ | f9 painted a 3-day block (hatched); f10 painting over trip #28 flashes it red and blocks the save |
| F8 | Edit and delete a listing and a maintenance block (existing flows kept) | ✅ | final pass: edited the daily rate and pickup instructions (saved), removed a maintenance block, paused and listed again; archive confirm by code |

## Value report

| # | Element / animation | Status | Verified |
| --- | --- | --- | --- |
| V1 | Booking value per vehicle as bars that grow from the road edge | ✅ | f13, bars grow from the road edge (staggered) |
| V2 | Hovering (or focusing) a bar shows the rolling total | ✅ | f13: hovering a bar rolls the gauge to that vehicle's value; focus does the same |

## Empty states

| # | Element / animation | Status | Verified |
| --- | --- | --- | --- |
| E1 | Owner road signs with one action: no vehicles yet (list one), no requests, no value yet, errors (retry) | ✅ | e1–e5 (no vehicles, no departures, no value, nothing to service), e6 diversion with retry |

## Quality bar

| # | Check | Status | Verified |
| --- | --- | --- | --- |
| QA1 | Full owner flow works: list a vehicle → approve → pickup within the window → return → value report | ✅ | recording rec/owner-flow-list-approve-pickup-return-value.webm |
| QA2 | Backend API unchanged (except the approved Paid stop); Django and frontend tests pass | ✅ | no API change in slice 3; vitest 18, tsc, build; Django suite in CI |
| QA3 | 1920×870, 1366×768 and 375 px, both themes; reduced motion shows final states | ✅ | q-{overview,board,fleet,listing,maint,booking,value}-{1920,1366,375}-{light,dark}; q-reduced-motion-* (transitions 0 s) |
| QA4 | CLS about 0; no console errors | ✅ | final pass: maintenance at 375 px now 0 (waits for the fleet before rendering the title); no console errors |
