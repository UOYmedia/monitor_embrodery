import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BridgeService } from './bridge-service.mjs'
import { defaultConfig } from './config.mjs'
import { SCHEMA_VERSION, normalizeTelemetry } from './contract.mjs'
import { normalizeShifts } from './shifts.mjs'

const shifts = normalizeShifts([
  { id: 'ca-1', name: 'Ca ngày', start: '06:00', end: '18:00' },
  { id: 'ca-2', name: 'Ca đêm', start: '18:00', end: '06:00' },
])

const sites = [
  { id: 'hn-1', name: 'Xưởng Hà Nội', timeZone: 'Asia/Ho_Chi_Minh', allowedCidrs: ['192.168.10.0/24'], freshSeconds: 30, staleSeconds: 90, shifts, pricePer1000Stitches: 1_000 },
  { id: 'hcm-1', name: 'Xưởng HCM', timeZone: 'Asia/Ho_Chi_Minh', allowedCidrs: ['10.20.0.0/24'], freshSeconds: 30, staleSeconds: 90, shifts, pricePer1000Stitches: null },
]

const technician = { actor: 'ky-thuat-b', role: 'technician', correlationId: 'corr-1', remote: '192.168.10.9' }

let dir
let service
let published

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bridge-service-'))
  published = []
  service = new BridgeService(
    // `faultPath` phải trỏ vào thư mục tạm như ba đường kia. Thiếu nó thì mặc định là
    // `./bridge-data/loi-<site>.jsonl` NGAY TRONG REPO: bài thử ghi sổ lần lỗi thật ra đó
    // (đã phình tới 980 KB trước khi phát hiện), và tệ hơn là `service.load()` của lần chạy
    // sau đọc lại đống rác của lần chạy trước — bài thử hết độc lập mà không hề đỏ.
    { ...defaultConfig, sites, dataPath: join(dir, 'fleet-store.json'), auditPath: join(dir, 'audit.jsonl'), productionPath: join(dir, 'production.json'), faultPath: join(dir, 'loi-<site>.jsonl') },
    { publish: (message) => published.push(message) },
  )
  await service.load()
})
afterEach(async () => {
  // Audit appends are queued, so the log can still be writing after the last assertion.
  // Removing the directory first would race that write and leave the temp dir behind.
  await service.audit.flush()
  await rm(dir, { recursive: true, force: true })
})

const input = (overrides = {}) => ({
  assetTag: 'HN-001', name: 'Máy thêu 01', siteId: 'hn-1', zone: 'Chuyền A',
  ipAddress: '192.168.10.21', adapter: 'manual', ...overrides,
})

const secondInput = (overrides = {}) => input({ assetTag: 'HN-002', name: 'Máy thêu 02', ipAddress: '192.168.10.22', ...overrides })

function telemetryFor(machineId, payload, observedAt = new Date().toISOString()) {
  return normalizeTelemetry({ observedAt, ...payload }, { machine: { id: machineId, adapter: 'http-json' }, source: 'http-json' })
}

describe('pairing', () => {
  it('registers a batch and publishes one update per machine', async () => {
    const machines = await service.pairMany([input(), secondInput()], technician)
    expect(machines).toHaveLength(2)
    expect(service.machines.map((entry) => entry.assetTag)).toEqual(['HN-001', 'HN-002'])
    expect(published.filter((message) => message.type === 'machine_update')).toHaveLength(2)
  })

  it('is all-or-nothing: one bad entry rejects the whole batch', async () => {
    await expect(service.pairMany([input(), secondInput({ ipAddress: '10.20.0.5' })], technician))
      .rejects.toThrow(/Máy thứ 2/)
    expect(service.machines).toHaveLength(0)
  })

  it('names the offending row so the technician can fix it', async () => {
    await expect(service.pairMany([input(), secondInput({ zone: '' })], technician)).rejects.toThrow(/Máy thứ 2 \(192.168.10.22\)/)
  })

  it('blocks a duplicate asset tag against machines already paired', async () => {
    await service.pairMany([input()], technician)
    await expect(service.pairMany([secondInput({ assetTag: 'HN-001' })], technician)).rejects.toThrow(/Mã tài sản HN-001 đã thuộc về máy/)
    expect(service.machines).toHaveLength(1)
  })

  it('blocks a duplicate IP inside the same batch', async () => {
    await expect(service.pairMany([input(), secondInput({ ipAddress: '192.168.10.21' })], technician)).rejects.toThrow(/IP 192.168.10.21/)
  })

  it('refuses an address outside the site allowlist before any packet is sent', async () => {
    await expect(service.pairMany([input({ ipAddress: '8.8.8.8' })], technician)).rejects.toThrow(/nằm ngoài dải LAN riêng/)
  })

  it('enforces the batch size limit', async () => {
    const oversized = Array.from({ length: defaultConfig.limits.maxBatchPairing + 1 }, (_, index) => input({ assetTag: `HN-${index}`, ipAddress: `192.168.10.${index + 10}` }))
    await expect(service.pairMany(oversized, technician)).rejects.toThrow(/tối đa/)
  })

  it('records an audit entry with actor, target and correlation id', async () => {
    await service.pairMany([input()], technician)
    await service.audit.flush()
    const [entry] = await service.audit.tail({ limit: 10 })
    expect(entry).toMatchObject({ actor: 'ky-thuat-b', role: 'technician', action: 'machine.pair', targetType: 'machine', targetId: 'mch-hn-001', correlationId: 'corr-1', result: 'allowed' })
    expect(entry.after.assetTag).toBe('HN-001')
  })

  it('survives a restart with the same fleet', async () => {
    await service.pairMany([input()], technician)
    const reopened = new BridgeService({ ...defaultConfig, sites, dataPath: join(dir, 'fleet-store.json'), auditPath: join(dir, 'audit.jsonl') }, {})
    await reopened.load()
    expect(reopened.machines.map((entry) => entry.assetTag)).toEqual(['HN-001'])
  })
})

