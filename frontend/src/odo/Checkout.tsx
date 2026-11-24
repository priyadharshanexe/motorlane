// Checkout as a trip sheet. Left: the trip (vehicle tag, a time road for pickup and one for return, who's driving,
// conditions). Right, sticky: the breakdown as a receipt printing out, with a rolling total. The request is the
// same POST /bookings/ as before; nothing is charged until the owner confirms.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FocusEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, dateLabel, money } from "../api";
import type { VehicleDetail } from "../api";
import type { Quote } from "./pricing";
import { isRentalDate, rentalToday } from "../rentalDates";
import { useSession, useWrite } from "../requests";
import { Photo } from "./shared";
import { photoTransition } from "./KeyTag";
import { Odometer, reducedMotion } from "./primitives";
import { ErrorSign, RoadSign } from "./states";
import { SLOTS, TimeRoad, toSlot, toTime } from "./TimeRoad";
import type { Blocked } from "./TimeRoad";
import { Hud, useChapters } from "./world";

const CLEANING_SLOTS = 4;  // the 2-hour cleaning window owners keep after a rental (RENTAL_TURNAROUND_MINUTES)

/** [YYYY-MM-DD, HH:MM] of an instant in the marketplace's time zone (Asia/Kolkata). */
function kolkata(moment: Date): [string, string] {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(moment).map(part => [part.type, part.value]));
  return [`${parts.year}-${parts.month}-${parts.day}`, `${parts.hour}:${parts.minute}`];
}
const shiftDate = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
};
const shortDay = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const roundUp = (time: string) => toTime(Math.min(SLOTS - 1, toSlot(time) + (time.endsWith(":00") || time.endsWith(":30") ? 0 : 1)));

/** Debounce a value (the quote is re-asked once dragging settles, not on every pixel). */
function useSettled<T>(value: T, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => { const id = window.setTimeout(() => setSettled(value), ms); return () => window.clearTimeout(id); }, [value, ms]);
  return settled;
}

