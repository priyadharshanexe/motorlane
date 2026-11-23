// The owner workspace, part 2: the fleet as key tags with status plates; the listing sheet in two steps (details with
// a live rate tag that rolls as you type, then photos); the photo manager (drag or keyboard to reorder with a layout
// spring, drop on the cover plate, upload progress as a road filling, a lane-wipe on the new thumbnail); and
// maintenance (drag across the calendar to paint a hatched block; a clash flashes the booking it hits).
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, dateLabel, money } from "../api";
import type { Booking, FleetVehicle, Maintenance, VehiclePhoto } from "../api";
import { useSession, useWrite } from "../requests";
import { rentalToday } from "../rentalDates";
import { Photo } from "../shared";
import { Odometer, reducedMotion } from "./primitives";
import { ErrorSign, RoadSign } from "./states";
import { OwnerPage } from "./Owner";

const useFleet = () => useQuery({ queryKey: ["fleet"], queryFn: () => api<FleetVehicle[]>("owner/fleet/") });
const plate = (id: number) => `ML·${String(id).padStart(4, "0")}`;
const whole = (v: string | number | null | undefined) => (v === "" || v == null ? "" : String(Math.round(Number(v))));
const ACTIVE: Booking["status"][] = ["Pending", "Confirmed", "In progress"];

/** Today's maintenance per vehicle, so the fleet's status plates can say "In the workshop". */
function useMaintenance(vehicles: FleetVehicle[]) {
  return useQueries({
    queries: vehicles.map(v => ({ queryKey: ["maintenance", String(v.id)], queryFn: () => api<Maintenance[]>(`owner/fleet/${v.id}/maintenance/`) })),
  });
}

function plateFor(v: FleetVehicle, blocks?: Maintenance[]) {
  const today = rentalToday();
  if (v.archived_at) return ["Archived", "archived"];
  if (blocks?.some(b => b.start_date <= today && today <= b.end_date)) return ["In the workshop", "maintenance"];
  return v.is_available ? ["Listed", "listed"] : ["Paused", "paused"];
}

// ----- fleet -----------------------------------------------------------------------------------------------------

export function OwnerFleet() {
  const fleet = useFleet();
  const [params, setParams] = useSearchParams();
  const [show, setShow] = useState<"active" | "archived">("active");
  const vehicles = (fleet.data ?? []).filter(v => (show === "archived") === Boolean(v.archived_at));
  const maintenance = useMaintenance((fleet.data ?? []).filter(v => !v.archived_at));
  const blocksFor = (id: number) => maintenance[(fleet.data ?? []).filter(v => !v.archived_at).findIndex(v => v.id === id)]?.data;
  const edit = params.get("edit");
  const editing = edit === "new" ? "new" : fleet.data?.find(v => String(v.id) === edit && !v.archived_at);
  return (
    <OwnerPage chapter="Workspace · Fleet" eyebrow="Your fleet" title="Keys on the board." lede="Every vehicle you list, with its rates and where it stands today."
      action={<button type="button" className="od-cta" onClick={() => setParams({ edit: "new" })}>List a vehicle</button>}>
      {editing && <ListingSheet key={edit} vehicle={editing === "new" ? undefined : editing} onClose={() => setParams({})} />}
      {/* opening a listing by link: wait for the fleet so the sheet does not appear above content and push it down */}
      {edit && edit !== "new" && !fleet.data ? <div style={{ minHeight: "100vh" }} aria-busy="true" /> : <>
      <div className="od-seg od-queue" role="group" aria-label="Show">
        <button type="button" aria-pressed={show === "active"} onClick={() => setShow("active")}>On the board</button>
        <button type="button" aria-pressed={show === "archived"} onClick={() => setShow("archived")}>Archived</button>
      </div>
      <ErrorSign error={fleet.error} retry={() => fleet.refetch()} />
      {fleet.isPending && <div className="od-fleet">{[0, 1, 2].map(i => <div key={i} className="od-fleet-tag od-skel" />)}</div>}
      {fleet.data && vehicles.length === 0 && (show === "active"
        ? <RoadSign kind="end" title="No vehicles yet." action={<button type="button" className="od-cta" onClick={() => setParams({ edit: "new" })}>List your first vehicle</button>}>Add a car or bike with a photo and a daily rate; it goes on the marketplace straight away.</RoadSign>
        : <RoadSign kind="end" title="Nothing archived.">Archived listings keep their booking history and show up here.</RoadSign>)}
      <ul className="od-fleet">
        {vehicles.map((v, i) => <FleetTag key={v.id} vehicle={v} index={i} blocks={blocksFor(v.id)} onEdit={() => setParams({ edit: String(v.id) })} />)}
      </ul>
      </>}
    </OwnerPage>
  );
}

