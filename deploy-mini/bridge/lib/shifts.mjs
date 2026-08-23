/**
 * Shift calendar for production counting.
 *
 * Payroll is per shift, so a stitch has to land in exactly one bucket: a business date plus a
 * shift id, both in the site's local time. Two rules matter and both are here rather than
 * spread through the service:
 *
 * 1. An overnight shift (18:00 -> 06:00) belongs to the business date it *started* on. The 02:00
 *    reading of Tuesday morning is Monday night's work and Monday night's pay.
 * 2. Time not covered by any declared shift is never dropped. It lands in `ngoai-ca` so the
 *    totals still add up to the odometer, and the gap is visible instead of silently missing.
 */

export const OUTSIDE_SHIFT_ID = 'ngoai-ca'
export const OUTSIDE_SHIFT_NAME = 'Ngoài ca'

/**
 * Deliberately one 24h bucket, not the usual two 12h ca. Guessing shift boundaries would
 * produce plausible-looking but wrong payroll splits; one honest bucket plus a startup warning
 * makes the workshop declare its real shifts.
 */
export const defaultShifts = [{ id: 'ca-ngay', name: 'Cả ngày', start: '00:00', end: '24:00' }]

const TIME_PATTERN = /^([01]\d|2[0-4]):([0-5]\d)$/

/** "HH:MM" -> minutes past local midnight. "24:00" is the end of the day, not the start. */
export function parseShiftTime(text, label = 'shift time') {
  const match = TIME_PATTERN.exec(String(text ?? '').trim())
  if (!match) throw new Error(`${label} phải có dạng HH:MM (00:00–24:00).`)
  const minutes = Number(match[1]) * 60 + Number(match[2])
  if (minutes > 1_440) throw new Error(`${label} vượt quá 24:00.`)
  return minutes
}

/** A shift as one or two half-open minute ranges on the 0–1440 clock; wrapping shifts split. */
function ranges(shift) {
  if (shift.startMinute < shift.endMinute) return [[shift.startMinute, shift.endMinute]]
  return [[shift.startMinute, 1_440], [0, shift.endMinute]]
}

function overlaps(a, b) {
  return ranges(a).some(([aStart, aEnd]) => ranges(b).some(([bStart, bEnd]) => aStart < bEnd && bStart < aEnd))
}

/**
 * Validates a site's declared shifts. Overlapping shifts are rejected: a stitch counted twice
 * is money paid twice, and there is no safe way to guess which shift the operator meant.
 */
export function normalizeShifts(rawShifts, label = 'shifts') {
  if (rawShifts === undefined || rawShifts === null) return defaultShifts.map((shift) => resolveShiftDefinition(shift, label))
  if (!Array.isArray(rawShifts) || !rawShifts.length) throw new Error(`${label} phải là danh sách có ít nhất một ca.`)
  if (rawShifts.length > 6) throw new Error(`${label} tối đa 6 ca.`)

  const ids = new Set()
  const shifts = rawShifts.map((raw, index) => {
    const shift = resolveShiftDefinition(raw, `${label}[${index}]`)
    if (shift.id === OUTSIDE_SHIFT_ID) throw new Error(`${label}[${index}].id trùng với mã dành riêng "${OUTSIDE_SHIFT_ID}".`)
    if (ids.has(shift.id)) throw new Error(`${label}: mã ca trùng "${shift.id}".`)
    ids.add(shift.id)
    return shift
  })

  for (let i = 0; i < shifts.length; i += 1) {
    for (let j = i + 1; j < shifts.length; j += 1) {
      if (overlaps(shifts[i], shifts[j])) throw new Error(`${label}: ca "${shifts[i].id}" và "${shifts[j].id}" chồng giờ nhau.`)
    }
  }
  return shifts
}

function resolveShiftDefinition(raw, label) {
  if (!raw || typeof raw !== 'object') throw new Error(`${label} không hợp lệ.`)
  const id = String(raw.id ?? '').trim()
  if (!/^[a-z0-9][a-z0-9-]{0,32}$/i.test(id)) throw new Error(`${label}.id cần dạng chữ-số-gạch ngang.`)
  const startMinute = parseShiftTime(raw.start, `${label}.start`)
  const endMinute = parseShiftTime(raw.end, `${label}.end`)
  if (startMinute === endMinute) throw new Error(`${label}: giờ bắt đầu và kết thúc trùng nhau.`)
  if (startMinute === 1_440) throw new Error(`${label}.start không thể là 24:00.`)
  return {
    id,
    name: String(raw.name ?? id).trim() || id,
    start: minutesToText(startMinute),
    end: minutesToText(endMinute),
    startMinute,
    endMinute,
  }
}

function minutesToText(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

const formatterCache = new Map()

function formatter(timeZone) {
  let cached = formatterCache.get(timeZone)
  if (!cached) {
    try {
      cached = new Intl.DateTimeFormat('en-CA', {
        timeZone, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    } catch {
      throw new Error(`Múi giờ không hợp lệ: ${timeZone}`)
    }
    formatterCache.set(timeZone, cached)
  }
  return cached
}

/** Wall-clock parts at `instant` in `timeZone`. The site's clock decides the shift, not the server's. */
export function localParts(instant, timeZone) {
  const date = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(date.getTime())) throw new Error('Thời điểm không hợp lệ.')
  const parts = {}
  for (const part of formatter(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

/** Calendar arithmetic on a `YYYY-MM-DD` business date. No timezone involved at this point. */
export function addDays(date, days) {
  const [year, month, day] = String(date).split('-').map(Number)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) throw new Error(`Ngày không hợp lệ: ${date}`)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

/** "2026-08-14" -> "2026-08-13". */
export function previousDate(date) {
  return addDays(date, -1)
}

/**
 * Maps an instant to the bucket its stitches belong to.
 * Returns `{ date, shiftId, shiftName, localTime }` — never null, so nothing goes uncounted.
 */
export function resolveShift(instant, { timeZone = 'Asia/Ho_Chi_Minh', shifts = defaultShifts } = {}) {
  const local = localParts(instant, timeZone)
  for (const shift of shifts) {
    const startMinute = shift.startMinute ?? parseShiftTime(shift.start)
    const endMinute = shift.endMinute ?? parseShiftTime(shift.end)
    if (startMinute < endMinute) {
      if (local.minutes >= startMinute && local.minutes < endMinute) {
        return { date: local.date, shiftId: shift.id, shiftName: shift.name, localTime: minutesToText(local.minutes) }
      }
    } else if (local.minutes >= startMinute) {
      return { date: local.date, shiftId: shift.id, shiftName: shift.name, localTime: minutesToText(local.minutes) }
    } else if (local.minutes < endMinute) {
      // Past midnight: still the shift that began on the previous business date.
      return { date: previousDate(local.date), shiftId: shift.id, shiftName: shift.name, localTime: minutesToText(local.minutes) }
    }
  }
  return { date: local.date, shiftId: OUTSIDE_SHIFT_ID, shiftName: OUTSIDE_SHIFT_NAME, localTime: minutesToText(local.minutes) }
}

/** True when the declared shifts leave part of the day uncovered — worth a startup warning. */
export function hasUncoveredTime(shifts) {
  const covered = new Array(1_440).fill(false)
  for (const shift of shifts) {
    for (const [start, end] of ranges(shift)) {
      for (let minute = start; minute < end; minute += 1) covered[minute] = true
    }
  }
  return covered.includes(false)
}
