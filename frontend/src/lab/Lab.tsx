// /app/lab: a live concept prototype of the "Odometer" design direction (docs/design-direction.md).
// Not linked from the app. It reads real catalog data but changes nothing. Plain CSS + pointer
// events only, so the prototype adds no dependencies; the real build will use Motion and GSAP.
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { Vehicle } from "../api";
import "./lab.css";

type Theme = "dark" | "light";

const FONTS = "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=JetBrains+Mono:wght@500;700&family=Public+Sans:wght@400;600&display=swap";

export default function Lab() {
  const [theme, setTheme] = useState<Theme>(() => (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONTS;
    document.head.appendChild(link);
    document.title = "Motorlane · Odometer concept";
    return () => link.remove();
  }, []);
  return (
    <div className="lab" data-theme={theme}>
      <header className="lab-bar">
        <Mark />
        <span className="lab-note">Design concept · not the live site</span>
        <button className="lab-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
          {theme === "dark" ? "Light" : "Dark"} mode
        </button>
      </header>
      <Hero />
      <Catalog />
      <Trip />
      <footer className="lab-foot">
        Odometer concept for Motorlane. Static parts are placeholders; motion here is a quick taste, built
        without the animation libraries the real build will use.
      </footer>
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

/** Odometer: each digit is a column of 0-9 that rolls to the target digit. */
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

function useVehicles(type: string) {
  return useQuery({
    queryKey: ["lab-vehicles", type],
    queryFn: () => api<{ count: number; results: Vehicle[] }>(`vehicles/?${new URLSearchParams(type ? { type } : {})}`),
  });
}

function Hero() {
  const [type, setType] = useState("");
  const vehicles = useVehicles(type);
  const count = String(vehicles.data?.count ?? 0).padStart(3, "0");
  const road = useRef<HTMLDivElement>(null);
  // Scroll speeds the road up: lane dashes move faster while you scroll, then settle.
  useEffect(() => {
    let speed = 1, last = window.scrollY, frame = 0;
    const tick = () => {
      const delta = Math.abs(window.scrollY - last);
      last = window.scrollY;
      speed += (1 + Math.min(delta, 60) / 6 - speed) * 0.08;
      road.current?.style.setProperty("--speed", speed.toFixed(2));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <section className="lab-hero">
      <div className="lab-hero-copy">
        <h1>Your next <br />stretch <br />of <em>road.</em></h1>
        <p>Cars and bikes from local owners across Tamil Nadu. Pick a time, watch the price, take the keys.</p>
      </div>
      <div className="lab-road" ref={road}>
        <div className="lab-road-surface"><span className="lab-road-dashes" /></div>
        <div className="lab-counter">
          <small>Free right now</small>
          <Odometer value={count} />
        </div>
        <div className="lab-cluster">
          <div><small>Type</small>
            <div className="lab-seg" role="group" aria-label="Vehicle type">
              {[["", "All"], ["Car", "Cars"], ["Bike", "Bikes"]].map(([value, label]) => (
                <button key={value} aria-pressed={type === value} onClick={() => setType(value)}>{label}</button>
              ))}
            </div>
          </div>
          <div><small>Pickup</small><b className="mono">29 Nov · 09:00</b></div>
          <div><small>Return</small><b className="mono">01 Dec · 18:00</b></div>
          <button className="lab-go">Search</button>
        </div>
      </div>
      <p className="lab-hint">Try: switch Cars / Bikes and watch the count roll. Scroll to speed up the road.</p>
    </section>
  );
}

function Catalog() {
  const vehicles = useVehicles("");
  const rows = vehicles.data?.results.slice(0, 6) ?? [];
  return (
    <section className="lab-catalog">
      <div className="lab-lane-head">
        <h2>{vehicles.data ? <><Odometer value={String(vehicles.data.count)} size="md" /> on the road</> : "On the road"}</h2>
        <p className="lab-hint">Real listings from this catalog. Hover a tag: it swings on its ring and tilts towards you.</p>
      </div>
      <div className="lab-tags">
        {rows.map((vehicle, index) => <KeyTag key={vehicle.id} vehicle={vehicle} index={index} />)}
      </div>
    </section>
  );
}

function KeyTag({ vehicle, index }: { vehicle: Vehicle; index: number }) {
  const ref = useRef<HTMLElement>(null);
  const tilt = (event: ReactPointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5, y = (event.clientY - box.top) / box.height - 0.5;
    ref.current!.style.setProperty("--tx", `${(y * -6).toFixed(2)}deg`);
    ref.current!.style.setProperty("--ty", `${(x * 8).toFixed(2)}deg`);
  };
  const reset = () => { ref.current!.style.setProperty("--tx", "0deg"); ref.current!.style.setProperty("--ty", "0deg"); };
  const cover = vehicle.cover;
  return (
    <article className="lab-tag" ref={ref} onPointerMove={tilt} onPointerLeave={reset}
      style={{ "--hang": `${[-1.4, 0.6, 1.2, -0.8, 1.6, -1.1][index % 6]}deg` } as CSSProperties}>
      <span className="lab-tag-hole" aria-hidden="true" />
      {cover ? <img src={cover.small} srcSet={`${cover.small} 400w, ${cover.large} 1200w`} sizes="(max-width: 700px) 100vw, 400px"
        width={cover.width ?? undefined} height={cover.height ?? undefined} style={{ backgroundColor: cover.color ?? undefined }}
        alt={vehicle.name} loading={index < 3 ? "eager" : "lazy"} /> : <div className="lab-tag-noimg" />}
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

// ----- Trip timeline + time road ------------------------------------------------------------

const STOPS = [
  { label: "You requested", time: "22 Nov · 10:23", color: "pending" },
  { label: "Asha approved", time: "22 Nov · 11:02", color: "confirmed", note: "Paid ₹1,650 · demo payment" },
  { label: "Keys handed over", time: "22 Nov · 22:04", color: "progress" },
  { label: "Return", time: "23 Nov · 10:00 · ₹1,000 deposit back", color: "ghost" },
];

function Trip() {
  const path = useRef<SVGPathElement>(null);
  const [run, setRun] = useState(0);
  return (
    <section className="lab-trip">
      <div className="lab-trip-road">
        <TimelineRoad key={run} pathRef={path} />
        <button className="lab-replay" onClick={() => setRun(run + 1)}>Replay the road</button>
      </div>
      <TripTicket />
    </section>
  );
}

function TimelineRoad({ pathRef }: { pathRef: React.RefObject<SVGPathElement | null> }) {
  const car = useRef<SVGGElement>(null);
  const [reached, setReached] = useState(0);
  // The road draws itself to the current stop (stop 3 of 4), with the car following the path.
  useEffect(() => {
    const path = pathRef.current, marker = car.current;
    if (!path || !marker) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const total = path.getTotalLength(), target = total * 0.62, duration = reduce ? 0 : 2400;
    const stops = [0, 0.27, 0.62].map(f => f * total);
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = duration ? Math.min(1, (now - start) / duration) : 1;
      const eased = 1 - Math.pow(1 - t, 3);
      const length = target * eased;
      path.style.strokeDasharray = `${length} ${total}`;
      const point = path.getPointAtLength(length);
      marker.setAttribute("transform", `translate(${point.x} ${point.y})`);
      setReached(stops.filter(s => s <= length + 1).length);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [pathRef]);
  const d = "M60 20 C 60 160, 100 200, 100 300 S 60 440, 60 560 S 100 680, 100 740";
  return (
    <div className="lab-timeline">
      <svg viewBox="0 0 160 760" aria-hidden="true">
        <path d={d} className="lab-asphalt" />
        <path d={d} className="lab-ghost-lane" />
        <path d={d} className="lab-drawn-lane" ref={pathRef} />
        <g ref={car}><circle r="11" className="lab-car" /></g>
      </svg>
      <ol>
        {STOPS.map((stop, index) => (
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
const BOOKED_UNTIL = 10 * 2;      // in half-hours
const CLEANING_UNTIL = 12 * 2;
const DAY = 48;

function TripTicket() {
  const [pickup, setPickup] = useState(CLEANING_UNTIL + 2);  // 13:00
  const [bump, setBump] = useState(false);
  const length = 6;  // a 3-hour rental
  const track = useRef<HTMLDivElement>(null);
  const hours = useMemo(() => length / 2, [length]);
  const price = 650 * Math.max(1, Math.ceil(hours / 24));
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
  return (
    <div className="lab-ticket">
      <h2>Honda Activa 6G</h2>
      <span className="lab-status">● On the road</span>
      <div className="lab-slots">
        <div><small>Pickup</small><Odometer value={time(pickup).replace(":", ":")} size="md" /></div>
        <div className="lab-right"><small>Return</small><Odometer value={time(pickup + length)} size="md" /></div>
      </div>
      <div className="lab-breakdown">
        <div className="lab-row lab-weekend"><span>1 weekend day × ₹650</span><span className="mono">₹{price.toLocaleString("en-IN")}</span></div>
        <div className="lab-row lab-deposit"><span>Refundable deposit</span><span className="mono">₹1,000</span></div>
        <div className="lab-total"><span>Due at payment</span><span className="lab-total-amount"><span className="odo-sep">₹</span><Odometer value={(price + 1000).toLocaleString("en-IN")} size="md" /></span></div>
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
