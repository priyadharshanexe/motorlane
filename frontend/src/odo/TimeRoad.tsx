// The time road: one day as a road in 30-minute ticks. Booked time is solid road block, the cleaning window
// before the next free slot is a hatched kerb, and free time is open road. A car marker is dragged along it (or moved
// with the keyboard: arrows by 30 minutes, Page Up / Page Down by a day). It can't be dropped on blocked or hatched
// road: it springs back to the earliest free time with a clear message, and the kerb pulses once.
import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

export const SLOTS = 48;  // half hours in a day
export const toSlot = (time: string) => { const [h, m] = time.split(":").map(Number); return h * 2 + (m >= 30 ? 1 : 0); };
export const toTime = (slot: number) => `${String(Math.floor(slot / 2)).padStart(2, "0")}:${slot % 2 ? "30" : "00"}`;

export type Blocked = { from: number; to: number; cleaningFrom?: number };  // slots [from, to); cleaning is [cleaningFrom, to)

export function TimeRoad({ label, day, value, blocked, earliest, onChange, onDay, onUseEarliest }: {
  label: string;
  day: string;                    // "23 Nov"
  value: number;                  // slot
  blocked: Blocked[];             // blocked spans on this day
  earliest?: number | null;       // the API's earliest_pickup on this day, as a slot
  onChange: (slot: number) => void;
  onDay?: (delta: number) => void;
  onUseEarliest?: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [bump, setBump] = useState(false);
  const [message, setMessage] = useState("");
  const isBlocked = (slot: number) => blocked.some(b => slot >= b.from && slot < b.to);
  const firstFree = (from: number) => { for (let s = from; s < SLOTS; s++) if (!isBlocked(s)) return s; return null; };
  const commit = (slot: number) => {
    const clamped = Math.max(0, Math.min(SLOTS - 1, slot));
    if (isBlocked(clamped)) {
      const free = firstFree(clamped);
      setBump(true); window.setTimeout(() => setBump(false), 500);
      setMessage(free !== null ? `That time is booked or being cleaned. Earliest free time: ${toTime(free)}.` : "This day is fully booked. Try another day.");
      if (free !== null) onChange(free);
      return;
    }
    setMessage("");
    onChange(clamped);
  };
  const slotAt = (event: PointerEvent) => {
    const box = track.current!.getBoundingClientRect();
    return Math.round(((event.clientX - box.left) / box.width) * SLOTS);
  };
  const shown = drag ?? value;
  const key = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight") { event.preventDefault(); commit(value + 1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); commit(value - 1); }
    if (event.key === "PageUp" && onDay) { event.preventDefault(); onDay(1); }
    if (event.key === "PageDown" && onDay) { event.preventDefault(); onDay(-1); }
    if (event.key === "Home") { event.preventDefault(); commit(firstFree(0) ?? value); }
  };
  return (
    <div className="od-timeroad">
      <div className="od-timeroad-head">
        <small>{label} · {day}</small>
        <b className="mono">{toTime(shown)}</b>
      </div>
      <div className={`od-timeroad-track${bump ? " bump" : ""}${drag !== null ? " dragging" : ""}`} ref={track}
        onPointerDown={event => { track.current!.setPointerCapture(event.pointerId); setDrag(Math.max(0, Math.min(SLOTS - 1, slotAt(event)))); }}
        onPointerMove={event => { if (drag !== null) setDrag(Math.max(0, Math.min(SLOTS - 1, slotAt(event)))); }}
        onPointerUp={event => { if (drag !== null) { commit(slotAt(event)); setDrag(null); } }}
        onPointerCancel={() => setDrag(null)}>
        {blocked.map((b, i) => (
          <span key={i}>
            <span className="od-tr-booked" style={{ left: `${(b.from / SLOTS) * 100}%`, width: `${(((b.cleaningFrom ?? b.to) - b.from) / SLOTS) * 100}%` }} />
            {b.cleaningFrom !== undefined && <span className="od-tr-cleaning" style={{ left: `${(b.cleaningFrom / SLOTS) * 100}%`, width: `${((b.to - b.cleaningFrom) / SLOTS) * 100}%` }} />}
          </span>
        ))}
        {earliest !== null && earliest !== undefined && <span className="od-tr-earliest" style={{ left: `${(earliest / SLOTS) * 100}%` }} aria-hidden="true" />}
        <button type="button" className="od-tr-car" style={{ left: `${(shown / SLOTS) * 100}%` }}
          role="slider" aria-label={`${label} time`} aria-valuemin={0} aria-valuemax={SLOTS - 1} aria-valuenow={shown} aria-valuetext={`${toTime(shown)}, ${day}`}
          onKeyDown={key}>
          <svg viewBox="-12 -8 24 16" aria-hidden="true"><rect x="-11" y="-6" width="22" height="12" rx="4" /><rect x="2" y="-4" width="5" height="8" rx="1.5" className="glass" /></svg>
        </button>
      </div>
      <div className="od-tr-ticks mono" aria-hidden="true"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
      {earliest !== null && earliest !== undefined && onUseEarliest && (
        <button type="button" className="od-tr-earliest-btn" onClick={onUseEarliest}>
          <span className="od-tr-glow" aria-hidden="true" /> Earliest pickup {toTime(earliest)} · use it
        </button>
      )}
      <p className={`od-tr-message${message ? " show" : ""}`} aria-live="polite">{message}</p>
    </div>
  );
}
