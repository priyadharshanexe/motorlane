// The renter's trips. The list is a stack of trip tickets grouped by lane (Upcoming, On the road, Completed,
// Closed) that tilt slightly towards the cursor. The detail page is "The road so far": a timeline road down the left
// edge from the booking's recorded events, drawn by scroll up to the current stop with a car following, future stops
// as ghost road, labels that know the viewer, and notes hanging off stops; next to it the ticket with pay, cancel
// (fee and refund roll in first), the receipt, the refund gauge and the review.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, dateLabel, money } from "../api";
import type { Booking, TimelineEvent, VehicleDetail } from "../api";
import type { Quote } from "./pricing";
import { formData, useWrite } from "../requests";
import { rentalToday } from "../rentalDates";
import { Photo } from "./shared";
import { ScrollTrigger } from "./drive";
import { PaymentSheet } from "./PaymentSheet";
import { Odometer, reducedMotion, scrolling } from "./primitives";
import { ErrorSign, RoadSign } from "./states";
import { Hud, useChapters } from "./world";

const LANES: [string, Booking["status"][]][] = [
  ["Upcoming", ["Pending", "Confirmed"]],
  ["On the road", ["In progress"]],
  ["Completed", ["Returned"]],
  ["Closed", ["Cancelled", "Rejected", "Expired"]],
];
const STATE_ICON: Record<string, string> = {
  Pending: "◔", Confirmed: "✓", "In progress": "➜", Returned: "■", Cancelled: "✕", Rejected: "✕", Expired: "◌",
};
const clock = (value: string) => value.slice(0, 5);
const stamp = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date(value));

export function State({ value }: { value: string }) {
  return <span className="od-state" data-state={value}><span aria-hidden="true">{STATE_ICON[value] ?? "•"}</span> {value}</span>;
}

// ----- List -----------------------------------------------------------------------------------------------------

export function Trips() {
  const query = useQuery({ queryKey: ["bookings"], queryFn: () => api<Booking[]>("bookings/") });
  const root = useRef<HTMLDivElement>(null);
  useChapters(root, [query.data?.length]);
  const rows = query.data ?? [];
  return (
    <div className="od-page od-trips" ref={root} data-chapter="Logbook · Your trips">
      <header className="od-page-head">
        <span className="od-eyebrow">Your logbook</span>
        <h1 tabIndex={-1}>Your trips.</h1>
        <p>Requests, rentals on the road and past trips, with every handoff and refund.</p>
      </header>
      {query.isPending && <div className="od-ticket-skeletons">{[0, 1, 2].map(i => <div key={i} className="od-ticket od-ticket-skel" />)}</div>}
      <ErrorSign error={query.error} retry={() => query.refetch()} />
      {query.data && !rows.length && (
        <RoadSign kind="end" title="No trips yet." action={<Link className="od-cta" to="/vehicles">Find a ride</Link>}>When you request a vehicle, its trip ticket appears here.</RoadSign>
      )}
      {query.data && rows.length > 0 && LANES.map(([lane, states]) => {
        const inLane = rows.filter(row => states.includes(row.status));
        return (
          <section className="od-lane-group" key={lane} aria-labelledby={`lane-${lane}`}>
            <h2 id={`lane-${lane}`}>{lane} <span className="mono">{String(inLane.length).padStart(2, "0")}</span></h2>
            {inLane.length ? <div className="od-tickets">{inLane.map(row => <TripTicket key={row.id} row={row} />)}</div>
              : <p className="od-empty-line">Nothing in this lane.</p>}
          </section>
        );
      })}
      <Hud />
    </div>
  );
}