describe('machine view', () => {
  it('reports a manual machine as unknown with no invented telemetry', async () => {
    const [view] = await service.pairMany([input()], technician)
    expect(view.connection.state).toBe('unknown')
    expect(view.connection.reason).toMatch(/Adapter manual/)
    expect(view.telemetry).toBeNull()
    expect(view.alerts).toEqual([])
    expect(view.identity.verification.status).toBe('unverified')
  })

  // Chỗ hỏng nằm ở KHÚC NỐI giữa `machineView` và `derivedAlerts`, không nằm trong hàm nào.
  // `derived-alerts.test.mjs` gọi thẳng hàm với mốc đúng nên xanh suốt, trong khi production
  // truyền vào NaN và cảnh báo "dừng quá ngưỡng" tắt ngóm. Nên bài thử này cố ý đi đường vòng
  // qua `machineView` — đúng đường mà API thật đi.
  it('phát cảnh báo dừng quá ngưỡng qua machineView, không chỉ khi gọi thẳng derivedAlerts', async () => {
    const [view] = await service.pairMany([input({ adapter: 'http-json', adapterConfig: { port: 8080 } })], technician)
    const id = view.identity.id
    const base = Date.parse('2026-08-14T07:00:00Z')
    const nguong = service.site('hn-1').stopEscalationMinutes ?? 5

    // Máy vừa gửi telemetry (nên còn `online`) nhưng đã đứng ở `stopped` từ lâu.
    service.now = () => base
    service.telemetry.set(id, telemetryFor(id, { status: 'stopped' }, new Date(base).toISOString()))
    service.recordReachability(id, true)
    service.statusSince.set(id, {
      status: 'stopped',
      at: new Date(base - (nguong + 5) * 60_000).toISOString(),
      approximate: false,
    })

    const ra = service.machineView(service.machines[0])
    expect(ra.connection.state).toBe('online')
    expect(ra.derivedAlerts.map((a) => a.id)).toContain('state:idle-long')
    // Dòng cảnh báo phải nói ĐƯỢC máy dừng bao lâu. NaN phút vẫn lọt qua `toContain` ở trên.
    expect(ra.derivedAlerts.find((a) => a.id === 'state:idle-long').title).toMatch(/10 phút/)
    expect(ra.derivedAlerts.find((a) => a.id === 'state:idle-long').title).not.toMatch(/NaN/)
  })

  it('chưa quá ngưỡng thì im — cảnh báo dừng lâu không được nổ sớm', async () => {
    const [view] = await service.pairMany([input({ adapter: 'http-json', adapterConfig: { port: 8080 } })], technician)
    const id = view.identity.id
    const base = Date.parse('2026-08-14T07:00:00Z')
    const nguong = service.site('hn-1').stopEscalationMinutes ?? 5

    service.now = () => base
    service.telemetry.set(id, telemetryFor(id, { status: 'stopped' }, new Date(base).toISOString()))
    service.recordReachability(id, true)
    service.statusSince.set(id, {
      status: 'stopped',
      at: new Date(base - (nguong - 1) * 60_000).toISOString(),
      approximate: false,
    })

    expect(service.machineView(service.machines[0]).derivedAlerts.map((a) => a.id)).not.toContain('state:idle-long')
  })

  it('never marks an unverified machine as verified just because telemetry arrived', async () => {
    const [view] = await service.pairMany([input({ adapter: 'http-json' })], technician)
    service.telemetry.set(view.identity.id, telemetryFor(view.identity.id, { status: 'running', rpm: 750 }))
    expect(service.machineView(service.machines[0]).identity.verification.status).toBe('unverified')
  })

  it('ages telemetry through online → stale → offline without touching the snapshot', async () => {
    const [view] = await service.pairMany([input({ adapter: 'http-json', adapterConfig: { port: 8080 } })], technician)
    const id = view.identity.id
    const base = Date.parse('2026-08-14T07:00:00Z')
    service.telemetry.set(id, telemetryFor(id, { status: 'running', rpm: 750 }, '2026-08-14T07:00:00.000Z'))
    service.recordReachability(id, true)

    service.now = () => base + 10_000
    expect(service.machineView(service.machines[0]).connection.state).toBe('online')
    service.now = () => base + 60_000
    expect(service.machineView(service.machines[0]).connection.state).toBe('stale')

    service.reachability.set(id, { reachable: false, checkedAt: '2026-08-14T07:01:00.000Z', lastReachableAt: '2026-08-14T07:00:00.000Z' })
    service.now = () => base + 200_000
    const aged = service.machineView(service.machines[0])
    expect(aged.connection.state).toBe('offline')
    // The last real reading is still shown, with its own timestamp, rather than blanked.
    expect(aged.telemetry.rpm.value).toBe(750)
    expect(aged.telemetry.observedAt).toBe('2026-08-14T07:00:00.000Z')
  })

  it('keeps a controller fault distinct from a connection loss', async () => {
    const [view] = await service.pairMany([input({ adapter: 'http-json', adapterConfig: { port: 8080 } })], technician)
    const id = view.identity.id
    service.telemetry.set(id, telemetryFor(id, {
      status: 'fault',
      events: [{ id: 'e1', code: 'E12', severity: 'critical', occurredAt: new Date().toISOString(), message: 'Đứt chỉ kim 5' }],
    }))
    service.recordReachability(id, true)
    const current = service.machineView(service.machines[0])
    expect(current.telemetry.status.value).toBe('fault')
    expect(current.connection.state).toBe('online')
    expect(current.alerts[0]).toMatchObject({ severity: 'critical', source: 'controller' })
  })

  it('keeps a sensor-node report distinct from a controller fault all the way to the alert', async () => {
    const [view] = await service.pairMany([input({ adapter: 'http-json', adapterConfig: { port: 8080 } })], technician)
    const id = view.identity.id
    service.telemetry.set(id, telemetryFor(id, {
      status: 'stopped',
      events: [{ id: 's1', code: 'SPINDLE-STOP', severity: 'warning', source: 'sensor', occurredAt: new Date().toISOString() }],
    }))
    service.recordReachability(id, true)
    const alert = service.machineView(service.machines[0]).alerts[0]
    // Thợ đọc dòng này để quyết có mở máy hay không, nên nhãn nguồn phải là nhãn thật.
    expect(alert).toMatchObject({ severity: 'warning', source: 'sensor', kind: 'sensor-event' })
    expect(alert.title).toMatch(/node cảm biến/)
  })
})

