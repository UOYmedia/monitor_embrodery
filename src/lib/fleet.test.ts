import { describe, expect, it } from 'vitest'
import {
  ageFleet, applyFilter, distinctZones, effectiveStatus, emptyFilter, highestSeverity,
  jobProgressPercent, matchesSearch, sortMachines, summarize,
} from './fleet'
import { baseNow, makeMachine, makeTelemetry } from '../test/factories'
import type { Alert, MachineView, OperationalStatus } from '../types/fleet'

const now = baseNow + 5000
const ago = (seconds: number) => new Date(baseNow - (seconds * 1000)).toISOString()

function alert(severity: Alert['severity'], acknowledged = false): Alert {
  return {
    id: `a-${severity}`, severity, kind: 'controller-event', title: `Cảnh báo ${severity}`,
    detail: 'chi tiết', source: 'controller', since: new Date(baseNow).toISOString(),
    acknowledged: acknowledged ? { at: new Date(baseNow).toISOString(), by: 'ktv.an', note: null } : null,
  }
}

function withStatus(id: string, status: OperationalStatus, lastTelemetryAt = new Date(baseNow).toISOString()): MachineView {
  return makeMachine({
    id,
    lastTelemetryAt,
    telemetry: makeTelemetry({
      machineId: id,
      observedAt: lastTelemetryAt,
      status: { value: status, observedAt: lastTelemetryAt, source: 'controller', quality: 'verified' },
    }),
  })
}

/** Máy dừng liên tục `minutes` phút tính đến `baseNow`, dữ liệu vẫn tươi. */
function stoppedFor(id: string, minutes: number): MachineView {
  const machine = withStatus(id, 'stopped')
  return { ...machine, statusSince: { status: 'stopped', at: new Date(baseNow - minutes * 60_000).toISOString(), approximate: false } }
}

describe('summarize', () => {
  it('chỉ tính máy đã xác minh vào KPI sản xuất', () => {
    const kpi = summarize([
      withStatus('m1', 'running'),
      makeMachine({ id: 'm2', verified: false }),
      makeMachine({ id: 'm3', archived: true }),
    ])
    expect(kpi.verified).toBe(1)
    expect(kpi.running).toBe(1)
    expect(kpi.unverified).toBe(1)
    expect(kpi.archived).toBe(1)
  })

  it('phân biệt lỗi máy với mất kết nối', () => {
    const faulted = withStatus('m1', 'fault')
    const offline = ageFleet([makeMachine({ id: 'm2', lastTelemetryAt: ago(600), reachable: false })], now)[0]
    const kpi = summarize([faulted, offline])
    expect(kpi.fault).toBe(1)
    expect(kpi.offline).toBe(1)
    // Máy offline không được cộng vào cột lỗi máy.
    expect(summarize([offline]).fault).toBe(0)
  })

  it('máy mất kết nối không còn được coi là đang chạy', () => {
    const stale = ageFleet([withStatus('m1', 'running', ago(600))], now)[0]
    expect(effectiveStatus(stale)).toBe('unknown')
    expect(summarize([stale]).running).toBe(0)
  })

  it('đếm cảnh báo nghiêm trọng chưa xác nhận và bảo trì đến hạn', () => {
    const machine = makeMachine({
      alerts: [alert('critical'), alert('warning'), { ...alert('critical', true), id: 'a-acked' }],
      maintenance: [
        { id: 'p1', title: 'Tra dầu', intervalStitches: 1_000_000, lastServiceOdometer: 0, lastServiceAt: null, lastServiceBy: null, history: [], consumedStitches: 1_200_000, remainingStitches: -200_000, dueState: 'overdue', reason: null },
        { id: 'p2', title: 'Vệ sinh', intervalStitches: 500_000, lastServiceOdometer: null, lastServiceAt: null, lastServiceBy: null, history: [], consumedStitches: null, remainingStitches: null, dueState: 'unknown', reason: 'Chưa đọc được odometer' },
      ],
    })
    const kpi = summarize([machine])
    expect(kpi.criticalAlerts).toBe(1)
    expect(kpi.maintenanceDue).toBe(1)
  })

  it('đếm máy dừng lâu như một tập con của máy dừng, không cộng thêm', () => {
    const kpi = summarize([stoppedFor('m1', 41), stoppedFor('m2', 2)], baseNow)
    expect(kpi.idle).toBe(2)
    expect(kpi.idleLong).toBe(1)
    expect(kpi.needsAttention).toBe(1)
  })

  it('vẫn đếm "cần xử lý" cho máy chưa xác minh — máy lỗi thì vẫn phải có người tới', () => {
    const faulted = { ...withStatus('m1', 'fault'), identity: { ...withStatus('m1', 'fault').identity, verification: { status: 'unverified' as const, verifiedAt: null, verifiedBy: null, evidence: null } } }
    const kpi = summarize([faulted], baseNow)
    expect(kpi.unverified).toBe(1)
    expect(kpi.fault).toBe(0)
    expect(kpi.needsAttention).toBe(1)
  })
})

