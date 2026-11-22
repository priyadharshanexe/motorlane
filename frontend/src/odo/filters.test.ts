import { describe, expect, it } from 'vitest'
import { activeFilters, vehicleType, withParam } from './filters'

describe('catalog filters bound to the URL', () => {
  it('sets the vehicle type and keeps the other filters (regression: the type filter did not apply)', () => {
    const start = new URLSearchParams('location=Madurai&start_date=2026-11-24')
    const cars = withParam(start, 'type', 'Car')
    expect(cars.get('type')).toBe('Car')
    expect(cars.get('location')).toBe('Madurai')
    expect(cars.get('start_date')).toBe('2026-11-24')
    expect(vehicleType(cars)).toBe('Car')
    const bikes = withParam(cars, 'type', 'Bike')
    expect(vehicleType(bikes)).toBe('Bike')
  })

  it('clears the type for "All" instead of sending an empty filter', () => {
    const all = withParam(new URLSearchParams('type=Bike&fuel=Petrol'), 'type', '')
    expect(all.has('type')).toBe(false)
    expect(all.toString()).toBe('fuel=Petrol')
    expect(vehicleType(all)).toBe('')
  })

  it('returns to the first page whenever a filter changes, but not when paging', () => {
    const paged = new URLSearchParams('type=Car&page=3')
    expect(withParam(paged, 'fuel', 'Diesel').has('page')).toBe(false)
    expect(withParam(paged, 'page', '4').get('page')).toBe('4')
  })

  it('ignores unknown types and lists active filters in a stable order', () => {
    expect(vehicleType(new URLSearchParams('type=Truck'))).toBe('')
    const params = new URLSearchParams('fuel=Petrol&type=Car&q=Swift&page=2')
    expect(activeFilters(params).map(f => f.key)).toEqual(['q', 'type', 'fuel'])
  })
})