describe('acknowledgement and maintenance', () => {
  async function machineWithAlert() {
    const [view] = await service.pairMany([input({ adapter: 'http-json', adapterConfig: { port: 8080 } })], technician)
    service.telemetry.set(view.identity.id, telemetryFor(view.identity.id, {
      status: 'fault', odometer: 1_000_000,
      events: [{ id: 'e1', code: 'E12', severity: 'critical', occurredAt: new Date().toISOString(), message: 'Đứt chỉ kim 5' }],
    }))
    return view.identity.id
  }

  it('acknowledges an alert on the dashboard only and audits who did it', async () => {
    const id = await machineWithAlert()
    const view = await service.acknowledgeAlert(id, 'event:e1', technician, { note: 'Đã kiểm tra tại máy' })
    expect(view.alerts[0].acknowledged).toMatchObject({ by: 'ky-thuat-b', note: 'Đã kiểm tra tại máy' })
    await service.audit.flush()
    const entries = await service.audit.tail({ limit: 10 })
    expect(entries[0]).toMatchObject({ action: 'alert.acknowledge', targetType: 'alert' })
  })

  it('refuses to acknowledge an alert the machine does not have', async () => {
    const id = await machineWithAlert()
    await expect(service.acknowledgeAlert(id, 'event:khong-co', technician)).rejects.toThrow(/không còn tồn tại/)
  })

  it('will not close a maintenance item while the odometer is unread', async () => {
    const [view] = await service.pairMany([input({ maintenance: [{ id: 'dau-may', title: 'Tra dầu', intervalStitches: 500_000 }] })], technician)
    await expect(service.completeMaintenance(view.identity.id, 'dau-may', technician)).rejects.toThrow(/Chưa đọc được bộ đếm mũi/)
  })

  it('anchors a completed maintenance item to the controller odometer', async () => {
    const [view] = await service.pairMany([input({ adapter: 'http-json', adapterConfig: { port: 8080 }, maintenance: [{ id: 'dau-may', title: 'Tra dầu', intervalStitches: 500_000 }] })], technician)
    const id = view.identity.id
    service.telemetry.set(id, telemetryFor(id, { status: 'running', odometer: 1_200_000 }))
    const updated = await service.completeMaintenance(id, 'dau-may', technician, { note: 'Đã tra dầu' })
    expect(updated.maintenance[0]).toMatchObject({ lastServiceOdometer: 1_200_000, dueState: 'ok' })
    expect(updated.maintenance[0].history).toHaveLength(1)
  })

  it('raises an overdue maintenance alert from the odometer, attributed to the dashboard', async () => {
    const [view] = await service.pairMany([input({ adapter: 'http-json', adapterConfig: { port: 8080 }, maintenance: [{ id: 'dau-may', title: 'Tra dầu', intervalStitches: 100_000, lastServiceOdometer: 0 }] })], technician)
    service.telemetry.set(view.identity.id, telemetryFor(view.identity.id, { status: 'running', odometer: 250_000 }))
    const alerts = service.machineView(service.machines[0]).alerts
    expect(alerts[0]).toMatchObject({ id: 'maintenance:dau-may', severity: 'critical', source: 'dashboard' })
  })

  it('reports maintenance as unknown, not ok, while the odometer is unread', async () => {
    const [view] = await service.pairMany([input({ maintenance: [{ id: 'dau-may', title: 'Tra dầu', intervalStitches: 100_000 }] })], technician)
    expect(view.maintenance[0]).toMatchObject({ dueState: 'unknown' })
    expect(view.maintenance[0].reason).toMatch(/Chưa đọc được/)
  })
})

describe('archiving', () => {
  it('soft-deletes: the record stays, disabled and flagged', async () => {
    const [view] = await service.pairMany([input()], technician)
    const archived = await service.archiveMachine(view.identity.id, technician)
    expect(archived.identity).toMatchObject({ archived: true, enabled: false })
    expect(service.machines).toHaveLength(1)
    await service.audit.flush()
    expect((await service.audit.tail({ limit: 1 }))[0].action).toBe('machine.archive')
  })

  it('can restore an archived machine', async () => {
    const [view] = await service.pairMany([input()], technician)
    await service.archiveMachine(view.identity.id, technician)
    const restored = await service.archiveMachine(view.identity.id, technician, { archived: false })
    expect(restored.identity.archived).toBe(false)
  })

  it('404s on an unknown machine instead of creating one', async () => {
    await expect(service.archiveMachine('mch-khong-co', technician)).rejects.toMatchObject({ status: 404 })
  })
})

describe('polling isolation', () => {
  it('does not merge a malformed payload into the previous good snapshot', async () => {
    const [view] = await service.pairMany([input({ adapter: 'http-json', adapterConfig: { port: 8080 } })], technician)
    const id = view.identity.id
    const good = telemetryFor(id, { status: 'running', rpm: 750 }, '2026-08-14T07:00:00.000Z')
    service.telemetry.set(id, good)
    service.telemetryErrors.set(id, { message: 'rpm phải là số hợp lệ.', at: '2026-08-14T07:00:30.000Z', kind: 'contract', field: 'rpm' })

    const current = service.machineView(service.machines[0])
    expect(current.telemetry).toBe(good)
    expect(current.telemetry.rpm.value).toBe(750)
    expect(current.telemetryError).toMatchObject({ kind: 'contract', field: 'rpm' })
  })

  it('keeps the fleet view working when one machine has an error', async () => {
    await service.pairMany([input({ adapter: 'http-json', adapterConfig: { port: 8080 } }), secondInput()], technician)
    service.telemetryErrors.set('mch-hn-001', { message: 'Hết 2500 ms chờ phản hồi HTTP.', at: new Date().toISOString(), kind: 'transport', field: null })
    const fleet = service.fleet()
    expect(fleet).toHaveLength(2)
    expect(fleet[0].telemetryError.kind).toBe('transport')
    expect(fleet[1].telemetryError).toBeNull()
  })

  it('skips machines that are archived or disabled', async () => {
    const [view] = await service.pairMany([input({ adapter: 'http-json', adapterConfig: { port: 8080 } })], technician)
    await service.archiveMachine(view.identity.id, technician)
    await expect(service.pollOnce()).resolves.toEqual({ polled: 0 })
  })
})

describe('health', () => {
  it('counts only verified, non-archived machines as production-ready', async () => {
    await service.pairMany([
      input({ macAddress: '8C:1F:64:AB:CD:EF', verification: { confirmed: true, evidence: 'mac' } }),
      secondInput(),
    ], technician)
    expect(service.health().counts).toMatchObject({ machines: 2, verified: 1, archived: 0 })
  })

  it('surfaces migration warnings instead of hiding them', async () => {
    expect(Array.isArray(service.health().migrationWarnings)).toBe(true)
  })

  it('keeps site subnets and fleet counts out of the unauthenticated liveness probe', async () => {
    await service.pairMany([input({})], technician)
    const liveness = service.liveness()
    expect(liveness).toMatchObject({ status: 'ok', schemaVersion: SCHEMA_VERSION })
    expect(Object.keys(liveness).sort()).toEqual(['schemaVersion', 'serverTime', 'startedAt', 'status'])
    expect(JSON.stringify(liveness)).not.toContain('127.0.0')
  })
})

