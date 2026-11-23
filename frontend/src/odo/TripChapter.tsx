// "Your trip, mile by mile": one sample booking told as a scrubbed timeline road (stops light up as the drawn
// tip, tied to the reader's eye line, reaches them) next to a trip ticket with a draggable time road and a price
// odometer that rolls up on arrival. Shared by the home page and /app/lab.
import { useMemo, useRef, useState, useLayoutEffect } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ScrollTrigger } from "./drive";
import { Odometer, reducedMotion, useOnce } from "./primitives";
import "./trip.css";

// One sample booking, consistent everywhere: requested and approved on 22 Nov, keys handed over on 23 Nov once the
// pickup window opens (an hour before the slot), return the same day. Keys and return follow the slot you drag.
const slotTime = (slot: number) => `${String(Math.floor(slot / 2)).padStart(2, "0")}:${slot % 2 ? "30" : "00"}`;
const RENTAL_SLOTS = 6;  // 3 hours

export function TripChapter({ chapter = "Stage 4 · Your trip", title }: { chapter?: string; title?: string }) {
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
    <section className="od-tripchapter" data-chapter={chapter}>
      {title && <header className="od-trip-head"><span className="od-eyebrow">A sample trip</span><h2>{title}</h2></header>}
      <div className="od-trip-road"><TimelineRoad stops={stops} /></div>
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
    <div className="od-timeline" ref={wrapper}>
      <svg viewBox="0 0 160 760" aria-hidden="true">
        <path d={d} className="od-asphalt" />
        <path d={d} className="od-ghost-lane" />
        <path d={d} className="od-drawn-lane" ref={path} />
        <g ref={car}><circle r="11" className="od-car" /></g>
      </svg>
      <ol>
        {stops.map((stop, index) => (
          <li key={stop.label} className={index < reached ? "reached" : ""} style={{ top: `${[20, 210, 430, 650][index]}px` }}>
            <span className={`od-dot od-${stop.color}`} />
            <div><b>{stop.label}</b><small className="mono">{stop.time}</small>{stop.note && <span className="od-tag-note">{stop.note}</span>}</div>
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
    <div className="od-ticket" ref={ticket}>
      <h2>Honda Activa 6G</h2>
      <span className="od-status">● On the road</span>
      <div className="od-slots">
        <div><small>Pickup</small><span className="od-slot-date">23 Nov ·</span> <Odometer value={time(pickup)} size="md" /></div>
        <div className="od-right"><small>Return</small><span className="od-slot-date">23 Nov ·</span> <Odometer value={time(pickup + length)} size="md" /></div>
      </div>
      <div className="od-breakdown">
        <div className="od-row od-weekend"><span>1 weekend day × ₹650</span><span className="mono">₹{price.toLocaleString("en-IN")}</span></div>
        <div className="od-row od-deposit"><span>Refundable deposit</span><span className="mono">₹1,000</span></div>
        <div className="od-total"><span>Due at payment</span><span className="od-total-amount"><span className="odo-sep">₹</span><Odometer value={money(price + 1000)} size="md" /></span></div>
      </div>
      <div className="od-timeroad">
        <small>Time road · 23 Nov · drag the car (or use ← →)</small>
        <div className={`od-track${bump ? " bump" : ""}`} ref={track}
          onPointerDown={event => { track.current!.setPointerCapture(event.pointerId); fromPointer(event); }}
          onPointerMove={event => { if (event.buttons) fromPointer(event); }}>
          <span className="od-booked" style={{ width: `${(BOOKED_UNTIL / DAY) * 100}%` }} title="Booked until 10:00" />
          <span className="od-cleaning" style={{ left: `${(BOOKED_UNTIL / DAY) * 100}%`, width: `${((CLEANING_UNTIL - BOOKED_UNTIL) / DAY) * 100}%` }} title="Cleaning window" />
          <span className="od-mine" style={{ left: `${(pickup / DAY) * 100}%`, width: `${(length / DAY) * 100}%` }} />
          <button className="od-marker" style={{ left: `${(pickup / DAY) * 100}%` }} aria-label={`Pickup ${time(pickup)}`}
            onKeyDown={event => {
              if (event.key === "ArrowRight") place(pickup + 1);
              if (event.key === "ArrowLeft") place(pickup - 1);
            }} />
        </div>
        <div className="od-ticks mono"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
        <p className="od-legend"><span className="od-key od-key-booked" /> Booked until 10:00 <span className="od-key od-key-cleaning" /> Cleaning window 10:00–12:00 <span className="od-key od-key-mine" /> Your rental</p>
        <p className={`od-earliest${bump ? " show" : ""}`}>Cleaning window after the previous rental: earliest pickup 12:00.</p>
      </div>
    </div>
  );
}

