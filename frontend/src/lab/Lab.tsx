// /app/lab: a live prototype of the "Odometer" design direction (docs/design-direction.md).
// Not linked from the app; reads real catalog data and changes nothing.
//
// Motion architecture (one system, no competing loops):
//   Lenis scrolls -> drives GSAP ScrollTrigger and gsap.ticker -> `drive` (throttle, km/h, km) ->
//   the 3D road, speedometer, HUD, headline stretch, streaks and backdrop all read the same numbers.
// Only transform and opacity change per frame. prefers-reduced-motion turns all of it off and shows
// final states.
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { Vehicle } from "../api";
import { drive, gsap, IDLE_KMH, MAX_KMH, onDrive, ScrollTrigger, startDrive, stopDrive } from "./drive";
import "./lab.css";
import "./lab-v2.css";

const Road3D = lazy(() => import("./Road3D"));

type Theme = "dark" | "light";
const FONTS = "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=JetBrains+Mono:wght@500;700&family=Public+Sans:wght@400;600&display=swap";
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** The 3D road only where it will run smoothly; everyone else gets the 2D road. */
const canRun3D = () => {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  return !reducedMotion() && (navigator.hardwareConcurrency ?? 8) > 4 && !nav.connection?.saveData
    && !!document.createElement("canvas").getContext("webgl2");
};

/** True while scrolling (and briefly after), so hover effects don't fire when content slides under a still cursor. */
const scrolling = { active: false, timer: 0 };
if (typeof window !== "undefined") {
  window.addEventListener("scroll", () => {
    scrolling.active = true;
    window.clearTimeout(scrolling.timer);
    scrolling.timer = window.setTimeout(() => { scrolling.active = false; }, 180);
  }, { passive: true });
}

export default function Lab() {
  const [theme, setTheme] = useState<Theme>(() => (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: FONTS });
    document.head.appendChild(link);
    document.title = "Motorlane · Odometer concept";
    startDrive();
    return () => { stopDrive(); link.remove(); };
  }, []);
  // Each chapter announces itself to the HUD's GPS readout as it scrolls into the middle of the screen.
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>("[data-chapter]").forEach(section => {
        ScrollTrigger.create({ trigger: section, start: "top 55%", end: "bottom 55%",
          onToggle: self => { if (self.isActive) drive.chapter = section.dataset.chapter ?? ""; } });
      });
    }, root);
    // Catalog data and images arrive after first layout and push later sections down; re-measure every trigger
    // whenever the page height changes so scrubbed animations start where they should (not already finished).
    let timer = 0, lastHeight = 0;
    const observer = new ResizeObserver(entries => {
      const height = Math.round(entries[0].contentRect.height);
      if (height === lastHeight) return;
      lastHeight = height;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => ScrollTrigger.refresh(), 120);
    });
    if (root.current) observer.observe(root.current);
    return () => { observer.disconnect(); window.clearTimeout(timer); ctx.revert(); };
  }, []);
  return (
    <div className="lab" data-theme={theme} ref={root}>
      <Backdrop />
      <header className="lab-bar">
        <Mark />
        <span className="lab-note">Design concept · not the live site · scroll to drive</span>
        <button className="lab-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
          {theme === "dark" ? "Daytime" : "Night"}
        </button>
      </header>
      <main className="lab-main">
        <Hero light={theme === "light"} />
        <Catalog />
        <HowItWorks />
        <Trip />
        <Finish />
      </main>
      <Hud />
    </div>
  );
}

function Mark() {
  return (
    <span className="lab-mark">
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <path className="lab-mark-m" d="M6 34 L6 6 L20 22 L34 6 L34 34" />
        <path className="lab-mark-lane" d="M20 25 V34" />
      </svg>
      MOTORLANE
    </span>
  );
}

// ----- Shared bits ----------------------------------------------------------------------------

/** Odometer: each digit is a column of 0-9 that rolls to the target digit (driven by React value changes). */
function Odometer({ value, size = "lg" }: { value: string; size?: "lg" | "md" }) {
  return (
    <span className={`odo odo-${size}`} aria-label={value} role="img">
      {value.split("").map((char, index) => /\d/.test(char) ? (
        <span className="odo-wheel" key={index} aria-hidden="true">
          <span className="odo-strip" style={{ "--digit": Number(char) } as CSSProperties}>
            {"0123456789".split("").map(d => <span key={d}>{d}</span>)}
          </span>
        </span>
      ) : <span className="odo-sep" key={index} aria-hidden="true">{char}</span>)}
    </span>
  );
}