function TripTicket({ row }: { row: Booking }) {
  const ref = useRef<HTMLAnchorElement>(null);
  // A 2-3 degree magnetic tilt towards the cursor (never while the page scrolls under it).
  const tilt = (event: ReactPointerEvent) => {
    if (event.pointerType !== "mouse" || scrolling.active || reducedMotion()) return;
    const box = ref.current!.getBoundingClientRect();
    ref.current!.style.setProperty("--rx", `${(((event.clientY - box.top) / box.height - 0.5) * -3).toFixed(2)}deg`);
    ref.current!.style.setProperty("--ry", `${(((event.clientX - box.left) / box.width - 0.5) * 3).toFixed(2)}deg`);
  };
  const reset = () => { ref.current!.style.setProperty("--rx", "0deg"); ref.current!.style.setProperty("--ry", "0deg"); };
  return (
    <Link to={`/bookings/${row.id}`} viewTransition className="od-ticket" ref={ref} onPointerMove={tilt} onPointerLeave={reset}>
      <div className="od-ticket-photo"><Photo vehicle={row.vehicle} /></div>
      <div className="od-ticket-body">
        <State value={row.status} />
        {row.overdue && <span className="od-state" data-state="Overdue">⚠ Overdue return</span>}
        <h3>{row.vehicle.name}</h3>
        <p className="mono">{dateLabel(row.start_date)} {clock(row.pickup_time)} → {dateLabel(row.end_date)} {clock(row.return_time)}</p>
        <p>{row.vehicle.location ?? "Location on request"} · #{row.id}</p>
      </div>
      <div className="od-ticket-stubpart"><small>Total</small><b className="mono">{money(row.total_price)}</b></div>
    </Link>
  );
}

// ----- Detail -----------------------------------------------------------------------------------------------------

export type Detail = Booking & { timeline: TimelineEvent[] };

export function TripDetail() {
  const { id } = useParams();
  const cache = useQueryClient();
  const query = useQuery({ queryKey: ["booking-detail", id], queryFn: () => api<Detail>(`bookings/${id}/`),
    // refetches on focus, and every 15 s while the trip can still change, so the ticket flips while you watch
    refetchInterval: q => (["Pending", "Confirmed", "In progress"].includes(q.state.data?.status ?? "") ? 15_000 : false) });
  const vehicle = useQuery({ enabled: Boolean(query.data), queryKey: ["vehicle", String(query.data?.vehicle.id)], queryFn: () => api<VehicleDetail>(`vehicles/${query.data!.vehicle.id}/`) });
  const root = useRef<HTMLDivElement>(null);
  const [paying, setPaying] = useState(false);
  useChapters(root, [query.data?.id]);
  // The ticket flips when the state changes while you're looking (e.g. the owner approves while the tab was away).
  const lastState = useRef<string | null>(null), [flip, setFlip] = useState(false);
  useEffect(() => {
    const now = query.data?.status ?? null;
    if (lastState.current && now && now !== lastState.current && !reducedMotion()) { setFlip(true); window.setTimeout(() => setFlip(false), 700); }
    lastState.current = now;
  }, [query.data?.status]);
  if (query.isPending) return <div className="od-page-loading" style={{ minHeight: "100vh" }} />;
  if (!query.data) return <div className="od-page"><RoadSign kind="end" title="Booking not found." action={<Link className="od-cta" to="/bookings">Your trips</Link>}>It may belong to another account.</RoadSign></div>;
  const b = query.data;
  const refresh = () => { cache.invalidateQueries({ queryKey: ["booking-detail", id] }); cache.invalidateQueries({ queryKey: ["bookings"] }); };
  const host = vehicle.data?.host_name || "The owner";
  const needsPay = b.status === "Confirmed" && b.payment_required && !["paid", "partially_refunded", "refunded"].includes(b.payment?.status ?? "");
  const canCancel = b.status === "Pending" || (b.status === "Confirmed" && b.start_date > rentalToday());
  const quote = b.price_breakdown as Quote | undefined;
  return (
    <div className="od-page od-trip-detail" ref={root} data-chapter={`Logbook · Trip #${b.id}`}>
      <nav className="od-crumbs" aria-label="Breadcrumb"><Link to="/bookings" viewTransition>← Your trips</Link><span aria-current="page">Trip #{b.id}</span></nav>
      <header className="od-page-head">
        <span className="od-eyebrow">The road so far</span>
        <h1 tabIndex={-1}>{b.vehicle.name}</h1>
      </header>
      <div className="od-trip-grid">
        <TimelineRoad booking={b} host={host} />
        <div className="od-trip-side">
          <section className={`od-ticket od-ticket-big${flip ? " flipping" : ""}`}>
            <div className="od-ticket-photo"><Photo vehicle={b.vehicle} /></div>
            <div className="od-ticket-body">
              <State value={b.status} />
              {b.overdue && <span className="od-state" data-state="Overdue">⚠ Overdue return</span>}
              <div className="od-ticket-slots">
                <div><small>Pickup</small><b className="mono">{dateLabel(b.start_date)} · {clock(b.pickup_time)}</b></div>
                <div><small>Return</small><b className="mono">{dateLabel(b.end_date)} · {clock(b.return_time)}</b></div>
              </div>
              <p>{b.vehicle.location ?? "Location on request"} · hosted by {vehicle.data?.host_name || "a local owner"}</p>
            </div>
          </section>
          <RefundGauge booking={b} />
          <div className="od-trip-actions">
            {needsPay && <button type="button" className="od-cta" onClick={() => setPaying(true)}>Pay now</button>}
            <a className="od-cta od-cta-ghost" href={`/download-receipt/${b.id}/`}>Download receipt</a>
            {canCancel && <CancelFlow booking={b} onDone={refresh} />}
          </div>
          {quote?.lines && (
            <section className="od-card">
              <h2>Price breakdown</h2>
              <dl className="od-receipt-lines">
                <div><dt>Rental days</dt><dd className="mono">{quote.days}</dd></div>
                {quote.lines.filter(l => l.kind !== "deposit").map(l => <div key={l.kind} className={`kind-${l.kind}`}><dt>{l.label}</dt><dd className="mono">{money(l.amount)}</dd></div>)}
                <div className="od-receipt-sub"><dt>Rental total</dt><dd className="mono">{money(quote.rental_total)}</dd></div>
                {Number(quote.deposit) > 0 && <div className="kind-deposit"><dt>Refundable deposit</dt><dd className="mono">{money(quote.deposit)}</dd></div>}
              </dl>
            </section>
          )}
          {b.status === "Returned" && !b.reviewed && <ReviewForm booking={b} onDone={refresh} />}
          {b.status === "Returned" && b.reviewed && <p className="od-fine">Thanks: your review is published.</p>}
        </div>
      </div>
      {paying && <PaymentSheet booking={b} onClose={() => { setPaying(false); refresh(); }} />}
      <Hud />
    </div>
  );
}

