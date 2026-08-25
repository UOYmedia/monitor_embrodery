import { describe, expect, it } from 'vitest'
import { DOWNTIME_STATUSES, durationSeconds, formatSpokenDuration, isDowntime, isImmediateDowntime, latestSignificantEvent } from './downtime.mjs'

describe('phân loại trạng thái ngừng', () => {
  it('coi fault/stopped/paused là ngừng, running/unknown thì không', () => {
    expect([...DOWNTIME_STATUSES].sort()).toEqual(['fault', 'paused', 'stopped'])
    expect(isDowntime('fault')).toBe(true)
    expect(isDowntime('running')).toBe(false)
    expect(isDowntime('unknown')).toBe(false)
  })

  it('chỉ fault mới đáng ghi ngay, dừng thường phải chờ ngưỡng', () => {
    expect(isImmediateDowntime('fault')).toBe(true)
    expect(isImmediateDowntime('stopped')).toBe(false)
    expect(isImmediateDowntime('paused')).toBe(false)
  })
})

describe('latestSignificantEvent', () => {
  it('bỏ qua sự kiện info', () => {
    expect(latestSignificantEvent([{ code: 'X', severity: 'info', occurredAt: '2026-08-24T00:00:00Z' }])).toBeNull()
    expect(latestSignificantEvent([])).toBeNull()
  })

  it('ưu tiên critical hơn warning dù warning mới hơn', () => {
    const event = latestSignificantEvent([
      { code: 'CRIT', severity: 'critical', occurredAt: '2026-08-24T00:00:00Z' },
      { code: 'WARN', severity: 'warning', occurredAt: '2026-08-24T01:00:00Z' },
    ])
    expect(event.code).toBe('CRIT')
  })

  it('trong cùng mức thì lấy cái mới nhất', () => {
    const event = latestSignificantEvent([
      { code: 'OLD', severity: 'critical', occurredAt: '2026-08-24T00:00:00Z' },
      { code: 'NEW', severity: 'critical', occurredAt: '2026-08-24T02:00:00Z' },
    ])
    expect(event.code).toBe('NEW')
  })
})

describe('formatSpokenDuration', () => {
  it('đọc giây/phút/giờ cho người ở xưởng', () => {
    expect(formatSpokenDuration(0)).toBe('0 giây')
    expect(formatSpokenDuration(45)).toBe('45 giây')
    expect(formatSpokenDuration(60)).toBe('1 phút')
    expect(formatSpokenDuration(750)).toBe('12 phút 30 giây')
    expect(formatSpokenDuration(3600)).toBe('1 giờ')
    expect(formatSpokenDuration(7500)).toBe('2 giờ 5 phút')
  })

  it('trả null khi số không hợp lệ, để chỗ gọi nói "không rõ"', () => {
    expect(formatSpokenDuration(-1)).toBeNull()
    expect(formatSpokenDuration(NaN)).toBeNull()
  })
})

describe('durationSeconds', () => {
  it('tính khoảng cách hai mốc ISO, làm tròn, không âm', () => {
    expect(durationSeconds('2026-08-24T00:00:00Z', '2026-08-24T00:12:30Z')).toBe(750)
    // Mốc kết thúc trước mốc bắt đầu (đồng hồ nhảy lùi) không sinh thời lượng âm.
    expect(durationSeconds('2026-08-24T00:05:00Z', '2026-08-24T00:00:00Z')).toBe(0)
  })

  it('trả null khi một mốc không đọc được', () => {
    expect(durationSeconds('không-phải-ngày', '2026-08-24T00:00:00Z')).toBeNull()
    expect(durationSeconds('2026-08-24T00:00:00Z', null)).toBeNull()
  })
})