/** A trip-meter odometer driven every frame from `drive.km`: the last wheel turns continuously, like the real thing. */
function TripMeter({ digits = 5, className = "" }: { digits?: number; className?: string }) {
  const strips = useRef<(HTMLSpanElement | null)[]>([]);
  const last = useRef<number[]>([]);
  // Wheels sit exactly on a digit at rest. Only the tenths wheel rolls, in the last fifth of each tenth, and a
  // wheel to its left rolls only while every wheel to its right goes 9 -> 0 (a real odometer's carry). Offsets are
  // whole device pixels of a wheel height chosen so 100/125/150% scaling all land on pixel boundaries.
  useEffect(() => onDrive(() => {
    const tenths = drive.km * 10;
    const dpr = window.devicePixelRatio || 1;
    let carry = 0;
    for (let i = digits - 1; i >= 0; i--) {
      const strip = strips.current[i];
      const height = strip?.parentElement?.clientHeight ?? 0;
      const digit = Math.floor(tenths / 10 ** (digits - 1 - i)) % 10;
      let roll: number;
      if (i === digits - 1) {
        const t = Math.min(1, Math.max(0, ((tenths % 1) - 0.8) / 0.2));
        roll = t * t * (3 - 2 * t);
      } else roll = carry;
      carry = digit === 9 ? roll : 0;
      const y = -Math.round((digit + roll) * height * dpr) / dpr;
      if (strip && height && last.current[i] !== y) { last.current[i] = y; strip.style.transform = `translate3d(0, ${y}px, 0)`; }
    }
  }), [digits]);
  return (
    <span className={`tripmeter ${className}`} aria-hidden="true">
      {Array.from({ length: digits }, (_, i) => (
        <span className={`tripmeter-wheel${i === digits - 1 ? " tenths" : ""}`} key={i}>
          <span className="tripmeter-strip" ref={el => { strips.current[i] = el; }}>
            {"01234567890".split("").map((d, k) => <span key={k}>{d}</span>)}
          </span>
        </span>
      ))}
    </span>
  );
}

function useVehicles(type: string) {
  return useQuery({
    queryKey: ["lab-vehicles", type],
    queryFn: () => api<{ count: number; results: Vehicle[] }>(`vehicles/?${new URLSearchParams(type ? { type } : {})}`),
  });
}

/** Run once when the element first comes into view. */
function useOnce<T extends Element>(onEnter: () => void, start = "top 75%") {
  const ref = useRef<T>(null);
  const callback = useRef(onEnter);
  useEffect(() => { callback.current = onEnter; });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const trigger = ScrollTrigger.create({ trigger: ref.current, start, once: true, onEnter: () => callback.current() });
    return () => trigger.kill();
  }, [start]);
  return ref;
}

// ----- Backdrop and HUD -----------------------------------------------------------------------

/** The page's "world": tarmac grain, margin lane markings and kerb hatching at two depths, road signs and
 *  kilometre posts in the far layer, and a headlight sweep when you accelerate hard. Fixed behind content. */
function Backdrop() {
  const near = useRef<HTMLDivElement>(null), far = useRef<HTMLDivElement>(null), sweep = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reducedMotion()) return;
    let sweeping = false;
    return onDrive(() => {
      const travelled = drive.km * 9000;  // the margins scroll with distance driven, not just page position
      if (near.current) near.current.style.transform = `translate3d(0, ${(-(travelled % 160)).toFixed(1)}px, 0)`;
      if (far.current) far.current.style.transform = `translate3d(0, ${(-((travelled * 0.35) % 1400)).toFixed(1)}px, 0)`;
      if (!sweeping && drive.throttle > 0.55 && sweep.current) {
        sweeping = true;
        gsap.fromTo(sweep.current, { xPercent: -60, opacity: 0 }, {
          xPercent: 160, opacity: 1, duration: 1.1, ease: "power2.inOut",
          onComplete: () => { gsap.set(sweep.current, { opacity: 0 }); window.setTimeout(() => { sweeping = false; }, 1600); },
        });
      }
    });
  }, []);
  return (
    <div className="lab-backdrop" aria-hidden="true">
      <div className="lab-grain" />
      <div className="lab-far" ref={far}>
        {Array.from({ length: 8 }, (_, i) => (
          <div className={`lab-far-item ${i % 2 ? "right" : "left"}`} key={i} style={{ top: `${i * 175 + 60}px` }}>
            {i % 3 === 0 ? <span className="lab-kmpost mono">{120 + i * 4}<small>km</small></span>
              : i % 3 === 1 ? <span className="lab-sign lab-sign-curve" /> : <span className="lab-sign lab-sign-speed mono">60</span>}
          </div>
        ))}
      </div>
      <div className="lab-near" ref={near}>
        <span className="lab-margin-lane left" /><span className="lab-margin-lane right" />
        <span className="lab-kerb left" /><span className="lab-kerb right" />
      </div>
      <div className="lab-sweep" ref={sweep} />
    </div>
  );
}