/** Labels from the viewer's side: "You requested", "Asha approved", "You paid ₹5,200", "Automatically expired". */
export function stopLabel(event: TimelineEvent, host: string, viewer: "renter" | "owner" = "renter") {
  const amount = event.note.match(/₹[\d,.]+/)?.[0] ?? "";
  const payer = viewer === "renter" ? "You" : "Renter";
  if (event.kind === "paid") return `${payer} paid ${amount}`.trim();
  if (event.kind === "refund_issued") return `Refund of ${amount} issued`;
  if (event.kind === "refunded") return `${amount} refunded`;
  if (!event.from_status) return viewer === "renter" ? "You requested" : "Renter requested";
  const who = event.actor === "renter" ? payer : event.actor === "owner" ? (viewer === "owner" ? "You" : host) : event.actor === "staff" ? "Motorlane" : "Automatically";
  const verb: Record<string, string> = {
    Confirmed: "approved", Rejected: "declined", "In progress": "handed over the keys", Returned: "recorded the return",
    Cancelled: "cancelled", Expired: "expired",
  };
  if (who === "Automatically") return `Automatically ${verb[event.to_status] ?? event.to_status.toLowerCase()}`;
  return `${who} ${verb[event.to_status] ?? `moved it to ${event.to_status}`}`;
}
const NEXT_STOPS: Partial<Record<Booking["status"], string[]>> = {
  Pending: ["Owner approves", "Payment", "Keys handed over", "Return"],
  Confirmed: ["Payment", "Keys handed over", "Return"],
  "In progress": ["Return"],
};