describe('ageFleet', () => {
  it('giữ nguyên tham chiếu khi máy không đổi trạng thái, để hàng đã memo không render lại', () => {
    const machines = [makeMachine({ id: 'm1' })]
    const first = ageFleet(machines, baseNow)
    const again = ageFleet(first, baseNow)
    expect(again[0]).toBe(first[0])
  })

  it('chuyển online → stale → offline theo đúng đồng hồ', () => {
    const machine = makeMachine({ id: 'm1', reachable: false })
    expect(ageFleet([machine], baseNow + 5_000)[0].connection.state).toBe('online')
    expect(ageFleet([machine], baseNow + 45_000)[0].connection.state).toBe('stale')
    expect(ageFleet([machine], baseNow + 200_000)[0].connection.state).toBe('offline')
  })
})

describe('tìm kiếm và lọc', () => {
  it('bỏ dấu khi tìm kiếm', () => {
    const machine = makeMachine({ name: 'Máy thêu Chuyền A' })
    expect(matchesSearch(machine, 'may theu')).toBe(true)
    expect(matchesSearch(machine, 'MÁY THÊU')).toBe(true)
    expect(matchesSearch(machine, 'chuyen b')).toBe(false)
  })

  it('tìm theo mã tài sản, IP và serial', () => {
    const machine = makeMachine({ id: 'm7', assetTag: 'HN-007' })
    expect(matchesSearch(machine, 'HN-007')).toBe(true)
    expect(matchesSearch(machine, '192.168.10.20')).toBe(true)
    expect(matchesSearch(machine, 'SN-m7')).toBe(true)
  })

  it('ẩn máy lưu trữ trừ khi được yêu cầu', () => {
    const machines = [makeMachine({ id: 'm1' }), makeMachine({ id: 'm2', archived: true })]
    expect(applyFilter(machines, emptyFilter)).toHaveLength(1)
    expect(applyFilter(machines, { ...emptyFilter, includeArchived: true })).toHaveLength(2)
  })

  it('lọc theo mức cảnh báo tối thiểu, bỏ qua cảnh báo đã xác nhận', () => {
    const machines = [
      makeMachine({ id: 'm1', alerts: [alert('warning')] }),
      makeMachine({ id: 'm2', alerts: [alert('critical')] }),
      makeMachine({ id: 'm3', alerts: [alert('critical', true)] }),
    ]
    expect(applyFilter(machines, { ...emptyFilter, severity: 'critical' }).map((m) => m.identity.id)).toEqual(['m2'])
    expect(applyFilter(machines, { ...emptyFilter, severity: 'warning' }).map((m) => m.identity.id)).toEqual(['m1', 'm2'])
  })

  it('lọc theo site, khu vực, adapter và trạng thái xác minh', () => {
    const machines = [
      makeMachine({ id: 'm1', siteId: 'hn', zone: 'Chuyền A', adapter: 'http-json' }),
      makeMachine({ id: 'm2', siteId: 'hcm', zone: 'Chuyền B', adapter: 'manual', verified: false }),
    ]
    expect(applyFilter(machines, { ...emptyFilter, siteId: 'hcm' })).toHaveLength(1)
    expect(applyFilter(machines, { ...emptyFilter, zone: 'Chuyền A' })).toHaveLength(1)
    expect(applyFilter(machines, { ...emptyFilter, adapter: 'manual' })).toHaveLength(1)
    expect(applyFilter(machines, { ...emptyFilter, verification: 'unverified' }).map((m) => m.identity.id)).toEqual(['m2'])
  })

  it('preset "Cần xử lý" gom đúng những máy phải có người tới', () => {
    const machines = ageFleet([
      withStatus('ok', 'running'),
      withStatus('loi', 'fault'),
      stoppedFor('dung-lau', 41),
      stoppedFor('dung-ngan', 2),
      makeMachine({ id: 'canh-bao', alerts: [alert('critical')] }),
    ], baseNow)
    const ids = applyFilter(machines, { ...emptyFilter, attention: true }, baseNow).map((m) => m.identity.id)
    expect(ids).toEqual(['loi', 'dung-lau', 'canh-bao'])
  })

  it('lọc riêng nhóm dừng lâu và nhóm bảo trì đến hạn', () => {
    const duePlan = { id: 'p1', title: 'Tra dầu', intervalStitches: 1_000_000, lastServiceOdometer: 0, lastServiceAt: null, lastServiceBy: null, history: [], consumedStitches: 950_000, remainingStitches: 50_000, dueState: 'due' as const, reason: null }
    const machines = [stoppedFor('dung-lau', 41), makeMachine({ id: 'bt', maintenance: [duePlan] }), withStatus('ok', 'running')]
    expect(applyFilter(machines, { ...emptyFilter, escalation: 'idle-long' }, baseNow).map((m) => m.identity.id)).toEqual(['dung-lau'])
    expect(applyFilter(machines, { ...emptyFilter, escalation: 'maintenance' }, baseNow).map((m) => m.identity.id)).toEqual(['bt'])
  })
})

