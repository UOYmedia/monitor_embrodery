import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PRODUCTION_SCHEMA_VERSION, ProductionLog, pieceRateAmount } from './production.mjs'
import { normalizeShifts } from './shifts.mjs'

const shifts = normalizeShifts([
  { id: 'ca-1', name: 'Ca ngày', start: '06:00', end: '18:00' },
  { id: 'ca-2', name: 'Ca đêm', start: '18:00', end: '06:00' },
])
const site = { id: 'hn-1', timeZone: 'Asia/Ho_Chi_Minh', shifts }
const machine = { id: 'mch-hn-001', siteId: 'hn-1' }

const snapshot = (odometer, observedAt, { status = 'running', quality = 'verified' } = {}) => ({
  machineId: machine.id,
  observedAt,
  odometer: odometer === null ? null : { value: odometer, observedAt, source: 'http-json', quality },
  status: { value: status, observedAt, source: 'http-json', quality: 'verified' },
})

const silent = { warn() {}, error() {}, debug() {} }
let dir
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'production-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const newLog = (options = {}) => new ProductionLog({ filePath: join(dir, 'production.json'), logger: silent, ...options })

describe('ProductionLog.record', () => {
  it('counts nothing from the first reading — a single odometer value is not production', () => {
    const log = newLog()
    const result = log.record(snapshot(1_000_000, '2026-08-14T03:00:00Z'), { machine, site })
    expect(result).toMatchObject({ counted: false, reason: 'baseline' })
    expect(log.query()).toEqual([])
  })

  it('counts the difference between two readings into the local shift bucket', () => {
    const log = newLog()
    log.record(snapshot(1_000_000, '2026-08-14T03:00:00Z'), { machine, site })
    log.record(snapshot(1_012_000, '2026-08-14T03:15:00Z'), { machine, site })
    const [bucket] = log.query()
    expect(bucket).toMatchObject({ date: '2026-08-14', shiftId: 'ca-1', machineId: 'mch-hn-001', siteId: 'hn-1', stitches: 12_000 })
  })

  it('splits work across shifts at the local boundary', () => {
    const log = newLog()
    log.record(snapshot(0, '2026-08-14T10:50:00Z'), { machine, site }) // 17:50 -> ca-1
    log.record(snapshot(5_000, '2026-08-14T10:59:00Z'), { machine, site }) // 17:59 -> ca-1
    log.record(snapshot(9_000, '2026-08-14T11:05:00Z'), { machine, site }) // 18:05 -> ca-2
    const buckets = Object.fromEntries(log.query().map((entry) => [entry.shiftId, entry.stitches]))
    expect(buckets).toEqual({ 'ca-1': 5_000, 'ca-2': 4_000 })
  })

  it('re-baselines on a counter reset instead of counting a negative or a huge delta', () => {
    const log = newLog()
    log.record(snapshot(9_000_000, '2026-08-14T03:00:00Z'), { machine, site })
    const reset = log.record(snapshot(0, '2026-08-14T03:05:00Z'), { machine, site })
    log.record(snapshot(4_000, '2026-08-14T03:10:00Z'), { machine, site })
    expect(reset).toMatchObject({ counted: false, reason: 'counter-reset' })
    const [bucket] = log.query()
    expect(bucket.stitches).toBe(4_000)
    expect(bucket.resets).toBe(1)
  })

  it('refuses a jump the machine could not physically have stitched', () => {
    const log = newLog({ maxStitchesPerMinute: 1_500 })
    log.record(snapshot(1_000, '2026-08-14T03:00:00Z'), { machine, site })
    // 5 phút chỉ có thể ra tối đa ~9.000 mũi; 900.000 là lỗi bộ đếm, không phải sản lượng.
    const jump = log.record(snapshot(901_000, '2026-08-14T03:05:00Z'), { machine, site })
    expect(jump).toMatchObject({ counted: false, reason: 'implausible-jump' })
    const [bucket] = log.query()
    expect(bucket.stitches).toBe(0)
    expect(bucket.anomalies).toBe(1)
    // Sau khi lấy mốc lại, các lần đọc kế tiếp vẫn đếm bình thường.
    log.record(snapshot(903_000, '2026-08-14T03:06:00Z'), { machine, site })
    expect(log.query()[0].stitches).toBe(2_000)
  })

  it('ignores a reading with no odometer rather than treating it as zero', () => {
    const log = newLog()
    log.record(snapshot(1_000, '2026-08-14T03:00:00Z'), { machine, site })
    expect(log.record(snapshot(null, '2026-08-14T03:05:00Z'), { machine, site })).toMatchObject({ counted: false, reason: 'no-odometer' })
    log.record(snapshot(3_000, '2026-08-14T03:10:00Z'), { machine, site })
    expect(log.query()[0].stitches).toBe(2_000)
  })

  it('ignores a reading the adapter did not mark verified', () => {
    const log = newLog()
    log.record(snapshot(1_000, '2026-08-14T03:00:00Z'), { machine, site })
    const result = log.record(snapshot(5_000, '2026-08-14T03:05:00Z', { quality: 'inferred' }), { machine, site })
    expect(result).toMatchObject({ counted: false, reason: 'unverified-reading' })
    expect(log.query()).toEqual([])
  })

  it('drops an out-of-order reading without rewriting history', () => {
    const log = newLog()
    log.record(snapshot(1_000, '2026-08-14T03:00:00Z'), { machine, site })
    log.record(snapshot(5_000, '2026-08-14T03:10:00Z'), { machine, site })
    const late = log.record(snapshot(3_000, '2026-08-14T03:05:00Z'), { machine, site })
    expect(late).toMatchObject({ counted: false, reason: 'out-of-order' })
    expect(log.query()[0].stitches).toBe(4_000)
  })

  it('accumulates run time only while the controller reports running, capped over a gap', () => {
    const log = newLog({ maxRunGapSeconds: 120 })
    log.record(snapshot(0, '2026-08-14T03:00:00Z'), { machine, site })
    log.record(snapshot(1_000, '2026-08-14T03:01:00Z'), { machine, site }) // +60s chạy
    log.record(snapshot(1_000, '2026-08-14T03:02:00Z', { status: 'stopped' }), { machine, site }) // dừng, không cộng
    log.record(snapshot(2_000, '2026-08-14T04:00:00Z'), { machine, site }) // mất kết nối 58 phút -> chỉ cộng 120s
    expect(log.query()[0].runSeconds).toBe(180)
  })

  it('uses the site timezone so a night shift is not split by UTC midnight', () => {
    const log = newLog()
    log.record(snapshot(0, '2026-08-14T16:00:00Z'), { machine, site }) // 23:00 local, ca-2 ngày 14
    log.record(snapshot(3_000, '2026-08-14T18:00:00Z'), { machine, site }) // 01:00 local ngày 15, vẫn ca-2 ngày 14
    const rows = log.query()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ date: '2026-08-14', shiftId: 'ca-2', stitches: 3_000 })
  })

  it('keeps stitches from an undeclared hour in a visible ngoai-ca bucket', () => {
    const officeSite = { ...site, shifts: normalizeShifts([{ id: 'ca-1', name: 'Hành chính', start: '08:00', end: '17:00' }]) }
    const log = newLog()
    log.record(snapshot(0, '2026-08-14T14:00:00Z'), { machine, site: officeSite }) // 21:00 local
    log.record(snapshot(2_000, '2026-08-14T14:10:00Z'), { machine, site: officeSite })
    expect(log.query()[0]).toMatchObject({ shiftId: 'ngoai-ca', stitches: 2_000 })
  })
})