export function Checkout() {
  const { id } = useParams(), [params] = useSearchParams(), navigate = useNavigate();
  const start = params.get("start_date") || "", end = params.get("end_date") || "";
  const [pickup, setPickup] = useState(toSlot(params.get("pickup_time") || "09:00"));
  const [dropoff, setDropoff] = useState(toSlot(params.get("return_time") || "18:00"));
  const pickupTime = useSettled(toTime(pickup), 250), returnTime = useSettled(toTime(dropoff), 250);
  const session = useSession(), write = useWrite<{ id: number }>();
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tearing, setTearing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const vehicle = useQuery({ queryKey: ["vehicle", id], queryFn: () => api<VehicleDetail>(`vehicles/${id}/`) });
  const validDates = isRentalDate(start) && isRentalDate(end) && start >= rentalToday() && end >= start;
  const quote = useQuery({
    enabled: Boolean(id) && validDates, retry: false, placeholderData: previous => previous,
    queryKey: ["checkout-quote", id, start, end, pickupTime, returnTime],
    queryFn: () => api<Quote>(`vehicles/${id}/quote/?${new URLSearchParams({ start_date: start, end_date: end, pickup_time: pickupTime, return_time: returnTime })}`),
  });
  useChapters(root, [vehicle.data?.id]);

  // What the time roads show: past time today, and (from the API) the booked stretch before the earliest free pickup,
  // whose last two hours are the cleaning window.
  const [nowDate, nowTime] = kolkata(new Date());
  const earliest = quote.data?.available === false && quote.data.earliest_pickup ? kolkata(new Date(quote.data.earliest_pickup)) : null;
  const pickupBlocked = useMemo<Blocked[]>(() => {
    const spans: Blocked[] = [];
    if (start === nowDate) spans.push({ from: 0, to: Math.min(SLOTS, toSlot(roundUp(nowTime)) + 1) });
    if (earliest) {
      if (earliest[0] === start) { const to = toSlot(earliest[1]); spans.push({ from: 0, to, cleaningFrom: Math.max(0, to - CLEANING_SLOTS) }); }
      else if (earliest[0] > start) spans.push({ from: 0, to: SLOTS, cleaningFrom: SLOTS - CLEANING_SLOTS });
    }
    return spans;
  }, [start, nowDate, nowTime, earliest?.[0], earliest?.[1]]);  // eslint-disable-line react-hooks/exhaustive-deps
  // A pickup today can't start in the past: the default 09:00 (or a stale link) moves to the next free half hour, and
  // a same-day return keeps at least an hour after it.
  const pastSlots = start === nowDate ? Math.min(SLOTS, toSlot(roundUp(nowTime)) + 1) : 0;
  useEffect(() => {
    if (pickup >= pastSlots || pastSlots >= SLOTS) return;
    setPickup(pastSlots);
    if (start === end && dropoff <= pastSlots + 1) setDropoff(Math.min(SLOTS - 1, pastSlots + 2));
  }, [pastSlots, start, end]);  // eslint-disable-line react-hooks/exhaustive-deps
  const earliestSlot = earliest && earliest[0] === start ? toSlot(earliest[1]) : null;
  const useEarliest = () => {
    // Keep the rental length and move pickup (and the dates, if needed) to the suggestion.
    const at = new Date(quote.data!.earliest_pickup!);
    const shift = at.getTime() - new Date(`${start}T${toTime(pickup)}:00+05:30`).getTime();
    const back = new Date(new Date(`${end}T${toTime(dropoff)}:00+05:30`).getTime() + shift);
    const [pDate, pTime] = kolkata(at), [rDate, rTime] = kolkata(back);
    setPickup(toSlot(pTime)); setDropoff(toSlot(rTime));
    navigate(`/checkout/${id}?${new URLSearchParams({ start_date: pDate, end_date: rDate, pickup_time: pTime, return_time: rTime })}`, { replace: true });
  };
  const moveDays = (which: "pickup" | "return", delta: number) => {
    const next = new URLSearchParams(params);
    if (which === "pickup") {
      const s = shiftDate(start, delta), e = shiftDate(end, delta);
      if (s < rentalToday()) return;
      next.set("start_date", s); next.set("end_date", e);
    } else {
      const e = shiftDate(end, delta);
      if (e < start) return;
      next.set("end_date", e);
    }
    next.set("pickup_time", toTime(pickup)); next.set("return_time", toTime(dropoff));
    navigate(`/checkout/${id}?${next}`, { replace: true });
  };

  // Inline validation: on leaving a field, then live while it has an error. Server field errors map to their field.
  const check = (name: string, value: string) => {
    if (name === "contact_name") return value.trim().length < 2 ? "Enter the driver's full name." : "";
    if (name === "contact_phone") return value.replace(/\D/g, "").length < 7 ? "Enter a phone number the owner can call (at least 7 digits)." : "";
    return "";
  };
  const onBlur = (event: FocusEvent<HTMLInputElement>) => setErrors(e => ({ ...e, [event.target.name]: check(event.target.name, event.target.value) }));
  const onLive = (event: React.ChangeEvent<HTMLInputElement>) => { if (errors[event.target.name]) setErrors(e => ({ ...e, [event.target.name]: check(event.target.name, event.target.value) })); };

  if (!validDates) return (
    <div className="od-page"><RoadSign kind="end" title="Pick your dates first." action={<Link className="od-cta" to={id ? `/vehicles/${id}` : "/vehicles"}>Choose dates</Link>}>
      Select a pickup date and a return date on or after pickup to continue.</RoadSign></div>
  );
  if (vehicle.isPending) return <div className="od-page-loading" style={{ minHeight: "100vh" }} />;
  if (!vehicle.data) return <div className="od-page"><ErrorSign error={vehicle.error} retry={() => vehicle.refetch()} /></div>;
  const v = vehicle.data, q = quote.data;
  const due = q ? Number(q.due_now) : 0;

  return (
    <div className="od-page od-checkout" ref={root} data-chapter="Stage 4 · Trip sheet">
      <nav className="od-crumbs" aria-label="Breadcrumb">
        <Link to={`/vehicles/${id}?${new URLSearchParams({ start_date: start, end_date: end })}`} viewTransition>← {v.name}</Link>
        <span aria-current="page">Trip sheet</span>
      </nav>
      <header className="od-page-head">
        <span className="od-eyebrow">One step from the open road</span>
        <h1 tabIndex={-1}>Your trip sheet.</h1>
        <p>Set your pickup and return on the time road. Nothing is charged until the owner confirms.</p>
      </header>
      <div className="od-sheet-grid">
        <div className="od-sheet-trip">
          <section className={`od-ticket-stub${tearing ? " tearing" : ""}`}>
            <div className="od-stub-tag">
              <span className="od-tag-hole" aria-hidden="true" />
              <div style={{ viewTransitionName: photoTransition(v.id) } as React.CSSProperties}><Photo vehicle={v} /></div>
              <div><span className="od-plate mono">ML·{String(v.id).padStart(4, "0")}</span><h2>{v.name}</h2>
                <p>{v.vehicle_type} · {v.fuel_type} · hosted by {v.host_name || "a local owner"}</p></div>
            </div>
            <TimeRoad label="Pickup" day={`${shortDay(start)}`} value={pickup} blocked={pickupBlocked} earliest={earliestSlot}
              onChange={setPickup} onDay={delta => moveDays("pickup", delta)} onUseEarliest={useEarliest} />
            <TimeRoad label="Return" day={`${shortDay(end)}`} value={dropoff} blocked={start === end ? [{ from: 0, to: Math.min(SLOTS, pickup + 1) }] : []}
              onChange={setDropoff} onDay={delta => moveDays("return", delta)} />
            {q?.available === false && (
              <div className="od-alert" role="alert">
                <strong>{q.unavailable_reason}</strong>
                {q.earliest_pickup && !earliestSlot && (
                  <button type="button" className="od-cta od-cta-ghost" onClick={useEarliest}>
                    Use the earliest pickup: {dateLabel(kolkata(new Date(q.earliest_pickup))[0])}, {kolkata(new Date(q.earliest_pickup))[1]}
                  </button>
                )}
              </div>
            )}
            <p className="od-fine">Every started 24 hours counts as a rental day. Pickup opens an hour before your slot. {v.location ? `Pickup point: ${v.location}.` : ""}</p>
          </section>
          <section className="od-card">
            <span className="od-eyebrow">Who's driving</span>
            <h2>Contact for the handoff.</h2>
            <div className="od-form">
              <label className="od-field"><small>Full name</small>
                <input name="contact_name" form="od-checkout" autoComplete="name" defaultValue={session.data?.user?.name} maxLength={100} required
                  aria-invalid={Boolean(errors.contact_name)} aria-describedby="err-name" onBlur={onBlur} onChange={onLive} />
                <span className={`od-error-line${errors.contact_name ? " show" : ""}`} id="err-name">{errors.contact_name}</span></label>
              <label className="od-field"><small>Phone</small>
                <input name="contact_phone" form="od-checkout" type="tel" autoComplete="tel" maxLength={30} required
                  aria-invalid={Boolean(errors.contact_phone)} aria-describedby="err-phone" onBlur={onBlur} onChange={onLive} />
                <span className={`od-error-line${errors.contact_phone ? " show" : ""}`} id="err-phone">{errors.contact_phone}</span></label>
              <label className="od-field"><small>Pickup notes (optional)</small>
                <textarea name="pickup_notes" form="od-checkout" maxLength={1000} placeholder="Anything the owner should know for the handoff" /></label>
            </div>
          </section>
          <section className="od-card">
            <h2>Conditions.</h2>
            <p>{v.pickup_instructions || "Arrange the exact pickup point and handoff with the owner after confirmation."}</p>
            <ul className="od-conditions">
              <li>The owner has up to 24 hours to respond; a request is not yet a confirmed rental.</li>
              <li>Pending requests can be cancelled. Confirmed bookings: free until 48 hours before pickup, after that 20% of the rental is kept. The deposit is always refunded.</li>
              <li>Insurance and any extra arrangements are agreed with the owner.</li>
            </ul>
          </section>
        </div>
        <aside className="od-receipt" aria-live="polite">
          <span className="od-eyebrow">Clear pricing, no surprises</span>
          <h2>Breakdown</h2>
          {quote.isPending && <div className="od-receipt-skel" />}
          <ErrorSign error={quote.error} retry={() => quote.refetch()} />
          {q && (
            <dl className="od-receipt-lines" key={`${start}-${end}-${q.days}`}>
              <div><dt>Rental days</dt><dd className="mono">{q.days}</dd></div>
              {q.lines.filter(line => line.kind !== "deposit").map(line => (
                <div key={line.kind} className={`kind-${line.kind}`}><dt>{line.label}</dt><dd className="mono">{money(line.amount)}</dd></div>
              ))}
              <div className="od-receipt-sub"><dt>Rental total</dt><dd className="mono">{money(q.rental_total)}</dd></div>
              {Number(q.deposit) > 0 && <div className="kind-deposit"><dt>Refundable deposit <span className="od-swing-tag">returned after the trip</span></dt><dd className="mono">{money(q.deposit)}</dd></div>}
            </dl>
          )}
          {q && (
            <div className="od-receipt-total">
              <span>Due once confirmed</span>
              <span className="od-receipt-odo" aria-label={`₹${due.toLocaleString("en-IN")}`}><span className="odo-sep">₹</span><Odometer value={due.toLocaleString("en-IN")} size="md" /></span>
            </div>
          )}
          <form id="od-checkout" className="od-request" onSubmit={event => {
            event.preventDefault();
            const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
            const found = { contact_name: check("contact_name", data.contact_name ?? ""), contact_phone: check("contact_phone", data.contact_phone ?? "") };
            setErrors(found);
            if (found.contact_name || found.contact_phone || !accepted || !q || write.isPending) return;
            write.mutate({ path: "bookings/", body: { vehicle_id: v.id, start_date: start, end_date: end, checkout: true, accepted_conditions: accepted,
              pickup_time: toTime(pickup), return_time: toTime(dropoff), ...data } }, {
              onSuccess: result => {
                if (reducedMotion()) { navigate(`/bookings/${result.id}`); return; }
                setTearing(true);  // the stub tears off, then the booking page opens
                window.setTimeout(() => navigate(`/bookings/${result.id}`, { viewTransition: true }), 520);
              },
            });
          }}>
            <label className="od-check"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} required />
              <span>I've reviewed the dates, the total and the conditions.</span></label>
            {write.error && <p className="od-error" role="alert">{write.error.message}</p>}
            <button className={`od-ignition${accepted ? " on" : ""}`} disabled={!accepted || !q || q.available === false || write.isPending}>
              {write.isPending ? "Sending request…" : "Send request to the owner"}
            </button>
          </form>
          <p className="od-fine">Availability and the price are checked again when you send.</p>
        </aside>
      </div>
      <Hud />
    </div>
  );
}
