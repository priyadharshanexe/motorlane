// Catalog filters live in the URL. Every control reads its value from the URL and writes back through these
// helpers, so the vehicle-type switch can never disagree with the results (the old uncontrolled <select> could).

export const FILTER_LABELS: Record<string, string> = {
  q: "Model", type: "Type", fuel: "Fuel", location: "Near", start_date: "From", end_date: "Until",
  min_price: "From ₹", max_price: "Up to ₹",
};

/** A copy of `params` with `key` set to `value` (or removed when empty). Changing a filter returns to page 1. */
export function withParam(params: URLSearchParams, key: string, value: string | null | undefined) {
  const next = new URLSearchParams(params);
  const clean = (value ?? "").trim();
  if (clean) next.set(key, clean); else next.delete(key);
  if (key !== "page") next.delete("page");
  return next;
}

/** The vehicle type the URL asks for: "Car", "Bike", or "" for all. Anything else counts as all. */
export function vehicleType(params: URLSearchParams): "" | "Car" | "Bike" {
  const value = params.get("type");
  return value === "Car" || value === "Bike" ? value : "";
}

/** Active filters as removable road signs, in a stable order. */
export function activeFilters(params: URLSearchParams) {
  return Object.keys(FILTER_LABELS)
    .filter(key => params.get(key))
    .map(key => ({ key, label: FILTER_LABELS[key], value: params.get(key)! }));
}
