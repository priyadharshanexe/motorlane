import type { Vehicle } from '../api'

const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong.'

export function Notice({ error }: { error: unknown }) {
  return error ? <p className="od-error" role="alert">{message(error)}</p> : null
}
export function Busy() { return <p className="od-loading" role="status">Loading…</p> }
// Card images are rendered about 400 CSS px wide; the 1200 px rendition is for detail pages and
// high-density screens. Width/height reserve the space (no layout shift) and the average colour
// fills it until the image arrives.
const CARD_SIZES = '(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 400px'

export function Photo({ vehicle, size = 'card', priority = false }: {
  vehicle: Vehicle
  size?: 'card' | 'large'
  priority?: boolean
}) {
  const cover = vehicle.cover
  if (!cover && !vehicle.vehicle_image) return <div className="photo placeholder">{vehicle.vehicle_type}</div>
  if (!cover) return <img className="photo" src={vehicle.vehicle_image ?? ''} alt={vehicle.name} loading="lazy" decoding="async" />
  return <img
    className="photo"
    src={size === 'large' ? cover.large : cover.small}
    srcSet={`${cover.small} 400w, ${cover.large} 1200w`}
    sizes={size === 'large' ? '(max-width: 900px) 100vw, 60vw' : CARD_SIZES}
    width={cover.width ?? undefined}
    height={cover.height ?? undefined}
    style={cover.color ? { backgroundColor: cover.color } : undefined}
    alt={vehicle.name}
    loading={priority ? 'eager' : 'lazy'}
    decoding="async"
    {...(priority ? { fetchPriority: 'high' as const } : {})}
  />
}