function FleetTag({ vehicle: v, index, blocks, onEdit }: { vehicle: FleetVehicle; index: number; blocks?: Maintenance[]; onEdit: () => void }) {
  const write = useWrite();
  const [confirming, setConfirming] = useState(false);
  const [label, tone] = plateFor(v, blocks);
  return (
    <li className="od-fleet-tag" style={{ "--i": index } as CSSProperties}>
      <span className="od-fleet-ring" aria-hidden="true" />
      <div className="od-fleet-photo"><Photo vehicle={v} /></div>
      <div className="od-fleet-body">
        <span className="od-fleet-plate mono">{plate(v.id)}</span>
        <h2>{v.name}</h2>
        <p>{v.vehicle_type} · {v.fuel_type} · {v.location || "Location on request"}</p>
        <p className="od-fleet-rates mono">{money(v.price_per_day)}/day{v.weekend_price_per_day ? ` · Sat–Sun ${money(v.weekend_price_per_day)}` : ""}{Number(v.deposit) > 0 ? ` · deposit ${money(v.deposit!)}` : ""}</p>
        <span className={`od-status-plate od-status-${tone}`}>{label}</span>
      </div>
      {!v.archived_at && (
        <div className="od-fleet-actions">
          <button type="button" className="od-cta" onClick={onEdit}>Edit</button>
          <Link className="od-cta od-cta-ghost" to={`/owner/fleet/${v.id}/maintenance`} viewTransition>Maintenance</Link>
          <button type="button" className="od-linkbtn" disabled={write.isPending}
            onClick={() => write.mutate({ path: `owner/fleet/${v.id}/`, method: "PATCH", body: { is_available: !v.is_available } })}>
            {v.is_available ? "Pause listing" : "List again"}
          </button>
          {confirming ? (
            <span className="od-confirm" role="group" aria-label={`Archive ${v.name}?`}>
              Archive? <button type="button" className="od-linkbtn od-danger-text" disabled={write.isPending}
                onClick={() => write.mutate({ path: `owner/fleet/${v.id}/`, method: "DELETE" }, { onSuccess: () => setConfirming(false) })}>Yes, archive</button>
              <button type="button" className="od-linkbtn" onClick={() => setConfirming(false)}>Keep</button>
            </span>
          ) : <button type="button" className="od-linkbtn" onClick={() => setConfirming(true)}>Archive</button>}
          {write.error && <p className="od-error" role="alert">{write.error.message}</p>}
        </div>
      )}
    </li>
  );
}

// ----- listing sheet ---------------------------------------------------------------------------------------------