describe('production report', () => {
  // Đồng hồ cố định: bảng lương phải kiểm chứng được, không phụ thuộc lúc chạy test.
  const clock = Date.parse('2026-08-14T04:00:00Z') // 11:00 giờ VN, giữa ca 1
  let payroll
  let payrollDir

  beforeEach(async () => {
    payrollDir = await mkdtemp(join(tmpdir(), 'bridge-payroll-'))
    payroll = new BridgeService(
      { ...defaultConfig, sites, dataPath: join(payrollDir, 'fleet.json'), auditPath: join(payrollDir, 'audit.jsonl'), productionPath: join(payrollDir, 'production.json') },
      { now: () => clock },
    )
    await payroll.load()
  })
  afterEach(async () => {
    await payroll.audit.flush()
    await rm(payrollDir, { recursive: true, force: true })
  })

  const verified = (overrides = {}) => input({ macAddress: '8C:1F:64:AB:CD:EF', verification: { confirmed: true, evidence: 'mac' }, ...overrides })

  function feed(machineId, readings) {
    for (const [odometer, observedAt] of readings) {
      payroll.countProduction({ id: machineId, siteId: 'hn-1' }, telemetryFor(machineId, { status: 'running', odometer }, observedAt))
    }
  }

  it('turns two odometer readings into stitches, hours and money for the shift', async () => {
    const [machine] = await payroll.pairMany([verified({ pricePer1000Stitches: 1_200 })], technician)
    feed(machine.identity.id, [[1_000_000, '2026-08-14T03:00:00Z'], [1_009_000, '2026-08-14T03:10:00Z']])

    const report = payroll.productionReport({})
    expect(report.range).toEqual({ from: '2026-08-08', to: '2026-08-14' })
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({
      date: '2026-08-14', shiftId: 'ca-1', shiftName: 'Ca ngày',
      machineName: 'Máy thêu 01', assetTag: 'HN-001', zone: 'Chuyền A',
      stitches: 9_000, runSeconds: 120, pricePer1000Stitches: 1_200, amount: 10_800, countedInTotals: true,
    })
    expect(report.totals).toMatchObject({ machines: 1, stitches: 9_000, amount: 10_800, anomalies: 0 })
  })

  it('shows an unverified machine but keeps it out of the payroll totals', async () => {
    const [confirmed, unconfirmed] = await payroll.pairMany([verified(), secondInput()], technician)
    feed(confirmed.identity.id, [[0, '2026-08-14T03:00:00Z'], [4_000, '2026-08-14T03:05:00Z']])
    feed(unconfirmed.identity.id, [[0, '2026-08-14T03:00:00Z'], [7_000, '2026-08-14T03:05:00Z']])

    const report = payroll.productionReport({})
    expect(report.rows).toHaveLength(2)
    expect(report.totals.stitches).toBe(4_000)
    expect(report.excluded.unverifiedRows).toBe(1)
    expect(report.rows.find((row) => row.machineId === unconfirmed.identity.id)).toMatchObject({ verified: false, countedInTotals: false, stitches: 7_000 })
  })

  it('prefers the machine rate over the site default and says so per row', async () => {
    const [own, siteRate] = await payroll.pairMany([
      verified({ pricePer1000Stitches: 1_500 }),
      secondInput({ macAddress: '8C:1F:64:AB:CD:F0', verification: { confirmed: true, evidence: 'mac' } }),
    ], technician)
    feed(own.identity.id, [[0, '2026-08-14T03:00:00Z'], [10_000, '2026-08-14T03:10:00Z']])
    feed(siteRate.identity.id, [[0, '2026-08-14T03:00:00Z'], [10_000, '2026-08-14T03:10:00Z']])

    const rates = Object.fromEntries(payroll.productionReport({}).rows.map((row) => [row.machineId, row.pricePer1000Stitches]))
    expect(rates[own.identity.id]).toBe(1_500)
    expect(rates[siteRate.identity.id]).toBe(1_000) // đơn giá mặc định của site
    expect(payroll.productionReport({}).totals.amount).toBe(25_000)
  })

  it('leaves money blank rather than zero when no rate is set anywhere', async () => {
    const [machine] = await payroll.pairMany([verified({ siteId: 'hcm-1', ipAddress: '10.20.0.30' })], technician)
    payroll.countProduction({ id: machine.identity.id, siteId: 'hcm-1' }, telemetryFor(machine.identity.id, { status: 'running', odometer: 0 }, '2026-08-14T03:00:00Z'))
    payroll.countProduction({ id: machine.identity.id, siteId: 'hcm-1' }, telemetryFor(machine.identity.id, { status: 'running', odometer: 5_000 }, '2026-08-14T03:05:00Z'))

    const report = payroll.productionReport({ siteId: 'hcm-1' })
    expect(report.rows[0]).toMatchObject({ stitches: 5_000, pricePer1000Stitches: null, amount: null })
    expect(report.totals).toMatchObject({ stitches: 5_000, amount: 0, rowsWithoutPrice: 1 })
  })

  it('counts a night shift as one business day instead of splitting it at midnight', async () => {
    const [machine] = await payroll.pairMany([verified()], technician)
    feed(machine.identity.id, [
      [0, '2026-08-13T15:00:00Z'],       // 22:00 ngày 13
      [6_000, '2026-08-13T16:00:00Z'],   // 23:00 ngày 13
      [9_000, '2026-08-13T18:00:00Z'],   // 01:00 ngày 14 — vẫn ca đêm của ngày 13
    ])
    const rows = payroll.productionReport({}).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ date: '2026-08-13', shiftId: 'ca-2', stitches: 9_000 })
  })

  it('reports a counter glitch instead of paying for it', async () => {
    const [machine] = await payroll.pairMany([verified({ pricePer1000Stitches: 1_000 })], technician)
    feed(machine.identity.id, [[1_000, '2026-08-14T03:00:00Z'], [50_000_000, '2026-08-14T03:05:00Z']])
    const report = payroll.productionReport({})
    expect(report.rows[0]).toMatchObject({ stitches: 0, anomalies: 1, amount: 0 })
    expect(report.totals.anomalies).toBe(1)
  })

  it('validates the date range and the site instead of returning something plausible', async () => {
    expect(() => payroll.productionReport({ from: '14/08/2026' })).toThrow(/YYYY-MM-DD/)
    expect(() => payroll.productionReport({ from: '2026-08-14', to: '2026-08-01' })).toThrow(/sau "to"/)
    expect(() => payroll.productionReport({ siteId: 'khong-co' })).toThrow(/chưa được cấu hình/)
  })

  it('keeps the shift rows of a machine that was later unpaired, flagged as missing', async () => {
    const [machine] = await payroll.pairMany([verified()], technician)
    feed(machine.identity.id, [[0, '2026-08-14T03:00:00Z'], [3_000, '2026-08-14T03:05:00Z']])
    await payroll.archiveMachine(machine.identity.id, technician)

    const [row] = payroll.productionReport({}).rows
    expect(row).toMatchObject({ stitches: 3_000, archived: true, machineMissing: false })
  })
})