describe('ProductionLog.query', () => {
  it('filters by business date range, site and machine', () => {
    const log = newLog()
    const other = { id: 'mch-hcm-001', siteId: 'hcm-1' }
    log.record(snapshot(0, '2026-08-10T03:00:00Z'), { machine, site })
    log.record(snapshot(1_000, '2026-08-10T03:05:00Z'), { machine, site })
    log.record(snapshot(0, '2026-08-14T03:00:00Z'), { machine, site })
    log.record(snapshot(2_000, '2026-08-14T03:05:00Z'), { machine, site })
    log.record({ ...snapshot(0, '2026-08-14T03:00:00Z'), machineId: other.id }, { machine: other, site: { ...site, id: 'hcm-1' } })
    log.record({ ...snapshot(500, '2026-08-14T03:05:00Z'), machineId: other.id }, { machine: other, site: { ...site, id: 'hcm-1' } })

    expect(log.query({ from: '2026-08-12' }).map((row) => row.machineId).sort()).toEqual(['mch-hcm-001', 'mch-hn-001'])
    expect(log.query({ siteId: 'hcm-1' })).toHaveLength(1)
    expect(log.query({ machineIds: ['mch-hn-001'] })).toHaveLength(2)
    expect(log.query({ from: '2026-08-14', to: '2026-08-14', machineIds: ['mch-hn-001'] })[0].stitches).toBe(2_000)
  })
})

