# Slice 1 gap audit (home, catalog, vehicle detail)

Compares the first slice-1 build (commit `f2c062a` plus the gantry `31c9727`) against the approved `/app/lab`
and `docs/design-direction.md`. Screenshot references are the slice-1 stills in `docs/design/slice1/`
(git-excluded; named `{theme}-{width}-{n-section}.png`). **Status** is as of that build; **Fix** says what this pass
does about it.

Legend: ✅ present · 🟡 partial · ❌ missing

## Whole page (shared shell)

| Element / animation | Source | Status | Screenshot | Fix |
| --- | --- | --- | --- | --- |
| Tarmac grain over the page background | lab | ❌ | dark-1920-2-rack | Shared `<Backdrop>` in the shell |
| Margin lane lines + red/white kerbs, parallax with distance driven | lab | ❌ | dark-1920-2-rack | Shared `<Backdrop>` |
| Far layer: road signs and km posts (margins only, hidden < 1440 px) | lab | ❌ | dark-1920-3-how | Shared `<Backdrop>` |
| Headlight sweep at high throttle | lab | ❌ | — | Shared `<Backdrop>` |
| HUD strip: GPS chapter name · speed needle · km odometer | lab | ❌ | dark-1920-5-catalog | Shared `<Hud>` (hidden over the hero, which has its own cluster) |
| Chapter story: each section announces itself to the HUD | lab | 🟡 (attributes only, nothing read them) | — | Shared `useChapters()` on every page |
| Header over the scene, solid once scrolled | direction | 🟡 (92 % backing let content show through) | dark-1920-4-footer | Opaque backing + hairline when scrolled |
| Lane-M logo drawing in | direction §7 A | ✅ | dark-1920-1-hero | — |
| Night / Daytime toggle, AA contrast | lab | ✅ | light-1920-* | — |
| Route change: top of page, focus to h1 | direction §6 | ✅ | — | — |
| Toll-gate finish: road runs into the gate, arm lifts (scrubbed), light turns green | lab | 🟡 (gate floats on an empty field, no road) | dark-1920-4-footer | Road leading into the gate, dashes flowing at drive speed |
| Reduced motion: final states, no Lenis | direction §6 | ✅ | reduced-1366-* | Extended to every new piece |

## Home