describe('dial-in ingest', () => {
  const dialIn = (overrides = {}) => input({ adapter: 'dial-in', ...overrides })

  it('resolves a source address to the one machine paired at it', async () => {
    const [machine] = await service.pairMany([dialIn()], technician)
    expect(service.identifyDialIn('192.168.10.21').machine.id).toBe(machine.identity.id)
    expect(service.identifyDialIn('::ffff:192.168.10.21').machine.id).toBe(machine.identity.id)
  })

  it('refuses an address no dial-in machine is paired at', async () => {
    await service.pairMany([input({ adapter: 'http-json', adapterConfig: { port: 8080 } })], technician)
    expect(service.identifyDialIn('192.168.10.21')).toEqual({ reason: 'unknown_source' })
    expect(service.identifyDialIn('192.168.10.99')).toEqual({ reason: 'unknown_source' })
    expect(service.identifyDialIn(null)).toEqual({ reason: 'unknown_source' })
  })

  it('refuses an archived or disabled machine rather than reviving it over the wire', async () => {
    const [machine] = await service.pairMany([dialIn()], technician)
    await service.archiveMachine(machine.identity.id, technician)
    expect(service.identifyDialIn('192.168.10.21')).toEqual({ reason: 'unknown_source' })
  })

  it('re-checks the site allowlist on every connection, not just at pairing', async () => {
    const [machine] = await service.pairMany([dialIn()], technician)
    // The subnet is narrowed after pairing — the machine must stop being accepted at once.
    service.config = { ...service.config, sites: sites.map((site) => (site.id === 'hn-1' ? { ...site, allowedCidrs: ['192.168.11.0/24'] } : site)) }
    expect(service.identifyDialIn('192.168.10.21')).toEqual({ reason: 'outside_allowlist' })
    expect(service.telemetryErrors.get(machine.identity.id).kind).toBe('policy')
  })

  it('turns a pushed frame into the machine state, source-tagged as dial-in', async () => {
    const [machine] = await service.pairMany([dialIn()], technician)
    service.acceptDialIn(service.findMachine(machine.identity.id), { status: 'running', rpm: 720, odometer: 1_000 }, { remote: '192.168.10.21' })
    const snapshot = service.telemetry.get(machine.identity.id)
    expect(snapshot.status.value).toBe('running')
    expect(snapshot.source).toBe('dial-in:192.168.10.21')
    expect(service.telemetryErrors.has(machine.identity.id)).toBe(false)
  })

  it('keeps the last good snapshot when a pushed frame breaks the contract', async () => {
    const [machine] = await service.pairMany([dialIn()], technician)
    const record = service.findMachine(machine.identity.id)
    service.acceptDialIn(record, { status: 'running', rpm: 720 }, { remote: '192.168.10.21' })
    service.acceptDialIn(record, { status: 'chay-vun-vut' }, { remote: '192.168.10.21' })
    expect(service.telemetry.get(machine.identity.id).status.value).toBe('running')
    expect(service.telemetryErrors.get(machine.identity.id)).toMatchObject({ kind: 'contract', field: 'status' })
  })

  it('records undecodable bytes as an error instead of inventing telemetry', async () => {
    const [machine] = await service.pairMany([dialIn()], technician)
    service.recordUndecoded(service.findMachine(machine.identity.id), { reason: 'not_json', bytes: 3, hex: '02 31 30', truncated: false }, { remote: '192.168.10.21' })
    expect(service.telemetry.has(machine.identity.id)).toBe(false)
    expect(service.telemetryErrors.get(machine.identity.id).message).toContain('02 31 30')
  })

  it('never polls a dial-in machine: the bridge must not call a machine that calls it', async () => {
    const [dial] = await service.pairMany([dialIn()], technician)
    const [manual] = await service.pairMany([secondInput({ adapter: 'manual' })], technician)
    const touched = []
    service.checkManualReachability = async (machine) => { touched.push(machine.id) }
    // Pairing seeds a jittered first-poll time, so force both machines due in this pass —
    // otherwise the assertion would pass simply because nothing was polled at all.
    for (const id of [dial.identity.id, manual.identity.id]) service.scheduler.stateFor(id).nextDueAt = 0

    await service.pollOnce()

    expect(touched).toEqual([manual.identity.id])
  })
})