describe('ProductionLog persistence', () => {
  it('survives a restart without losing the odometer cursor or double-counting', async () => {
    const log = newLog()
    log.record(snapshot(1_000, '2026-08-14T03:00:00Z'), { machine, site })
    log.record(snapshot(4_000, '2026-08-14T03:05:00Z'), { machine, site })
    expect(await log.flush()).toBe(true)

    const reopened = newLog()
    await reopened.load()
    expect(reopened.query()[0].stitches).toBe(3_000)
    reopened.record(snapshot(5_000, '2026-08-14T03:10:00Z'), { machine, site })
    expect(reopened.query()[0].stitches).toBe(4_000)
  })

  it('does not rewrite the file when nothing changed', async () => {
    const log = newLog()
    log.record(snapshot(1_000, '2026-08-14T03:00:00Z'), { machine, site })
    expect(await log.flush()).toBe(true)
    expect(await log.flush()).toBe(false)
  })

  it('starts a new ledger when the file is corrupt, keeping the fleet view up', async () => {
    const path = join(dir, 'production.json')
    await writeFile(path, '{ not json', 'utf8')
    const log = newLog()
    await log.load()
    expect(log.query()).toEqual([])
    log.record(snapshot(1_000, '2026-08-14T03:00:00Z'), { machine, site })
    await log.flush()
    const saved = JSON.parse(await readFile(path, 'utf8'))
    expect(saved.schemaVersion).toBe(PRODUCTION_SCHEMA_VERSION)
  })

  it('drops rows written by an unknown future schema instead of misreading them', async () => {
    const path = join(dir, 'production.json')
    await writeFile(path, JSON.stringify({ schemaVersion: 99, buckets: { x: {} } }), 'utf8')
    const log = newLog()
    await log.load()
    expect(log.query()).toEqual([])
  })
})

describe('ProductionLog.prune', () => {
  it('removes buckets past the retention window and keeps the rest', () => {
    const log = newLog({ retentionDays: 30 })
    log.record(snapshot(0, '2026-05-01T03:00:00Z'), { machine, site })
    log.record(snapshot(1_000, '2026-05-01T03:05:00Z'), { machine, site })
    log.record(snapshot(0, '2026-08-14T03:00:00Z'), { machine, site })
    log.record(snapshot(2_000, '2026-08-14T03:05:00Z'), { machine, site })
    const result = log.prune(new Date('2026-08-14T10:00:00Z'))
    expect(result).toMatchObject({ removed: 1, cutoff: '2026-07-15' })
    expect(log.query().map((row) => row.date)).toEqual(['2026-08-14'])
  })
})

describe('ProductionLog.forget', () => {
  it('clears the cursor so an unpaired machine cannot resume counting from a stale value', () => {
    const log = newLog()
    log.record(snapshot(1_000, '2026-08-14T03:00:00Z'), { machine, site })
    log.forget(machine.id)
    const result = log.record(snapshot(9_000, '2026-08-14T03:05:00Z'), { machine, site })
    expect(result).toMatchObject({ counted: false, reason: 'baseline' })
  })
})

describe('pieceRateAmount', () => {
  it('prices per 1000 stitches and rounds to whole đồng', () => {
    expect(pieceRateAmount(12_000, 1_200)).toBe(14_400)
    expect(pieceRateAmount(1_234, 1_000)).toBe(1_234)
    expect(pieceRateAmount(1_235, 900)).toBe(1_112) // 1.1115 * 1000 -> làm tròn
  })

  it('returns null when no rate is configured, not a misleading zero', () => {
    expect(pieceRateAmount(12_000, null)).toBeNull()
    expect(pieceRateAmount(12_000, 0)).toBeNull()
    expect(pieceRateAmount(0, 1_200)).toBe(0)
  })
})
