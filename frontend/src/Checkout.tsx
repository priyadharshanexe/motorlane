import { isRentalDate, rentalToday } from "./rentalDates";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api, dateLabel } from "./api";
import type { VehicleDetail } from "./api";
import { useSession, useWrite } from "./requests";
import { QuoteLines } from "./Pricing";
import type { Quote } from "./Pricing";
import { Busy, Notice, Photo } from "./shared";
import { Breadcrumb } from "./Breadcrumb";

export function Checkout() {
  const { id } = useParams(),
    [params] = useSearchParams(),
    navigate = useNavigate();
  const start = params.get("start_date") || "",
    end = params.get("end_date") || "";
  const [pickupTime, setPickupTime] = useState(params.get("pickup_time") || "09:00"),
    [returnTime, setReturnTime] = useState(params.get("return_time") || "18:00");
  const session = useSession(),
    write = useWrite<{ id: number }>();
  const [accepted, setAccepted] = useState(false);
  const vehicle = useQuery({
    queryKey: ["vehicle", id],
    queryFn: () => api<VehicleDetail>(`vehicles/${id}/`),
  });
  const validDates = isRentalDate(start) && isRentalDate(end) && start >= rentalToday() && end >= start;
  const quote = useQuery({
    enabled: Boolean(id) && validDates,
    queryKey: ["checkout-quote", id, start, end, pickupTime, returnTime],
    queryFn: () =>
      api<Quote>(
        `vehicles/${id}/quote/?${new URLSearchParams({ start_date: start, end_date: end, pickup_time: pickupTime, return_time: returnTime })}`,
      ),
    retry: false,
  });
  if (!validDates) return (
    <section className="panel">
      <h1>Choose your rental dates</h1>
      <p>Select a pickup date and a return date on or after pickup to continue.</p>
      <Link className="button" to={id ? "/vehicles/" + id : "/vehicles"}>Choose vehicle and dates</Link>
    </section>
  );
  if (vehicle.isPending) return <Busy />;
  if (!vehicle.data) return <Notice error={vehicle.error} />;
  const v = vehicle.data;
  return (
    <>
      <Breadcrumb
        to={`/vehicles/${id}?${params}`}
        parent="Vehicle details"
        current="Review your rental"
      />
      <div className="checkout-heading">
        <span className="eyebrow">One step closer to the open road</span>
        <h1>Review your rental.</h1>
        <p>Check the details before sending your request to the owner.</p>
        <ol className="checkout-steps" aria-label="Booking progress">
          <li className="done">
            <Link to={`/vehicles/${id}?${params}`}>
              <span className="step-node" aria-hidden="true">
                ✓
              </span>
              <span>
                <strong>Choose your ride</strong>
                <small>Vehicle & dates selected</small>
              </span>
            </Link>
          </li>
          <li className="active" aria-current="step">
            <span className="step-node" aria-hidden="true">
              2
            </span>
            <span>
              <strong>Review & request</strong>
              <small>Confirm your trip details</small>
            </span>
          </li>
          <li>
            <span className="step-node" aria-hidden="true">
              3
            </span>
            <span>
              <strong>Owner confirmation</strong>
              <small>Await your host’s response</small>
            </span>
          </li>
        </ol>
      </div>
      <div className="checkout-layout">
        <div className="checkout-sections">
          <section className="panel">
            <h2>Your rental</h2>
            <div className="checkout-vehicle">
              <Photo vehicle={v} />
              <div>
                <span className="eyebrow">
                  {v.vehicle_type} · {v.fuel_type}
                </span>
                <h2>{v.name}</h2>
                <p>Listed by {v.host_name || "Vehicle owner"}</p>
              </div>
            </div>
            <div className="handoff-grid">
              <div>
                <span className="eyebrow">Pickup</span>
                <h3>{start ? dateLabel(start) : "Select a date"}</h3>
                <label className="time-field">
                  Pickup time
                  <input type="time" name="pickup_time" form="rental-checkout" value={pickupTime}
                    step={900} required onChange={(event) => setPickupTime(event.target.value)} />
                </label>
                <p>⌖ {v.location || "Arrange with owner"}</p>
              </div>
              <div>
                <span className="eyebrow">Return</span>
                <h3>{end ? dateLabel(end) : "Select a date"}</h3>
                <label className="time-field">
                  Return time
                  <input type="time" name="return_time" form="rental-checkout" value={returnTime}
                    step={900} required onChange={(event) => setReturnTime(event.target.value)} />
                </label>
                <p>⌖ {v.location || "Arrange with owner"}</p>
              </div>
            </div>
            <p className="fine-print">
              Every started 24 hours counts as a rental day. Owners keep a short cleaning window between
              rentals, so a slot right after another booking may be unavailable.
            </p>
            <Link className="button secondary" to={`/vehicles/${id}?${params}`}>
              Edit rental dates
            </Link>
          </section>
          <section className="panel">
            <span className="eyebrow">The person renting</span>
            <h2>Who’s taking the wheel?</h2>
            <p>Your contact details help the owner arrange your handoff.</p>
            <div className="fields">
              <label>
                Full name
                <input
                  name="contact_name"
                  form="rental-checkout"
                  autoComplete="name"
                  defaultValue={session.data?.user?.name}
                  maxLength={100}
                  required
                />
              </label>
              <label>
                Contact phone
                <input
                  name="contact_phone"
                  form="rental-checkout"
                  type="tel"
                  autoComplete="tel"
                  placeholder="Phone number for pickup coordination"
                  minLength={7}
                  maxLength={30}
                  required
                />
              </label>
              <label>
                Pickup notes <span className="optional">Optional</span>
                <textarea
                  name="pickup_notes"
                  form="rental-checkout"
                  placeholder="Share any handoff arrangements you would like to discuss."
                  maxLength={1000}
                />
              </label>
            </div>
          </section>
          <section className="panel">
            <h2>Pickup & rental conditions</h2>
            <p>
              {v.pickup_instructions ||
                "Arrange the exact pickup point and handoff with the owner after confirmation."}
            </p>
            <ul className="conditions">
              <li>Every started 24 hours between pickup and return counts as a rental day.</li>
              <li>
                The owner has up to 24 hours to respond. A request is not a
                confirmed rental.
              </li>
              <li>
                Pending requests can be cancelled. Confirmed bookings can be
                cancelled before pickup: free until 48 hours before, after that
                20% of the rental is kept. The deposit is always refunded.
              </li>
              <li>
                Insurance and any additional arrangements must be confirmed with
                the owner.
              </li>
            </ul>
          </section>
        </div>
        <aside className="checkout-summary panel">
          <span className="eyebrow">Clear pricing. No surprises.</span>
          <h2>Booking summary</h2>
          {quote.isPending && <Busy />}
          <Notice error={quote.error} />
          {quote.data && <QuoteLines quote={quote.data} />}
          {quote.data && quote.data.available === false && (
            <div className="availability-warning" role="alert">
              <p>{quote.data.unavailable_reason}</p>
              {quote.data.earliest_pickup && (
                <button type="button" className="secondary" onClick={() => {
                  // Keep the rental length and move pickup (and the dates, if needed) to the suggestion.
                  const pickup = new Date(quote.data!.earliest_pickup!);
                  const shift = pickup.getTime() - new Date(`${start}T${pickupTime}:00+05:30`).getTime();
                  const dropoff = new Date(new Date(`${end}T${returnTime}:00+05:30`).getTime() + shift);
                  const [pickupDate, newPickup] = kolkata(pickup), [returnDate, newReturn] = kolkata(dropoff);
                  setPickupTime(newPickup);
                  setReturnTime(newReturn);
                  const next = new URLSearchParams({ start_date: pickupDate, end_date: returnDate, pickup_time: newPickup, return_time: newReturn });
                  navigate(`/checkout/${id}?${next}`, { replace: true });
                }}>
                  Use the earliest available pickup
                </button>
              )}
            </div>
          )}
          <div className="payment-note">
            <strong>No payment collected now</strong>
            <p>
              This sends a rental request. Once the owner confirms, you pay the
              rental and the refundable deposit from your booking.
            </p>
          </div>
          <form
            id="rental-checkout"
            className="fields"
            onSubmit={(event) => {
              event.preventDefault();
              if (!accepted || !quote.data || write.isPending) return;
              write.mutate(
                {
                  path: "bookings/",
                  body: {
                    vehicle_id: v.id,
                    start_date: start,
                    end_date: end,
                    checkout: true,
                    accepted_conditions: accepted,
                    ...Object.fromEntries(new FormData(event.currentTarget)),
                  },
                },
                { onSuccess: (result) => navigate(`/bookings/${result.id}`) },
              );
            }}
          >
            <label className="check-label">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
                required
              />
              <span>
                I have reviewed the dates, total, and rental conditions above.
              </span>
            </label>
            <Notice error={write.error} />
            <button disabled={!accepted || !quote.data || quote.data.available === false || write.isPending}>
              {write.isPending ? "Sending request…" : "Confirm & send request"}
            </button>
          </form>
          <p className="fine-print">
            Availability and the price are checked again when your request is
            submitted.
          </p>
        </aside>
      </div>
    </>
  );
}

/** [YYYY-MM-DD, HH:MM] of an instant in the marketplace's time zone (Asia/Kolkata). */
function kolkata(moment: Date): [string, string] {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(moment).map(part => [part.type, part.value]));
  return [`${parts.year}-${parts.month}-${parts.day}`, `${parts.hour}:${parts.minute}`];
}
