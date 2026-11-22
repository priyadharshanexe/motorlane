// Vehicle detail: the key tag's photo morphs into the gallery (a named View Transition), the gallery swipes with
// momentum and snaps (arrow keys too), the spec plates stamp in one by one, and the reservation panel stays in
// view. The reservation logic (dates, availability, quote, checkout) is the same as before the redesign.
import { useQuery } from "@tanstack/react-query";
import { motion, MotionConfig } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { VehicleDetail as Detail } from "../api";
import { FavoriteButton, Rating } from "../Favorites";
import { overlapsUnavailableDates } from "../marketplaceData";
import { Price, PriceBreakdown } from "../Pricing";
import { RentalCalendar } from "../RentalCalendar";
import { useSession } from "../requests";
import { Busy, Notice } from "../shared";
import { photoTransition } from "./KeyTag";
import { reducedMotion } from "./primitives";

export function VehicleDetail() {
  const { id } = useParams(), [params] = useSearchParams();
  return <Reservation key={id} id={id} params={params} />;
}

function Reservation({ id, params }: { id: string | undefined; params: URLSearchParams }) {
  const [start, setStart] = useState(params.get("start_date") || ""), [end, setEnd] = useState(params.get("end_date") || "");
  const query = useQuery({ queryKey: ["vehicle", id], queryFn: () => api<Detail>(`vehicles/${id}/`) });
  const blocked = overlapsUnavailableDates(query.data?.unavailable || [], start, end) && start <= end;
  const valid = Boolean(start && end && start <= end && !blocked);
  const qp = new URLSearchParams({ start_date: start, end_date: end });
  const quote = useQuery({
    queryKey: ["quote", id, start, end], enabled: valid, retry: false,
    queryFn: ({ signal }) => api<{ days: number; total_price: string }>(`vehicles/${id}/quote/?${qp}`, { signal }),
  });
  const navigate = useNavigate(), session = useSession();
  if (query.isPending) return <Busy />;
  if (!query.data) return <Notice error={query.error} />;
  const v = query.data, ready = valid && Boolean(quote.data) && !quote.isError;
  const back = new URLSearchParams(params);
  back.delete("start_date"); back.delete("end_date");
  const specs: [string, string | number][] = [
    ["Type", v.vehicle_type], ["Fuel", v.fuel_type], ["Gearbox", v.transmission || "—"],
    ["Seats", v.seats || "—"], ["Year", v.model_year || "—"], ["Pickup", v.location || "With host"],
  ];
  return (
    <MotionConfig reducedMotion="user">
      <div className="od-detail">
        <nav className="od-crumbs" aria-label="Breadcrumb">
          <Link to={`/vehicles${params.toString() ? "?" + params : ""}`} viewTransition>← Explore vehicles</Link>
          <span aria-current="page">{v.name}</span>
        </nav>
        <section className="od-detail-main">
          <Gallery vehicle={v} />
          <header className="od-detail-head">
            <span className="od-plate mono">ML·{String(v.id).padStart(4, "0")}</span>
            <h1 tabIndex={-1}>{v.name}</h1>
            <p className="od-detail-where"><span aria-hidden="true">◉</span> {v.location || "Location on request"} · hosted by {v.host_name || "a local owner"}</p>
            <div className="od-detail-rating"><Rating vehicle={v} /><a href="#reviews">Read reviews</a><FavoriteButton vehicle={v} /></div>
          </header>
          <ul className="od-spec-plates" aria-label="Specifications">
            {specs.map(([label, value], i) => (
              <motion.li key={label}
                initial={{ scale: 1.08, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.25 + i * 0.07, type: "spring", stiffness: 620, damping: 22 }}>
                <small>{label}</small><b>{value}</b>
              </motion.li>
            ))}
          </ul>
          <section className="od-detail-story">
            <span className="od-eyebrow">The details that matter</span>
            <h2>Meet your ride.</h2>
            <p>{v.description || `Discover ${v.location || "your destination"} with this ${v.name}. Choose your dates to see the price for your trip.`}</p>
          </section>
          <section className="od-detail-card">
            <h2>Pickup and handoff</h2>
            <p>{v.pickup_instructions || "Arrange the exact pickup point with the owner after confirmation."}</p>
            <p>Both the pickup and the return date count towards your rental. You see the full summary at checkout.</p>
          </section>
          <section className="od-detail-card" id="reviews">
            <span className="od-eyebrow">Real rentals, real experiences</span>
            <h2>From the driver's seat.</h2>
            <Rating vehicle={v} />
            {v.reviews.length ? (
              <div className="od-reviews">
                {v.reviews.map(review => (
                  <article className="od-review" key={review.id}>
                    <span className="od-gauge" aria-label={`${review.rating} out of 5 stars`} style={{ "--fill": review.rating / 5 } as CSSProperties}>
                      <span aria-hidden="true">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span>
                    </span>
                    <p>{review.comment}</p>
                    <small>Verified completed rental</small>
                  </article>
                ))}
              </div>
            ) : <p>No reviews yet. Renters can review this vehicle after completing a rental.</p>}
          </section>
        </section>
        <aside className="od-reserve">
          <span className="od-eyebrow">Make this ride yours</span>
          <h2 className="od-reserve-rate"><Price value={v.price_per_day} label="/day" /></h2>
          <p>Choose your trip dates. You review everything before you request.</p>
          <form className="od-reserve-form" onSubmit={event => {
            event.preventDefault();
            if (!ready) return;
            const next = `/checkout/${v.id}?${qp}`;
            navigate(session.data?.user ? next : `/sign-in?next=${encodeURIComponent(next)}`);
          }}>
            <div className="od-field-row">
              <label className="od-field"><small>Pickup</small><input type="date" required value={start} onChange={e => setStart(e.target.value)} /></label>
              <label className="od-field"><small>Return</small><input type="date" required value={end} min={start || undefined} onChange={e => setEnd(e.target.value)} /></label>
            </div>
            <RentalCalendar start={start} end={end} unavailable={v.unavailable} onSelect={(a, b) => { setStart(a); setEnd(b); }} />
            <div aria-live="polite">
              {blocked && <div className="od-quote bad"><strong>These dates are unavailable</strong><p>Choose another date range for this vehicle.</p></div>}
              {start && end && end < start && <p className="od-error">Return must be on or after pickup.</p>}
              {ready && quote.data && <>
                <div className="od-quote good"><strong>Available for your dates</strong></div>
                <PriceBreakdown rate={v.price_per_day} days={quote.data.days} total={quote.data.total_price} estimate />
              </>}
              <Notice error={quote.error} />
            </div>
            <button className="od-go" disabled={!ready}>
              {blocked ? "Choose other dates" : !start || !end ? "Select your trip dates" : quote.isFetching ? "Checking availability…" : "Continue to checkout →"}
            </button>
            <p className="od-fine">No payment now · Owner confirmation required</p>
          </form>
        </aside>
      </div>
    </MotionConfig>
  );
}

