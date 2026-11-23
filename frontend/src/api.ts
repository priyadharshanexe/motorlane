export interface Session {
  csrf_token: string
  user: { id: number; name: string } | null
  google_enabled: boolean
}
export interface Vehicle {
  id: number
  name: string
  description: string
  transmission: string
  seats: number | null
  model_year: number | null
  pickup_instructions: string
  rating: number | null
  review_count: number
  vehicle_type: 'Car' | 'Bike'
  fuel_type: string
  location: string | null
  price_per_day: string
  vehicle_image: string | null
  cover?: { small: string; large: string; width: number | null; height: number | null; color: string | null } | null
  weekend_price_per_day?: string | null
  deposit?: string
  photos?: VehiclePhoto[]
}
export interface DateRange { start_date: string; end_date: string }
export interface Review { id: number; rating: number; comment: string }
export interface VehicleDetail extends Vehicle {
  host_name: string | null
  unavailable: DateRange[]
  reviews: Review[]
}
export interface FleetVehicle extends Vehicle { is_available: boolean; archived_at: string | null }
export type BookingStatus = 'Pending' | 'Confirmed' | 'Rejected' | 'Expired' | 'Cancelled' | 'In progress' | 'Returned'
export interface Booking extends DateRange {
  id: number
  vehicle: Vehicle
  status: BookingStatus
  total_price: string
  quoted_daily_rate: string | null
  contact_name: string
  contact_phone: string
  pickup_notes: string
  renter_name: string
  picked_up_at: string | null
  returned_at: string | null
  reviewed: boolean
  overdue: boolean
  status_changed_at: string | null
  pickup_time: string
  return_time: string
  price_breakdown?: Partial<import('./Pricing').Quote>
  payment_required?: boolean
  payment?: {
    status: string; amount: string; refunded: string; cancellation_fee: string; provider: string
    refund_status: 'pending' | 'delayed' | 'refunded' | null; refund_confirmed: string
  } | null
}
export interface VehiclePhoto { id: number; url: string; small: string; large: string; order: number; is_cover: boolean }
export interface TimelineEvent { id: number; kind?: 'status' | 'paid' | 'refund_issued' | 'refunded'; from_status: string; to_status: string; actor: string; at: string; note: string }
export interface Maintenance extends DateRange { id: number; reason: string }
export interface BookingValue { vehicle_id: number; vehicle__name: string; bookings: number; value: string }

function errorMessage(payload: unknown, fallback: string): string {
  if (typeof payload !== 'object' || payload === null) return fallback
  return Object.entries(payload).flatMap(([field, value]: [string, unknown]) => {
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
      .map(item => field === '__all__' ? item : `${field.replaceAll('_', ' ')}: ${item}`)
    return []
  }).join(' ') || fallback
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** API data the server inlined for the first page (see rental/views.py react_app): each entry is used once. */
let initial: Record<string, unknown> | null | undefined
function takeInitial(path: string): unknown {
  if (initial === undefined) {
    try { initial = JSON.parse(document.getElementById('initial-data')?.textContent || 'null') } catch { initial = null }
  }
  if (!initial || !(path in initial)) return undefined
  const value = initial[path]
  delete initial[path]
  return value
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  if (!options?.method || options.method === 'GET') {
    const ready = typeof document !== 'undefined' ? takeInitial(path) : undefined
    if (ready !== undefined) return ready as T
  }
  const response = await fetch(`/api/v1/${path}`, { ...options, credentials: 'same-origin' })
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    throw new ApiError(errorMessage(payload, `Request failed (${response.status}).`), response.status)
  }
  if (response.status === 204 || response.headers.get('Content-Length') === '0') return undefined as T
  return await response.json() as T
}

export const money = (value: string | number) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
}).format(Number(value))

export function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' })
    .format(new Date(value))
}

export function queryString(form: FormData) {
  const params = new URLSearchParams()
  for (const [key, value] of form) if (typeof value === 'string' && value.trim()) params.set(key, value.trim())
  return params
}

interface AuthError { message?: string }

export async function authRequest(
  path: string, data: Record<string, string>, csrfToken: string,
  options: { verificationPending?: boolean; signedOutSuccess?: boolean } = {},
) {
  const response = await fetch(`/auth/browser/v1/${path}`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as {
      errors?: AuthError[]
      data?: { flows?: { id: string; is_pending?: boolean }[] }
    } | null
    const pending = body?.data?.flows?.some(flow => flow.id === 'verify_email' && flow.is_pending)
    if (response.status === 401 && ((options.verificationPending && pending)
      || (options.signedOutSuccess && body !== null && !body.errors?.length))) return
    throw new Error(body?.errors?.map(error => error.message).filter(Boolean).join(' ')
      || (pending ? 'Check your inbox and verify your email before signing in.' : 'The account request could not be completed.'))
  }
}

export function signIn(email: string, password: string, csrfToken: string) {
  return authRequest('auth/login', { email, password }, csrfToken)
}
