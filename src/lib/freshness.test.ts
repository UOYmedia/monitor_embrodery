import { describe, expect, it } from 'vitest'
import { connectionState, isReadingStale, readingAgeSeconds, refreshConnection } from './freshness'
import { makeMachine } from '../test/factories'

const now = Date.parse('2026-08-14T07:00:00Z')
const thresholds = { freshSeconds: 30, staleSeconds: 90 }
const ago = (seconds: number) => new Date(now - (seconds * 1000)).toISOString()

/**
 * Same table as bridge/lib/freshness.test.mjs. If the two ever disagree, one of them is
 * lying to an operator about whether the number on screen is current.
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
] as const

describe('connectionState (dashboard mirror của bridge)', () => {
  for (const row of table) {
    it(row.name, () => {
      expect(connectionState({ ...row.input, ...thresholds, now }).state).toBe(row.state)
    })
  }

  it('không bao giờ trả về fault: chỉ controller mới báo lỗi máy', () => {
    const states = table.map((row) => connectionState({ ...row.input, ...thresholds, now }).state)
    expect(states).not.toContain('fault')
  })

  it('luôn kèm lý do bằng chữ, không chỉ dựa vào màu', () => {
    for (const row of table) {
      const result = connectionState({ ...row.input, ...thresholds, now })
      expect(result.reason.length).toBeGreaterThan(10)
    }
  })

  it('không nhét chuỗi ISO thô vào lý do hiển thị cho người vận hành', () => {
    const result = connectionState({
      hasProtocol: true, lastTelemetryAt: ago(600), lastReachableAt: ago(300), reachable: false, ...thresholds, now,
    })
    expect(result.state).toBe('offline')
    expect(result.reason).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(result.reason).toContain('300s')
  })
})

describe('refreshConnection', () => {
  it('già hoá ảnh chụp cũ mà không đụng tới telemetry', () => {
    const machine = makeMachine({ lastTelemetryAt: ago(200) })
    const connection = refreshConnection(machine, now)
    expect(connection.state).toBe('unknown') // cổng còn mở nhưng adapter im lặng
    expect(connection.ageSeconds).toBe(200)
    expect(machine.telemetry?.rpm?.value).toBe(720)
  })

  it('máy đã lưu trữ được coi là không theo dõi', () => {
    const machine = makeMachine({ archived: true, lastTelemetryAt: ago(2) })
    expect(refreshConnection(machine, now).state).toBe('unknown')
  })

  it('mất liên lạc không biến thành lỗi máy', () => {
    const machine = makeMachine({ lastTelemetryAt: ago(600), reachable: false })
    const connection = refreshConnection(machine, now)
    expect(connection.state).toBe('offline')
    expect(machine.telemetry?.status.value).toBe('running')
  })
})

describe('tuổi của từng trường', () => {
  it('tính tuổi theo giây', () => {
    expect(readingAgeSeconds(ago(42), now)).toBe(42)
    expect(readingAgeSeconds(null, now)).toBeNull()
    expect(readingAgeSeconds('không-phải-thời-gian', now)).toBeNull()
  })

  it('đánh dấu trường quá ngưỡng tươi', () => {
    expect(isReadingStale(ago(10), thresholds, now)).toBe(false)
    expect(isReadingStale(ago(31), thresholds, now)).toBe(true)
    expect(isReadingStale(null, thresholds, now)).toBe(false)
  })
})