/** A swipe gallery with momentum and snap, a film strip, and keyboard arrows. The first photo carries the
 *  card's View Transition name, so the tag's photo morphs straight into it. */
function Gallery({ vehicle }: { vehicle: Detail }) {
  const photos = vehicle.photos?.length
    ? [...vehicle.photos].sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || a.order - b.order).map(p => ({ small: p.small, large: p.large }))
    : vehicle.cover ? [{ small: vehicle.cover.small, large: vehicle.cover.large }]
    : vehicle.vehicle_image ? [{ small: vehicle.vehicle_image, large: vehicle.vehicle_image }] : [];
  const [index, setIndex] = useState(0);
  const viewport = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ x: number; t: number; dx: number; id: number } | null>(null);
  // The track sits at -index * 100% (a transform with a spring-like CSS transition); while a finger or mouse
  // drags, it follows the pointer exactly, then a flick or a drag past a fifth of the width moves one photo.
  const place = (dx = 0, animated = true) => {
    const el = track.current;
    if (!el) return;
    el.style.transition = animated && !reducedMotion() ? "transform .45s cubic-bezier(.25, 1.1, .4, 1)" : "none";
    el.style.transform = `translate3d(calc(${-index * 100}% + ${dx}px), 0, 0)`;
  };
  useEffect(() => { place(0); });  // eslint-disable-line react-hooks/exhaustive-deps
  const go = (next: number) => setIndex(Math.max(0, Math.min(photos.length - 1, next)));
  const onDown = (event: React.PointerEvent) => {
    if (photos.length < 2 || (event.pointerType === "mouse" && event.button !== 0)) return;
    dragging.current = { x: event.clientX, t: performance.now(), dx: 0, id: event.pointerId };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onMove = (event: React.PointerEvent) => {
    const d = dragging.current;
    if (!d || d.id !== event.pointerId) return;
    d.dx = event.clientX - d.x;
    const atEdge = (index === 0 && d.dx > 0) || (index === photos.length - 1 && d.dx < 0);
    place(atEdge ? d.dx * 0.25 : d.dx, false);  // rubber-band at the first and last photo
  };
  const onUp = () => {
    const d = dragging.current;
    dragging.current = null;
    if (!d) return;
    const width = viewport.current?.clientWidth ?? 1;
    const velocity = d.dx / Math.max(1, performance.now() - d.t);  // px per ms
    const step = Math.abs(d.dx) > width / 5 || Math.abs(velocity) > 0.5 ? (d.dx < 0 ? 1 : -1) : 0;
    if (step) go(index + step); else place(0);
  };
  const ratio = vehicle.cover?.width && vehicle.cover?.height ? `${vehicle.cover.width} / ${vehicle.cover.height}` : "3 / 2";
  if (!photos.length) return <div className="od-gallery od-gallery-empty" style={{ aspectRatio: ratio }}>{vehicle.vehicle_type}</div>;
  return (
    <div className="od-gallery" role="region" aria-roledescription="carousel" aria-label={`${vehicle.name} photos`}
      tabIndex={0} onKeyDown={event => {
        if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); }
        if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); }
      }}>
      <div className="od-gallery-viewport" ref={viewport} style={{ aspectRatio: ratio }}>
        <div className="od-gallery-track" ref={track} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          {photos.map((photo, i) => (
            <img key={photo.large + i} src={photo.large} srcSet={`${photo.small} 400w, ${photo.large} 1200w`}
              sizes="(max-width: 900px) 100vw, 60vw" alt={i === 0 ? vehicle.name : `${vehicle.name}, photo ${i + 1}`}
              draggable={false} loading={i === 0 ? "eager" : "lazy"} decoding="async"
              {...(i === 0 ? { fetchPriority: "high" as const } : {})}
              style={{ ...(i === 0 ? { viewTransitionName: photoTransition(vehicle.id) } : {}), backgroundColor: vehicle.cover?.color ?? undefined } as CSSProperties} />
          ))}
        </div>
        {photos.length > 1 && <>
          <button type="button" className="od-gallery-nav prev" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous photo">‹</button>
          <button type="button" className="od-gallery-nav next" onClick={() => go(index + 1)} disabled={index === photos.length - 1} aria-label="Next photo">›</button>
          <span className="od-gallery-count mono" aria-live="polite">{index + 1} / {photos.length}</span>
        </>}
      </div>
      {photos.length > 1 && (
        <div className="od-filmstrip" role="tablist" aria-label="Choose a photo">
          {photos.map((photo, i) => (
            <button type="button" role="tab" key={photo.small + i} aria-selected={i === index} aria-label={`Photo ${i + 1}`} onClick={() => go(i)}>
              <img src={photo.small} alt="" loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