/** A fixed GPS-style strip: current chapter, speed with a needle, and the trip meter. */
function Hud() {
  const chapter = useRef<HTMLSpanElement>(null), speed = useRef<HTMLSpanElement>(null), needle = useRef<SVGLineElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  // The hero has its own speedometer and trip meter, so the HUD stays out of the way there and slides in once the
  // hero has mostly scrolled away.
  useLayoutEffect(() => {
    const trigger = ScrollTrigger.create({ trigger: ".lab-hero", start: "top top", end: "bottom 55%",
      onToggle: self => hud.current?.classList.toggle("away", self.isActive) });
    hud.current?.classList.toggle("away", window.scrollY < trigger.end);
    return () => trigger.kill();
  }, []);
  useEffect(() => {
    let shown = "", shownSpeed = -1;
    return onDrive(() => {
      if (chapter.current && shown !== drive.chapter) { shown = drive.chapter; chapter.current.textContent = shown; }
      const rounded = Math.round(drive.kmh);
      if (speed.current && rounded !== shownSpeed) { shownSpeed = rounded; speed.current.textContent = String(rounded).padStart(3, "0"); }
      if (needle.current) needle.current.style.transform = `rotate(${(-120 + (drive.kmh / MAX_KMH) * 240).toFixed(1)}deg)`;
    });
  }, []);
  return (
    <div className="lab-hud away" ref={hud} role="status" aria-label="Trip readout">
      <span className="lab-hud-pin" aria-hidden="true" />
      <span className="lab-hud-chapter" ref={chapter}>Start</span>
      <span className="lab-hud-gauge" aria-hidden="true">
        <svg viewBox="-20 -20 40 40"><path d="M-14 8 A16 16 0 1 1 14 8" className="arc" /><line ref={needle} x1="0" y1="0" x2="0" y2="-13" className="needle" /></svg>
      </span>
      <span className="lab-hud-speed mono"><span ref={speed}>000</span> km/h</span>
      <span className="lab-hud-odo"><TripMeter digits={5} /> <small>km</small></span>
    </div>
  );
}

// ----- Chapter 1: the hero drives ---------------------------------------------------------------

function Hero({ light }: { light: boolean }) {
  const [type, setType] = useState("");
  const vehicles = useVehicles(type);
  const count = String(vehicles.data?.count ?? 0).padStart(3, "0");
  const section = useRef<HTMLElement>(null), headline = useRef<HTMLHeadingElement>(null);
  const streaks = useRef<HTMLDivElement>(null), needle = useRef<SVGLineElement>(null), kmh = useRef<HTMLSpanElement>(null);
  const flatDashes = useRef<HTMLSpanElement>(null), sheet = useRef<HTMLSpanElement>(null);
  const [use3D] = useState(canRun3D);
  // Milestones name real cities from the catalog (falling back to Tamil Nadu cities while it loads).
  const everything = useVehicles("");
  const placeKey = [...new Set((everything.data?.results ?? []).map(v => v.location?.split(",")[0].trim()).filter(Boolean))].join("|")
    || "Madurai|Coimbatore|Tiruchirappalli|Salem|Chennai";
  const places = useMemo(() => placeKey.split("|"), [placeKey]);
  const [onScreen, setOnScreen] = useState(true);

  // The hero is a sticky stage inside a taller section (CSS position: sticky, so no pin spacer and no layout
  // shift): you "drive" through about one screen of scroll before the catalog arrives. The 3D road only renders
  // while the section is on screen.
  useLayoutEffect(() => {
    if (reducedMotion()) return;
    const visibility = ScrollTrigger.create({ trigger: section.current, start: "top bottom", end: "bottom top",
      onToggle: self => setOnScreen(self.isActive) });
    return () => visibility.kill();
  }, []);

  // Per frame, from the shared drive state: headline stretch, streaks, speedometer, 2D road fallback.
  useEffect(() => {
    let distance = 0, streakY = 0, streaksOn = true, shownKmh = -1;
    return onDrive(dt => {
      const t = drive.throttle;
      if (headline.current) headline.current.style.transform =
        `scaleX(${(1 + t * 0.22).toFixed(3)}) skewX(${(-t * 9).toFixed(2)}deg)`;
      // One sheet of streaks, moved by transform only, and switched off entirely below a crawl (no idle cost).
      if (streaks.current && sheet.current) {
        const on = t > 0.04;
        if (on !== streaksOn) { streaksOn = on; streaks.current.style.visibility = on ? "visible" : "hidden"; }
        if (on) {
          streakY = (streakY + (900 + t * 2600) * dt) % 540;
          streaks.current.style.opacity = (t * 0.9).toFixed(2);
          sheet.current.style.transform = `translate3d(0, ${(streakY - 540).toFixed(0)}px, 0) scaleY(${(0.6 + t * 1.4).toFixed(2)})`;
        }
      }
      if (needle.current) needle.current.style.transform = `rotate(${(-125 + (drive.kmh / MAX_KMH) * 250).toFixed(1)}deg)`;
      const rounded = Math.round(drive.kmh);  // text changes only when the number does (no per-frame layout)
      if (kmh.current && rounded !== shownKmh) { shownKmh = rounded; kmh.current.textContent = String(rounded).padStart(3, "0"); }
      if (flatDashes.current) {
        distance = (distance + (40 + t * 1400) * dt) % 82;
        flatDashes.current.style.transform = `translate3d(0, ${(distance - 82).toFixed(1)}px, 0) scaleY(${(1 + t * 2.5).toFixed(2)})`;
      }
    });
  }, []);

  return (
    <section className="lab-hero" ref={section} data-chapter="Highway 1 · Start">
      <div className="lab-hero-stage">
      <div className="lab-hero-scene">
        {use3D ? (
          <Suspense fallback={<FlatRoad dashes={flatDashes} />}>
            <Road3D light={light} active={onScreen} places={places} />
          </Suspense>
        ) : <FlatRoad dashes={flatDashes} />}
        <div className="lab-streaks" ref={streaks} aria-hidden="true">
          <span className="lab-streaks-sheet" ref={sheet} />
        </div>
      </div>
      <div className="lab-hero-copy">
        <h1 ref={headline}>Your next <br />stretch <br />of <em>road.</em></h1>
        <p>Cars and bikes from local owners across Tamil Nadu. Pick a time, watch the price, take the keys.</p>
        <p className="lab-cue"><span className="lab-cue-wheel" aria-hidden="true" /> Scroll to drive</p>
      </div>
      <div className="lab-dash">
        <div className="lab-speedo" aria-hidden="true">
          <svg viewBox="-60 -60 120 120">
            <path className="arc" d="M-42 30 A52 52 0 1 1 42 30" />
            <path className="arc-red" d="M33 -40 A52 52 0 0 1 49 18" />
            {Array.from({ length: 9 }, (_, i) => {
              const angle = (-125 + i * 31.25) * Math.PI / 180;
              return <line key={i} className="tick" x1={Math.sin(angle) * 44} y1={-Math.cos(angle) * 44} x2={Math.sin(angle) * 52} y2={-Math.cos(angle) * 52} />;
            })}
            <line ref={needle} className="needle" x1="0" y1="6" x2="0" y2="-46" />
            <circle r="6" className="hub" />
          </svg>
          <span className="lab-speedo-read mono"><span ref={kmh}>{String(IDLE_KMH).padStart(3, "0")}</span><small>km/h</small></span>
        </div>
        <div className="lab-counter"><small>Free right now</small><Odometer value={count} /></div>
        <div className="lab-cluster">
          <div><small>Type</small>
            <div className="lab-seg" role="group" aria-label="Vehicle type">
              {[["", "All"], ["Car", "Cars"], ["Bike", "Bikes"]].map(([value, label]) => (
                <button key={value} aria-pressed={type === value} onClick={() => setType(value)}>{label}</button>
              ))}
            </div>
          </div>
          <div><small>Trip meter</small><TripMeter digits={5} className="lab-cluster-trip" /></div>
          <button className="lab-go">Search</button>
        </div>
      </div>
      </div>
    </section>
  );
}

