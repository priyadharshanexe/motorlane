// Home: "Put it in drive." A sticky hero where scrolling drives the road (the 3D road, or the 2D road on low-end
// devices / reduced motion), the headline stretches with speed, and the search dashboard counts what is free for
// the chosen dates on an odometer. Below: the newest listings drop onto a rack as key tags, and "how a rental
// drives" draws itself as you scroll.
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Vehicle } from "../api";
import { Notice } from "./shared";
import { drive, gsap, IDLE_KMH, MAX_KMH, onDrive, onScreen as watchScreen, ScrollTrigger } from "./drive";
import { KeyTag, KeyTagSkeleton } from "./KeyTag";
import { canRun3D, Odometer, plural, reducedMotion, TripMeter, useOnce } from "./primitives";
import { useTheme } from "./theme";
import { TripChapter } from "./TripChapter";
import { Hud, useChapters } from "./world";

const Road3D = lazy(() => import("./Road3D"));
type Catalog = { count: number; next: string | null; previous: string | null; results: Vehicle[] };

export function Home() {
  const root = useRef<HTMLDivElement>(null);
  useChapters(root);
  return (
    <div className="od-home" ref={root}>
      <Hero />
      <Rack />
      <HowItWorks />
      <TripChapter chapter="Stage 4 · Your trip" title="Your trip, mile by mile" />
      <HostCallout />
      <Hud hero=".od-hero" />
    </div>
  );
}

// ----- Hero --------------------------------------------------------------------------------------------------------

