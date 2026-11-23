// The owner workspace, part 1: the instrument cluster (gauges that sweep to their values with a spring overshoot and
// rolling numbers), the departures board (split-flap rows sorted by pickup time, each with a live pickup-window bar;
// "Record pickup" slides out exactly when the window opens, with a countdown until then), the owner's view of a
// booking (the timeline road with owner-side labels) and the value report (bars that grow from the road edge).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link, NavLink, useParams, useSearchParams } from "react-router-dom";
import { api, dateLabel, money } from "../api";
import type { Booking, BookingValue, FleetVehicle } from "../api";
import { formData, useWrite } from "../requests";
import { rentalToday } from "../rentalDates";
import { Photo } from "../shared";
import { Odometer, reducedMotion } from "./primitives";
import { ErrorSign, RoadSign } from "./states";
import { State, TimelineRoad } from "./Trips";
import type { Detail } from "./Trips";
import { Hud, useChapters } from "./world";

// ----- shared pieces ---------------------------------------------------------------------------------------------

const HOUR = 3600_000;
const at = (date: string, time: string) => new Date(`${date}T${time.slice(0, 5)}:00+05:30`).getTime();
/** Mirrors the server rule: pickup opens 60 minutes before the agreed time and closes at the return time. */
export const pickupWindow = (row: Booking) => ({ opens: at(row.start_date, row.pickup_time) - HOUR, closes: at(row.end_date, row.return_time) });
const PAID = ["paid", "partially_refunded", "refunded"];
export const awaitingPayment = (row: Booking) => Boolean(row.payment_required) && !PAID.includes(row.payment?.status ?? "");
const rupees = (value: number) => money(Math.round(value)).replace(/\.00$/, "");

export function useNow(step = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), step); return () => window.clearInterval(id); }, [step]);
  return now;
}

