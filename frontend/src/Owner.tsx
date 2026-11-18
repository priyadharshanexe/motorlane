export { Fleet } from "./Fleet";
import { MetricIcon } from "./MetricIcon";
import { Breadcrumb } from "./Breadcrumb";
import { Price } from "./Pricing";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, dateLabel, queryString } from "./api";
import type { BookingValue, FleetVehicle, Maintenance } from "./api";
import { Busy, Notice, Photo } from "./shared";
import { formData, useWrite } from "./requests";

export function MaintenancePage() {
  const { id } = useParams();
  const fleet = useQuery({
    queryKey: ["fleet"],
    queryFn: () => api<FleetVehicle[]>("owner/fleet/"),
  });
  const vehicle = fleet.data?.find((row) => String(row.id) === id);
  const path = `owner/fleet/${id}/maintenance/`;
  const query = useQuery({
    queryKey: ["maintenance", id],
    queryFn: () => api<Maintenance[]>(path),
  });
  const write = useWrite();
  return (
    <>
      <Breadcrumb
        to="/owner/maintenance"
        parent="Maintenance"
        current={vehicle?.name ?? "Vehicle schedule"}
      />
      <div className="page-heading">
        <h1>{vehicle ? vehicle.name : "Vehicle maintenance"}</h1>
        <p>Block dates when this vehicle is unavailable to renters.</p>
      </div>
      <div className="dashboard-grid maintenance-grid">
        <section className="panel">
          <h2>Schedule maintenance</h2>
          <form
            className="fields"
            onSubmit={(event) => {
              const form = event.currentTarget;
              write.mutate(
                { path, body: formData(event) },
                { onSuccess: () => form.reset() },
              );
            }}
          >
            <label>
              Start date
              <input type="date" name="start_date" required />
            </label>
            <label>
              End date
              <input type="date" name="end_date" required />
            </label>
            <label>
              Reason
              <input name="reason" maxLength={120} required />
            </label>
            <Notice
              error={write.variables?.method !== "DELETE" ? write.error : null}
            />
            <button disabled={write.isPending}>Block dates</button>
          </form>
        </section>
        <section className="panel">
          <h2>Unavailable periods</h2>
          {query.isPending && <Busy />}
          <Notice error={query.error} />
          <Notice
            error={write.variables?.method === "DELETE" ? write.error : null}
          />
          {query.data?.length === 0 && (
            <p className="empty">No maintenance scheduled.</p>
          )}
          <ul className="records">
            {query.data?.map((block) => (
              <li className="record" key={block.id}>
                <div>
                  {block.reason}
                  <p>
                    {dateLabel(block.start_date)} to {dateLabel(block.end_date)}
                  </p>
                </div>
                <button
                  className="secondary"
                  disabled={write.isPending}
                  onClick={() =>
                    write.mutate({
                      path: `${path}${block.id}/`,
                      method: "DELETE",
                    })
                  }
                >
                  Remove block
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
export function Values() {
  const [params, setParams] = useSearchParams();
  const query = useQuery({
    queryKey: ["values", params.toString()],
    queryFn: () => api<BookingValue[]>(`owner/value/?${params}`),
  });
  return (
    <>
      <div className="page-heading">
        <h1>Completed booking value</h1>
        <p>Review the value of returned rentals by vehicle and date range.</p>
      </div>
      <form
        className="filters value-filters"
        key={params.toString()}
        onSubmit={(event) => setParams(queryString(formData(event)))}
      >
        <label>
          From
          <input
            type="date"
            name="start_date"
            defaultValue={params.get("start_date") ?? ""}
          />
        </label>
        <label>
          To
          <input
            type="date"
            name="end_date"
            defaultValue={params.get("end_date") ?? ""}
          />
        </label>
        <button>Filter</button>
      </form>
      {query.isPending && <Busy />}
      <Notice error={query.error} />
      {query.data && (
        <>
          <div className="section-head">
            <h2>Rental performance</h2>
            <button
              className="secondary"
              onClick={() => {
                const csv = [
                  "Vehicle,Completed rentals,Booking value (INR)",
                  ...query.data.map(
                    (row) =>
                      `"${("'" + row.vehicle__name).replaceAll('"', '""')}",${row.bookings},${row.value}`,
                  ),
                ].join("\r\n");
                const url = URL.createObjectURL(
                  new Blob([csv], { type: "text/csv;charset=utf-8;" }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = "motorlane-booking-value.csv";
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Export CSV
            </button>
          </div>
          <div className="metrics">
            <div>
              <span>Total booking value</span><MetricIcon label="Total booking value" />
              <Price
                value={query.data.reduce(
                  (total, row) => total + Number(row.value),
                  0,
                )}
              />
            </div>
            <div>
              <span>Completed bookings</span><MetricIcon label="Completed bookings" />
              <strong>
                {query.data.reduce((total, row) => total + row.bookings, 0)}
              </strong>
            </div>
          </div>
          {query.data.length > 0 && (
            <section
              className="panel value-chart"
              aria-label="Completed booking value by vehicle"
            >
              {query.data.map((row) => (
                <div className="value-bar-row" key={row.vehicle_id}>
                  <strong>{row.vehicle__name}</strong>
                  <div className="value-bar-track">
                    <div
                      className="value-bar-fill"
                      style={{
                        width: `${(Number(row.value) / Math.max(1, ...query.data.map((v) => Number(v.value)))) * 100}%`,
                      }}
                    />
                  </div>
                  <Price value={row.value} />
                </div>
              ))}
            </section>
          )}
          {query.data.length === 0 ? (
            <p className="empty">No completed bookings for this period.</p>
          ) : (
            <div className="records">
              {query.data.map((row) => (
                <article className="record" key={row.vehicle_id}>
                  <h2>{row.vehicle__name}</h2>
                  <p>{row.bookings} completed</p>
                  <p>
                    <Price value={row.value} label="Completed booking value" />
                  </p>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

export function MaintenanceIndex() {
  const fleet = useQuery({
    queryKey: ["fleet"],
    queryFn: () => api<FleetVehicle[]>("owner/fleet/"),
  });
  const vehicles = fleet.data?.filter((vehicle) => !vehicle.archived_at);
  return (
    <>
      <div className="page-heading">
        <h1>Maintenance</h1>
        <p>Choose a vehicle to view its schedule or block rental dates.</p>
      </div>
      {fleet.isPending && <Busy />}
      <Notice error={fleet.error} />
      {vehicles?.length === 0 && (
        <p className="empty">
          No active listings.{" "}
          <Link to="/owner/fleet?edit=new">List a vehicle</Link>.
        </p>
      )}
      <div className="records">
        {vehicles?.map((vehicle) => (
          <article className="record" key={vehicle.id}>
            <div className="record-identity">
              <Photo vehicle={vehicle} />
              <h2>{vehicle.name}</h2>
            </div>
            <Link to={`/owner/fleet/${vehicle.id}/maintenance`}>
              Manage schedule →
            </Link>
          </article>
        ))}
      </div>
    </>
  );
}
