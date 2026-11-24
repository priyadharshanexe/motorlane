// Saved vehicles: the renter's garage of key tags, each with its heart to remove it, and a road sign when it is empty.
import { useRef } from "react";
import { Link } from "react-router-dom";
import { useFavorites } from "./favorites";
import { KeyTag, KeyTagSkeleton } from "./KeyTag";
import { Odometer, plural } from "./primitives";
import { ErrorSign, RoadSign } from "./states";
import { Hud, useChapters } from "./world";

export function Saved() {
  const query = useFavorites();
  const root = useRef<HTMLDivElement>(null);
  useChapters(root, [query.data?.length]);
  const count = query.data?.length ?? 0;
  return (
    <div className="od-page od-saved" ref={root} data-chapter="Garage · Saved vehicles">
      <header className="od-page-head od-saved-head">
        <span className="od-eyebrow">Your garage</span>
        <h1 tabIndex={-1}>Saved for the next trip.</h1>
        <p>The cars and bikes you hearted, together. Pick dates on any of them when you're ready.</p>
        <span className="od-saved-count"><Odometer value={String(count).padStart(2, "0")} size="md" label={plural(count, "saved vehicle")} /> in the garage</span>
      </header>
      <ErrorSign error={query.error} retry={() => query.refetch()} />
      {query.data && count === 0 && (
        <RoadSign kind="end" title="The garage is empty." action={<Link className="od-cta" to="/vehicles" viewTransition>Find a ride</Link>}>
          Tap the heart on any key tag to keep it here.
        </RoadSign>
      )}
      <div className="od-tags od-tags-grid od-saved-grid">
        {query.isPending && Array.from({ length: 3 }, (_, i) => <KeyTagSkeleton key={i} />)}
        {query.data?.map((vehicle, index) => <KeyTag key={vehicle.id} vehicle={vehicle} index={index} priority={index < 3} />)}
      </div>
      <Hud />
    </div>
  );
}