export function countdown(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

export function OwnerNav() {
  const links: [string, string][] = [["/owner", "Overview"], ["/owner/requests", "Departures"], ["/owner/fleet", "Fleet"], ["/owner/maintenance", "Maintenance"], ["/owner/value", "Value"]];
  return (
    <nav className="od-owner-nav od-seg" aria-label="Owner workspace">
      {links.map(([to, label]) => <NavLink key={to} to={to} end={to === "/owner"} viewTransition>{label}</NavLink>)}
    </nav>
  );
}

export function OwnerPage({ chapter, eyebrow, title, lede, action, children }: { chapter: string; eyebrow: string; title: string; lede: string; action?: ReactNode; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useChapters(root, [title]);
  return (
    <div className="od-page od-owner" ref={root} data-chapter={chapter}>
      <OwnerNav />
      <header className="od-page-head od-owner-head">
        <span className="od-eyebrow">{eyebrow}</span>
        <h1 tabIndex={-1}>{title}</h1>
        <p>{lede}</p>
        {action}
      </header>
      {children}
      <Hud />
    </div>
  );
}

/** A dial: a 240-degree arc that sweeps to its value with a spring overshoot; the number rolls on an odometer. */
export function Gauge({ label, value, max, display, tone = "lane", note }: { label: string; value: number; max: number; display: string; tone?: string; note?: string }) {
  const [shown, setShown] = useState(reducedMotion() ? 1 : 0);
  useEffect(() => { const id = requestAnimationFrame(() => setShown(1)); return () => cancelAnimationFrame(id); }, []);
  const R = 52, arc = (2 * Math.PI * R * 240) / 360;
  const fraction = Math.min(1, max > 0 ? value / max : 0) * shown;
  const angle = -120 + 240 * fraction;
  return (
    <figure className={`od-gauge od-gauge-${tone}`} aria-label={`${label}: ${display}`}>
      <svg viewBox="0 0 140 120" aria-hidden="true">
        <circle cx="70" cy="68" r={R} className="od-gauge-track" strokeDasharray={`${arc} 999`} transform="rotate(150 70 68)" />
        <circle cx="70" cy="68" r={R} className="od-gauge-fill" strokeDasharray={`${arc} 999`} strokeDashoffset={arc * (1 - fraction)} transform="rotate(150 70 68)" />
        {Array.from({ length: 9 }, (_, i) => -120 + i * 30).map(a => (
          <line key={a} x1="70" y1="22" x2="70" y2={a % 60 === 0 ? 30 : 27} className="od-gauge-tick" transform={`rotate(${a} 70 68)`} />
        ))}
        <g className="od-gauge-needle" style={{ transform: `rotate(${angle}deg)` } as CSSProperties}>
          <line x1="70" y1="68" x2="70" y2="28" /><circle cx="70" cy="68" r="6" />
        </g>
      </svg>
      <Odometer value={shown ? display : display.replace(/\d/g, "0")} size="md" label={display} />
      <figcaption>{label}{note && <small>{note}</small>}</figcaption>
    </figure>
  );
}

/** Split-flap text: each character is a flap that flips over (staggered) whenever the text changes. */
export function SplitFlap({ text, width }: { text: string; width?: number }) {
  const padded = width ? text.toUpperCase().padEnd(width, " ").slice(0, width) : text.toUpperCase();
  return (
    <span className="od-flaps" aria-label={text} role="text">
      {padded.split("").map((char, i) => (
        <span key={`${padded}-${i}`} className="od-flap" style={{ "--i": i } as CSSProperties} aria-hidden="true">{char === " " ? " " : char}</span>
      ))}
    </span>
  );
}

// ----- the departures board --------------------------------------------------------------------------------------

const ACTION_LABEL: Record<string, string> = { approve: "Approve", reject: "Reject", pickup: "Record pickup", return: "Record return" };

/** The pickup window as a bar: it fills over the six hours before the window opens, is full while it is open, and
 *  for a rental on the road it shows how far through the rental time we are. */
function WindowBar({ row, now }: { row: Booking; now: number }) {
  const { opens, closes } = pickupWindow(row);
  let fill = 0, text = "", state = "waiting";
  if (row.status === "In progress") {
    const start = at(row.start_date, row.pickup_time);
    fill = Math.min(1, Math.max(0, (now - start) / Math.max(1, closes - start)));
    state = now > closes ? "late" : "road";
    text = now > closes ? `Return overdue by ${countdown(now - closes)}` : `Return due in ${countdown(closes - now)}`;
  } else if (row.status === "Confirmed") {
    if (now >= closes) { fill = 1; state = "late"; text = "Pickup window closed"; }
    else if (now >= opens) { fill = 1; state = "open"; text = `Window open · closes in ${countdown(closes - now)}`; }
    else { fill = Math.max(0, 1 - (opens - now) / (6 * HOUR)); text = `Pickup opens in ${countdown(opens - now)}`; }
  } else if (row.status === "Pending") {
    text = now < opens ? `Pickup ${countdown(opens + HOUR - now)} away` : "Pickup time has passed";
    fill = Math.max(0, 1 - (opens - now) / (6 * HOUR)); state = "pending";
  } else return <span className="od-window od-window-none mono">{row.status === "Returned" ? "Back in the bay" : "—"}</span>;
  return (
    <span className={`od-window od-window-${state}`}>
      <span className="od-window-bar" aria-hidden="true"><span style={{ transform: `scaleX(${fill.toFixed(4)})` }} /></span>
      <small className="mono" aria-live={state === "open" ? "polite" : "off"}>{text}</small>
    </span>
  );
}

function BoardRow({ row, now, onDone }: { row: Booking; now: number; onDone: () => void }) {
  const write = useWrite();
  const { opens, closes } = pickupWindow(row);
  const open = now >= opens && now < closes;
  const actions = row.status === "Pending" ? ["approve", "reject"] : row.status === "In progress" ? ["return"] : row.status === "Confirmed" ? ["pickup"] : [];
  const unpaid = row.status === "Confirmed" && awaitingPayment(row);
  return (
    <li className={`od-board-row${row.status === "Confirmed" && open ? " is-open" : ""}`} data-state={row.status}>
      <span className="od-board-time mono">
        <b>{row.pickup_time.slice(0, 5)}</b>
        <small>{dateLabel(row.start_date)}</small>
      </span>
      <span className="od-board-vehicle">
        <Photo vehicle={row.vehicle} />
        <span><Link to={`/owner/bookings/${row.id}`} viewTransition>{row.vehicle.name}</Link><small>{row.renter_name || row.contact_name} · #{row.id}</small></span>
      </span>
      <span className="od-board-state"><SplitFlap text={row.status} width={11} /><State value={row.status} /></span>
      <WindowBar row={row} now={now} />
      <span className="od-board-actions">
        {actions.map(action => {
          if (action === "pickup") {
            if (!open) return <span key={action} className="od-board-wait mono">{now < opens ? `Pickup in ${countdown(opens - now)}` : "Closed"}</span>;
            if (unpaid) return <span key={action} className="od-board-wait">Awaiting payment</span>;
          }
          return (
            <button key={action} type="button" className={`od-cta od-board-btn${action === "reject" ? " od-cta-ghost" : ""}${action === "pickup" ? " slide" : ""}`}
              disabled={write.isPending} onClick={() => write.mutate({ path: `bookings/${row.id}/${action}/` }, { onSuccess: onDone })}>
              {ACTION_LABEL[action]}
            </button>
          );
        })}
        {write.error && <span className="od-board-error" role="alert">{write.error.message}</span>}
      </span>
    </li>
  );
}

const QUEUES: [string, Booking["status"][]][] = [
  ["All", []], ["Requests", ["Pending"]], ["Pickups", ["Confirmed"]], ["On the road", ["In progress"]], ["Completed", ["Returned"]], ["Closed", ["Cancelled", "Rejected", "Expired"]],
];
const ORDER: Record<string, number> = { "In progress": 0, Confirmed: 1, Pending: 2, Returned: 3, Cancelled: 4, Rejected: 4, Expired: 4 };

export function DeparturesBoard({ rows, limit }: { rows: Booking[]; limit?: number }) {
  const now = useNow();
  const cache = useQueryClient();
  const sorted = [...rows].sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || (at(a.start_date, a.pickup_time) - at(b.start_date, b.pickup_time)));
  const shown = limit ? sorted.slice(0, limit) : sorted;
  const refresh = () => { void cache.invalidateQueries({ queryKey: ["owner-bookings"] }); void cache.invalidateQueries({ queryKey: ["values"] }); };
  if (!shown.length) return <RoadSign kind="end" title="No departures." action={<Link className="od-cta" to="/owner/fleet">Your fleet</Link>}>Requests and pickups for your vehicles appear here, sorted by pickup time.</RoadSign>;
  return (
    <div className="od-board" role="region" aria-label="Departures board">
      <div className="od-board-head mono" aria-hidden="true"><span>Pickup</span><span>Vehicle · renter</span><span>Status</span><span>Window</span><span>Action</span></div>
      <ol>{shown.map(row => <BoardRow key={row.id} row={row} now={now} onDone={refresh} />)}</ol>
    </div>
  );
}

const useOwnerBookings = () => useQuery({ queryKey: ["owner-bookings"], queryFn: () => api<Booking[]>("owner/bookings/"), refetchInterval: 30_000 });

// ----- pages ------------------------------------------------------------------------------------------------------

export function OwnerHome() {
  const bookings = useOwnerBookings();
  const fleet = useQuery({ queryKey: ["fleet"], queryFn: () => api<FleetVehicle[]>("owner/fleet/") });
  const today = rentalToday();
  const monthStart = today.slice(0, 8) + "01";
  const month = useQuery({ queryKey: ["values", `start_date=${monthStart}`], queryFn: () => api<BookingValue[]>(`owner/value/?start_date=${monthStart}`) });
  const rows = bookings.data ?? [];
  const count = (pred: (b: Booking) => boolean) => rows.filter(pred).length;
  const pending = count(b => b.status === "Pending");
  const pickups = count(b => b.status === "Confirmed" && b.start_date === today);
  const active = count(b => b.status === "In progress");
  const value = (month.data ?? []).reduce((sum, row) => sum + Number(row.value), 0);
  const listings = fleet.data?.filter(v => !v.archived_at) ?? [];
  const scale = Math.max(4, listings.length);
  const live = rows.filter(b => ["Pending", "Confirmed", "In progress"].includes(b.status));
  return (
    <OwnerPage chapter="Workspace · Overview" eyebrow="Owner workspace" title="Your instrument cluster." lede="Requests, today's pickups, rentals on the road and this month's booking value at a glance."
      action={<Link className="od-cta" to="/owner/fleet?edit=new" viewTransition>List a vehicle</Link>}>
      <ErrorSign error={bookings.error ?? fleet.error} retry={() => { void bookings.refetch(); void fleet.refetch(); }} />
      {bookings.data && fleet.data && (
        <>
          <section className="od-cluster-gauges" aria-label="Today at a glance">
            <Gauge label="Pending requests" value={pending} max={scale} display={String(pending).padStart(2, "0")} tone="pending" />
            <Gauge label="Pickups today" value={pickups} max={scale} display={String(pickups).padStart(2, "0")} tone="confirmed" />
            <Gauge label="On the road" value={active} max={Math.max(1, listings.length)} display={String(active).padStart(2, "0")} tone="progress" note={`of ${listings.length} listed`} />
            <Gauge label="Booking value this month" value={value} max={Math.max(10000, value * 1.25)} display={rupees(value)} tone="lane" />
          </section>
          {listings.length === 0 ? (
            <RoadSign kind="end" title="No vehicles yet." action={<Link className="od-cta" to="/owner/fleet?edit=new">List your first vehicle</Link>}>
              List a car or bike and requests start arriving on your departures board.
            </RoadSign>
          ) : (
            <section className="od-owner-section">
              <div className="od-section-row"><h2>Next departures</h2><Link to="/owner/requests" viewTransition>Full board →</Link></div>
              <DeparturesBoard rows={live} limit={6} />
            </section>
          )}
        </>
      )}
      {(bookings.isPending || fleet.isPending) && <div className="od-cluster-gauges od-skel-row" aria-hidden="true">{[0, 1, 2, 3].map(i => <div key={i} className="od-gauge od-skel" />)}</div>}
    </OwnerPage>
  );
}

export function OwnerRequests() {
  const bookings = useOwnerBookings();
  const [params, setParams] = useSearchParams();
  const queue = params.get("queue") ?? "All";
  const states = QUEUES.find(([name]) => name === queue)?.[1] ?? [];
  const rows = (bookings.data ?? []).filter(b => !states.length || states.includes(b.status));
  return (
    <OwnerPage chapter="Workspace · Departures" eyebrow="Departures" title="Departures board." lede="Every booking by pickup time. The pickup button appears when the window opens, an hour before the agreed time.">
      <div className="od-seg od-queue" role="group" aria-label="Queue">
        {QUEUES.map(([name, s]) => {
          const n = (bookings.data ?? []).filter(b => !s.length || s.includes(b.status)).length;
          return <button key={name} type="button" aria-pressed={queue === name} onClick={() => setParams(name === "All" ? {} : { queue: name }, { replace: true })}>{name} <span className="mono">{n}</span></button>;
        })}
      </div>
      <ErrorSign error={bookings.error} retry={() => bookings.refetch()} />
      {bookings.isPending && <div className="od-board od-skel" style={{ minHeight: 320 }} />}
      {bookings.data && <DeparturesBoard rows={rows} />}
    </OwnerPage>
  );
}

export function OwnerBooking() {
  const { id } = useParams();
  const query = useQuery({ queryKey: ["booking-detail", id], queryFn: () => api<Detail>(`bookings/${id}/`) });
  const now = useNow();
  const cache = useQueryClient();
  if (query.isPending) return <div className="od-page-loading" style={{ minHeight: "100vh" }} />;
  if (!query.data) return <div className="od-page"><RoadSign kind="end" title="Booking not found." action={<Link className="od-cta" to="/owner/requests">Departures</Link>}>It may belong to another owner.</RoadSign></div>;
  const b = query.data;
  const refresh = () => { void cache.invalidateQueries({ queryKey: ["booking-detail", id] }); void cache.invalidateQueries({ queryKey: ["owner-bookings"] }); };
  return (
    <OwnerPage chapter={`Workspace · Booking #${b.id}`} eyebrow={`Booking #${b.id} · ${b.renter_name || b.contact_name}`} title={b.vehicle.name} lede={`${dateLabel(b.start_date)} ${b.pickup_time.slice(0, 5)} to ${dateLabel(b.end_date)} ${b.return_time.slice(0, 5)} · ${money(b.total_price)}`}>
      <div className="od-trip-grid">
        <TimelineRoad booking={b} host="You" viewer="owner" />
        <div className="od-trip-side">
          <section className="od-ticket od-ticket-big">
            <div className="od-ticket-photo"><Photo vehicle={b.vehicle} /></div>
            <div className="od-ticket-body">
              <State value={b.status} />
              <dl className="od-ticket-times">
                <div><dt>Contact</dt><dd>{b.contact_name} · <a href={`tel:${b.contact_phone}`}>{b.contact_phone}</a></dd></div>
                {b.pickup_notes && <div><dt>Pickup notes</dt><dd>{b.pickup_notes}</dd></div>}
              </dl>
            </div>
          </section>
          <div className="od-board od-board-single"><ol><BoardRow row={b} now={now} onDone={refresh} /></ol></div>
        </div>
      </div>
    </OwnerPage>
  );
}

export function OwnerValue() {
  const [params, setParams] = useSearchParams();
  const query = useQuery({ queryKey: ["values", params.toString()], queryFn: () => api<BookingValue[]>(`owner/value/?${params}`) });
  const rows = useMemo(() => [...(query.data ?? [])].sort((a, b) => Number(b.value) - Number(a.value)), [query.data]);
  const total = rows.reduce((sum, row) => sum + Number(row.value), 0);
  const top = Math.max(1, ...rows.map(r => Number(r.value)));
  const [hover, setHover] = useState<BookingValue | null>(null);
  const [grown, setGrown] = useState(reducedMotion());
  useEffect(() => { if (!query.data) return; const id = requestAnimationFrame(() => setGrown(true)); return () => cancelAnimationFrame(id); }, [query.data]);
  const exportCsv = () => {
    const csv = ["Vehicle,Completed rentals,Booking value (INR)", ...rows.map(row => `"${("'" + row.vehicle__name).replaceAll('"', '""')}",${row.bookings},${row.value}`)].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a"); link.href = url; link.download = "motorlane-booking-value.csv"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <OwnerPage chapter="Workspace · Value" eyebrow="Value report" title="What the fleet earned." lede="Completed (returned) rentals by vehicle, for any date range.">
      <form className="od-value-filters" key={params.toString()} onSubmit={e => { const body = formData(e); setParams(Object.fromEntries([...body.entries()].filter(([, v]) => v).map(([k, v]) => [k, String(v)]))); }}>
        <label><small>From</small><input type="date" name="start_date" defaultValue={params.get("start_date") ?? ""} /></label>
        <label><small>To</small><input type="date" name="end_date" defaultValue={params.get("end_date") ?? ""} /></label>
        <button className="od-cta">Show</button>
        {rows.length > 0 && <button type="button" className="od-cta od-cta-ghost" onClick={exportCsv}>Export CSV</button>}
      </form>
      <ErrorSign error={query.error} retry={() => query.refetch()} />
      {query.data && (rows.length === 0 ? (
        <RoadSign kind="end" title="No value yet." action={<Link className="od-cta" to="/owner/requests">Departures board</Link>}>Value appears once a rental in this range is returned.</RoadSign>
      ) : (
        <div className="od-value">
          <section className="od-value-totals" aria-live="polite">
            <Gauge label={hover ? hover.vehicle__name : "Total booking value"} value={hover ? Number(hover.value) : total} max={total} display={rupees(hover ? Number(hover.value) : total)} tone="lane" />
            <p className="mono">{hover ? `${hover.bookings} completed rental${hover.bookings === 1 ? "" : "s"}` : `${rows.reduce((s, r) => s + r.bookings, 0)} completed · ${rows.length} vehicle${rows.length === 1 ? "" : "s"}`}</p>
          </section>
          <ol className="od-value-bars" aria-label="Booking value by vehicle">
            {rows.map((row, i) => (
              <li key={row.vehicle_id}>
                <button type="button" onMouseEnter={() => setHover(row)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(row)} onBlur={() => setHover(null)}
                  aria-label={`${row.vehicle__name}: ${money(row.value)} from ${row.bookings} rentals`}>
                  <span className="od-value-name">{row.vehicle__name}</span>
                  <span className="od-value-track"><span className="od-value-fill" style={{ transform: `scaleX(${grown ? Number(row.value) / top : 0})`, transitionDelay: `${i * 70}ms` }} /></span>
                  <span className="od-value-amt mono">{rupees(Number(row.value))}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ))}
      {query.isPending && <div className="od-value od-skel" style={{ minHeight: 320 }} />}
    </OwnerPage>
  );
}
