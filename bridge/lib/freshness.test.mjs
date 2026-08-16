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

  it('reports the age in seconds so the UI can show data age, not just a colour', () => {
    expect(connectionState({ hasProtocol: true, lastTelemetryAt: ago(45), reachable: true, ...thresholds, now }).ageSeconds).toBe(45)
    expect(connectionState({ hasProtocol: true, lastTelemetryAt: null, ...thresholds, now }).ageSeconds).toBeNull()
  })

  it('honours per-site thresholds', () => {
    const slowSite = { freshSeconds: 120, staleSeconds: 600 }
    expect(connectionState({ hasProtocol: true, lastTelemetryAt: ago(45), reachable: true, ...slowSite, now }).state).toBe('online')
  })
})
