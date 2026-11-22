// Catalog: "Shuffle lanes." Every filter lives in the URL (see filters.ts). The vehicle-type switch is controlled
// by the URL, so it always matches the results. Changing filters reflows the key tags with FLIP layout animation:
// tags slide to their new places, leavers drop out of the lane and newcomers merge in from the side.
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { Vehicle } from "../api";
import { Notice } from "../shared";
import { activeFilters, vehicleType, withParam } from "./filters";
import { KeyTag, KeyTagSkeleton } from "./KeyTag";
import { Odometer, reducedMotion } from "./primitives";

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
  const sheet = useRef<HTMLDetailsElement>(null);
  // A one-tap filter (type, removing a sign, paging) applies at once; on phones it also closes the filter sheet
  // so the results are visible.
  const set = (key: string, value: string) => {
    setParams(withParam(params, key, value), { preventScrollReset: true });
    if (sheet.current) sheet.current.open = false;
  };
  const filters = activeFilters(params);

  const apply = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let next = new URLSearchParams(params);
    for (const [key, value] of new FormData(event.currentTarget)) next = withParam(next, key, String(value));
    setParams(next, { preventScrollReset: true });
    if (sheet.current) sheet.current.open = false;
  };

  const heading = type === "Car" ? "Discover your next car." : type === "Bike" ? "Life on two wheels." : "Where to next?";
  const rail = (
    <form className="od-gearbox" onSubmit={apply} key={params.toString()} aria-label="Refine your search">
      <div className="od-field"><small id="od-cat-type">Vehicle type</small>
        <div className="od-seg od-seg-lg" role="group" aria-labelledby="od-cat-type">
          {TYPES.map(([value, label]) => (
            <button type="button" key={value} aria-pressed={type === value} onClick={() => set("type", value)}>{label}</button>
          ))}
        </div>
      </div>
      <label className="od-field"><small>Location</small><input name="location" defaultValue={params.get("location") ?? ""} placeholder="Any town" /></label>
      <div className="od-field-row">
        <label className="od-field"><small>Pickup</small><input type="date" name="start_date" defaultValue={params.get("start_date") ?? ""} /></label>
        <label className="od-field"><small>Return</small><input type="date" name="end_date" defaultValue={params.get("end_date") ?? ""} /></label>
      </div>
      <label className="od-field"><small>Model</small><input name="q" defaultValue={params.get("q") ?? ""} placeholder="Search a model" /></label>
      <label className="od-field"><small>Fuel</small><input name="fuel" defaultValue={params.get("fuel") ?? ""} placeholder="Petrol, Diesel, Electric" /></label>
      <div className="od-field-row">
        <label className="od-field"><small>Min ₹ / day</small><input type="number" min="0" step="50" inputMode="numeric" name="min_price" defaultValue={params.get("min_price") ?? ""} /></label>
        <label className="od-field"><small>Max ₹ / day</small><input type="number" min="0" step="50" inputMode="numeric" name="max_price" defaultValue={params.get("max_price") ?? ""} /></label>
      </div>
      <button className="od-go">Apply filters</button>
      <Link className="od-reset" to="/vehicles" preventScrollReset>Reset filters</Link>
    </form>
  );

  const results = query.data?.results ?? [];
  return (
    <MotionConfig reducedMotion="user">
      <div className="od-catalog">
        <header className="od-catalog-head">
          <span className="od-eyebrow">A ride for every reason</span>
          <h1 tabIndex={-1}>{heading}</h1>
          <div className="od-catalog-count" aria-live="polite">
            <Odometer value={String(query.data?.count ?? 0).padStart(2, "0")} size="md" label={`${query.data?.count ?? 0} rides`} />
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
              {rail}
            </details>
            <div className="od-rail-desk">
              <span className="od-eyebrow">Gearbox</span>
              {rail}
            </div>
          </aside>
          <section className="od-results" aria-busy={query.isFetching}>
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