describe('sắp xếp', () => {
  it('mặc định đưa lỗi máy, cảnh báo nghiêm trọng rồi mất kết nối lên đầu', () => {
    const machines = ageFleet([
      makeMachine({ id: 'ok' }),
      makeMachine({ id: 'crit', alerts: [alert('critical')] }),
      withStatus('fault', 'fault'),
      makeMachine({ id: 'off', lastTelemetryAt: ago(600), reachable: false }),
    ], now)
    expect(sortMachines(machines, 'attention').map((m) => m.identity.id)).toEqual(['fault', 'crit', 'off', 'ok'])
  })

  it('xếp máy dừng lâu trên cảnh báo nhẹ và trên dữ liệu cũ', () => {
    const machines = ageFleet([
      makeMachine({ id: 'warn', alerts: [alert('warning')] }),
      stoppedFor('dung-lau', 41),
      makeMachine({ id: 'cu', lastTelemetryAt: ago(60) }),
    ], baseNow)
    expect(sortMachines(machines, 'attention', 'asc', baseNow).map((m) => m.identity.id)).toEqual(['dung-lau', 'warn', 'cu'])
  })

  it('xếp theo bảo trì: quá hạn trước, máy chưa có kế hoạch xuống cuối và không nhảy chỗ', () => {
    const plan = (remaining: number) => ({
      id: 'p1', title: 'Tra dầu', intervalStitches: 1_000_000, lastServiceOdometer: 0, lastServiceAt: null,
      lastServiceBy: null, history: [], consumedStitches: 0, remainingStitches: remaining,
      dueState: (remaining <= 0 ? 'overdue' : 'ok') as 'overdue' | 'ok', reason: null,
    })
    const machines = [
      makeMachine({ id: 'khong-1', name: 'A' }),
      makeMachine({ id: 'con-han', name: 'B', maintenance: [plan(400_000)] }),
      makeMachine({ id: 'khong-2', name: 'C' }),
      makeMachine({ id: 'qua-han', name: 'D', maintenance: [plan(-200_000)] }),
    ]
    expect(sortMachines(machines, 'maintenance').map((m) => m.identity.id)).toEqual(['qua-han', 'con-han', 'khong-1', 'khong-2'])
  })

  it('sắp xếp tên theo tiếng Việt', () => {
    const machines = [makeMachine({ id: 'b', name: 'Ánh' }), makeMachine({ id: 'a', name: 'An' })]
    expect(sortMachines(machines, 'name').map((m) => m.identity.name)).toEqual(['An', 'Ánh'])
  })

  it('không làm biến đổi mảng gốc', () => {
    const machines = [makeMachine({ id: 'b', name: 'B' }), makeMachine({ id: 'a', name: 'A' })]
    sortMachines(machines, 'name')
    expect(machines[0].identity.id).toBe('b')
  })
})

describe('đội 100 máy', () => {
  const fleet = Array.from({ length: 100 }, (_, index) => makeMachine({
    id: `m${index}`,
    name: `Máy ${String(index).padStart(3, '0')}`,
    assetTag: `HN-${String(index).padStart(3, '0')}`,
    zone: `Chuyền ${String.fromCharCode(65 + (index % 5))}`,
    siteId: index % 2 === 0 ? 'hn' : 'hcm',
    verified: index % 10 !== 0,
    lastTelemetryAt: ago(index * 3),
    reachable: index % 7 !== 0,
  }))

  it('lọc, sắp xếp và tổng hợp toàn bộ đội trong một lượt', () => {
    const aged = ageFleet(fleet, now)
    const kpi = summarize(aged)
    expect(kpi.verified + kpi.unverified).toBe(100)
    expect(kpi.unverified).toBe(10)

    const filtered = applyFilter(aged, { ...emptyFilter, siteId: 'hn', search: 'may 0' })
    expect(filtered.every((machine) => machine.identity.siteId === 'hn')).toBe(true)

    const sorted = sortMachines(aged, 'attention')
    expect(sorted).toHaveLength(100)
    expect(distinctZones(aged, 'all')).toEqual(['Chuyền A', 'Chuyền B', 'Chuyền C', 'Chuyền D', 'Chuyền E'])
  })

  it('giữ nguyên tham chiếu của 99 máy khi 1 máy đổi dữ liệu', () => {
    const aged = ageFleet(fleet, now)
    const updated = aged.map((machine, index) => (index === 42 ? { ...machine } : machine))
    const unchanged = updated.filter((machine, index) => machine === aged[index])
    expect(unchanged).toHaveLength(99)
  })
})

describe('tiến độ mẫu', () => {
  it('tính phần trăm từ số mũi controller báo', () => {
    expect(jobProgressPercent(makeMachine())).toBe(8)
  })

  it('trả null khi controller chưa báo số mũi', () => {
    expect(jobProgressPercent(makeMachine({ telemetry: null, lastTelemetryAt: null }))).toBeNull()
  })
})

describe('highestSeverity', () => {
  it('trả về mức cao nhất, null khi không có cảnh báo', () => {
    expect(highestSeverity([alert('info'), alert('critical'), alert('warning')])).toBe('critical')
    expect(highestSeverity([])).toBeNull()
  })
})
