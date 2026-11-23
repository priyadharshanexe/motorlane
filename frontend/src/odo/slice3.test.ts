import { describe, expect, it } from 'vitest'
import type { Booking } from '../api'
import { awaitingPayment, countdown, pickupWindow } from './Owner'

const row = { start_date: '2027-03-10', end_date: '2027-03-11', pickup_time: '10:00:00', return_time: '09:30:00' } as Booking

describe('pickup window', () => {
  it('opens an hour before pickup (IST) and closes at the return time', () => {
    const { opens, closes } = pickupWindow(row)
    expect(new Date(opens).toISOString()).toBe('2027-03-10T03:30:00.000Z')
    expect(new Date(closes).toISOString()).toBe('2027-03-11T04:00:00.000Z')
  })
  it('counts down in readable units', () => {
    expect(countdown(65_000)).toBe('1m 05s')
    expect(countdown(2 * 3600e3 + 14 * 60e3)).toBe('2h 14m')
    expect(countdown(26 * 3600e3)).toBe('1d 2h')
    expect(countdown(-5)).toBe('0m 00s')
  })
  it('knows when a payment is still owed', () => {
    expect(awaitingPayment({ ...row, payment_required: true, payment: null })).toBe(true)
    expect(awaitingPayment({ ...row, payment_required: true, payment: { status: 'paid' } } as Booking)).toBe(false)
    expect(awaitingPayment({ ...row, payment_required: false })).toBe(false)
  })
})