export function TimelineRoad({ booking, host, viewer = "renter" }: { booking: Detail; host: string; viewer?: "renter" | "owner" }) {
  const recorded = booking.timeline;
  const paid = recorded.some(e => e.kind === "paid");
  const ghosts = (NEXT_STOPS[booking.status] ?? []).filter(s => s !== "Payment" || (booking.payment_required && !paid));
  const stops = [...recorded.map(e => ({ label: stopLabel(e, host, viewer), time: stamp(e.at), note: !e.kind || e.kind === "status" ? e.note : e.kind === "refund_issued" ? (e.note.match(/\((.+)\)$/)?.[1] ?? "") : "",
    state: e.kind && e.kind !== "status" ? e.kind : e.to_status, ghost: false, money: e.kind === "paid" })),
    ...ghosts.map(label => ({ label, time: "Not yet", note: "", state: "", ghost: true, money: false }))];
  const n = Math.max(1, stops.length);
  const spacing = 150, height = 40 + (n - 1) * spacing + 40;
  // A gently winding road through the stops; the drawn part ends at the last recorded stop.
  const ys = stops.map((_, i) => 40 + i * spacing);
  const d = ys.reduce((path, y, i) => i === 0 ? `M60 ${y}` : `${path} S ${i % 2 ? 100 : 20} ${y - spacing / 2}, 60 ${y}`, "");
  const path = useRef<SVGPathElement>(null), car = useRef<SVGGElement>(null), wrap = useRef<HTMLDivElement>(null);
  const [reached, setReached] = useState(0);
  useLayoutEffect(() => {
    const line = path.current, marker = car.current;
    if (!line || !marker) return;
    const total = line.getTotalLength();
    const lastRecorded = Math.max(0, recorded.length - 1);
    const target = n > 1 ? (total * lastRecorded) / (n - 1) : 0;  // the road so far ends at the current stop
    let shown = -1;
    const render = (progress: number) => {
      const length = target * progress;
      line.style.strokeDasharray = `${length.toFixed(1)} ${total.toFixed(1)}`;
      const p = line.getPointAtLength(length);
      marker.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
      const count = ys.filter(y => y <= p.y + 2).length;
      if (count !== shown) { shown = count; setReached(Math.min(count, recorded.length)); }
    };
    if (reducedMotion()) { render(1); return; }
    render(0);
    // Tied to the eye line: drawing starts when the road's top reaches 60% of the viewport.
    const trigger = ScrollTrigger.create({ trigger: wrap.current, start: "top 75%", end: () => `top+=${Math.max(80, target)} 60%`, scrub: 0.6, onUpdate: self => render(self.progress) });
    return () => trigger.kill();
  }, [booking.id, recorded.length, n]);  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="od-tl" ref={wrap} style={{ height }}>
      <svg viewBox={`0 0 120 ${height}`} style={{ height }} aria-hidden="true">
        <path d={d} className="od-tl-asphalt" />
        <path d={d} className="od-tl-ghost" />
        <path d={d} className="od-tl-lane" ref={path} />
        <g ref={car}><circle r="10" className="od-tl-car" /></g>
      </svg>
      <ol>
        {stops.map((stop, i) => (
          <li key={`${stop.label}-${i}`} className={`${stop.ghost ? "ghost" : i < reached ? "reached" : ""}`} style={{ top: ys[i] - 14 } as CSSProperties}>
            <span className="od-tl-dot" data-state={stop.state} />
            <div><b>{stop.label}</b>{stop.money && <span className="od-tl-stamp" aria-hidden="true">PAID</span>}<small className="mono">{stop.time}</small>{stop.note && <span className="od-tl-note">{stop.note}</span>}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Refund status as a fuel-gauge needle: pending (moving), delayed (at red, with a note), refunded (full). */
function RefundGauge({ booking }: { booking: Booking }) {
  const status = booking.payment?.refund_status;
  if (!status || !booking.payment) return null;
  const amount = Number(booking.payment.refunded).toLocaleString("en-IN");
  const text = { pending: `Refund of ₹${amount} is on its way.`, delayed: `Refund of ₹${amount} is delayed. We're on it and will keep trying.`, refunded: `₹${amount} refunded.` }[status];
  return (
    <section className={`od-gauge-card refund-${status}`} role="status">
      <svg viewBox="-50 -46 100 56" aria-hidden="true">
        <path d="M-40 0 A40 40 0 0 1 40 0" className="arc" />
        <path d="M-40 0 A40 40 0 0 1 -28 -28" className="arc-red" />
        <line x1="0" y1="0" x2="0" y2="-34" className="needle" />
        <circle r="5" className="hub" />
      </svg>
      <div><small>Refund</small><p>{text}</p></div>
    </section>
  );
}

function CancelFlow({ booking, onDone }: { booking: Booking; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const write = useWrite();
  const preview = useQuery({ enabled: open, queryKey: ["cancellation", booking.id], queryFn: () => api<{ fee: string; refund: string; free_until: string; fee_percent: number }>(`bookings/${booking.id}/cancellation/`) });
  const [rolled, setRolled] = useState(false);
  useEffect(() => { if (preview.data) { const t = window.setTimeout(() => setRolled(true), 100); return () => window.clearTimeout(t); } }, [preview.data]);
  const figure = (value: string) => { const s = Number(value).toLocaleString("en-IN"); return rolled ? s : s.replace(/\d/g, "0"); };
  if (!open) return <button type="button" className="od-cta od-cta-ghost" onClick={() => setOpen(true)}>Cancel booking</button>;
  return (
    <section className="od-card od-cancel" aria-live="polite">
      <h2>Cancel this trip?</h2>
      {preview.isPending && <p>Working out the fee…</p>}
      <ErrorSign error={preview.error} retry={() => preview.refetch()} />
      {preview.data && <>
        <div className="od-cancel-figures">
          <div><small>Kept as a fee</small><span className="od-cancel-odo"><span className="odo-sep">₹</span><Odometer value={figure(preview.data.fee)} size="md" /></span></div>
          <div><small>Refunded to you</small><span className="od-cancel-odo good"><span className="odo-sep">₹</span><Odometer value={figure(preview.data.refund)} size="md" /></span></div>
        </div>
        <p className="od-fine">{Number(preview.data.fee) > 0 ? `${preview.data.fee_percent}% of the rental is kept because pickup is less than 48 hours away. The deposit is always refunded.` : "Free cancellation: you get everything back."}</p>
      </>}
      {write.error && <p className="od-error" role="alert">{write.error.message}</p>}
      <div className="od-trip-actions">
        <button type="button" className="od-cta od-danger" disabled={!preview.data || write.isPending}
          onClick={() => write.mutate({ path: `bookings/${booking.id}/cancel/` }, { onSuccess: () => { setOpen(false); onDone(); } })}>
          {write.isPending ? "Cancelling…" : "Yes, cancel"}</button>
        <button type="button" className="od-cta od-cta-ghost" onClick={() => setOpen(false)}>Keep the trip</button>
      </div>
    </section>
  );
}

function ReviewForm({ booking, onDone }: { booking: Booking; onDone: () => void }) {
  const write = useWrite();
  const [rating, setRating] = useState(0), [hover, setHover] = useState(0);
  const words = ["Tap a star", "Poor", "Fair", "Good", "Very good", "Excellent"];
  return (
    <form className="od-card od-review-form" onSubmit={event => write.mutate({ path: `bookings/${booking.id}/review/`, body: formData(event) }, { onSuccess: onDone })}>
      <h2>How was the drive?</h2>
      <fieldset className="od-stars" onMouseLeave={() => setHover(0)}>
        <legend>Rating</legend>
        {[1, 2, 3, 4, 5].map(value => (
          <label key={value} data-filled={value <= (hover || rating)} onMouseEnter={() => setHover(value)}>
            <input type="radio" name="rating" value={value} required checked={rating === value} onChange={() => setRating(value)} aria-label={`${value} of 5, ${words[value]}`} />
            <span aria-hidden="true">★</span>
          </label>
        ))}
        <span className="od-stars-word" aria-live="polite">{words[hover || rating]}</span>
      </fieldset>
      <label className="od-field"><small>Comment</small><textarea name="comment" required maxLength={500} /></label>
      {write.error && <p className="od-error" role="alert">{write.error.message}</p>}
      <button className="od-cta" disabled={write.isPending}>{write.isPending ? "Publishing…" : "Publish review"}</button>
    </form>
  );
}

