// Catalog: "Shuffle lanes." Every filter lives in the URL (see filters.ts). The vehicle-type switch is controlled
// by the URL, so it always matches the results. Changing filters reflows the key tags with FLIP layout animation:
// tags slide to their new places, leavers drop out of the lane and newcomers merge in from the side.
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { Vehicle } from "../api";
import { Notice } from "../shared";
import { activeFilters, vehicleType, withParam } from "./filters";
import { KeyTag, KeyTagSkeleton } from "./KeyTag";
import { Odometer, plural, reducedMotion } from "./primitives";
import { Hud, useChapters } from "./world";

const PRICE_MAX = 5000, PRICE_STEP = 50, MAGNET = 500, PULL = 90;
/** Handles snap to round values: within PULL of a multiple of MAGNET, the value jumps onto it. */
export const magnetic = (value: number) => {
  const nearest = Math.round(value / MAGNET) * MAGNET;
  return Math.abs(nearest - value) <= PULL ? nearest : Math.round(value / PRICE_STEP) * PRICE_STEP;
};

/** A two-handle price range with magnetic round values and odometer readouts. It applies to the URL when a handle
 *  is released (or on keyboard change), not on every pixel of a drag. */
function PriceRange({ min, max, onApply }: { min: number; max: number; onApply: (min: number, max: number) => void }) {
  const [low, setLow] = useState(min), [high, setHigh] = useState(max);
  useEffect(() => { setLow(min); setHigh(max); }, [min, max]);  // follow the URL (e.g. "Reset filters")
  const commit = () => onApply(low, high);
  // The magnet only pulls a dragged handle; arrow keys step exactly (otherwise a step next to a round value would
  // snap straight back onto it).
  const byPointer = useRef(false);
  const snap = (value: number) => (byPointer.current ? magnetic(value) : value);
  const pct = (v: number) => `${(v / PRICE_MAX) * 100}%`;
  return (
    <div className="od-field od-price">
      <small id="od-price-label">Price per day</small>
      <div className="od-price-read" aria-hidden="true">
        <span>₹<Odometer value={String(low).padStart(4, "0")} size="md" /></span>
        <span>₹<Odometer value={String(high).padStart(4, "0")} size="md" />{high >= PRICE_MAX ? "+" : ""}</span>
      </div>
      <div className="od-price-track" style={{ "--lo": pct(low), "--hi": pct(high) } as React.CSSProperties}>
        <input type="range" min={0} max={PRICE_MAX} step={PRICE_STEP} value={low} aria-labelledby="od-price-label" aria-label="Minimum price per day"
          aria-valuetext={`₹${low}`} onChange={e => setLow(Math.min(snap(Number(e.target.value)), high - PRICE_STEP))}
          onPointerDown={() => { byPointer.current = true; }} onKeyDown={() => { byPointer.current = false; }} onPointerUp={commit} onKeyUp={commit} />
        <input type="range" min={0} max={PRICE_MAX} step={PRICE_STEP} value={high} aria-label="Maximum price per day"
          aria-valuetext={high >= PRICE_MAX ? "No maximum" : `₹${high}`} onChange={e => setHigh(Math.max(snap(Number(e.target.value)), low + PRICE_STEP))}
          onPointerDown={() => { byPointer.current = true; }} onKeyDown={() => { byPointer.current = false; }} onPointerUp={commit} onKeyUp={commit} />
      </div>
    </div>
  );
}

type Catalog = { count: number; next: string | null; previous: string | null; results: Vehicle[] };
const TYPES: [string, string][] = [["", "All"], ["Car", "Cars"], ["Bike", "Bikes"]];
const spring = { type: "spring", stiffness: 420, damping: 38, mass: 0.9 } as const;