describe('nhập số bằng tay', () => {
  // Đồng hồ cố định vì `manual-entry` từ chối số ở tương lai và số quá cũ — hai luật đó đo bằng
  // `now`, nên test phụ thuộc lúc chạy sẽ hỏng lúc nửa đêm chứ không phải lúc code sai.
  const clock = Date.parse('2026-08-14T04:00:00Z') // 11:00 giờ VN, giữa ca 1
  let hand
  let handDir
  let handPublished

  beforeEach(async () => {
    handDir = await mkdtemp(join(tmpdir(), 'bridge-tay-'))
    handPublished = []
    hand = new BridgeService(
      { ...defaultConfig, sites, dataPath: join(handDir, 'fleet.json'), auditPath: join(handDir, 'audit.jsonl'), productionPath: join(handDir, 'production.json') },
      { now: () => clock, publish: (message) => handPublished.push(message) },
    )
    await hand.load()
  })
  afterEach(async () => {
    await hand.audit.flush()
    await rm(handDir, { recursive: true, force: true })
  })

  const dialIn = (overrides = {}) => input({ adapter: 'dial-in', ...overrides })
  const reading = (odometer, observedAt, extra = {}) => ({ odometer, observedAt, status: 'running', ...extra })

  it('ghi được số cho máy dial-in — đúng cái máy cần đường này nhất', async () => {
    const [paired] = await hand.pairMany([dialIn()], technician)
    const id = paired.identity.id
    await hand.recordManualReading(id, reading(1_000_000, '2026-08-14T03:00:00Z'), technician)
    const result = await hand.recordManualReading(id, reading(1_009_000, '2026-08-14T03:30:00Z'), technician)

    expect(result.counted).toMatchObject({ counted: true, stitches: 9_000, lane: 'manual' })
    expect(result.reading).toMatchObject({ delta: 9_000, elapsedSeconds: 1_800, impliedStitchesPerMinute: 300 })
    // Con số này chỉ tồn tại ở đây, không ở đâu khác. Nói "đã ghi" khi nó còn nằm trong RAM là một
    // lời nói dối sống tới đúng lần khởi động lại tiếp theo.
    expect(result.persisted).toBe(true)
  })

  it('không khai máy là liên lạc được: người gõ số chỉ chứng minh có người đứng đó', async () => {
    const [paired] = await hand.pairMany([dialIn()], technician)
    const id = paired.identity.id
    await hand.recordManualReading(id, reading(1_000_000, '2026-08-14T03:00:00Z'), technician)

    expect(hand.reachability.has(id)).toBe(false)
    expect(hand.machineView(hand.findMachine(id)).connection.state).toBe('unknown')
    expect(hand.machineView(hand.findMachine(id)).connection.reason).toContain('gõ tay')
  })

  it('không xoá lỗi adapter: lỗi đó chính là lý do có người phải gõ tay', async () => {
    const [paired] = await hand.pairMany([dialIn()], technician)
    const id = paired.identity.id
    hand.recordUndecoded(hand.findMachine(id), { reason: 'not_json', bytes: 3, hex: '02 31 30', truncated: false }, { remote: '192.168.10.21' })

    await hand.recordManualReading(id, reading(1_000_000, '2026-08-14T03:00:00Z'), technician)

    expect(hand.telemetryErrors.get(id).message).toContain('02 31 30')
  })

  it('không đặt lại nhịp poll: máy vẫn đang im, chỉ có người là không im', async () => {
    const [paired] = await hand.pairMany([dialIn()], technician)
    const id = paired.identity.id
    hand.scheduler.recordFailure(id, new Error('không trả lời'))
    const failures = hand.scheduler.stateFor(id).failures

    await hand.recordManualReading(id, reading(1_000_000, '2026-08-14T03:00:00Z'), technician)

    expect(hand.scheduler.stateFor(id).failures).toBe(failures)
  })

  it('trả lỗi 400 nêu tên trường thay vì nhận một con số sai', async () => {
    const [paired] = await hand.pairMany([dialIn()], technician)
    const id = paired.identity.id
    await hand.recordManualReading(id, reading(1_000_000, '2026-08-14T03:00:00Z'), technician)

    // Thừa một chữ số: 10 000 000 mũi trong 30 phút là quá giới hạn vật lý của máy.
    await expect(hand.recordManualReading(id, reading(11_000_000, '2026-08-14T03:30:00Z'), technician))
      .rejects.toMatchObject({ status: 400, field: 'odometer' })
    // Và số bị từ chối thì không được lọt vào sổ.
    expect(hand.production.cursorFor(id).odometer).toBe(1_000_000)
  })

  it('từ chối ghi số cho máy đã lưu trữ', async () => {
    const [paired] = await hand.pairMany([dialIn()], technician)
    const id = paired.identity.id
    await hand.archiveMachine(id, technician)
    await expect(hand.recordManualReading(id, reading(1_000_000, '2026-08-14T03:00:00Z'), technician))
      .rejects.toMatchObject({ status: 400 })
  })

  it('ghi nhật ký kiểm toán đủ để dựng lại con số khi bị tranh chấp', async () => {
    const [paired] = await hand.pairMany([dialIn()], technician)
    const id = paired.identity.id
    await hand.recordManualReading(id, reading(1_000_000, '2026-08-14T03:00:00Z'), technician)
    await hand.recordManualReading(id, reading(1_009_000, '2026-08-14T03:30:00Z', { note: 'đọc trên HMI' }), technician)
    await hand.audit.flush()

    const entries = await hand.audit.tail({ limit: 10 })
    const latest = entries.find((entry) => entry.after?.odometer === 1_009_000)
    expect(latest).toMatchObject({ actor: 'ky-thuat-b', action: 'production.manual-reading', targetId: id })
    expect(latest.before).toMatchObject({ odometer: 1_000_000 })
    expect(latest.after).toMatchObject({ delta: 9_000, countedStitches: 9_000, persisted: true })
    expect(latest.message).toContain('đọc trên HMI')
  })

  it('mũi gõ tay được trả tiền, nhưng báo cáo tách riêng chứ không trộn vào số của máy', async () => {
    const [paired] = await hand.pairMany([dialIn({ pricePer1000Stitches: 1_000, macAddress: '8C:1F:64:AB:CD:EF', verification: { confirmed: true, evidence: 'mac' } })], technician)
    const id = paired.identity.id
    await hand.recordManualReading(id, reading(1_000_000, '2026-08-14T03:00:00Z'), technician)
    await hand.recordManualReading(id, reading(1_010_000, '2026-08-14T03:30:00Z'), technician)

    const report = hand.productionReport({})
    expect(report.rows[0]).toMatchObject({ stitches: 0, manualStitches: 10_000, stitchesBilled: 10_000, amount: 10_000, runSeconds: 0 })
    expect(report.totals).toMatchObject({ stitches: 0, manualStitches: 10_000, stitchesBilled: 10_000, rowsWithManualEntry: 1 })
  })
})

