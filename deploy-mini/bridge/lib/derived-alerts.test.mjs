import { describe, expect, it } from 'vitest'
import { derivedAlerts, effectiveStatus, statusDuration } from './derived-alerts.mjs'

const MOC = Date.parse('2026-08-23T10:00:00Z')
const truoc = (phut) => new Date(MOC - phut * 60_000).toISOString()

const may = ({ state = 'online', status = 'running', tuNhieuPhut = null, approximate = false, ...rest } = {}) => ({
  identity: { name: 'Máy 1', enabled: true, archived: false, adapterHasProtocol: true, ...(rest.identity ?? {}) },
  connection: { state, reason: 'lý do của bridge', ageSeconds: 5, lastTelemetryAt: truoc(1), lastReachableAt: truoc(1), ...(rest.connection ?? {}) },
  thresholds: { freshSeconds: 30, staleSeconds: 90, stopEscalationMinutes: 5 },
  telemetry: status === null ? null : { status: { value: status } },
  statusSince: tuNhieuPhut === null ? null : { status, at: truoc(tuNhieuPhut), approximate },
  telemetryError: rest.telemetryError ?? null,
})

const ids = (m) => derivedAlerts(m, MOC).map((a) => a.id)

describe('trạng thái dùng được', () => {
  it('mất kết nối thì ảnh chụp cũ KHÔNG còn nói lên hiện tại', () => {
    // Máy rớt mạng trong lúc đang chạy: giữ nguyên "đang chạy" là nói dối người đọc.
    expect(effectiveStatus(may({ state: 'offline', status: 'running' }))).toBe('unknown')
    expect(effectiveStatus(may({ state: 'unknown', status: 'running' }))).toBe('unknown')
  })

  it('còn online hoặc mới cũ thì vẫn tin controller', () => {
    expect(effectiveStatus(may({ state: 'online', status: 'fault' }))).toBe('fault')
    expect(effectiveStatus(may({ state: 'stale', status: 'stopped' }))).toBe('stopped')
  })
})

describe('máy lỗi', () => {
  it('báo lỗi kèm thời lượng khi biết mốc', () => {
    const [a] = derivedAlerts(may({ status: 'fault', tuNhieuPhut: 41 }), MOC)
    expect(a.id).toBe('state:fault')
    expect(a.severity).toBe('critical')
    expect(a.detail).toContain('41 phút')
  })

  it('KHÔNG bịa thời lượng khi bridge chưa có mốc', () => {
    const [a] = derivedAlerts(may({ status: 'fault' }), MOC)
    expect(a.detail).toMatch(/Chưa có mốc thời gian/)
    expect(a.detail).not.toMatch(/0 phút/)
  })

  it('nói "ít nhất" khi mốc chỉ tính từ lúc bridge khởi động lại', () => {
    const [a] = derivedAlerts(may({ status: 'fault', tuNhieuPhut: 41, approximate: true }), MOC)
    expect(a.detail).toContain('ít nhất')
  })
})

describe('mất tín hiệu', () => {
  it('máy dial-in trôi sang `unknown` vẫn phải được nói ra', () => {
    // Đây là cái bẫy chính: bridge KHÔNG thăm dò máy dial-in nên `reachable` không bao giờ
    // thành false, tức là nó KHÔNG BAO GIỜ chạm `offline`. Chỉ canh `offline` thì con A15 duy
    // nhất ở xưởng mất tín hiệu mà API im lặng hoàn toàn.
    expect(ids(may({ state: 'unknown', status: null }))).toContain('connection:unknown')
  })

  it('máy đã tắt trong sổ tài sản thì im lặng — nó không được kỳ vọng trả lời', () => {
    expect(ids(may({ state: 'offline', identity: { enabled: false } }))).toEqual([])
  })

  it('máy manual (không có giao thức) không bị kêu là mất tín hiệu', () => {
    expect(ids(may({ state: 'unknown', identity: { adapterHasProtocol: false } }))).not.toContain('connection:unknown')
  })

  it('dữ liệu cũ của máy manual không phải sự cố', () => {
    expect(ids(may({ state: 'stale', identity: { adapterHasProtocol: false } }))).not.toContain('connection:stale')
  })
})

describe('dừng quá lâu', () => {
  it('vượt ngưỡng xưởng thì leo thang', () => {
    expect(ids(may({ status: 'stopped', tuNhieuPhut: 41 }))).toContain('state:idle-long')
  })

  it('dưới ngưỡng thì im — báo sớm là báo động giả, mà báo động giả thì bị bỏ qua', () => {
    expect(ids(may({ status: 'stopped', tuNhieuPhut: 2 }))).not.toContain('state:idle-long')
  })

  it('không có mốc thì không kết luận dừng lâu', () => {
    expect(ids(may({ status: 'stopped' }))).not.toContain('state:idle-long')
  })
})

describe('ranh giới của cả module', () => {
  it('mọi cảnh báo suy ra đều KHÔNG xác nhận được', () => {
    const m = may({ state: 'offline', status: 'fault', tuNhieuPhut: 90, telemetryError: { kind: 'contract', message: 'sai trường', field: 'status', at: truoc(2) } })
    const rows = derivedAlerts(m, MOC)
    expect(rows.length).toBeGreaterThan(1)
    // Bridge chỉ nhận acknowledge cho alert id nó đang giữ; id lạ ⇒ 400. Một nút "đã xem" cho
    // nhóm này là nút nói dối, nên `acknowledged` phải luôn null.
    for (const a of rows) expect(a.acknowledged, a.id).toBeNull()
  })

  it('máy đã lưu trữ thì không sinh dòng nào', () => {
    expect(ids(may({ state: 'offline', status: 'fault', identity: { archived: true } }))).toEqual([])
  })

  it('thời lượng tính lại theo thời gian trôi, không đóng băng', () => {
    const m = may({ status: 'fault', tuNhieuPhut: 10 })
    expect(statusDuration(m, MOC).minutes).toBeCloseTo(10, 5)
    expect(statusDuration(m, MOC + 600_000).minutes).toBeCloseTo(20, 5)
  })
})