/** The 2D road (reduced motion, low-end devices, while the 3D road loads), with a static roadside: the ridge and a
 *  gopuram on the horizon, palms and milestones along the verge. */
function FlatRoad({ dashes }: { dashes: React.RefObject<HTMLSpanElement | null> }) {
  const palm = (x: number, y: number, s: number, flip = 1) => (
    <g transform={`translate(${x} ${y}) scale(${s * flip} ${s})`} className="lab-flat-palm">
      <path d="M0 0 C 4 -40, 10 -80, 6 -120" className="trunk" />
      <path d="M6 -120 c -20 -10 -40 -4 -54 12 c 18 -14 36 -14 54 -12 z M6 -120 c 20 -12 42 -6 56 10 c -18 -12 -38 -12 -56 -10 z
        M6 -120 c -10 -18 -30 -26 -44 -24 c 16 2 32 10 44 24 z M6 -120 c 12 -18 32 -24 46 -20 c -16 2 -34 8 -46 20 z
        M6 -120 c 0 -16 8 -30 18 -36 c -8 10 -14 22 -18 36 z" className="leaf" />
    </g>
  );
  return (
    <div className="lab-flatroad">
      <svg className="lab-flat-scenery" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <path className="far" d="M0 240 C 120 190, 200 210, 300 196 S 480 170, 560 200 S 760 180, 860 206 S 960 196, 1000 210 V 260 H 0 Z" />
        <path className="temple" d="M640 214 V 176 h3 v-6 h3 v-6 h3 v-6 h3 v-6 h3 v-6 c 2 -6 10 -6 12 0 v6 h3 v6 h3 v6 h3 v6 h3 v6 h3 v38 Z" />
        <rect className="field" x="0" y="258" width="1000" height="442" />
        {Array.from({ length: 9 }, (_, i) => <rect key={i} className="row" x="0" y={270 + i * i * 6} width="1000" height={2 + i} />)}
        {palm(90, 520, 1.5)}{palm(200, 380, 0.9, -1)}{palm(830, 560, 1.7, -1)}{palm(930, 420, 1.1)}
        <g className="stone" transform="translate(760 470)"><rect width="26" height="34" rx="2" /><path d="M0 12 V 10 a13 13 0 0 1 26 0 v2 z" className="cap" /></g>
      </svg>
      <div className="lab-road-surface"><span className="lab-road-dashes" ref={dashes} /></div>
    </div>
  );
}

// ----- Chapter 2: key tags drop onto the rack ---------------------------------------------------

