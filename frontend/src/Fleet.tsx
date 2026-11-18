import { Price } from "./Pricing";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "./api";
import type { FleetVehicle } from "./api";
import { Busy, Notice, Photo, Status } from "./shared";
import { formData, useWrite } from "./requests";

export function Fleet() {
  const query = useQuery({
    queryKey: ["fleet"],
    queryFn: () => api<FleetVehicle[]>("owner/fleet/"),
  });
  const write = useWrite();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [visibility, setVisibility] = useState("active");
  const edit = params.get("edit");
  const editing =
    edit === "new"
      ? "new"
      : query.data?.find(
          (item) => String(item.id) === edit && !item.archived_at,
        );
  const setEditing = (item: FleetVehicle | "new" | null) => {
    write.reset();
    setParams(item ? { edit: item === "new" ? item : String(item.id) } : {});
  };
  const [preview, setPreview] = useState<{
    editor: string | null;
    url: string;
  }>();
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const changeEditor = (item: FleetVehicle | "new" | null) => {
    setPreview(undefined);
    setEditing(item);
  };
  const [archiving, setArchiving] = useState<number | null>(null);
  const vehicle = editing && editing !== "new" ? editing : undefined;
  const previewUrl =
    preview && preview.editor === edit ? preview.url : vehicle?.vehicle_image;
  return (
    <>
      <div className="section-head page-heading">
        <div>
          <h1>My fleet</h1>
          <p>Manage listings, rates, and availability.</p>
        </div>
        <button onClick={() => changeEditor("new")}>List a vehicle</button>
      </div>
      {query.isPending && <Busy />}
      <Notice error={query.error} />
      <Notice error={write.error} />
      {editing && (
        <section className="panel fleet-editor">
          <h2>{vehicle ? `Edit ${vehicle.name}` : "New vehicle"}</h2>
          <form
            className="fields editor-fields"
            key={vehicle?.id ?? "new"}
            onSubmit={(event) => {
              const body = formData(event);
              const image = body.get("vehicle_image");
              if (image instanceof File && !image.size)
                body.delete("vehicle_image");
              write.mutate(
                {
                  path: vehicle ? `owner/fleet/${vehicle.id}/` : "owner/fleet/",
                  method: vehicle ? "PATCH" : "POST",
                  body,
                },
                { onSuccess: () => changeEditor(null) },
              );
            }}
          >
            <label>
              Vehicle name
              <input
                name="name"
                required
                maxLength={100}
                defaultValue={vehicle?.name}
              />
            </label>
            <label>
              Type
              <select name="vehicle_type" defaultValue={vehicle?.vehicle_type}>
                <option>Car</option>
                <option>Bike</option>
              </select>
            </label>
            <label>
              Fuel
              <input
                name="fuel_type"
                required
                maxLength={50}
                defaultValue={vehicle?.fuel_type}
              />
            </label>
            <label>
              Location
              <input
                name="location"
                maxLength={100}
                defaultValue={vehicle?.location ?? ""}
              />
            </label>
            <label>
              Daily rate (INR)
              <input
                type="number"
                name="price_per_day"
                min=".01"
                step=".01"
                required
                defaultValue={vehicle?.price_per_day}
              />
            </label>
            <label>
              Transmission
              <select
                name="transmission"
                defaultValue={vehicle?.transmission || ""}
              >
                <option value="">Not specified</option>
                <option>Automatic</option>
                <option>Manual</option>
              </select>
            </label>
            <label>
              Seats
              <input
                type="number"
                name="seats"
                min="1"
                max="50"
                defaultValue={vehicle?.seats ?? ""}
              />
            </label>
            <label>
              Model year
              <input
                type="number"
                name="model_year"
                min="1900"
                max="2100"
                defaultValue={vehicle?.model_year ?? ""}
              />
            </label>
            <label className="full-field">
              About this vehicle
              <textarea
                name="description"
                maxLength={3000}
                defaultValue={vehicle?.description}
              />
            </label>
            <label className="full-field">
              Pickup instructions
              <textarea
                name="pickup_instructions"
                maxLength={1000}
                defaultValue={vehicle?.pickup_instructions}
              />
            </label>
            <label>
              Vehicle photo
              <input
                type="file"
                name="vehicle_image"
                accept="image/jpeg,image/png,image/webp"
                required={!vehicle}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  setPreview(
                    file
                      ? { editor: edit, url: URL.createObjectURL(file) }
                      : undefined,
                  );
                }}
              />
            </label>
            {previewUrl && (
              <img
                className="image-preview"
                src={previewUrl}
                alt="Listing photo preview"
              />
            )}
            <Notice error={write.error} />
            <div className="actions">
              <button disabled={write.isPending}>Save vehicle</button>
              <button
                type="button"
                className="secondary"
                onClick={() => changeEditor(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
      {query.data?.length === 0 && (
        <p className="empty">
          Your vehicles will appear here after you create a listing.
        </p>
      )}
      <div className="fleet-toolbar">
        <label>
          Search fleet
          <input
            placeholder="Vehicle name or location"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          Listing status
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
          >
            <option value="active">Active listings</option>
            <option value="published">Published</option>
            <option value="unpublished">Unpublished</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      </div>
      <div className="records fleet-cards">
        {query.data
          ?.filter(
            (item) =>
              `${item.name} ${item.location}`
                .toLowerCase()
                .includes(search.toLowerCase()) &&
              (visibility === "archived"
                ? Boolean(item.archived_at)
                : !item.archived_at &&
                  (visibility === "active" ||
                    item.is_available === (visibility === "published"))),
          )
          .map((item) => (
            <article className="record" key={item.id}>
              <div className="record-identity">
                <Photo vehicle={item} />
                <div>
                  <h2>{item.name}</h2>
                  <p>
                    {item.vehicle_type} ·{" "}
                    {item.location ?? "Location on request"}
                  </p>
                </div>
              </div>
              <div>
                <Status
                  value={
                    item.archived_at
                      ? "Archived"
                      : item.is_available
                        ? "Published"
                        : "Unpublished"
                  }
                />
                <p>
                  <Price value={item.price_per_day} label="/day" />
                </p>
              </div>
              {!item.archived_at && (
                <div className="actions">
                  <button
                    className="secondary"
                    onClick={() => changeEditor(item)}
                  >
                    Edit
                  </button>
                  <Link to={`/owner/fleet/${item.id}/maintenance`}>
                    Maintenance
                  </Link>
                  <button
                    className="secondary"
                    disabled={write.isPending}
                    onClick={() =>
                      write.mutate({
                        path: `owner/fleet/${item.id}/`,
                        method: "PATCH",
                        body: { is_available: !item.is_available },
                      })
                    }
                  >
                    {item.is_available ? "Unpublish" : "Publish"}
                  </button>
                  {archiving === item.id ? (
                    <dialog
                      ref={(node) => {
                        if (node && !node.open) node.showModal();
                      }}
                      onCancel={() => setArchiving(null)}
                      aria-labelledby="archive-title"
                    >
                      <h2 id="archive-title">Archive {item.name}?</h2>
                      <p>
                        The listing will be removed from the marketplace.
                        Booking history will remain available.
                      </p>
                      <Notice error={write.error} />
                      <div className="actions">
                        <button
                          disabled={write.isPending}
                          onClick={() =>
                            write.mutate(
                              {
                                path: `owner/fleet/${item.id}/`,
                                method: "DELETE",
                              },
                              { onSuccess: () => setArchiving(null) },
                            )
                          }
                        >
                          Confirm archive
                        </button>
                        <button
                          className="secondary"
                          onClick={() => setArchiving(null)}
                        >
                          Keep listing
                        </button>
                      </div>
                    </dialog>
                  ) : (
                    <button
                      className="secondary"
                      onClick={() => {
                        write.reset();
                        setArchiving(item.id);
                      }}
                    >
                      Archive
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
      </div>
    </>
  );
}