function ListingSheet({ vehicle, onClose }: { vehicle?: FleetVehicle; onClose: () => void }) {
  const [step, setStep] = useState<"details" | "photos">("details");
  const [params, setParams] = useSearchParams();
  const fleet = useFleet();
  const current = vehicle ?? fleet.data?.find(v => String(v.id) === params.get("created"));
  const write = useWrite<FleetVehicle>();
  const [rates, setRates] = useState({ day: whole(vehicle?.price_per_day), weekend: whole(vehicle?.weekend_price_per_day), deposit: whole(vehicle?.deposit ?? "0") });
  const [cover, setCover] = useState<string>();
  useEffect(() => () => { if (cover) URL.revokeObjectURL(cover); }, [cover]);
  const sheet = useRef<HTMLElement>(null);
  useEffect(() => { sheet.current?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" }); sheet.current?.querySelector<HTMLElement>("input")?.focus({ preventScroll: true }); }, []);
  const title = current ? `Edit ${current.name}` : "List a vehicle";
  return (
    <section className="od-listing" ref={sheet} aria-label={title}>
      <header>
        <h2>{title}</h2>
        <ol className="od-steps">
          <li aria-current={step === "details" ? "step" : undefined}><button type="button" onClick={() => setStep("details")}>1 · Details</button></li>
          <li aria-current={step === "photos" ? "step" : undefined}><button type="button" disabled={!current} onClick={() => setStep("photos")}>2 · Photos</button></li>
        </ol>
        <button type="button" className="od-linkbtn" onClick={onClose}>Close</button>
      </header>
      {step === "details" ? (
        <form className="od-listing-form" onSubmit={event => {
          event.preventDefault();
          const body = new FormData(event.currentTarget);
          const image = body.get("vehicle_image");
          if (image instanceof File && !image.size) body.delete("vehicle_image");
          write.mutate({ path: current ? `owner/fleet/${current.id}/` : "owner/fleet/", method: current ? "PATCH" : "POST", body }, {
            onSuccess: saved => {
              if (!current && saved?.id) setParams({ edit: "new", created: String(saved.id) }, { replace: true });
              setStep("photos");
            },
          });
        }}>
          <div className="od-listing-grid">
            <label><small>Vehicle name</small><input name="name" required maxLength={100} defaultValue={current?.name} /></label>
            <label><small>Type</small><select name="vehicle_type" defaultValue={current?.vehicle_type ?? "Car"}><option>Car</option><option>Bike</option></select></label>
            <label><small>Fuel</small><input name="fuel_type" required maxLength={50} defaultValue={current?.fuel_type} placeholder="Petrol" /></label>
            <label><small>Location</small><input name="location" maxLength={100} defaultValue={current?.location ?? ""} placeholder="Anna Nagar, Chennai" /></label>
            <label><small>Daily rate (₹)</small><input type="number" name="price_per_day" min=".01" step=".01" required defaultValue={current?.price_per_day} onInput={e => { const v = whole(e.currentTarget.value); setRates(r => ({ ...r, day: v })); }} /></label>
            <label><small>Weekend rate (₹) · optional, Sat and Sun</small><input type="number" name="weekend_price_per_day" min=".01" step=".01" placeholder="Same as daily" defaultValue={current?.weekend_price_per_day ?? ""} onInput={e => { const v = whole(e.currentTarget.value); setRates(r => ({ ...r, weekend: v })); }} /></label>
            <label><small>Refundable deposit (₹)</small><input type="number" name="deposit" min="0" step=".01" defaultValue={current?.deposit ?? "0"} onInput={e => { const v = whole(e.currentTarget.value); setRates(r => ({ ...r, deposit: v })); }} /></label>
            <label><small>Transmission</small><select name="transmission" defaultValue={current?.transmission || ""}><option value="">Not specified</option><option>Automatic</option><option>Manual</option></select></label>
            <label><small>Seats</small><input type="number" name="seats" min="1" max="50" defaultValue={current?.seats ?? ""} /></label>
            <label><small>Model year</small><input type="number" name="model_year" min="1900" max="2100" defaultValue={current?.model_year ?? ""} /></label>
            <label className="wide"><small>About this vehicle</small><textarea name="description" maxLength={3000} defaultValue={current?.description} /></label>
            <label className="wide"><small>Pickup instructions</small><textarea name="pickup_instructions" maxLength={1000} defaultValue={current?.pickup_instructions} /></label>
            <label className="wide od-file"><small>{current ? "Replace the cover photo (optional)" : "Cover photo"}</small>
              <input type="file" name="vehicle_image" accept="image/jpeg,image/png,image/webp" required={!current}
                onChange={e => { const f = e.target.files?.[0]; setCover(f ? URL.createObjectURL(f) : undefined); }} />
            </label>
          </div>
          <aside className="od-rate-preview" aria-live="polite">
            <span className="od-swing-tag od-rate-tag">
              {cover ? <img src={cover} alt="" /> : current && <Photo vehicle={current} />}
              <b className="mono">Mon–Fri <Odometer value={`₹${rates.day || "0"}`} size="md" /></b>
              <b className="mono">Sat–Sun <Odometer value={`₹${rates.weekend || rates.day || "0"}`} size="md" /></b>
              <b className="mono">Deposit <Odometer value={`₹${rates.deposit || "0"}`} size="md" /></b>
            </span>
            <p className="od-fine">Renters see the weekend rate on Saturdays and Sundays; the deposit comes back after the return.</p>
          </aside>
          {write.error && <p className="od-error" role="alert">{write.error.message}</p>}
          <div className="od-listing-actions">
            <button className="od-cta" disabled={write.isPending}>{write.isPending ? "Saving…" : current ? "Save and go to photos" : "Create listing"}</button>
            <button type="button" className="od-cta od-cta-ghost" onClick={onClose}>Cancel</button>
          </div>
        </form>
      ) : current && (
        <>
          <PhotoManager vehicle={current} />
          <div className="od-listing-actions"><button type="button" className="od-cta" onClick={onClose}>Done</button></div>
        </>
      )}
    </section>
  );
}

// ----- photo manager ---------------------------------------------------------------------------------------------

function upload(path: string, file: File, csrf: string, onProgress: (p: number) => void) {
  return new Promise<VehiclePhoto>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/v1/${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-CSRFToken", csrf);
    xhr.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: unknown = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status < 300) resolve(body as VehiclePhoto);
      else reject(new Error(body && typeof body === "object" ? Object.values(body).flat().join(" ") : `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."));
    const form = new FormData(); form.append("image", file); xhr.send(form);
  });
}

function PhotoManager({ vehicle }: { vehicle: FleetVehicle }) {
  const base = `owner/fleet/${vehicle.id}/photos/`;
  const photos = useQuery({ queryKey: ["fleet-photos", vehicle.id], queryFn: () => api<VehiclePhoto[]>(base) });
  const cache = useQueryClient();
  const session = useSession();
  const write = useWrite();
  const [order, setOrder] = useState<number[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [overCover, setOverCover] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [fresh, setFresh] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  useEffect(() => { if (photos.data) setOrder(photos.data.map(p => p.id)); }, [photos.data]);
  const byId = useMemo(() => new Map((photos.data ?? []).map(p => [p.id, p])), [photos.data]);
  const grid = useRef<HTMLOListElement>(null), coverSlot = useRef<HTMLDivElement>(null);
  const refresh = () => { void cache.invalidateQueries({ queryKey: ["fleet-photos", vehicle.id] }); void cache.invalidateQueries({ queryKey: ["fleet"] }); };
  const saveOrder = (ids: number[]) => write.mutate({ path: `${base}order/`, body: { order: ids } }, { onSuccess: refresh, onError: e => { setError(e.message); refresh(); } });
  const makeCover = (id: number) => write.mutate({ path: `${base}${id}/`, method: "PATCH", body: { cover: true } }, { onSuccess: () => { setSaid("Cover photo changed."); refresh(); } });

  const onPointerDown = (id: number) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    const item = e.currentTarget;
    let moved = false, current = [...order];
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
      if (!moved) { moved = true; setDragging(id); }
      item.style.setProperty("--dx", `${ev.clientX - start.x}px`); item.style.setProperty("--dy", `${ev.clientY - start.y}px`);
      const c = coverSlot.current?.getBoundingClientRect();
      setOverCover(Boolean(c && ev.clientX >= c.left && ev.clientX <= c.right && ev.clientY >= c.top && ev.clientY <= c.bottom));
      const target = [...(grid.current?.children ?? [])].find(el => {
        if (el === item) return false;
        const r = el.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      }) as HTMLElement | undefined;
      const over = target ? Number(target.dataset.id) : null;
      if (over != null) {
        const next = current.filter(x => x !== id);
        next.splice(next.indexOf(over) + (current.indexOf(over) > current.indexOf(id) ? 1 : 0), 0, id);
        if (next.join() !== current.join()) {
          // The dragged tile's offset is relative to where it started; re-anchor so it stays under the pointer.
          const before = item.getBoundingClientRect();
          current = next; setOrder(next);
          requestAnimationFrame(() => { const after = item.getBoundingClientRect(); start.x += after.left - before.left; start.y += after.top - before.top; });
        }
      }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      item.style.removeProperty("--dx"); item.style.removeProperty("--dy");
      setDragging(null); setOverCover(false);
      if (!moved) return;
      const c = coverSlot.current?.getBoundingClientRect();
      if (c && ev.clientX >= c.left && ev.clientX <= c.right && ev.clientY >= c.top && ev.clientY <= c.bottom) { setOrder(photos.data?.map(p => p.id) ?? []); makeCover(id); return; }
      if (current.join() !== (photos.data ?? []).map(p => p.id).join()) { saveOrder(current); setSaid("Photo order saved."); }
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const onKey = (id: number) => (e: KeyboardEvent<HTMLElement>) => {
    const i = order.indexOf(id);
    const delta = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
    if (e.key === "c" || e.key === "C") { e.preventDefault(); makeCover(id); return; }
    if (!delta || i + delta < 0 || i + delta >= order.length) return;
    e.preventDefault();
    const next = [...order]; next.splice(i, 1); next.splice(i + delta, 0, id);
    setOrder(next); saveOrder(next); setSaid(`Moved to position ${i + delta + 1} of ${next.length}.`);
    requestAnimationFrame(() => (grid.current?.querySelector(`[data-id="${id}"]`) as HTMLElement | null)?.focus());
  };
  const cover = photos.data?.find(p => p.is_cover);
  return (
    <div className="od-photos">
      <div className={`od-cover-plate${overCover ? " over" : ""}`} ref={coverSlot}>
        <small>Cover plate</small>
        {cover ? <img key={cover.id} src={cover.small} alt="Current cover" /> : <span>Drop a photo here</span>}
        <p className="od-fine">Drag a photo onto the plate to make it the cover on cards.</p>
      </div>
      <div className="od-photo-grid-wrap">
        <p className="od-fine" id="photo-help">Drag to reorder, or focus a photo and use the arrow keys; press C to make it the cover.</p>
        <ol className="od-photo-grid" ref={grid} aria-describedby="photo-help">
          {order.map((id, i) => {
            const photo = byId.get(id);
            if (!photo) return null;
            return (
              <motion.li layout={!reducedMotion()} transition={{ type: "spring", stiffness: 520, damping: 34 }} key={id} data-id={id} tabIndex={0}
                className={`od-photo${dragging === id ? " dragging" : ""}${fresh === id ? " fresh" : ""}${photo.is_cover ? " is-cover" : ""}`}
                aria-label={`Photo ${i + 1} of ${order.length}${photo.is_cover ? ", cover" : ""}`}
                onPointerDown={onPointerDown(id)} onKeyDown={onKey(id)}>
                <img src={photo.small} alt="" draggable={false} />
                <span className="od-photo-n mono">{i + 1}</span>
                <button type="button" className="od-photo-x" aria-label={`Remove photo ${i + 1}`} disabled={write.isPending || order.length < 2}
                  onClick={() => write.mutate({ path: `${base}${id}/`, method: "DELETE" }, { onSuccess: refresh })}>×</button>
              </motion.li>
            );
          })}
        </ol>
        <label className={`od-upload${progress != null ? " busy" : ""}`}>
          <span className="od-upload-road" aria-hidden="true"><span style={{ transform: `scaleX(${progress ?? 0})` }} /></span>
          <span>{progress != null ? `Uploading… ${Math.round(progress * 100)}%` : order.length >= 8 ? "8 photos is the limit" : "Add a photo"}</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={progress != null || order.length >= 8}
            onChange={async e => {
              const file = e.target.files?.[0]; e.target.value = "";
              if (!file) return;
              setError(null); setProgress(0);
              try {
                const added = await upload(base, file, session.data?.csrf_token ?? "", setProgress);
                setFresh(added?.id ?? null); setSaid("Photo added."); refresh();
                window.setTimeout(() => setFresh(null), 1200);
              } catch (err) { setError(err instanceof Error ? err.message : "Upload failed."); }
              finally { setProgress(null); }
            }} />
        </label>
        {(error || write.error) && <p className="od-error" role="alert">{error ?? write.error?.message}</p>}
        <p className="sr-only" aria-live="polite">{said}</p>
      </div>
    </div>
  );
}

// ----- maintenance -----------------------------------------------------------------------------------------------

export function OwnerMaintenanceIndex() {
  const fleet = useFleet();
  const vehicles = (fleet.data ?? []).filter(v => !v.archived_at);
  const maintenance = useMaintenance(vehicles);
  return (
    <OwnerPage chapter="Workspace · Maintenance" eyebrow="Maintenance" title="The workshop." lede="Pick a vehicle to block dates for servicing; renters can't book them.">
      <ErrorSign error={fleet.error} retry={() => fleet.refetch()} />
      {fleet.data && vehicles.length === 0 && <RoadSign kind="maintenance" title="No vehicles to service." action={<Link className="od-cta" to="/owner/fleet?edit=new">List a vehicle</Link>}>Once you list a vehicle you can block dates for its servicing here.</RoadSign>}
      <ul className="od-fleet od-fleet-compact">
        {vehicles.map((v, i) => {
          const upcoming = (maintenance[i]?.data ?? []).filter(b => b.end_date >= rentalToday());
          const [label, tone] = plateFor(v, maintenance[i]?.data);
          return (
            <li className="od-fleet-tag" key={v.id} style={{ "--i": i } as CSSProperties}>
              <span className="od-fleet-ring" aria-hidden="true" />
              <div className="od-fleet-photo"><Photo vehicle={v} /></div>
              <div className="od-fleet-body">
                <span className="od-fleet-plate mono">{plate(v.id)}</span>
                <h2>{v.name}</h2>
                <p>{upcoming.length ? `${upcoming.length} block${upcoming.length > 1 ? "s" : ""} ahead · next ${dateLabel(upcoming[0].start_date)}` : "Nothing scheduled"}</p>
                <span className={`od-status-plate od-status-${tone}`}>{label}</span>
              </div>
              <div className="od-fleet-actions"><Link className="od-cta" to={`/owner/fleet/${v.id}/maintenance`} viewTransition>Open the calendar</Link></div>
            </li>
          );
        })}
      </ul>
    </OwnerPage>
  );
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (value: string, n: number) => { const d = new Date(value + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };

export function OwnerMaintenance() {
  const { id } = useParams();
  const navigate = useNavigate();
  const fleet = useFleet();
  const vehicle = fleet.data?.find(v => String(v.id) === id);
  const path = `owner/fleet/${id}/maintenance/`;
  const blocks = useQuery({ queryKey: ["maintenance", String(id)], queryFn: () => api<Maintenance[]>(path) });
  const bookings = useQuery({ queryKey: ["owner-bookings"], queryFn: () => api<Booking[]>("owner/bookings/") });
  const write = useWrite();
  const today = rentalToday();
  const [monthOffset, setMonthOffset] = useState(0);
  const [range, setRange] = useState<[string, string] | null>(null);
  const [painting, setPainting] = useState(false);
  const [flash, setFlash] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const trips = (bookings.data ?? []).filter(b => String(b.vehicle.id) === id && ACTIVE.includes(b.status));
  const months = [0, 1].map(k => { const d = new Date(today + "T00:00:00"); d.setDate(1); d.setMonth(d.getMonth() + monthOffset + k); return d; });
  const [from, to] = range ? (range[0] <= range[1] ? range : [range[1], range[0]]) : ["", ""];
  const clash = range ? trips.find(b => b.start_date <= to && from <= b.end_date) : undefined;
  const blockClash = range ? blocks.data?.find(b => b.start_date <= to && from <= b.end_date) : undefined;
  useEffect(() => {
    if (!clash) return;
    setFlash(clash.id);
    const t = window.setTimeout(() => setFlash(null), 1400);
    return () => window.clearTimeout(t);
  }, [clash?.id]);  // eslint-disable-line react-hooks/exhaustive-deps
  const dayState = (day: string) => {
    if (blocks.data?.some(b => b.start_date <= day && day <= b.end_date)) return "blocked";
    const trip = trips.find(b => b.start_date <= day && day <= b.end_date);
    if (trip) return flash === trip.id ? "booked flash" : "booked";
    return "";
  };
  const onDown = (day: string) => (e: ReactPointerEvent) => { if (day < today) return; e.preventDefault(); (e.target as HTMLElement).releasePointerCapture?.(e.pointerId); setPainting(true); setRange([day, day]); write.reset(); };
  const onEnter = (day: string) => () => { if (painting && day >= today) setRange(r => (r ? [r[0], day] : r)); };
  useEffect(() => { const up = () => setPainting(false); window.addEventListener("pointerup", up); return () => window.removeEventListener("pointerup", up); }, []);
  const onKeyDay = (day: string) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (day < today) return; setRange(r => (r && r[0] === r[1] && !e.shiftKey ? [r[0], day] : [day, day])); return; }
    if (!step) return;
    e.preventDefault();
    const next = addDays(day, step);
    if (e.shiftKey && range) setRange([range[0], next]);
    (document.querySelector(`[data-day="${next}"]`) as HTMLElement | null)?.focus();
  };
  if (!fleet.data) return <div className="od-page-loading" style={{ minHeight: "100vh" }} />;  // the title wraps once the name is known
  if (!vehicle) return <OwnerPage chapter="Workspace · Maintenance" eyebrow="Maintenance" title="Vehicle not found." lede=""><RoadSign kind="end" title="Not in your fleet." action={<Link className="od-cta" to="/owner/maintenance">The workshop</Link>}>It may be archived or belong to another owner.</RoadSign></OwnerPage>;
  return (
    <OwnerPage chapter={`Workspace · ${vehicle?.name ?? "Maintenance"}`} eyebrow={`Maintenance · ${vehicle ? plate(vehicle.id) : ""}`} title={vehicle?.name ?? "…"} lede="Drag across the calendar to block days for servicing. Booked days are marked; a block can't cover them.">
      <nav className="od-crumbs" aria-label="Breadcrumb"><Link to="/owner/maintenance" viewTransition>← The workshop</Link></nav>
      <div className="od-maint">
        <div className="od-cal-wrap">
          <div className="od-cal-nav">
            <button type="button" className="od-linkbtn" disabled={monthOffset === 0} onClick={() => setMonthOffset(m => m - 1)}>← Earlier</button>
            <span className="od-cal-key"><i className="booked" /> Booked <i className="blocked" /> Blocked <i className="sel" /> Your selection</span>
            <button type="button" className="od-linkbtn" onClick={() => setMonthOffset(m => m + 1)}>Later →</button>
          </div>
          <div className="od-cals" onPointerLeave={() => setPainting(false)}>
            {months.map(m => {
              const first = new Date(m), lead = (first.getDay() + 6) % 7, days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
              return (
                <section className="od-cal" key={iso(m)} aria-label={m.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}>
                  <h3>{m.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h3>
                  <div className="od-cal-grid" role="grid">
                    {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="od-cal-dow" aria-hidden="true">{d}</span>)}
                    {Array.from({ length: lead }, (_, i) => <span key={`x${i}`} />)}
                    {Array.from({ length: days }, (_, i) => {
                      const day = iso(new Date(m.getFullYear(), m.getMonth(), i + 1));
                      const selected = range && from <= day && day <= to;
                      return (
                        <button type="button" key={day} data-day={day} className={`od-day ${dayState(day)}${selected ? " sel" : ""}${day === today ? " today" : ""}`}
                          disabled={day < today} aria-pressed={Boolean(selected)} aria-label={`${dateLabel(day)}${dayState(day) ? `, ${dayState(day).split(" ")[0]}` : ""}`}
                          onPointerDown={onDown(day)} onPointerEnter={onEnter(day)} onKeyDown={onKeyDay(day)}>{i + 1}</button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
        <aside className="od-maint-side">
          <form className={`od-card od-block-form${range ? " ready" : ""}`} onSubmit={e => {
            e.preventDefault();
            if (!range) return;
            write.mutate({ path, body: { start_date: from, end_date: to, reason } }, { onSuccess: () => { setRange(null); setReason(""); } });
          }}>
            <h2>{range ? `${dateLabel(from)}${from !== to ? ` – ${dateLabel(to)}` : ""}` : "Paint a block"}</h2>
            {!range && <p>Press on a day and drag to another; or use the arrow keys and Enter on two days.</p>}
            {clash && <p className="od-alert" role="alert">That covers booking #{clash.id} ({clash.renter_name || clash.contact_name}, {dateLabel(clash.start_date)}–{dateLabel(clash.end_date)}). Pick days around it.</p>}
            {!clash && blockClash && <p className="od-alert" role="alert">That overlaps “{blockClash.reason}”.</p>}
            {range && <label><small>Reason</small><input required maxLength={120} value={reason} onChange={e => setReason(e.target.value)} placeholder="Annual service" /></label>}
            {write.error && <p className="od-error" role="alert">{write.error.message}</p>}
            {range && <div className="od-listing-actions"><button className="od-cta" disabled={write.isPending || Boolean(clash) || Boolean(blockClash)}>Block these days</button><button type="button" className="od-linkbtn" onClick={() => setRange(null)}>Clear</button></div>}
          </form>
          <section className="od-card">
            <h2>Blocked</h2>
            <ErrorSign error={blocks.error} retry={() => blocks.refetch()} />
            {blocks.data?.length === 0 && <p>No maintenance scheduled.</p>}
            <ul className="od-blocks">
              {blocks.data?.map(b => (
                <li key={b.id}><span><b>{b.reason}</b><small className="mono">{dateLabel(b.start_date)} – {dateLabel(b.end_date)}</small></span>
                  <button type="button" className="od-linkbtn" disabled={write.isPending} onClick={() => write.mutate({ path: `${path}${b.id}/`, method: "DELETE" })}>Remove</button></li>
              ))}
            </ul>
          </section>
          {trips.length > 0 && (
            <section className="od-card">
              <h2>Booked</h2>
              <ul className="od-blocks">
                {trips.map(b => <li key={b.id} className={flash === b.id ? "flash" : ""}><span><b>#{b.id} · {b.renter_name || b.contact_name}</b><small className="mono">{dateLabel(b.start_date)} – {dateLabel(b.end_date)} · {b.status}</small></span>
                  <button type="button" className="od-linkbtn" onClick={() => navigate(`/owner/bookings/${b.id}`, { viewTransition: true })}>Open</button></li>)}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </OwnerPage>
  );
}
