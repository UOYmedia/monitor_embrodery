import { describe, expect, it } from 'vitest'
import { connectionState } from './freshness.mjs'

const now = Date.parse('2026-08-14T07:00:00Z')
const thresholds = { freshSeconds: 30, staleSeconds: 90 }
const ago = (seconds) => new Date(now - (seconds * 1000)).toISOString()

/**
 * The same table drives src/lib/freshness.test.ts, so the bridge and the dashboard can
 * never disagree about what "offline" means.
 */
const table = [
  { name: 'telemetry mới → online', input: { hasProtocol: true, lastTelemetryAt: ago(5), reachable: true }, state: 'online' },
  { name: 'đúng ngưỡng fresh vẫn online', input: { hasProtocol: true, lastTelemetryAt: ago(30), reachable: true }, state: 'online' },
  { name: 'quá fresh nhưng chưa quá stale → stale', input: { hasProtocol: true, lastTelemetryAt: ago(45), reachable: true }, state: 'stale' },
  { name: 'quá stale và không ping được → offline', input: { hasProtocol: true, lastTelemetryAt: ago(600), reachable: false }, state: 'offline' },
  { name: 'quá stale nhưng cổng vẫn mở → unknown', input: { hasProtocol: true, lastTelemetryAt: ago(600), reachable: true }, state: 'unknown' },
  { name: 'chưa từng có telemetry và ping fail → offline', input: { hasProtocol: true, lastTelemetryAt: null, reachable: false }, state: 'offline' },
  { name: 'chưa từng có telemetry, chưa ping → unknown', input: { hasProtocol: true, lastTelemetryAt: null, reachable: null }, state: 'unknown' },
  { name: 'adapter manual luôn unknown', input: { hasProtocol: false, lastTelemetryAt: null, reachable: true }, state: 'unknown' },
  { name: 'máy tắt theo dõi → unknown', input: { enabled: false, hasProtocol: true, lastTelemetryAt: ago(2), reachable: true }, state: 'unknown' },
  { name: 'số mới nhất là số gõ tay → unknown, dù rất mới', input: { hasProtocol: true, lastTelemetryAt: ago(5), reachable: true, telemetryQuality: 'manual' }, state: 'unknown' },
]

describe('connectionState', () => {
  for (const row of table) {
    it(row.name, () => {
      expect(connectionState({ ...row.input, ...thresholds, now }).state).toBe(row.state)
    })
  }

  it('never reports fault: only a controller can report a fault', () => {
    const states = table.map((row) => connectionState({ ...row.input, ...thresholds, now }).state)
    expect(states).not.toContain('fault')
  })

  it('always explains itself in Vietnamese so colour is not the only channel', () => {
    for (const row of table) {
      const result = connectionState({ ...row.input, ...thresholds, now })
      expect(typeof result.reason).toBe('string')
      expect(result.reason.length).toBeGreaterThan(10)
    }
  })

  it('keeps raw ISO strings out of the reason an operator reads', () => {
    const result = connectionState({
      hasProtocol: true, lastTelemetryAt: ago(600), lastReachableAt: ago(300), reachable: false, ...thresholds, now,
    })
    expect(result.state).toBe('offline')
    expect(result.reason).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(result.reason).toContain('300s')
  })

  it('máy adapter manual: lý do phải nói cả chuyện số là số gõ tay', () => {
    // Đây là ca thường gặp nhất của cả tính năng nhập tay, không phải ca rìa: máy `manual` thì
    // `hasProtocol` luôn false, nên nhánh này là nhánh duy nhất mà tấm thẻ hiện tuổi của một con số
    // gõ tay. Chỉ nói "chưa có giao thức" mà không nói con số ở đâu ra là để trống chỗ cho người xem
    // tự đoán, và đoán mặc định luôn là "máy có gửi gì đó".
    const result = connectionState({
      hasProtocol: false, lastTelemetryAt: ago(5), reachable: null, telemetryQuality: 'manual', ...thresholds, now,
    })
    expect(result.state).toBe('unknown')
    expect(result.reason).toContain('gõ tay')
    expect(result.ageSeconds).toBe(5)
  })

  it('nói rõ vì sao số gõ tay không tô xanh được ô máy', () => {
    // `online` là lời khẳng định về đường truyền giữa bridge và máy. Một người đứng gõ số chỉ chứng
    // minh có người đứng đó. Nếu ô vẫn xanh thì đúng cái tình huống sinh ra ô nhập tay bị che đi.
    const result = connectionState({
      hasProtocol: true, lastTelemetryAt: ago(5), reachable: true, telemetryQuality: 'manual', ...thresholds, now,
    })
    expect(result.state).toBe('unknown')
    expect(result.reason).toContain('gõ tay')
    expect(result.ageSeconds).toBe(5)
  })

  it('số của máy vẫn online: quality verified không đổi gì', () => {
    const result = connectionState({
      hasProtocol: true, lastTelemetryAt: ago(5), reachable: true, telemetryQuality: 'verified', ...thresholds, now,
    })
    expect(result.state).toBe('online')
  })

  it('reports the age in seconds so the UI can show data age, not just a colour', () => {
    expect(connectionState({ hasProtocol: true, lastTelemetryAt: ago(45), reachable: true, ...thresholds, now }).ageSeconds).toBe(45)
    expect(connectionState({ hasProtocol: true, lastTelemetryAt: null, ...thresholds, now }).ageSeconds).toBeNull()
  })

  it('honours per-site thresholds', () => {
    const slowSite = { freshSeconds: 120, staleSeconds: 600 }
    expect(connectionState({ hasProtocol: true, lastTelemetryAt: ago(45), reachable: true, ...slowSite, now }).state).toBe('online')
  })
})