describe('sổ thời gian ngừng máy', () => {
  async function pairOne(overrides) {
    const [view] = await service.pairMany([input(overrides)], technician)
    return service.machines.find((entry) => entry.id === view.identity.id)
  }
  function snap(id, status, observedAt, events) {
    const payload = events ? { status, events } : { status }
    return telemetryFor(id, payload, observedAt)
  }
  async function downtimeRows(machineId) {
    await service.audit.flush()
    const { entries } = await service.audit.read({ targetId: machineId, limit: 50 })
    return entries.filter((entry) => entry.action && entry.action.startsWith('machine.downtime'))
  }

  it('ghi mở rồi đóng episode lỗi kèm thời lượng đọc được', async () => {
    const machine = await pairOne()
    const id = machine.id
    service.ingestSnapshot(machine, snap(id, 'running', '2026-08-24T00:00:00.000Z'))
    service.ingestSnapshot(machine, snap(id, 'fault', '2026-08-24T00:00:00.000Z',
      [{ id: 'e1', code: 'E12', severity: 'critical', occurredAt: '2026-08-24T00:00:00.000Z', message: 'Đứt chỉ' }]))
    service.ingestSnapshot(machine, snap(id, 'running', '2026-08-24T00:12:30.000Z'))
    const rows = await downtimeRows(id)
    const open = rows.find((entry) => entry.action === 'machine.downtime.open')
    const close = rows.find((entry) => entry.action === 'machine.downtime.close')
    expect(open.after).toMatchObject({ reason: 'fault', status: 'fault', code: 'E12' })
    expect(close.after).toMatchObject({ reason: 'fault', status: 'running', durationSeconds: 750 })
    expect(close.message).toContain('12 phút 30 giây')
  })

  it('máy đã lỗi ngay từ ảnh chụp đầu → đánh dấu approximate, không bịa mốc', async () => {
    const machine = await pairOne()
    const id = machine.id
    service.ingestSnapshot(machine, snap(id, 'fault', '2026-08-24T00:00:00.000Z'))
    const [open] = (await downtimeRows(id)).filter((entry) => entry.action === 'machine.downtime.open')
    expect(open.after.approximate).toBe(true)
    expect(open.message).toContain('máy đã ở trạng thái lỗi khi bridge bắt đầu quan sát')
  })

  it('lỗi không kèm event → mã null, không bịa mã lỗi', async () => {
    const machine = await pairOne()
    const id = machine.id
    service.ingestSnapshot(machine, snap(id, 'running', '2026-08-24T00:00:00.000Z'))
    service.ingestSnapshot(machine, snap(id, 'fault', '2026-08-24T00:01:00.000Z'))
    const [open] = (await downtimeRows(id)).filter((entry) => entry.action === 'machine.downtime.open')
    expect(open.after.code).toBeNull()
    expect(open.message).toBe('Controller báo máy lỗi.')
  })

  it('dừng ngắn dưới ngưỡng xưởng → không ghi dòng ngừng nào', async () => {
    const machine = await pairOne()
    const id = machine.id
    service.ingestSnapshot(machine, snap(id, 'running', '2026-08-24T00:00:00.000Z'))
    service.ingestSnapshot(machine, snap(id, 'stopped', '2026-08-24T00:00:30.000Z'))
    service.now = () => Date.parse('2026-08-24T00:02:00.000Z')
    service.sweepDowntime()
    service.ingestSnapshot(machine, snap(id, 'running', '2026-08-24T00:02:00.000Z'))
    expect(await downtimeRows(id)).toHaveLength(0)
  })

  it('dừng lâu quá ngưỡng → sweep mở long-stop rồi đóng kèm thời lượng', async () => {
    const machine = await pairOne()
    const id = machine.id
    service.ingestSnapshot(machine, snap(id, 'stopped', '2026-08-24T00:00:00.000Z'))
    service.now = () => Date.parse('2026-08-24T00:06:00.000Z')
    service.sweepDowntime()
    service.ingestSnapshot(machine, snap(id, 'running', '2026-08-24T00:10:00.000Z'))
    const rows = await downtimeRows(id)
    const open = rows.find((entry) => entry.action === 'machine.downtime.open')
    const close = rows.find((entry) => entry.action === 'machine.downtime.close')
    expect(open.after).toMatchObject({ reason: 'long-stop', status: 'stopped' })
    expect(close.after).toMatchObject({ reason: 'long-stop', status: 'running', durationSeconds: 600 })
  })

  it('sweep chạy nhiều nhịp chỉ ghi đúng một dòng mở cho một episode', async () => {
    const machine = await pairOne()
    const id = machine.id
    service.ingestSnapshot(machine, snap(id, 'stopped', '2026-08-24T00:00:00.000Z'))
    for (const t of ['00:06:00', '00:07:00', '00:08:00']) {
      service.now = () => Date.parse(`2026-08-24T${t}.000Z`)
      service.sweepDowntime()
    }
    const opens = (await downtimeRows(id)).filter((entry) => entry.action === 'machine.downtime.open')
    expect(opens).toHaveLength(1)
  })

  /**
   * Dựng lại đúng chuỗi đã ĐO ĐƯỢC trên máy 3ce4b0c54f54 ngày 27/08 (log `tinh-trang`, 2 s một
   * nhịp). Bản cũ đi qua chuỗi này rồi khai một mốc bịa mà vẫn đóng dấu "chính xác":
   *
   *   08:20:03  stopped   tu_luc=03:11:21  xap_xi=false   ← bridge biết đúng
   *   08:20:22  unknown                                    ← adapter không đọc được
   *   08:20:26  stopped   tu_luc=08:20:26  xap_xi=FALSE    ← hơn 5 tiếng bốc hơi
   *
   * `unknown` không phải trạng thái của máy, nó là "không đọc được" (contract). Ra khỏi nó thì
   * mốc mới chỉ là cận dưới, y như lần đầu tiên nhìn thấy máy.
   */
  it('mất tín hiệu giữa chừng → mốc bắt đầu là cận dưới, KHÔNG được đóng dấu chính xác', async () => {
    const machine = await pairOne()
    const id = machine.id
    service.ingestSnapshot(machine, snap(id, 'running', '2026-08-24T00:00:00.000Z'))
    service.ingestSnapshot(machine, snap(id, 'stopped', '2026-08-24T01:00:00.000Z'))
    expect(service.statusSince.get(id)).toMatchObject({ at: '2026-08-24T01:00:00.000Z', approximate: false })

    // Bốn giây mù, rồi thấy lại đúng trạng thái cũ.
    service.ingestSnapshot(machine, snap(id, 'unknown', '2026-08-24T05:59:56.000Z'))
    service.ingestSnapshot(machine, snap(id, 'stopped', '2026-08-24T06:00:00.000Z'))

    const since = service.statusSince.get(id)
    expect(since.at).toBe('2026-08-24T06:00:00.000Z')
    expect(since.approximate).toBe(true)                      // ← lỗi cũ: false
    expect(since.somNhat).toBe('2026-08-24T01:00:00.000Z')    // phép đo cũ không bị vứt
  })

  it('hai bên khoảng mù là hai trạng thái khác nhau → không mượn mốc cũ', async () => {
    const machine = await pairOne()
    const id = machine.id
    service.ingestSnapshot(machine, snap(id, 'running', '2026-08-24T01:00:00.000Z'))
    service.ingestSnapshot(machine, snap(id, 'unknown', '2026-08-24T05:59:56.000Z'))
    service.ingestSnapshot(machine, snap(id, 'stopped', '2026-08-24T06:00:00.000Z'))

    const since = service.statusSince.get(id)
    expect(since.approximate).toBe(true)
    // Máy đang CHẠY trước khoảng mù. Mốc đó nói về lần chạy, không nói gì về lần dừng này —
    // mượn sang là bịa ra một lần dừng 5 tiếng chưa từng xảy ra.
    expect(since.somNhat).toBeNull()
  })

  it('nhiều khoảng mù liên tiếp vẫn nhớ được trạng thái đọc được cuối cùng', async () => {
    const machine = await pairOne()
    const id = machine.id
    service.ingestSnapshot(machine, snap(id, 'stopped', '2026-08-24T01:00:00.000Z'))
    service.ingestSnapshot(machine, snap(id, 'unknown', '2026-08-24T02:00:00.000Z'))
    service.ingestSnapshot(machine, snap(id, 'running', '2026-08-24T03:00:00.000Z'))
    service.ingestSnapshot(machine, snap(id, 'unknown', '2026-08-24T04:00:00.000Z'))
    service.ingestSnapshot(machine, snap(id, 'running', '2026-08-24T05:00:00.000Z'))

    // Trạng thái đọc được cuối cùng trước khoảng mù thứ hai là `running` lúc 03:00 — không
    // phải `stopped` lúc 01:00 đã bị khoảng mù thứ nhất bỏ lại.
    expect(service.statusSince.get(id)).toMatchObject({ approximate: true, somNhat: '2026-08-24T03:00:00.000Z' })
  })

  it('sổ lần lỗi mang cả cận dưới lẫn cận trên, và nói ra mốc chắc tới đâu', async () => {
    const machine = await pairOne()
    const id = machine.id
    service.ingestSnapshot(machine, snap(id, 'stopped', '2026-08-24T01:00:00.000Z'))
    service.ingestSnapshot(machine, snap(id, 'unknown', '2026-08-24T05:59:56.000Z'))
    service.ingestSnapshot(machine, snap(id, 'stopped', '2026-08-24T06:00:00.000Z'))
    service.now = () => Date.parse('2026-08-24T06:06:00.000Z')
    service.sweepDowntime()
    service.ingestSnapshot(machine, snap(id, 'running', '2026-08-24T06:10:00.000Z'))

    const { episodes } = await service.docLichSuLoi(id, {})
    expect(episodes).toHaveLength(1)
    const [lan] = episodes
    expect(lan.batDauUocChung).toBe(true)
    expect(lan.batDau).toBe('2026-08-24T06:00:00.000Z')
    expect(lan.batDauSomNhat).toBe('2026-08-24T01:00:00.000Z')
    expect(lan.thoiLuongGiay).toBe(600)          // chắc chắn ít nhất 10 phút
    expect(lan.thoiLuongToiDaGiay).toBe(18_600)  // nhiều nhất 5 tiếng 10 phút
    expect(lan.cauMoc).toContain('CẬN DƯỚI')
    expect(lan.cauMoc).toContain('2026-08-24T01:00:00.000Z')
  })

  it('không có khoảng mù thì không sinh ra cận trên giả', async () => {
    const machine = await pairOne()
    const id = machine.id
    service.ingestSnapshot(machine, snap(id, 'running', '2026-08-24T00:00:00.000Z'))
    service.ingestSnapshot(machine, snap(id, 'stopped', '2026-08-24T01:00:00.000Z'))
    service.now = () => Date.parse('2026-08-24T01:06:00.000Z')
    service.sweepDowntime()
    service.ingestSnapshot(machine, snap(id, 'running', '2026-08-24T01:10:00.000Z'))

    const [lan] = (await service.docLichSuLoi(id, {})).episodes
    expect(lan.batDauUocChung).toBe(false)
    expect(lan.batDauSomNhat).toBeNull()
    expect(lan.thoiLuongToiDaGiay).toBeNull()
    expect(lan.cauMoc).toContain('chắc chắn')
  })
})