| Element / animation | Source | Status | Screenshot | Fix |
| --- | --- | --- | --- | --- |
| 3D road hero, speed from scroll velocity, CSS fallback | lab / direction 1 | ✅ | dark-1920-1-hero | — |
| Headline width/skew stretches with speed | lab / direction 2 | ✅ | — | — |
| Speedometer needle + km/h | lab | ✅ | dark-1920-1-hero | — |
| Search cluster needles sweep in on load | direction 3 | ❌ | — | Needle sweeps 0 → max → idle on load |
| Available-count odometer rolls when dates/type change | direction 4 | ✅ | — | — |
| Daytime halo tight to the text (not washing the scene) | lab feedback | 🟡 (washes out the gantry's left third) | gantry/light-gantry-ahead | Halo sized to the copy block only |
| Gantry + roadside board (Tamil/English) | feedback | ✅ | gantry/* | — |
| "Next on this page" chapter gantry ("The rack ↑ 1 km") | feedback | ❌ | — | First gantry names the page's chapters |
| Key tags drop onto a rack, elastic swing, staggered, on scroll into view | lab / direction 5 | 🟡 (runs, but tags hang from a flat grey bar with no hooks) | dark-1920-2-rack | Steel rail with a hook and string per tag; drop verified mid-flight |
| Key tags swing on hover (spring around the hole) | lab / direction 5 | ✅ | — | — |
| Key tags draggable with inertia along the lane | direction 5 | ❌ | — | Out of scope here, noted for the next slice |
| "How a rental drives": scrubbed dashed road, car on the path, stops wake their icons | lab / direction 6 | ✅ | dark-1920-3-how | — |
| Trip chapter: scrubbed timeline road + time road + rolling price odometer | lab | ❌ | — | Shared `<TripChapter>` ("Your trip, mile by mile") on home and in the lab |
| Host call-out | old home | ✅ | dark-1920-4-footer | — |

## Catalog

| Element / animation | Source | Status | Screenshot | Fix |
| --- | --- | --- | --- | --- |
| Type filter bound to the URL (bug fix + tests) | direction | ✅ | dark-1920-6-catalog-bikes | — |
| Gearbox rail, sticky | direction | ✅ | dark-1920-5-catalog | — |
| Date inputs wide enough | — | ❌ (cut to "dd-mm-yyy") | light-1920-5-catalog | Dates stack in the rail |
| Active filters as road signs flipping in / folding away | direction 2 | ✅ | — | — |
| FLIP reflow; leavers drop, newcomers merge from the side | direction 1 | ✅ | — | — |
| Price range slider with magnetic snap and rolling price odometer | direction 3 | ❌ (plain inputs) | — | Two-handle slider, snaps to round values, odometer readouts |
| Skeleton tags with the exact footprint | direction 4 | ✅ | — | — |
| Photo lane-wipe reveal | direction 4 | ❌ | — | Clip-path wipe on image load |
| Phone filter sheet | direction 5 | ✅ (final pass) | final/s1-sheet-open, s1-sheet-dragging | Drag the grab bar down past 90 px (or flick) to dismiss; shorter drags spring back; Esc/Enter on the bar closes it |
| "Road ends" barrier draws itself | direction 6 | ✅ | — | — |
| Backdrop + HUD | lab | ❌ | dark-1920-5-catalog | Shared shell pieces |

## Vehicle detail

| Element / animation | Source | Status | Screenshot | Fix |
| --- | --- | --- | --- | --- |
| Card → detail photo morph (View Transition) | direction 1 | ✅ | — | — |
| Swipe gallery with momentum and snap, filmstrip, keys | direction 2 | ✅ | light-1366-7-detail | — |
| Pinch-to-zoom (and double-tap / double-click zoom) | direction 2 | ❌ | — | Pinch and double-tap zoom with pan |
| Spec plates stamp in | direction 3 | ✅ | — | — |
| Calendar: blocked days as double lines | direction 4 | 🟡 (line-through double) | — | — |
| Price odometer rolls with dates | direction 5 | ❌ | — | Rolling total on the reservation panel |
| Reviews on a horizontal lane, gauge fill | direction 6 | 🟡 (lane yes, gauge static) | — | — |
| Backdrop + HUD | lab | ❌ | light-1366-7-detail | Shared shell pieces |

## Budgets

| Budget | Status | Fix |
| --- | --- | --- |
| 60 fps at x1 while scrolling | ✅ (60, p95 17 ms) | Re-measured after this pass |
| About 60 at x4 | ❌ (40–55, varies with host load) | Re-measured; reported honestly |
| CLS about 0 | ✅ (≤ 0.005) | Re-measured |
| Lighthouse (LCP, CLS, TBT) | ❌ not run | Lighthouse run on home, catalog and detail |

## After the fix pass

Verified in headless Chrome against port 8000 (stills in `docs/design/slice1/` and `docs/design/slice1/gaps/`).

| Gap | Result |
| --- | --- |
| Backdrop (grain, margin lanes and kerbs, far signs, headlight sweep) | ✅ Shared `odo/world.tsx`, on every page and in the lab |
| HUD + chapter story | ✅ Hidden over the hero, shown after it; chapters change in order while scrolling (Start → The rack → How it works → Your trip → Become a host → Toll gate · Finish); catalog and detail have their own chapters |
| Header backing when scrolled | ✅ Opaque (`rgb(18, 20, 23)` at night) |
| Toll gate | ✅ A road runs in from the left; the car rolls up, the arm lifts, the light turns green, the car drives through; the centre line flows at drive speed |
| Rack | ✅ A steel rail with a hook and chain per tag along a horizontal lane (drag with inertia, or swipe); drop measured mid-flight: y −320 → 0 with the elastic swing |
| Trip chapter on home | ✅ Shared `odo/TripChapter.tsx` ("Your trip, mile by mile"), also used by the lab |
| Needle sweep-in | ✅ The needle sweeps to the top of the dial and back on load |
| Daytime halo | ✅ Sized to the copy block |
| Chapter gantry | ✅ The first gantry signs the page ("NEXT ON THIS ROAD": Catalog · How it works · Your trip, Tamil and English) |
| Catalog dates | ✅ 278 px wide, stacked |
| Price slider | ✅ Two handles, magnetic snap when dragged (a drag to ~₹2,040 lands on ₹2,000), exact steps by keyboard, odometer readouts |
| Lane-wipe photo reveal | ✅ After each photo loads |
| FLIP reflow | ✅ Now actually runs: the page was being remounted on every filter change (the error boundary was keyed by location), which also stole keyboard focus |
| Pinch / double-tap zoom | ✅ Pinch (1–3×), double-tap or double-click 2×, pan while zoomed, reset on photo change |
| Detail price odometer | ✅ The estimated total rolls |
| Accessibility (Lighthouse) | home 96 → contrast fixed (dimmed steps now dim by colour); catalog 98 → heading order fixed; detail 100 |
| Cold-load CLS (mobile, slow 4G, 4× CPU) | ✅ ~0.9 → ≤ 0.003 (the footer showed while a page chunk loaded; pages now reserve the viewport) |
| LCP (same throttling) | ❌ home ~6.1 s, catalog ~6.3 s, detail ~8.5 s (FCP ~4.7 s: the main JS bundle on slow 4G). Budget 2.0–2.5 s: needs bundle splitting / preloading, open |
| Frame rate, home while scrolling (1920×870) | x1: 85 fps avg, p95 20.8 ms (misses 60 Hz on a few frames); x4: 44 fps, 6 long tasks. Open |
| Still open | Nothing: drag-to-dismiss on the phone filter sheet landed in the final pass |

## Second pass (review feedback)

| Item | Result |
| --- | --- |
| Toll-gate footer | ✅ A toll plaza: canopy with a "TOLL PLAZA · சுங்கச்சாவடி" fascia on two pillars, a booth with its light, the barrier across the lane in front of the car. Scrubbed: the car drives in and stops at the barrier, the arm lifts (clear of the canopy), the light turns green, the car drives through and off. Road and kerbs run edge to edge; the empty space above is gone (footer ~570 px at 1920×870). |
| HUD over the footer links | ✅ Hidden once the footer is in view |
| Rack scrollbar | ✅ Hidden; the lane still scrolls by drag, swipe, trackpad and keyboard (it is focusable) |
| Static compression | ✅ WhiteNoise now serves pre-compressed files (`CompressedStaticFilesStorage`, collected files even with DEBUG on); hashed Vite assets are cached as immutable. Entry script on the wire: 275 KB → 87 KB |
| Bundle split | ✅ The workspace/account pages, their layout and their Google Fonts load as one separate chunk; the public pages no longer download them. The public shell and home chunks are `modulepreload`ed from `index.html` (no chunk waterfall); the headline font is preloaded; the backdrop mounts after first paint; the 3D road loads when idle after first paint |
| Mobile cold load, slow 4G + 4× CPU, median of 3 (LCP / first paint) | home 6.1 s → **3.5 s** / 4.7 → 3.5 s · catalog 6.3 → **5.8 s** / 4.8 → 2.4 s · detail 8.5 → **5.3 s** / 4.6 → 2.5 s. ❌ Still above the 2.5 s target. On catalog and detail the LCP is the vehicle photo, which waits for the API data; home is bound by script evaluation (TBT ~3.6 s at 4× CPU) |
| Frame rate, home while scrolling (1920×870) | x1: 62–64 fps avg, p95 ~21 ms; x4: 38–40 fps, 8–12 long tasks. ❌ Not at the target |

## Deferred (approved with slice 1)

| Item | Status |
| --- | --- |
| Mobile LCP ≤ 2.5 s on 4G (home 3.5 s, catalog 5.8 s, detail 5.3 s now) | Open: deferred to a dedicated speed pass after the redesign |
| About 60 fps at x4 while scrolling home (38–40 now) and p95 ≤ 16.7 ms at x1 (~21 ms now) | Open: deferred to the same speed pass |