function Hero() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [type, setType] = useState("");
  const [start, setStart] = useState(""), [end, setEnd] = useState("");
  const datesReady = Boolean(start && end && start <= end);
  const filter = new URLSearchParams({ ...(type ? { type } : {}), ...(datesReady ? { start_date: start, end_date: end } : {}) });
  const available = useQuery({ queryKey: ["vehicles", "count", filter.toString()], queryFn: () => api<Catalog>(`vehicles/?${filter}`) });
  const all = useQuery({ queryKey: ["vehicles", ""], queryFn: () => api<Catalog>("vehicles/") });
  const count = String(available.data?.count ?? 0).padStart(3, "0");
  const placeKey = [...new Set((all.data?.results ?? []).map(v => v.location?.split(",")[0].trim()).filter(Boolean))].join("|")
    || "Madurai|Coimbatore|Tiruchirappalli|Salem|Chennai";
  const places = useMemo(() => placeKey.split("|"), [placeKey]);

  const section = useRef<HTMLElement>(null), headline = useRef<HTMLHeadingElement>(null);
  const streaks = useRef<HTMLDivElement>(null), sheet = useRef<HTMLSpanElement>(null);
  const needle = useRef<SVGLineElement>(null), kmh = useRef<HTMLSpanElement>(null);
  const [use3D, setUse3D] = useState(canRun3D);
  // The 3D road (and its ~230 KB chunk) loads only once the browser is idle after the first paint, so it never
  // competes with the headline (the LCP); the 2D road shows until then.
  const [load3D, setLoad3D] = useState(false);
  useEffect(() => {
    if (!use3D) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) { const id = w.requestIdleCallback(() => setLoad3D(true), { timeout: 2500 }); return () => w.cancelIdleCallback?.(id); }
    const id = window.setTimeout(() => setLoad3D(true), 1200);
    return () => window.clearTimeout(id);
  }, [use3D]);
  const [onScreen, setOnScreen] = useState(true);
  // Loading ring: stays up (continuing the one in the static first frame) until the page has loaded and, where the 3D
  // road runs, its canvas is drawing smoothly: the scene's start-up (chunk, shaders, first frames) briefly freezes the
  // page, and the ring (a compositor-only spin) keeps turning through it. Needs 20 frames in a row under 50 ms. Capped at 12 s.
  const [booting, setBooting] = useState(true);
  useEffect(() => {
    const t0 = performance.now();
    let last = t0, smooth = 0, raf = 0;
    const tick = (now: number) => {
      const ready = document.readyState === "complete" && (!use3D || !!section.current?.querySelector(".od-hero-scene canvas"));
      smooth = ready && now - last < 50 ? smooth + 1 : 0;
      last = now;
      if (smooth >= 20 || now - t0 > 12000) { setBooting(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [use3D]);
  // Frame-budget watchdog: if the 3D road keeps frames over ~26 ms once the page has settled (a slow GPU or CPU),
  // drop to the still of the road for the rest of the visit rather than scroll at half speed. Load-time jank does not
  // count: watching starts 4 s after the scene appears and needs three slow windows in a row.
  useEffect(() => {
    if (!use3D || !load3D) return;
    let forced = false;
    try { forced = localStorage.getItem("motorlane-3d") === "always"; } catch { /* storage blocked */ }
    if (forced) return;
    let n = 0, sum = 0, slow = 0, armed = false;
    const arm = window.setTimeout(() => { armed = true; }, 4000);
    const stop = onDrive(dt => {
      if (!armed || !onScreen) return;
      sum += dt; n += 1;
      if (n < 30) return;
      slow = sum / n > 0.026 ? slow + 1 : 0;
      n = 0; sum = 0;
      if (slow >= 3) setUse3D(false);
    });
    return () => { window.clearTimeout(arm); stop(); };
  }, [use3D, load3D, onScreen]);

  useLayoutEffect(() => {
    if (reducedMotion()) return;
    const visibility = ScrollTrigger.create({ trigger: section.current, start: "top bottom", end: "bottom top",
      onToggle: self => setOnScreen(self.isActive) });
    return () => visibility.kill();
  }, []);

  // Ignition check: on load the speedometer needle sweeps to the top of the dial and settles back (about 1.1 s).
  const sweep = useRef({ kmh: 0 });
  useEffect(() => {
    if (reducedMotion()) return;
    const tween = gsap.timeline()
      .to(sweep.current, { kmh: MAX_KMH, duration: 0.55, ease: "power2.out", delay: 0.4 })
      .to(sweep.current, { kmh: 0, duration: 0.6, ease: "power2.inOut" });
    return () => { tween.kill(); };
  }, []);

  // Per frame from the shared drive state: headline stretch, speed streaks, speedometer, and the 2D road.
  useEffect(() => {
    let streakY = 0, streaksOn = true, shownKmh = -1, shownHead = "", shownNeedle = "";
    // Everything here lives in the hero: skip it all once the hero is scrolled away.
    const visible = watchScreen(headline.current?.closest("section") ?? headline.current);
    const stop = onDrive(dt => {
      if (!visible.flag.on) return;
      const t = drive.throttle;
      const head = `scaleX(${(1 + t * 0.18).toFixed(3)}) skewX(${(-t * 8).toFixed(2)}deg)`;
      if (headline.current && head !== shownHead) { shownHead = head; headline.current.style.transform = head; }
      if (streaks.current && sheet.current) {
        const on = t > 0.04;
        if (on !== streaksOn) { streaksOn = on; streaks.current.style.visibility = on ? "visible" : "hidden"; }
        if (on) {
          streakY = (streakY + (900 + t * 2600) * dt) % 540;
          streaks.current.style.opacity = (t * 0.8).toFixed(2);
          sheet.current.style.transform = `translate3d(0, ${(streakY - 540).toFixed(0)}px, 0) scaleY(${(0.6 + t * 1.4).toFixed(2)})`;
        }
      }
      const shownSpeed = Math.max(drive.kmh, sweep.current.kmh);
      const rot = `rotate(${(-125 + (shownSpeed / MAX_KMH) * 250).toFixed(1)}deg)`;
      if (needle.current && rot !== shownNeedle) { shownNeedle = rot; needle.current.style.transform = rot; }
      const rounded = Math.round(shownSpeed);
      if (kmh.current && rounded !== shownKmh) { shownKmh = rounded; kmh.current.textContent = String(rounded).padStart(3, "0"); }
    });
    return () => { stop(); visible.stop(); };
  }, []);

  const search = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const query = new URLSearchParams();
    const location = String(form.get("location") ?? "").trim();
    if (location) query.set("location", location);
    if (start) query.set("start_date", start);
    if (end) query.set("end_date", end);
    if (type) query.set("type", type);
    navigate(`/vehicles?${query}`, { viewTransition: true });
  };

  return (
    <section className="od-hero" ref={section} data-chapter="Highway 1 · Start">
      <div className={booting ? "od-spinner" : "od-spinner out"} role="status" aria-live="polite">
        <span className="od-spinner-gauge" aria-hidden="true"><i /></span>
        <span className="od-spinner-text"><span className="od-spinner-label">Starting engine</span>
          <span className="od-spinner-lane" aria-hidden="true"><i /></span></span>
      </div>
      <div className="od-hero-stage">
        <div className="od-hero-scene">
          {/* A still of this very scene (captured from the 3D road, day or night) sits underneath: it is what shows
              before WebGL has drawn, while the 3D chunk loads, and on devices that keep the road still. The canvas is
              transparent until its first frame and then covers it, so the hand-over moves nothing. */}
          <div className="od-hero-poster" aria-hidden="true" />
          {use3D && load3D && (
            <Suspense fallback={null}>
              <Road3D light={theme === "light"} active={onScreen} places={places} />
            </Suspense>
          )}
          <div className="od-streaks" ref={streaks} aria-hidden="true"><span className="od-streaks-sheet" ref={sheet} /></div>
        </div>
        <div className="od-hero-copy">
          <h1 ref={headline} tabIndex={-1}>Your next <br />stretch <br />of <em>road.</em></h1>
          <p>Cars and bikes from local owners across Tamil Nadu. Pick your dates, see what is free, take the keys.</p>
          <p className="od-cue"><span className="od-cue-wheel" aria-hidden="true" /> Scroll to drive</p>
        </div>
        <form className="od-dash" onSubmit={search} aria-label="Find a vehicle">
          <div className="od-speedo" aria-hidden="true">
            <svg viewBox="-60 -60 120 120">
              <path className="arc" d="M-42 30 A52 52 0 1 1 42 30" />
              <path className="arc-red" d="M33 -40 A52 52 0 0 1 49 18" />
              {Array.from({ length: 9 }, (_, i) => {
                const a = (-125 + i * 31.25) * Math.PI / 180;
                return <line key={i} className="tick" x1={Math.sin(a) * 44} y1={-Math.cos(a) * 44} x2={Math.sin(a) * 52} y2={-Math.cos(a) * 52} />;
              })}
              <line ref={needle} className="needle" x1="0" y1="6" x2="0" y2="-46" />
              <circle r="6" className="hub" />
            </svg>
            <span className="od-speedo-read mono"><span ref={kmh}>{String(IDLE_KMH).padStart(3, "0")}</span><small>km/h</small></span>
          </div>
          <div className="od-count" aria-live="polite">
            <small>{datesReady ? "Free for your dates" : "On the road now"}</small>
            <Odometer value={count} label={plural(available.data?.count ?? 0, "vehicle")} />
          </div>
          <div className="od-cluster">
            <label className="od-field"><small>Location</small><input name="location" placeholder="Any town" autoComplete="off" /></label>
            <label className="od-field"><small>Pickup</small><input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
            <label className="od-field"><small>Return</small><input type="date" value={end} min={start || undefined} onChange={e => setEnd(e.target.value)} /></label>
            <div className="od-field"><small id="od-type">Type</small>
              <div className="od-seg" role="group" aria-labelledby="od-type">
                {[["", "All"], ["Car", "Cars"], ["Bike", "Bikes"]].map(([value, label]) => (
                  <button type="button" key={value} aria-pressed={type === value} onClick={() => setType(value)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="od-field od-trip"><small>Trip meter</small><TripMeter digits={5} /></div>
            <button className="od-go">Search rides</button>
          </div>
        </form>
      </div>
    </section>
  );
}

/** The 2D road, with a static roadside so it is never empty. */
function Rack() {
  const [category, setCategory] = useState("");
  // The six newest listings of the chosen category, straight from the API's "newest" sort.
  const filter = new URLSearchParams({ sort: "newest", ...(category ? { type: category } : {}) }).toString();
  const query = useQuery({ queryKey: ["vehicles", filter], queryFn: () => api<Catalog>(`vehicles/?${filter}`), placeholderData: keepPreviousData });
  const rows = (query.data?.results ?? []).slice(0, 6);
  const rack = useRef<HTMLDivElement>(null);
  const [arrived, setArrived] = useState(false);
  // Mouse drag along the lane with a little inertia (touch and trackpads scroll it natively).
  const drag = useRef<{ x: number; left: number; v: number; t: number; raf: number } | null>(null);
  const onDown = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || !rack.current) return;
    cancelAnimationFrame(drag.current?.raf ?? 0);
    drag.current = { x: event.clientX, left: rack.current.scrollLeft, v: 0, t: performance.now(), raf: 0 };
  };
  const onMove = (event: React.PointerEvent) => {
    const d = drag.current, lane = rack.current;
    if (!d || !lane || !event.buttons) return;
    const now = performance.now(), next = d.left - (event.clientX - d.x);
    d.v = (lane.scrollLeft - next) / Math.max(1, now - d.t); d.t = now;
    lane.scrollLeft = next;
    if (Math.abs(event.clientX - d.x) > 4) lane.classList.add("dragging");
  };
  const onUp = () => {
    const d = drag.current, lane = rack.current;
    if (!d || !lane) return;
    let v = -d.v * 16;
    const coast = () => { lane.scrollLeft += v; v *= 0.92; if (Math.abs(v) > 0.4 && !reducedMotion()) d.raf = requestAnimationFrame(coast); else lane.classList.remove("dragging"); };
    d.raf = requestAnimationFrame(coast);
    drag.current = null;
    window.setTimeout(() => lane.classList.remove("dragging"), 0);
  };
  const section = useOnce<HTMLElement>(() => setArrived(true), "top 72%");
  // When the rack scrolls in, the tags fall onto their hooks and swing until they settle (one damped swing each).
  useLayoutEffect(() => {
    if (!arrived || !rack.current || !rows.length) return;
    const tags = rack.current.querySelectorAll(".od-drop");
    if (reducedMotion()) { gsap.set(tags, { opacity: 1, y: 0, rotation: 0 }); return; }
    const ctx = gsap.context(() => {
      gsap.fromTo(tags, { y: -320, opacity: 0, rotation: (i: number) => (i % 2 ? 14 : -14) },
        { y: 0, opacity: 1, duration: 0.5, ease: "power3.in", stagger: 0.08 });
      gsap.to(tags, { rotation: 0, duration: 1.6, ease: "elastic.out(1.1, 0.3)", stagger: 0.08, delay: 0.45 });
    }, rack);
    return () => ctx.revert();
  }, [arrived, rows.length, category]);
  return (
    <section className="od-rack" ref={section} data-chapter="Exit 2 · The rack">
      <div className="od-lane-head">
        <div>
          <span className="od-eyebrow">Newest on the rack</span>
          <h2>{query.data ? <><Odometer value={String(query.data.count).padStart(2, "0")} size="md" /> rides, one key each</> : "Rides, one key each"}</h2>
        </div>
        <div className="od-seg od-seg-lg" role="group" aria-label="Vehicle category">
          {[["", "All rides"], ["Car", "Cars"], ["Bike", "Bikes"]].map(([value, label]) => (
            <button type="button" key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="od-rack-bar" aria-hidden="true" />
      <Notice error={query.error} />
      <div className="od-tags od-lane" ref={rack} tabIndex={0} role="region" aria-label="Newest rides, scroll sideways" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
        onClickCapture={event => { if (rack.current?.classList.contains("dragging")) { event.preventDefault(); event.stopPropagation(); } }}>
        {query.isPending && Array.from({ length: 6 }, (_, i) => <KeyTagSkeleton key={i} />)}
        {rows.map((vehicle, index) => (
          <div className="od-drop" key={vehicle.id} style={{ opacity: arrived || reducedMotion() ? undefined : 0 }}>
            <KeyTag vehicle={vehicle} index={index} />
          </div>
        ))}
      </div>
      {query.data && !rows.length && <p className="od-empty-line">New listings are on their way.</p>}
      <Link className="od-cta od-cta-ghost" to={category ? `/vehicles?type=${category}` : "/vehicles"} viewTransition>See every ride</Link>
    </section>
  );
}

// ----- How a rental drives --------------------------------------------------------------------------------------

const HOW = [
  { title: "Pick your dates", text: "Choose pickup and return; the price and deposit add up before you send anything.", icon: "clock" },
  { title: "Owner approves", text: "The owner confirms within 24 hours. You pay the rental and a refundable deposit.", icon: "stamp" },
  { title: "Take the keys", text: "Pickup opens an hour before your slot, and the owner hands over the keys.", icon: "key" },
  { title: "Return", text: "Bring it back on time and the deposit comes back to you automatically.", icon: "flag" },
];

function HowItWorks() {
  const road = useRef<SVGPathElement>(null), reveal = useRef<SVGPathElement>(null), lane = useRef<SVGPathElement>(null);
  const car = useRef<SVGGElement>(null), stops = useRef<(HTMLLIElement | null)[]>([]), pins = useRef<(SVGGElement | null)[]>([]);
  // Scroll draws the dashed centre line (scrubbed, so scrolling back retracts it) and drives a car along it, turned
  // to the road. Each stop wakes its step when the car reaches it. The dashes flow at the hero's speed.
  useLayoutEffect(() => {
    const path = road.current!, length = path.getTotalLength();
    const lengthAtX = (x: number) => {
      let lo = 0, hi = length;
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (path.getPointAtLength(mid).x < x) lo = mid; else hi = mid; }
      return lo;
    };
    const marks = [150, 450, 750, 1050].map(x => lengthAtX(x) / length);
    marks.forEach((mark, i) => {
      const p = path.getPointAtLength(mark * length);
      pins.current[i]?.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
    });
    reveal.current!.style.strokeDasharray = `${length} ${length}`;
    const place = (progress: number) => {
      reveal.current!.style.strokeDashoffset = String(length * (1 - progress));
      const at = Math.max(0.5, length * progress), p = path.getPointAtLength(at);
      const ahead = path.getPointAtLength(Math.min(length, at + 2)), behind = path.getPointAtLength(Math.max(0, at - 2));
      const angle = Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180 / Math.PI;
      car.current?.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${angle.toFixed(1)})`);
      marks.forEach((mark, i) => {
        const on = progress >= mark - 0.005;
        stops.current[i]?.classList.toggle("on", on);
        pins.current[i]?.classList.toggle("on", on);
      });
    };
    if (reducedMotion()) { place(1); return; }
    place(0);
    const trigger = ScrollTrigger.create({ trigger: path.ownerSVGElement, start: "center 85%", end: "center 30%", scrub: 0.6,
      onUpdate: self => place(self.progress) });
    let flow = 0;
    const visible = watchScreen(path.ownerSVGElement);
    const stopFlow = onDrive(dt => {
      if (!visible.flag.on) return;
      flow = (flow - (drive.kmh / MAX_KMH) * 240 * dt) % 40;
      if (lane.current) lane.current.style.strokeDashoffset = flow.toFixed(1);
    });
    return () => { trigger.kill(); stopFlow(); visible.stop(); };
  }, []);
  const d = "M20 200 C 220 200, 260 60, 460 60 S 700 200, 900 190 S 1120 70, 1180 70";
  return (
    <section className="od-how" data-chapter="Junction 3 · How it works">
      <span className="od-eyebrow">Less planning, more going</span>
      <h2>How a rental <em>drives</em></h2>
      <div className="od-how-road">
        <svg viewBox="0 0 1200 260" aria-hidden="true">
          <defs>
            <mask id="od-how-reveal" maskUnits="userSpaceOnUse" x="0" y="0" width="1200" height="260">
              <path ref={reveal} d={d} fill="none" stroke="#fff" strokeWidth="20" />
            </mask>
          </defs>
          <path ref={road} className="od-how-asphalt" d={d} />
          <path className="od-how-ghost" d={d} />
          <path ref={lane} className="od-how-lane" d={d} mask="url(#od-how-reveal)" />
          {[0, 1, 2, 3].map(i => (
            <g key={i} ref={el => { pins.current[i] = el; }} className={`od-how-pin${i === 3 ? " finish" : ""}`}>
              <circle r="13" /><circle r="5" className="core" />
            </g>
          ))}
          <g ref={car} className="od-how-vehicle">
            <rect x="-17" y="-9" width="34" height="18" rx="6" className="body" />
            <rect x="2" y="-7" width="9" height="14" rx="2" className="glass" />
            <rect x="-13" y="-7" width="6" height="14" rx="2" className="glass" />
          </g>
        </svg>
        <ol className="od-how-stops">
          {HOW.map((stop, i) => (
            <li key={stop.title} ref={el => { stops.current[i] = el; }} className="od-how-stop">
              <StopIcon kind={stop.icon} />
              <b>{stop.title}</b>
              <p>{stop.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function StopIcon({ kind }: { kind: string }) {
  const icons: Record<string, ReactNode> = {
    clock: <><circle cx="24" cy="24" r="18" className="ring" /><line x1="24" y1="24" x2="24" y2="12" className="hand hand-long" /><line x1="24" y1="24" x2="32" y2="24" className="hand hand-short" /></>,
    stamp: <><rect x="8" y="10" width="32" height="28" rx="3" className="ring" /><path d="M15 25 l6 6 l12 -14" className="check" /></>,
    key: <g className="key"><circle cx="16" cy="18" r="8" className="ring" /><path d="M22 23 L38 39 M32 33 l4 -4 M28 29 l3 -3" className="ring" /></g>,
    flag: <><line x1="12" y1="8" x2="12" y2="42" className="ring" /><path d="M12 9 C 22 5, 28 15, 38 10 L38 26 C 28 31, 22 21, 12 25 Z" className="flag" /></>,
  };
  return <svg className="od-stop-icon" viewBox="0 0 48 48" aria-hidden="true">{icons[kind]}</svg>;
}

function HostCallout() {
  return (
    <section className="od-host-callout" data-chapter="Rest stop · Become a host">
      <div>
        <span className="od-eyebrow">Your vehicle, new possibilities</span>
        <h2>Let your vehicle go places.</h2>
        <p>Put a parked car or bike to work. You set the price, the deposit and which requests to accept.</p>
      </div>
      <Link className="od-cta" to="/owner/fleet?edit=new">Become a host</Link>
    </section>
  );
}
