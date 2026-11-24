// Saved vehicles: the heart on every key tag and vehicle page, the rating line, and the list query the Saved page
// reads. Saving needs an account, so signed-out visitors go to sign-in and come back to the same page.
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Vehicle } from "../api";
import { useSession, useWrite } from "../requests";
import { Notice } from "./shared";

export function useFavorites() {
  const session = useSession();
  return useQuery({
    queryKey: ["favorites", session.data?.user?.id],
    queryFn: () => api<Vehicle[]>("favorites/"),
    enabled: Boolean(session.data?.user),
  });
}

export function FavoriteButton({ vehicle }: { vehicle: Vehicle }) {
  const session = useSession(), saved = useFavorites(), write = useWrite();
  const navigate = useNavigate(), location = useLocation();
  const selected = saved.data?.some(item => item.id === vehicle.id) ?? false;
  return (
    <div className="favorite-control">
      <button type="button" className="favorite-button" aria-pressed={selected} disabled={write.isPending}
        aria-label={`${selected ? "Remove" : "Save"} ${vehicle.name}${selected ? " from" : " to"} saved vehicles`}
        onClick={() => {
          if (!session.data?.user) { navigate(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`); return; }
          write.mutate({ path: `favorites/${vehicle.id}/`, method: selected ? "DELETE" : "POST" });
        }}>
        <svg viewBox="0 0 24 24" fill={selected ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
        </svg>
      </button>
      <Notice error={write.error} />
    </div>
  );
}

export function Rating({ vehicle }: { vehicle: Vehicle }) {
  return (
    <span className="vehicle-rating">
      {vehicle.review_count > 0 && <span aria-hidden="true">★</span>}{" "}
      {vehicle.rating
        ? `${Number(vehicle.rating).toFixed(1)} · ${vehicle.review_count} review${vehicle.review_count === 1 ? "" : "s"}`
        : "New listing"}
    </span>
  );
}
