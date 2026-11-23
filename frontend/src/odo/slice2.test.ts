import { describe, expect, it } from 'vitest'
import { strength, validate } from './authRules'
import { toSlot, toTime } from './TimeRoad'

describe('time road slots', () => {
  it('maps times to half-hour slots and back', () => {
    expect(toSlot('00:00')).toBe(0)
    expect(toSlot('13:00')).toBe(26)
    expect(toSlot('13:30')).toBe(27)
    expect(toSlot('13:45')).toBe(27)
    expect(toTime(26)).toBe('13:00')
    expect(toTime(47)).toBe('23:30')
  })
})

describe('auth inline validation', () => {
  it('checks email shape and password length', () => {
    expect(validate('email', '')).toMatch(/Enter/)
    expect(validate('email', 'asha@example')).toMatch(/doesn't look/)
    expect(validate('email', 'asha@example.com')).toBe('')
    expect(validate('password', 'short')).toMatch(/8 characters/)
    expect(validate('password', 'long enough')).toBe('')
  })

  it('scores password strength for the fuel gauge', () => {
    expect(strength('')).toBe(0)
    expect(strength('abcdefgh')).toBe(1)
    expect(strength('abcdefghijkl')).toBe(2)
    expect(strength('Abcdefghijk1!')).toBe(4)
  })
})
