// "Pay at the counter": a sheet that rises over the booking with the amount on an odometer (rolling up from 0),
// the breakdown and the provider (demo / Razorpay test mode). Processing runs lane dashes on the button. Success:
// a key tag drops onto the booking, swings on its ring and settles, then a check stamp. Failure or cancellation:
// the tag swings away, with the message and a retry. The payment calls are the same as before.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, money } from "../api";
import type { Booking } from "../api";
import { razorpayCheckout } from "../payments";
import type { CheckoutOptions, CheckoutResult, PaymentConfig } from "../payments";
import type { Quote } from "./pricing";
import { useWrite } from "../requests";
import { Odometer, reducedMotion } from "./primitives";

type Phase = "ready" | "processing" | "paid" | "failed";

export function PaymentSheet({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const config = useQuery({ queryKey: ["payment-config"], queryFn: () => api<PaymentConfig>("payments/config/"), staleTime: Infinity });
  const write = useWrite();
  const cache = useQueryClient();
  const [phase, setPhase] = useState<Phase>("ready");
  const [error, setError] = useState("");
  const quote = booking.price_breakdown as Quote | undefined;
  const amount = Number(quote?.due_now ?? booking.total_price);
  // The amount rolls up from zeros (in the final amount's shape, so every wheel turns) when the sheet opens.
  const target = amount.toLocaleString("en-IN");
  const [rolled, setRolled] = useState(reducedMotion());
  useEffect(() => { const id = window.setTimeout(() => setRolled(true), 140); return () => window.clearTimeout(id); }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && phase !== "processing") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [phase, onClose]);

  const pay = async () => {
    setPhase("processing"); setError("");
    try {
      const options = await write.mutateAsync({ path: `bookings/${booking.id}/payment/` }) as CheckoutOptions;
      const result = config.data?.provider === "razorpay"
        ? await razorpayCheckout(options, `${booking.vehicle.name} rental #${booking.id}`)
        : await write.mutateAsync({ path: `bookings/${booking.id}/payment/fake-checkout/` }) as CheckoutResult;
      await write.mutateAsync({ path: `bookings/${booking.id}/payment/confirm/`, body: { ...result } });
      setPhase("paid");
      cache.invalidateQueries({ queryKey: ["bookings"] });
      cache.invalidateQueries({ queryKey: ["booking-detail", String(booking.id)] });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Payment failed.");
      setPhase("failed");
    }
  };

  // Rendered at the app's top level (inside .od-app, so the theme tokens still apply), not inside the page: the page
  // is its own layer under the header, so a sheet inside it could never cover the header or anything above the page.
  const host = document.querySelector<HTMLElement>(".od-app:not(.static-first)") ?? document.body;
  return createPortal(
    <div className="od-paysheet-scrim" onClick={event => { if (event.target === event.currentTarget && phase !== "processing") onClose(); }}>
      <section className={`od-paysheet phase-${phase}`} role="dialog" aria-modal="true" aria-labelledby="od-pay-title">
        <div className="od-paysheet-grip" aria-hidden="true" />
        <header>
          <span className="od-eyebrow">Pay at the counter</span>
          <h2 id="od-pay-title">{booking.vehicle.name}</h2>
          <span className="od-provider">{config.data?.label ?? "…"}</span>
        </header>
        <div className="od-pay-amount" aria-live="polite" aria-label={`Amount ₹${amount.toLocaleString("en-IN")}`}>
          <span className="odo-sep">₹</span><Odometer value={rolled ? target : target.replace(/\d/g, "0")} />
        </div>
        {quote?.lines && (
          <dl className="od-pay-lines">
            <div><dt>Rental total</dt><dd className="mono">{money(quote.rental_total)}</dd></div>
            {Number(quote.deposit) > 0 && <div><dt>Refundable deposit</dt><dd className="mono">{money(quote.deposit)}</dd></div>}
          </dl>
        )}
        {/* The key tag: drops and swings on success, swings away on failure. */}
        <div className="od-pay-key" aria-hidden="true">
          <svg viewBox="0 0 80 130"><circle cx="40" cy="14" r="10" className="ring" /><path d="M14 30 h52 a6 6 0 0 1 6 6 v76 a6 6 0 0 1 -6 6 h-52 a6 6 0 0 1 -6 -6 v-76 a6 6 0 0 1 6 -6 z" className="tag" />
            <circle cx="40" cy="44" r="6" className="hole" /><text x="40" y="86" textAnchor="middle" className="plate">ML·{String(booking.vehicle.id).padStart(4, "0")}</text></svg>
          <span className="od-pay-stamp">Paid ✓</span>
        </div>
        {phase === "paid" ? (
          <div className="od-pay-done" role="status">
            <p><strong>Confirmed and paid.</strong> The keys are yours from pickup time. The deposit comes back after the return.</p>
            <button type="button" className="od-cta" onClick={onClose}>Back to the booking</button>
          </div>
        ) : (
          <>
            {phase === "failed" && <p className="od-error" role="alert">{error} You haven't been charged twice; you can try again.</p>}
            <div className="od-pay-actions">
              <button type="button" className={`od-cta od-pay-go${phase === "processing" ? " running" : ""}`} disabled={phase === "processing" || !config.data} onClick={pay}>
                {phase === "processing" ? "Processing…" : phase === "failed" ? "Retry payment" : `Pay ₹${amount.toLocaleString("en-IN")}`}
              </button>
              <button type="button" className="od-cta od-cta-ghost" disabled={phase === "processing"} onClick={onClose}>Not now</button>
            </div>
            <p className="od-fine">{config.data?.provider === "razorpay" ? "Razorpay test mode: use a test card, no real money." : "Demo payment: no real money moves."}</p>
          </>
        )}
      </section>
    </div>
  , host);
}