export function Catalog() {
  const [params, setParams] = useSearchParams();
  const query = useQuery({
    queryKey: ["vehicles", params.toString()],
    queryFn: () => api<Catalog>(`vehicles/?${params}`),
    placeholderData: keepPreviousData,  // keep the old tags on screen while the new ones load, then reflow
  });
  const type = vehicleType(params);
  const sheet = useRef<HTMLDetailsElement>(null), root = useRef<HTMLDivElement>(null);
  useChapters(root);
  // A one-tap filter (type, removing a sign, paging) applies at once; on phones it also closes the filter sheet
  // so the results are visible.
  const set = (key: string, value: string) => {
    setParams(withParam(params, key, value), { preventScrollReset: true });
    if (sheet.current) sheet.current.open = false;
  };
  const filters = activeFilters(params);
  // Phones: drag the open sheet's grab bar down to dismiss it (past 90 px or a quick flick), else it springs back.
  const dragSheet = (e: React.PointerEvent<HTMLElement>) => {
    const el = sheet.current;
    if (!el?.open) return;
    const startY = e.clientY, startT = performance.now();
    let dy = 0;
    el.style.transition = "none";
    const move = (ev: PointerEvent) => { dy = Math.max(0, ev.clientY - startY); el.style.transform = `translateY(${dy}px)`; };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      const flick = dy / Math.max(1, performance.now() - startT) > 0.6;
      el.style.transition = "transform .28s var(--ease-out)";
      if (dy > 90 || (flick && dy > 24)) {
        el.style.transform = "translateY(100%)";
        window.setTimeout(() => { el.open = false; el.style.transform = ""; el.style.transition = ""; }, 260);
      } else el.style.transform = "";
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  };

  const apply = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let next = new URLSearchParams(params);
    for (const [key, value] of new FormData(event.currentTarget)) next = withParam(next, key, String(value));
    setParams(next, { preventScrollReset: true });
    if (sheet.current) sheet.current.open = false;
  };

  const heading = type === "Car" ? "Discover your next car." : type === "Bike" ? "Life on two wheels." : "Where to next?";
  const rail = (
    <form className="od-gearbox" onSubmit={apply} aria-label="Refine your search">
      <div className="od-field"><small id="od-cat-type">Vehicle type</small>
        <div className="od-seg od-seg-lg" role="group" aria-labelledby="od-cat-type">
          {TYPES.map(([value, label]) => (
            <button type="button" key={value} aria-pressed={type === value} onClick={() => set("type", value)}>{label}</button>
          ))}
        </div>
      </div>
      <label className="od-field"><small>Location</small><input name="location" key={params.get("location") ?? ""} defaultValue={params.get("location") ?? ""} placeholder="Any town" /></label>
      <div className="od-field-row">
        <label className="od-field"><small>Pickup</small><input type="date" name="start_date" key={params.get("start_date") ?? ""} defaultValue={params.get("start_date") ?? ""} /></label>
        <label className="od-field"><small>Return</small><input type="date" name="end_date" key={params.get("end_date") ?? ""} defaultValue={params.get("end_date") ?? ""} /></label>
      </div>
      <label className="od-field"><small>Model</small><input name="q" key={params.get("q") ?? ""} defaultValue={params.get("q") ?? ""} placeholder="Search a model" /></label>
      <label className="od-field"><small>Fuel</small><input name="fuel" key={params.get("fuel") ?? ""} defaultValue={params.get("fuel") ?? ""} placeholder="Petrol, Diesel, Electric" /></label>
      <PriceRange min={Number(params.get("min_price") || 0)} max={Number(params.get("max_price") || PRICE_MAX)}
        onApply={(lo, hi) => {
          let next = withParam(params, "min_price", lo > 0 ? String(lo) : "");
          next = withParam(next, "max_price", hi < PRICE_MAX ? String(hi) : "");
          setParams(next, { preventScrollReset: true });
        }} />
      <button className="od-go">Apply filters</button>
      <Link className="od-reset" to="/vehicles" preventScrollReset>Reset filters</Link>
    </form>
  );

  const results = query.data?.results ?? [];
  return (
    <MotionConfig reducedMotion="user">
      <div className="od-catalog" ref={root}>
        <header className="od-catalog-head" data-chapter={type === "Car" ? "Exit 2 · Cars" : type === "Bike" ? "Exit 2 · Bikes" : "Exit 2 · Every ride"}>
          <span className="od-eyebrow">A ride for every reason</span>
          <h1 tabIndex={-1}>{heading}</h1>
          <div className="od-catalog-count" aria-live="polite">
            <Odometer value={String(query.data?.count ?? 0).padStart(2, "0")} size="md" label={plural(query.data?.count ?? 0, "ride")} />
            <span>{query.data?.count === 1 ? "ride" : "rides"} match</span>
          </div>
          {/* Active filters as road signs: they flip in, and fold away when removed. */}
          <ul className="od-signs" aria-label="Active filters">
            <AnimatePresence initial={false}>
              {filters.map(filter => (
                <motion.li key={filter.key} layout
                  initial={{ rotateX: -90, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} exit={{ rotateX: 90, opacity: 0 }}
                  transition={spring}>
                  <button type="button" onClick={() => set(filter.key, "")} aria-label={`Remove ${filter.label} ${filter.value}`}>
                    <small>{filter.label}</small> {filter.value} <span aria-hidden="true">×</span>
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </header>
        <div className="od-catalog-body">
          <aside className="od-rail">
            <details className="od-sheet" ref={sheet}>
              <summary>Refine your search{filters.length ? ` · ${filters.length}` : ""}</summary>
              <div className="od-sheet-grab" onPointerDown={dragSheet} role="button" tabIndex={0} aria-label="Close filters (or drag down)"
                onKeyDown={e => { if (e.key === "Enter" || e.key === " " || e.key === "Escape") { e.preventDefault(); if (sheet.current) sheet.current.open = false; } }}><span /></div>
              {rail}
            </details>
            <div className="od-rail-desk">
              <span className="od-eyebrow">Gearbox</span>
              {rail}
            </div>
          </aside>
          <section className="od-results" aria-busy={query.isFetching} aria-labelledby="od-results-title">
            <h2 id="od-results-title" className="od-visually-hidden">Results</h2>
            <Notice error={query.error} />
            <motion.div className="od-tags od-tags-grid" layout={!reducedMotion()}>
              {query.isPending && Array.from({ length: 6 }, (_, i) => <KeyTagSkeleton key={i} />)}
              <AnimatePresence mode="popLayout" initial={false}>
                {results.map((vehicle, index) => (
                  <motion.div key={vehicle.id} layout className="od-slot"
                    initial={{ opacity: 0, x: 60 }} animate={{ opacity: 1, x: 0, y: 0 }} exit={{ opacity: 0, y: 70 }}
                    transition={spring}>
                    <KeyTag vehicle={vehicle} index={index} params={params.toString()} priority={index < 3} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
            {query.data?.count === 0 && <RoadEnds />}
            {(query.data?.previous || query.data?.next) && (
              <nav className="od-pages" aria-label="Catalog pages">
                {query.data.previous && <button type="button" className="od-cta od-cta-ghost" onClick={() => set("page", String(Number(params.get("page") || 1) - 1))}>Previous</button>}
                {query.data.next && <button type="button" className="od-cta od-cta-ghost" onClick={() => set("page", String(Number(params.get("page") || 1) + 1))}>Next</button>}
              </nav>
            )}
          </section>
        </div>
        <Hud />
      </div>
    </MotionConfig>
  );
}

/** No results: the road ends at a barrier that draws itself, with one way forward. */
function RoadEnds() {
  return (
    <div className="od-road-ends" role="status">
      <svg viewBox="0 0 320 120" aria-hidden="true">
        <path className="road" d="M0 100 H320" />
        <path className="barrier" d="M40 60 H280 M60 60 V100 M260 60 V100" />
        <path className="stripes" d="M70 60 l20 0 M130 60 l20 0 M190 60 l20 0 M240 60 l20 0" />
      </svg>
      <h2>Road ends here.</h2>
      <p>No rides match these filters. Widen the dates or try another town.</p>
      <Link className="od-cta" to="/vehicles">Show every ride</Link>
    </div>
  );
}