function Catalog() {
  const vehicles = useVehicles("");
  const rows = vehicles.data?.results.slice(0, 6) ?? [];
  const rack = useRef<HTMLDivElement>(null);
  const [dropped, setDropped] = useState(false);
  const section = useOnce<HTMLElement>(() => setDropped(true), "top 70%");
  // When the rack scrolls in, the tags fall onto their hooks and swing until they settle (one damped swing each).
  useLayoutEffect(() => {
    if (!dropped || !rack.current || !rows.length) return;
    const tags = rack.current.querySelectorAll(".lab-drop");
    if (reducedMotion()) { gsap.set(tags, { opacity: 1, y: 0, rotation: 0 }); return; }
    const ctx = gsap.context(() => {
      gsap.fromTo(tags, { y: -360, opacity: 0, rotation: (i: number) => (i % 2 ? 16 : -16) },
        { y: 0, opacity: 1, duration: 0.55, ease: "power3.in", stagger: 0.09 });
      gsap.to(tags, { rotation: 0, duration: 1.8, ease: "elastic.out(1.1, 0.28)", stagger: 0.09, delay: 0.5 });
    }, rack);
    return () => ctx.revert();
  }, [dropped, rows.length]);
  return (
    <section className="lab-catalog" ref={section} data-chapter="Exit 2 · The rack">
      <div className="lab-lane-head">
        <h2>{vehicles.data ? <><Odometer value={String(vehicles.data.count).padStart(2, "0")} size="md" /> on the road</> : "On the road"}</h2>
        <p className="lab-hint">Real listings from this catalog. They drop onto the rack as you arrive; hover one to swing it.</p>
      </div>
      <div className="lab-rack-bar" aria-hidden="true" />
      <div className="lab-tags" ref={rack}>
        {rows.map((vehicle, index) => (
          <div className="lab-drop" key={vehicle.id} style={{ opacity: dropped || reducedMotion() ? undefined : 0 }}>
            <KeyTag vehicle={vehicle} index={index} />
          </div>
        ))}
      </div>
    </section>
  );
}

function KeyTag({ vehicle, index }: { vehicle: Vehicle; index: number }) {
  const ref = useRef<HTMLElement>(null);
  const armed = useRef(true);
  // Swings when a person moves the pointer onto it (never because the page scrolled under the cursor).
  const tilt = (event: ReactPointerEvent) => {
    const tag = ref.current!;
    if (event.pointerType !== "mouse" || scrolling.active) return;
    if (armed.current && !reducedMotion()) {
      armed.current = false;
      tag.classList.remove("swinging");
      void tag.offsetWidth;
      tag.classList.add("swinging");
    }
    const box = tag.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5, y = (event.clientY - box.top) / box.height - 0.5;
    tag.style.setProperty("--tx", `${(y * -5).toFixed(2)}deg`);
    tag.style.setProperty("--ty", `${(x * 7).toFixed(2)}deg`);
    tag.classList.add("lifted");
  };
  const reset = () => {
    const tag = ref.current!;
    armed.current = true;
    tag.classList.remove("lifted");
    tag.style.setProperty("--tx", "0deg");
    tag.style.setProperty("--ty", "0deg");
  };
  const cover = vehicle.cover;
  return (
    <article className="lab-tag" ref={ref} onPointerMove={tilt} onPointerLeave={reset}
      onAnimationEnd={event => event.currentTarget.classList.remove("swinging")}
      style={{ "--hang": `${[-1.4, 0.6, 1.2, -0.8, 1.6, -1.1][index % 6]}deg` } as CSSProperties}>
      <span className="lab-tag-hole" aria-hidden="true" />
      {cover ? <img src={cover.small} srcSet={`${cover.small} 400w, ${cover.large} 1200w`} sizes="(max-width: 700px) 100vw, 400px"
        width={cover.width ?? undefined} height={cover.height ?? undefined} style={{ backgroundColor: cover.color ?? undefined }}
        alt={vehicle.name} loading="lazy" decoding="async" /> : <div className="lab-tag-noimg" />}
      <span className="lab-plate mono">ML·{String(vehicle.id).padStart(4, "0")}</span>
      <h3>{vehicle.name}</h3>
      <p className="lab-meta">{[vehicle.location, vehicle.transmission, vehicle.seats ? `${vehicle.seats} seats` : null].filter(Boolean).join(" · ")}</p>
      <div className="lab-tag-price">
        <span className="mono">₹{Number(vehicle.price_per_day).toLocaleString("en-IN")}</span>
        <small>per day{vehicle.rating ? ` · ★ ${vehicle.rating.toFixed(1)}` : ""}</small>
      </div>
    </article>
  );
}

// ----- Chapter 3: how it works, a road you draw by scrolling ------------------------------------

const HOW = [
  { title: "Pick a time", text: "Choose pickup and return on the time road; the price rolls as you drag.", icon: "clock" },
  { title: "Owner approves", text: "The owner confirms within 24 hours. You pay the rental and a refundable deposit.", icon: "stamp" },
  { title: "Take the keys", text: "Pickup opens an hour before your slot. The owner hands over the keys.", icon: "key" },
  { title: "Return", text: "Bring it back on time; the deposit comes back to you automatically.", icon: "flag" },
];

