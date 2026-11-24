import { useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Vehicle, VehicleDetail } from "../api";
import { Photo, Notice } from "./shared";
import { Rating } from "./favorites";
import { Price } from "./pricing";

export function VehiclePreview({
  vehicle,
  url,
  onClose,
}: {
  vehicle: Vehicle;
  url: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const details = useQuery({
    queryKey: ["vehicle", String(vehicle.id)],
    queryFn: () => api<VehicleDetail>(`vehicles/${vehicle.id}/`),
  });
  return (
    <dialog
      className="vehicle-preview"
      ref={dialog}
      aria-labelledby={`preview-${vehicle.id}`}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const r = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <button
        className="preview-close"
        aria-label="Close vehicle preview"
        onClick={onClose}
      >
        ×
      </button>
      <Photo vehicle={vehicle} />
      <div className="preview-copy">
        <span className="od-eyebrow">Take a closer look</span>
        <h2 id={`preview-${vehicle.id}`}>{vehicle.name}</h2>
        <p>
          {vehicle.location} · {vehicle.vehicle_type} · {vehicle.fuel_type}
        </p>
        <Rating vehicle={vehicle} />
        <p>
          {details.data?.description ||
            "Choose your dates on the listing to see availability and review your rental."}
        </p>
        <Notice error={details.error} />
        <div className="preview-footer">
          <Price value={vehicle.price_per_day} label="/day" />
          <Link className="od-cta" to={url} viewTransition>
            View details & dates →
          </Link>
        </div>
      </div>
    </dialog>
  );
}
