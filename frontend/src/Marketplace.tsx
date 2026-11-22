import { VehiclePreview } from "./VehiclePreview";
import { useState } from "react";
import type { Vehicle } from "./api";
import { Photo } from "./shared";
import { Price } from "./Pricing";
import { Link } from "react-router-dom";
import { FavoriteButton, Rating } from "./Favorites";

// The listing card for the workspace pages (saved vehicles). The public pages use the key tag (src/odo/KeyTag).

export function Listing({
  vehicle,
  params = "",
  priority = false,
}: {
  vehicle: Vehicle;
  params?: string;
  /** The first row of a grid is above the fold: load it eagerly and first. */
  priority?: boolean;
}) {
  const [preview, setPreview] = useState(false);
  const url = `/vehicles/${vehicle.id}${params ? "?" + params : ""}`;
  return (
    <article
      className="listing ride-card"
      data-vehicle-type={vehicle.vehicle_type}
    >
      <div className="ride-media">
        <Link to={url} aria-label={`View ${vehicle.name}`}>
          <Photo vehicle={vehicle} priority={priority} />
        </Link>
        <span className="ride-type">{vehicle.vehicle_type}</span>
        <FavoriteButton vehicle={vehicle} />
        <button className="quick-preview" onClick={() => setPreview(true)}>
          Quick view <span aria-hidden="true">↗</span>
        </button>
      </div>
      <div className="listing-body">
        <div className="ride-title">
          <h3>
            <Link to={url}>{vehicle.name}</Link>
          </h3>
          <Rating vehicle={vehicle} />
        </div>
        <p className="card-location">
          <span className="location-pin" aria-hidden="true" />
          {vehicle.location || "Location on request"}
        </p>
        <div className="card-specs">
          <span>{vehicle.fuel_type}</span>
          {vehicle.transmission && <span>{vehicle.transmission}</span>}
          {vehicle.seats && <span>{vehicle.seats} seats</span>}
        </div>
        <div className="listing-bottom">
          <Price value={vehicle.price_per_day} label="/day" />
          <Link className="ride-book" to={url}>
            Explore ride <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </div>
      {preview && (
        <VehiclePreview
          vehicle={vehicle}
          url={url}
          onClose={() => setPreview(false)}
        />
      )}
    </article>
  );
}
