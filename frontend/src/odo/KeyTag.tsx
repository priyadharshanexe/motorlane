// A listing as a key tag: punched hole, photo, number plate, name, specs and the day rate. It swings on its hole
// when a person moves the pointer onto it (never because the page scrolled under the cursor), and its photo is a
// named View Transition so it morphs straight into the vehicle page.
import { useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router-dom";
import type { Vehicle } from "../api";
import { FavoriteButton, Rating } from "../Favorites";
import { Photo } from "../shared";
import { VehiclePreview } from "../VehiclePreview";
import { reducedMotion, scrolling } from "./primitives";

export const photoTransition = (id: number) => `vehicle-photo-${id}`;
const HANG = [-1.4, 0.6, 1.2, -0.8, 1.6, -1.1];

export function KeyTag({ vehicle, index = 0, params = "", priority = false }: {
  vehicle: Vehicle; index?: number; params?: string; priority?: boolean;
}) {
  const ref = useRef<HTMLElement>(null), armed = useRef(true);
  const [preview, setPreview] = useState(false);
  const url = `/vehicles/${vehicle.id}${params ? "?" + params : ""}`;
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
    tag.style.setProperty("--tx", `${(((event.clientY - box.top) / box.height - 0.5) * -5).toFixed(2)}deg`);
    tag.style.setProperty("--ty", `${(((event.clientX - box.left) / box.width - 0.5) * 7).toFixed(2)}deg`);
    tag.classList.add("lifted");
  };
  const reset = () => {
    const tag = ref.current!;
    armed.current = true;
    tag.classList.remove("lifted");
    tag.style.setProperty("--tx", "0deg");
    tag.style.setProperty("--ty", "0deg");
  };
  return (
    <article className="od-tag" ref={ref} data-vehicle-type={vehicle.vehicle_type}
      onPointerMove={tilt} onPointerLeave={reset}
      onAnimationEnd={event => event.currentTarget.classList.remove("swinging")}
      style={{ "--hang": `${HANG[index % HANG.length]}deg` } as CSSProperties}>
      <span className="od-tag-hole" aria-hidden="true" />
      <div className="od-tag-media">
        <Link to={url} viewTransition aria-label={`View ${vehicle.name}`} tabIndex={-1}
          style={{ viewTransitionName: photoTransition(vehicle.id) } as CSSProperties}>
          <Photo vehicle={vehicle} priority={priority} />
        </Link>
        <span className="od-tag-type">{vehicle.vehicle_type}</span>
        <FavoriteButton vehicle={vehicle} />
        <button type="button" className="od-tag-peek" onClick={() => setPreview(true)}>Quick view</button>
      </div>
      <span className="od-plate mono" aria-hidden="true">ML·{String(vehicle.id).padStart(4, "0")}</span>
      <h3><Link to={url} viewTransition>{vehicle.name}</Link></h3>
      <p className="od-tag-meta">{[vehicle.location || "Location on request", vehicle.transmission, vehicle.seats ? `${vehicle.seats} seats` : null, vehicle.fuel_type].filter(Boolean).join(" · ")}</p>
      <div className="od-tag-foot">
        <span className="od-tag-price"><span className="mono">₹{Number(vehicle.price_per_day).toLocaleString("en-IN")}</span><small>per day</small></span>
        <Rating vehicle={vehicle} />
      </div>
      {preview && <VehiclePreview vehicle={vehicle} url={url} onClose={() => setPreview(false)} />}
    </article>
  );
}

/** A tag-shaped placeholder with the exact footprint of a loaded tag, so results arriving cause no layout shift. */
export function KeyTagSkeleton() {
  return (
    <div className="od-tag od-tag-skeleton" aria-hidden="true">
      <span className="od-tag-hole" />
      <div className="od-tag-media"><div className="od-skel-photo" /></div>
      <span className="od-skel-line w60" /><span className="od-skel-line w80" /><span className="od-skel-line w40" />
    </div>
  );
}