function HowItWorks() {
  const section = useRef<HTMLElement>(null), road = useRef<SVGPathElement>(null), reveal = useRef<SVGPathElement>(null);
  const lane = useRef<SVGPathElement>(null), car = useRef<SVGGElement>(null);
  const stops = useRef<(HTMLLIElement | null)[]>([]), pins = useRef<(SVGGElement | null)[]>([]);
  // Scroll draws the dashed centre line (scrubbed: scrolling back up retracts it) and drives a car along it, turned
  // to the road's direction. Four stops sit on the road above their steps; reaching one plays that step's icon and
  // brightens its text. The dashes also flow along the road at the HUD's speed, so it feels like driving.
  useLayoutEffect(() => {
    const path = road.current!, length = path.getTotalLength();
    // Each stop sits where the road passes over the centre of its column (four equal columns below).
    const lengthAtX = (x: number) => {
      let lo = 0, hi = length;
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (path.getPointAtLength(mid).x < x) lo = mid; else hi = mid; }
      return lo;
    };
    const marks = [150, 450, 750, 1050].map(x => lengthAtX(x) / length);
    marks.forEach((mark, i) => {
      const point = path.getPointAtLength(mark * length);
      pins.current[i]?.setAttribute("transform", `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`);
    });
    reveal.current!.style.strokeDasharray = `${length} ${length}`;
    const place = (progress: number) => {
      reveal.current!.style.strokeDashoffset = String(length * (1 - progress));
      const at = Math.max(0.5, length * progress), point = path.getPointAtLength(at), ahead = path.getPointAtLength(Math.min(length, at + 2));
      const behind = path.getPointAtLength(Math.max(0, at - 2));
      const angle = Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180 / Math.PI;
      car.current?.setAttribute("transform", `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)}) rotate(${angle.toFixed(1)})`);
      marks.forEach((mark, i) => {
        const on = progress >= mark - 0.005;
        stops.current[i]?.classList.toggle("on", on);
        pins.current[i]?.classList.toggle("on", on);
      });
    };
    if (reducedMotion()) { place(1); return; }
    place(0);
    const trigger = ScrollTrigger.create({ trigger: road.current!.ownerSVGElement, start: "center 85%", end: "center 30%", scrub: 0.6,  // the whole road stays in view
      onUpdate: self => place(self.progress) });
    let flow = 0;
    const stopFlow = onDrive(dt => {
      flow = (flow - (drive.kmh / MAX_KMH) * 240 * dt) % 40;  // one dash cycle is 40 units
      if (lane.current) lane.current.style.strokeDashoffset = flow.toFixed(1);
    });
    return () => { trigger.kill(); stopFlow(); };
  }, []);
  const d = "M20 200 C 220 200, 260 60, 460 60 S 700 200, 900 190 S 1120 70, 1180 70";
  return (
    <section className="lab-how" ref={section} data-chapter="Junction 3 · How it works">
      <h2>How a rental <em>drives</em></h2>
      <div className="lab-how-road">
        <svg viewBox="0 0 1200 260" aria-hidden="true">
          <defs>
            <mask id="lab-how-reveal" maskUnits="userSpaceOnUse" x="0" y="0" width="1200" height="260">
              <path ref={reveal} d={d} fill="none" stroke="#fff" strokeWidth="20" />
            </mask>
          </defs>
          <path ref={road} className="lab-how-asphalt" d={d} />
          <path className="lab-how-ghost" d={d} />
          <path ref={lane} className="lab-how-lane" d={d} mask="url(#lab-how-reveal)" />
          {[0, 1, 2, 3].map(i => (
            <g key={i} ref={el => { pins.current[i] = el; }} className={`lab-how-pin${i === 3 ? " finish" : ""}`}>
              <circle r="13" /><circle r="5" className="core" />
            </g>
          ))}
          <g ref={car} className="lab-how-vehicle">
            <rect x="-17" y="-9" width="34" height="18" rx="6" className="body" />
            <rect x="2" y="-7" width="9" height="14" rx="2" className="glass" />
            <rect x="-13" y="-7" width="6" height="14" rx="2" className="glass" />
          </g>
        </svg>
        <ol className="lab-how-stops">
          {HOW.map((stop, i) => (
            <li key={stop.title} ref={el => { stops.current[i] = el; }} className={`lab-how-stop icon-${stop.icon}`}>
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
  return <svg className="lab-stop-icon" viewBox="0 0 48 48" aria-hidden="true">{icons[kind]}</svg>;
}

// ----- Chapter 4: the trip (timeline road + time road + price) ---------------------------------

// One sample booking, consistent everywhere: requested and approved on 22 Nov, keys handed over on 23 Nov once the
// pickup window opens (an hour before the slot), return the same day. Keys and return follow the slot you drag.
const slotTime = (slot: number) => `${String(Math.floor(slot / 2)).padStart(2, "0")}:${slot % 2 ? "30" : "00"}`;
const RENTAL_SLOTS = 6;  // 3 hours

function Trip() {
  const [pickup, setPickup] = useState(CLEANING_UNTIL + 2);
  const [h, m] = slotTime(pickup).split(":").map(Number);
  const keys = `${String(h).padStart(2, "0")}:${String(m + 4).padStart(2, "0")}`;  // handed over 4 minutes into the slot
  const stops = [
    { label: "You requested", time: "22 Nov · 10:23", color: "pending" },
    { label: "Asha approved", time: "22 Nov · 11:02", color: "confirmed", note: "Paid ₹1,650 · demo payment" },
    { label: "Keys handed over", time: `23 Nov · ${keys}`, color: "progress" },
    { label: "Return", time: `23 Nov · ${slotTime(pickup + RENTAL_SLOTS)} · ₹1,000 deposit back`, color: "ghost" },
  ];
  return (
    <section className="lab-trip" data-chapter="Stage 4 · Your trip">
      <div className="lab-trip-road"><TimelineRoad stops={stops} /></div>
      <TripTicket pickup={pickup} setPickup={setPickup} />
    </section>
  );
}

/** The timeline road is scrubbed by scroll: it draws as the section rises from 75% to 35% of the viewport, each
 *  stop lights up when the line reaches it, and scrolling back up retracts it. Nothing plays on load. */
function TimelineRoad({ stops }: { stops: { label: string; time: string; color: string; note?: string }[] }) {
  const path = useRef<SVGPathElement>(null), car = useRef<SVGGElement>(null), wrapper = useRef<HTMLDivElement>(null);
  const [reached, setReached] = useState(0);
  useLayoutEffect(() => {
    const line = path.current!, marker = car.current!, total = line.getTotalLength();
    const marks = [0.02, 0.27, 0.6, 0.97];
    let shown = -1;
    const render = (progress: number) => {
      const length = total * progress;
      line.style.strokeDasharray = `${length.toFixed(1)} ${total.toFixed(1)}`;
      const point = line.getPointAtLength(length);
      marker.setAttribute("transform", `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`);
      const count = marks.filter(mark => progress >= mark).length;
      if (count !== shown) { shown = count; setReached(count); }
    };
    if (reducedMotion()) { render(1); return; }
    render(0);
    // The road's drawn tip follows the reader's eye line (60% down the viewport): drawing starts when the top of the
    // road reaches it and finishes as the Return stop does, whatever the viewport height.
    const svg = wrapper.current!.querySelector("svg");
    const trigger = ScrollTrigger.create({ trigger: svg, start: "top 60%", end: "bottom 60%", scrub: 0.6,
      onUpdate: self => render(self.progress) });
    return () => trigger.kill();
  }, []);
  const d = "M60 20 C 60 160, 100 200, 100 300 S 60 440, 60 560 S 100 680, 100 740";
  return (
    <div className="lab-timeline" ref={wrapper}>
      <svg viewBox="0 0 160 760" aria-hidden="true">
        <path d={d} className="lab-asphalt" />
        <path d={d} className="lab-ghost-lane" />
        <path d={d} className="lab-drawn-lane" ref={path} />
        <g ref={car}><circle r="11" className="lab-car" /></g>
      </svg>
      <ol>
        {stops.map((stop, index) => (
          <li key={stop.label} className={index < reached ? "reached" : ""} style={{ top: `${[20, 210, 430, 650][index]}px` }}>
            <span className={`lab-dot lab-${stop.color}`} />
            <div><b>{stop.label}</b><small className="mono">{stop.time}</small>{stop.note && <span className="lab-tag-note">{stop.note}</span>}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// Time road for 23 Nov: an earlier rental until 10:00, then a 2-hour cleaning window.
const BOOKED_UNTIL = 10 * 2, CLEANING_UNTIL = 12 * 2, DAY = 48;

function TripTicket({ pickup, setPickup }: { pickup: number; setPickup: (slot: number) => void }) {
  const [bump, setBump] = useState(false);
  const [counted, setCounted] = useState(false);
  const length = RENTAL_SLOTS;
  const track = useRef<HTMLDivElement>(null);
  const hours = useMemo(() => length / 2, [length]);
  const price = 650 * Math.max(1, Math.ceil(hours / 24));
  const ticket = useOnce<HTMLDivElement>(() => setCounted(true), "top 65%");  // the price rolls up when you arrive
  const place = (slot: number) => {
    const clamped = Math.max(0, Math.min(DAY - length, slot));
    if (clamped < CLEANING_UNTIL) {
      setBump(true);
      window.setTimeout(() => setBump(false), 450);
      setPickup(CLEANING_UNTIL);
      return;
    }
    setPickup(clamped);
  };
  const fromPointer = (event: ReactPointerEvent) => {
    const box = track.current!.getBoundingClientRect();
    place(Math.round(((event.clientX - box.left) / box.width) * DAY));
  };
  const time = (slot: number) => `${String(Math.floor(slot / 2)).padStart(2, "0")}:${slot % 2 ? "30" : "00"}`;
  const money = (value: number) => counted ? value.toLocaleString("en-IN") : "0,000".slice(-value.toLocaleString("en-IN").length);
  return (
    <div className="lab-ticket" ref={ticket}>
      <h2>Honda Activa 6G</h2>
      <span className="lab-status">● On the road</span>
      <div className="lab-slots">
        <div><small>Pickup</small><span className="lab-slot-date">23 Nov ·</span> <Odometer value={time(pickup)} size="md" /></div>
        <div className="lab-right"><small>Return</small><span className="lab-slot-date">23 Nov ·</span> <Odometer value={time(pickup + length)} size="md" /></div>
      </div>
      <div className="lab-breakdown">
        <div className="lab-row lab-weekend"><span>1 weekend day × ₹650</span><span className="mono">₹{price.toLocaleString("en-IN")}</span></div>
        <div className="lab-row lab-deposit"><span>Refundable deposit</span><span className="mono">₹1,000</span></div>
        <div className="lab-total"><span>Due at payment</span><span className="lab-total-amount"><span className="odo-sep">₹</span><Odometer value={money(price + 1000)} size="md" /></span></div>
      </div>
      <div className="lab-timeroad">
        <small>Time road · 23 Nov · drag the car (or use ← →)</small>
        <div className={`lab-track${bump ? " bump" : ""}`} ref={track}
          onPointerDown={event => { track.current!.setPointerCapture(event.pointerId); fromPointer(event); }}
          onPointerMove={event => { if (event.buttons) fromPointer(event); }}>
          <span className="lab-booked" style={{ width: `${(BOOKED_UNTIL / DAY) * 100}%` }} title="Booked until 10:00" />
          <span className="lab-cleaning" style={{ left: `${(BOOKED_UNTIL / DAY) * 100}%`, width: `${((CLEANING_UNTIL - BOOKED_UNTIL) / DAY) * 100}%` }} title="Cleaning window" />
          <span className="lab-mine" style={{ left: `${(pickup / DAY) * 100}%`, width: `${(length / DAY) * 100}%` }} />
          <button className="lab-marker" style={{ left: `${(pickup / DAY) * 100}%` }} aria-label={`Pickup ${time(pickup)}`}
            onKeyDown={event => {
              if (event.key === "ArrowRight") place(pickup + 1);
              if (event.key === "ArrowLeft") place(pickup - 1);
            }} />
        </div>
        <div className="lab-ticks mono"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
        <p className="lab-legend"><span className="lab-key lab-key-booked" /> Booked until 10:00 <span className="lab-key lab-key-cleaning" /> Cleaning window 10:00–12:00 <span className="lab-key lab-key-mine" /> Your rental</p>
        <p className={`lab-earliest${bump ? " show" : ""}`}>Cleaning window after the previous rental: earliest pickup 12:00.</p>
      </div>
    </div>
  );
}

// ----- Chapter 5: the toll gate -----------------------------------------------------------------

function Finish() {
  const section = useRef<HTMLElement>(null), arm = useRef<SVGGElement>(null), lights = useRef<SVGCircleElement>(null);
  // The barrier lifts as you roll up to it (scrubbed), and the light turns from red to green at the top.
  useLayoutEffect(() => {
    if (reducedMotion()) { gsap.set(arm.current, { rotation: -78, svgOrigin: "60 120" }); lights.current?.classList.add("go"); return; }
    const ctx = gsap.context(() => {
      gsap.fromTo(arm.current, { rotation: 0, svgOrigin: "60 120" }, {
        rotation: -78, svgOrigin: "60 120", ease: "none",
        scrollTrigger: { trigger: section.current, start: "top 75%", end: "top 25%", scrub: 0.5,
          onUpdate: self => lights.current?.classList.toggle("go", self.progress > 0.92) },
      });
    }, section);
    return () => ctx.revert();
  }, []);
  return (
    <section className="lab-finish" ref={section} data-chapter="Toll gate · Finish">
      <svg className="lab-gate" viewBox="0 -240 900 460" aria-hidden="true">
        <rect x="0" y="176" width="900" height="44" className="lab-gate-road" />
        <g className="lab-gate-check">{Array.from({ length: 30 }, (_, i) => <rect key={i} x={i * 30} y={i % 2 ? 176 : 186} width="30" height="10" />)}</g>
        <rect x="40" y="96" width="40" height="80" className="lab-gate-post" />
        <circle ref={lights} cx="60" cy="86" r="9" className="lab-gate-light" />
        <g ref={arm}>
          <rect x="60" y="112" width="400" height="16" rx="3" className="lab-gate-arm" />
          {Array.from({ length: 5 }, (_, i) => <rect key={i} x={90 + i * 76} y="112" width="38" height="16" className="lab-gate-stripe" />)}
        </g>
      </svg>
      <h2>The road's <em>open.</em></h2>
      <p>Pick a vehicle, choose your time, and watch the meter.</p>
      <a className="lab-finish-cta" href="/app/vehicles">Find your vehicle</a>
    </section>
  );
}
