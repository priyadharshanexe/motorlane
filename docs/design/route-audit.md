# Route audit: every page Motorlane can show, and its design

Every URL the React app and the Django server can show, plus the emails and the PDF, with its design status after the
unification pass. **New** = the Odometer design (theme tokens, day and night, reduced motion, 1920×870 / 1366×768 /
375). Verified with a sweep in a browser launched for the purpose (`walkthrough/sweep.js`): 28 routes × 7 views
(3 sizes × 2 themes + reduced motion) = 196 loads, each checked for the new shell (`.od-app` or `.od-server`), any
legacy markup (`.site-header`, `.page-heading`, `.panel`, `.quick-links`, `.dashboard-list`, `.account-settings`,
`.listing`, Bootstrap, `marketplace.css`), page errors, horizontal overflow and CLS. Result: **0 problems**.
Stills (before → after) live in `docs/design/route-audit/` (git-excluded); the "before" column names the old page.

## What was still old before this pass

| Page | Before | Now |
| --- | --- | --- |
| `/app/favorites` (Saved vehicles) | Old design via `LegacyApp` (`Favorites.tsx`, `.page-heading`, `.cards`, `.listing`) | New: `odo/Saved.tsx`, key-tag grid with hearts, odometer count, "Garage is empty" road sign |
| `/app/account` | Old design (`AccountScreen.tsx`, `.panel`, links out to allauth pages) | New: `odo/Account.tsx`, email addresses (add, resend, make primary, remove), password with strength, connected Google, sign out, all through allauth's headless API |
| `/app/dashboard` | Old renter overview (`Dashboard.tsx`) | Redirects (server, 302) to `/app/bookings`; its trips and saved vehicles have their own pages. Menu says "Your trips" |
| `/app/*` (unknown) | Old "Page not found" inside `LegacyApp` | New: "Road ends" sign inside the shell (`NotFound`) |
| Route error boundary | Old `.panel` "This page couldn't load" | New: "Diversion" road sign with reload |
| `/accounts/*` (allauth: login fallback, email, password change, connected accounts, Google callback errors) | Bootstrap + `marketplace.css` | New server base (`rental/templates/rental/base.html` + `rental/static/rental/odometer.css`): Lane-M header, same menu, day/night toggle sharing the app's saved theme, road footer; the login fallback points to `/app/sign-in` |
| `/admin-dashboard/` (staff) | Bootstrap tables | New: stat tiles (alerts in red), tokenised tables |
| Django error pages 404 / 403 / 500 / CSRF (non-`/app` URLs) | Django defaults | New: road signs (Road ends / No entry / Diversion) on the server base. Preview in development at `/_preview/error/<404|403|500|csrf>/` |
| Emails (11 kinds, HTML + text) | Plain grey box, blue button | New: tarmac header with the M mark and wordmark, road stripe, the trip as a dashed "trip ticket", lane-yellow button, kerb line; links go to the booking (`/app/bookings/<id>`, owner emails `/app/owner/bookings/<id>`). Text versions kept |
| Booking PDF (`/download-receipt/<id>/`) | Blue "Motorlane" header, "payment not recorded" | New: tarmac band with the Lane-M mark, trip ticket, line-by-line price, deposit, payment and refunds, "The road so far" timeline from the booking's events, road-and-kerb footer |
| Shared pieces inside new pages (heart, rating, calendar, price breakdown, quick view, notices) | Lived in legacy files, styled by the legacy `index.css` | Moved into `odo/` and styled from the theme tokens in `odo/base.css` |

Removed: `LegacyApp.tsx`, `Layout.tsx`, `Dashboard.tsx`, `AccountScreen.tsx`, `Auth.tsx`, `Marketplace.tsx`,
`Breadcrumb.tsx`, `MetricIcon.tsx`, `legacy-fonts.css`, `index.css` (its remaining rules rewritten into
`odo/base.css`), two unused images, and `rental/static/rental/marketplace.css`. Nothing in `frontend/src` imports a
legacy file any more; the non-UI helpers (`api.ts`, `requests.ts`, `payments.ts`, `rentalDates.ts`) stay.

## Every URL

| URL | Who | Rendered by | Design | Key elements |
| --- | --- | --- | --- | --- |
| `/app/` | anyone | React `Home` | New | 3D/2D road hero, speedometer, search cluster, rack, trip chapter, how-it-works road, toll-plaza footer |
| `/app/vehicles` | anyone | React `Catalog` | New | gearbox filters in the URL, key-tag grid with FLIP, price slider, phone filter sheet (drag to dismiss) |
| `/app/vehicles/:id` | anyone | React `VehicleDetail` | New | gallery (swipe, zoom), rating, heart, rental calendar, estimate, reserve |
| `/app/checkout/:id` | signed in | React `Checkout` | New | time road, receipt printing, deposit tag, ignition |
| `/app/bookings` | signed in | React `Trips` | New | lanes of trip tickets |
| `/app/bookings/:id` | signed in | React `TripDetail` | New | timeline road with paid/refund stops, payment sheet, cancel preview, refund gauge, review |
| `/app/favorites` | signed in | React `Saved` | **New (this pass)** | key tags with hearts, count, empty sign |
| `/app/account` | signed in | React `Account` | **New (this pass)** | emails, password, Google, sign out |
| `/app/dashboard` | — | Django 302 | → `/app/bookings` | — |
| `/app/owner`, `/requests`, `/bookings/:id`, `/fleet`, `/maintenance`, `/fleet/:id/maintenance`, `/value` | signed in | React owner pages | New | gauges, departures board, key-tag fleet, listing sheet, maintenance calendar, value bars |
| `/app/sign-in`, `/register`, `/verify-email/:key`, `/reset-password[/:key]` | anyone | React `AuthPages` | New | highway scene, gantry, proof points, key rack, unlock |
| `/app/<anything else>` | anyone | React `NotFound` | **New (this pass)** | Road ends sign |
| `/accounts/login/` and other allauth pages | anyone / signed in | Django + allauth | **New (this pass)** | server base, forms on tokens |
| `/admin-dashboard/` | staff | Django | **New (this pass)** | stat tiles, tables |
| `/admin/` | staff | Django admin | Django's own admin (left as is: an internal tool) | — |
| `/api/docs`, `/api/schema` | developers | drf-spectacular | Swagger UI (left as is: developer tool) | — |
| 404 / 403 / 500 / CSRF on non-`/app` URLs | anyone | Django templates | **New (this pass)** | road signs |
| Emails | renters and owners | Django templates | **New (this pass)** | header, trip ticket, lane button |
| `/download-receipt/:id/` | the renter | ReportLab | **New (this pass)** | Lane-M band, ticket, price, payment, timeline |

## Links walked (header menu, footer, owner tabs, trips, auth, empty states)

Every link in the shell points at a page above that is in the new design: header (Discover, Cars, Bikes, List your
vehicle, theme, Menu: Explore vehicles, Saved vehicles, Your trips, Owner workspace, Account, Sign in/out), footer
(All vehicles, Browse cars, Browse bikes, List your vehicle, Owner workspace, Become a host), owner tabs (Overview,
Departures, Fleet, Maintenance, Value), trips (ticket → detail, receipt PDF), auth (sign up, reset, back to sign in),
empty states (Find a ride, Your trips, List a vehicle, Departures board, The workshop), the server menu (same
destinations), and every email button. The old `/dashboard` and "Settings" entries are gone from the menu.