/**
 * Cổng tin cậy: nhiều máy thêu đi chung một địa chỉ.
 *
 * Broker MQTT đẩy telemetry của MỌI máy qua chung một socket, ra từ 127.0.0.1. Bridge định
 * danh theo địa chỉ nguồn, nên nếu không có khái niệm cổng thì hai máy hoặc gộp làm một
 * (số trộn vào nhau, không một dòng lỗi), hoặc bị `ambiguous_source` vứt cả luồng — mất
 * luôn cái máy đang chạy tốt. Cả hai đều đã từng là hành vi thật, nên chốt lại bằng test.
 */
describe('dial-in qua cổng tin cậy', () => {
  const dialIn = (overrides = {}) => input({ adapter: 'dial-in', ...overrides })
  const moCong = (address = '192.168.10.21') => {
    service.config = { ...service.config, ingest: { ...(service.config.ingest ?? {}), gateways: [address] } }
  }

  it('cho ghép nhiều máy cùng một địa chỉ KHI địa chỉ đó là cổng đã khai', async () => {
    moCong()
    const machines = await service.pairMany(
      [dialIn(), input({ adapter: 'dial-in', assetTag: 'HN-002', name: 'Máy thêu 02', ipAddress: '192.168.10.21' })],
      technician,
    )
    expect(machines).toHaveLength(2)
  })

  it('vẫn chặn hai máy trùng IP ở địa chỉ KHÔNG phải cổng — đó vẫn là gõ nhầm sổ máy', async () => {
    await expect(
      service.pairMany(
        [dialIn(), input({ adapter: 'dial-in', assetTag: 'HN-002', name: 'Máy thêu 02', ipAddress: '192.168.10.21' })],
        technician,
      ),
    ).rejects.toThrow(/IP 192\.168\.10\.21 đã thuộc về máy/)
  })

  it('trả về cổng phân giải được ĐÚNG máy theo machineId, thay vì gộp hay từ chối cả luồng', async () => {
    moCong()
    const [mot, hai] = await service.pairMany(
      [dialIn(), input({ adapter: 'dial-in', assetTag: 'HN-002', name: 'Máy thêu 02', ipAddress: '192.168.10.21' })],
      technician,
    )
    const resolved = service.identifyDialIn('192.168.10.21')
    expect(resolved.machine).toBeUndefined()
    expect(resolved.gateway.resolve(mot.identity.id).id).toBe(mot.identity.id)
    expect(resolved.gateway.resolve(hai.identity.id).id).toBe(hai.identity.id)
  })

  it('không tin lời khai: machineId lạ trả null chứ không rơi về máy nào khác', async () => {
    moCong()
    await service.pairMany([dialIn()], technician)
    const { gateway } = service.identifyDialIn('192.168.10.21')
    expect(gateway.resolve('mch-khong-co')).toBeNull()
    expect(gateway.resolve('')).toBeNull()
    expect(gateway.resolve(undefined)).toBeNull()
  })

  it('máy đã lưu kho thì cổng cũng không hồi sinh nó qua đường dây', async () => {
    moCong()
    const [machine] = await service.pairMany([dialIn()], technician)
    await service.archiveMachine(machine.identity.id, technician)
    expect(service.identifyDialIn('192.168.10.21')).toEqual({ reason: 'unknown_source' })
  })

  it('vẫn soi lại allowlist ở cổng, không chỉ ở đường trực tiếp', async () => {
    moCong()
    const [machine] = await service.pairMany([dialIn()], technician)
    service.config = { ...service.config, sites: sites.map((s) => (s.id === 'hn-1' ? { ...s, allowedCidrs: ['192.168.11.0/24'] } : s)) }
    const { gateway } = service.identifyDialIn('192.168.10.21')
    expect(gateway.resolve(machine.identity.id)).toBeNull()
    expect(service.telemetryErrors.get(machine.identity.id).kind).toBe('policy')
  })

  it('địa chỉ không khai là cổng thì hành vi cũ giữ nguyên từng bước', async () => {
    const [machine] = await service.pairMany([dialIn()], technician)
    expect(service.identifyDialIn('192.168.10.21').machine.id).toBe(machine.identity.id)
    expect(service.identifyDialIn('192.168.10.99')).toEqual({ reason: 'unknown_source' })
  })

  it('đánh dấu cổng trên bảng địa chỉ, để nhiều máy một IP không bị đọc nhầm thành lỗi khai trùng', async () => {
    moCong()
    await service.pairMany(
      [dialIn(), input({ adapter: 'dial-in', assetTag: 'HN-002', name: 'Máy thêu 02', ipAddress: '192.168.10.21' })],
      technician,
    )
    service.dialIn.touchCaller('192.168.10.21', { accepted: true })
    const [caller] = service.ingestStatus().callers
    expect(caller.pairedCount).toBe(2)
    expect(caller.pairedGateway).toBe(true)
  })
})
