import { describe, expect, it } from 'vitest'
import { addDays, defaultShifts, hasUncoveredTime, normalizeShifts, parseShiftTime, resolveShift } from './shifts.mjs'

const vn = 'Asia/Ho_Chi_Minh'

// Hai ca 12 tiếng, kiểu phổ biến ở xưởng thêu Việt Nam.
const twoShifts = normalizeShifts([
  { id: 'ca-1', name: 'Ca ngày', start: '06:00', end: '18:00' },
  { id: 'ca-2', name: 'Ca đêm', start: '18:00', end: '06:00' },
])

describe('parseShiftTime', () => {
  it('accepts 24:00 as the end of a day but never as a start', () => {
    expect(parseShiftTime('24:00')).toBe(1_440)
    expect(parseShiftTime('00:00')).toBe(0)
    expect(() => parseShiftTime('7:00')).toThrow(/HH:MM/)
    expect(() => parseShiftTime('25:00')).toThrow(/HH:MM/)
    expect(() => normalizeShifts([{ id: 'x', start: '24:00', end: '06:00' }])).toThrow(/start không thể là 24:00/)
  })
})

describe('normalizeShifts', () => {
  it('rejects overlapping shifts so no stitch can be paid twice', () => {
    expect(() => normalizeShifts([
      { id: 'ca-1', start: '06:00', end: '18:00' },
      { id: 'ca-2', start: '17:00', end: '23:00' },
    ])).toThrow(/chồng giờ/)
  })

  it('detects overlap across midnight too', () => {
    expect(() => normalizeShifts([
      { id: 'ca-dem', start: '22:00', end: '06:00' },
      { id: 'ca-sang', start: '05:00', end: '12:00' },
    ])).toThrow(/chồng giờ/)
  })

  it('rejects duplicate ids and the reserved outside-shift id', () => {
    expect(() => normalizeShifts([
      { id: 'ca-1', start: '00:00', end: '08:00' },
      { id: 'ca-1', start: '08:00', end: '16:00' },
    ])).toThrow(/trùng/)
    expect(() => normalizeShifts([{ id: 'ngoai-ca', start: '00:00', end: '08:00' }])).toThrow(/dành riêng/)
  })

  it('falls back to a single honest all-day bucket instead of guessing two 12h ca', () => {
    const shifts = normalizeShifts(undefined)
    expect(shifts).toHaveLength(1)
    expect(shifts[0].id).toBe(defaultShifts[0].id)
    expect(hasUncoveredTime(shifts)).toBe(false)
  })

  it('reports a day that the declared shifts do not fully cover', () => {
    expect(hasUncoveredTime(normalizeShifts([{ id: 'ca-1', start: '08:00', end: '17:00' }]))).toBe(true)
    expect(hasUncoveredTime(twoShifts)).toBe(false)
  })
})

describe('resolveShift', () => {
  it('uses the site clock, not the server clock', () => {
    // 23:30 UTC is already 06:30 the next day in Ho Chi Minh City -> day shift, next date.
    const bucket = resolveShift('2026-08-13T23:30:00Z', { timeZone: vn, shifts: twoShifts })
    expect(bucket).toMatchObject({ date: '2026-08-14', shiftId: 'ca-1', localTime: '06:30' })
  })

  it('keeps an overnight shift on the business date it started', () => {
    const evening = resolveShift('2026-08-14T12:00:00Z', { timeZone: vn, shifts: twoShifts }) // 19:00 local
    const pastMidnight = resolveShift('2026-08-14T19:00:00Z', { timeZone: vn, shifts: twoShifts }) // 02:00 local, hôm sau
    expect(evening).toMatchObject({ date: '2026-08-14', shiftId: 'ca-2' })
    expect(pastMidnight).toMatchObject({ date: '2026-08-14', shiftId: 'ca-2', localTime: '02:00' })
  })

  it('puts the boundary minute in the incoming shift, not both', () => {
    const start = resolveShift('2026-08-14T11:00:00Z', { timeZone: vn, shifts: twoShifts }) // đúng 18:00
    expect(start.shiftId).toBe('ca-2')
  })

  it('never drops time: hours outside every declared shift land in ngoai-ca', () => {
    const officeHours = normalizeShifts([{ id: 'ca-1', name: 'Hành chính', start: '08:00', end: '17:00' }])
    const bucket = resolveShift('2026-08-14T15:00:00Z', { timeZone: vn, shifts: officeHours }) // 22:00 local
    expect(bucket).toMatchObject({ date: '2026-08-14', shiftId: 'ngoai-ca', shiftName: 'Ngoài ca' })
  })

  it('handles a site in another timezone without touching the others', () => {
    const bucket = resolveShift('2026-08-14T19:00:00Z', { timeZone: 'UTC', shifts: twoShifts })
    expect(bucket).toMatchObject({ date: '2026-08-14', shiftId: 'ca-2', localTime: '19:00' })
  })

  it('rejects an unusable timezone rather than silently using the server one', () => {
    expect(() => resolveShift('2026-08-14T19:00:00Z', { timeZone: 'Mars/Olympus', shifts: twoShifts })).toThrow(/Múi giờ/)
  })
})

describe('addDays', () => {
  it('crosses month and year ends', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
    expect(addDays('2026-08-14', -120)).toBe('2026-04-16')
  })
})
