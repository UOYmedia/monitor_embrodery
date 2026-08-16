import { describe, expect, it } from 'vitest'
import {
  alertDigest, alertFeed, derivedAlerts, filterAlerts, isActionable, machineAlerts, newAlerts, titleBadge,
} from './alerts'
import { andonTone } from './andon'
import { summarize } from './fleet'
import { baseNow, makeMachine, makeTelemetry } from '../test/factories'
import type { Acknowledgement, Alert, ConnectionStateName, MachineView, OperationalStatus } from '../types/fleet'

function withConnection(machine: MachineView, state: ConnectionStateName, reason = ''): MachineView {
  return { ...machine, connection: { ...machine.connection, state, reason } }
}

function withStatus(id: string, status: OperationalStatus): MachineView {
  const observedAt = new Date(baseNow).toISOString()
  return makeMachine({
    id,
    telemetry: makeTelemetry({ machineId: id, observedAt, status: { value: status, observedAt, source: 'controller', quality: 'verified' } }),
  })
}

/** Máy đã dừng liên tục `minutes` phút tính đến `baseNow`. */
function stoppedSince(id: string, minutes: number): MachineView {
  return {
    ...withStatus(id, 'stopped'),
    statusSince: { status: 'stopped', at: new Date(baseNow - minutes * 60_000).toISOString(), approximate: false },
  }
}

function bridgeAlert(severity: Alert['severity'], title: string, since: string | null = null, acknowledged: Acknowledgement | null = null): Alert {
  return { id: `event:${title}`, severity, kind: 'controller-event', title, detail: title, source: 'controller', since, acknowledged }
}

const ack: Acknowledgement = { at: new Date(baseNow).toISOString(), by: 'ktv.an', note: null }

describe('derivedAlerts', () => {
  it('raises a critical alert when the controller reports a fault', () => {
    const rows = derivedAlerts(withStatus('m-1', 'fault'), baseNow)
    expect(rows.map((row) => row.id)).toEqual(['state:fault'])
    expect(rows[0].severity).toBe('critical')
    expect(rows[0].source).toBe('dashboard')
  })

  it('raises a critical alert when the bridge cannot read the machine', () => {
    const machine = withConnection(withStatus('m-1', 'running'), 'offline')
    const offline = derivedAlerts(machine, baseNow).find((row) => row.id === 'connection:offline')
    expect(offline?.severity).toBe('critical')
    // Lý do phải nói được máy còn sống hay không — hai việc sửa khác hẳn nhau.
    expect(offline?.detail).toContain('adapter không đọc được')
  })

  it('stays silent about a machine that is switched off in the asset register', () => {
    const machine = withConnection(makeMachine({ id: 'm-1', enabled: false }), 'offline')
    expect(derivedAlerts(machine, baseNow).map((row) => row.id)).not.toContain('connection:offline')
  })

  it('says so when the machine sent bytes the bridge could not turn into a snapshot', () => {
    const machine = makeMachine({
      id: 'm-1',
      telemetryError: { kind: 'contract', message: 'Máy gửi dữ liệu chưa giải mã được.', field: null, at: new Date(baseNow).toISOString() },
    })
    const row = derivedAlerts(machine, baseNow).find((entry) => entry.id === 'telemetry:error')
    expect(row?.severity).toBe('warning')
    expect(row?.title).toContain('sai hợp đồng dữ liệu')
    // Ảnh chụp cũ không bị xoá, và dòng cảnh báo phải nói ra điều đó.
    expect(row?.detail).toContain('vẫn giữ nguyên')
  })

  it('escalates a stop that passed the workshop threshold, with the elapsed time in words', () => {
    const row = derivedAlerts(stoppedSince('m-1', 41), baseNow).find((entry) => entry.id === 'state:idle-long')
    expect(row?.severity).toBe('warning')
    expect(row?.title).toContain('41 phút')
    expect(row?.detail).toContain('ngưỡng 5 phút')
  })

  it('leaves a short stop alone', () => {
    expect(derivedAlerts(stoppedSince('m-1', 2), baseNow)).toEqual([])
  })

  it('files stale data as info, so it never calls anyone to the machine', () => {
    const machine = withConnection(withStatus('m-1', 'running'), 'stale')
    const row = derivedAlerts(machine, baseNow).find((entry) => entry.id === 'connection:stale')
    expect(row?.severity).toBe('info')
    expect(isActionable({ key: 'k', machineId: 'm-1', machineName: '', assetTag: '', zone: '', siteId: '', alert: row!, acknowledgeable: false })).toBe(false)
  })

  it('does not call a manual machine stale: it was never expected to answer', () => {
    const machine = withConnection(makeMachine({ id: 'm-1', adapter: 'manual', adapterHasProtocol: false }), 'stale')
    expect(derivedAlerts(machine, baseNow).map((row) => row.id)).not.toContain('connection:stale')
  })

  it('says nothing at all about an archived machine', () => {
    const machine = withConnection(makeMachine({ id: 'm-1', archived: true }), 'offline')
    expect(derivedAlerts(machine, baseNow)).toEqual([])
  })
})

describe('machineAlerts', () => {
  it('marks bridge alerts acknowledgeable and dashboard ones not', () => {
    const machine = { ...withStatus('m-1', 'fault'), alerts: [bridgeAlert('critical', 'Mã lỗi EC12')] }
    const rows = machineAlerts(machine, baseNow)
    expect(rows.find((row) => row.alert.source === 'controller')?.acknowledgeable).toBe(true)
    expect(rows.find((row) => row.alert.source === 'dashboard')?.acknowledgeable).toBe(false)
  })

  it('keys every row by machine so two machines with the same alert id stay apart', () => {
    const left = machineAlerts(withStatus('m-1', 'fault'), baseNow)
    const right = machineAlerts(withStatus('m-2', 'fault'), baseNow)
    expect(left[0].alert.id).toBe(right[0].alert.id)
    expect(left[0].key).not.toBe(right[0].key)
  })

  /**
   * Khoá cả module lại: cảnh báo dashboard là khung nhìn, không phải dữ liệu. Nếu ai đó
   * "tiện tay" nhét chúng vào `machine.alerts`, bảng andon sẽ đổi tone và KPI sẽ đổi số mà
   * không có yêu cầu nào — bài test này là cái chuông báo cho lần sửa đó.
   */
  it('never mutates machine.alerts, so the andon board and the KPI keep their meaning', () => {
    const machine = withConnection(withStatus('m-1', 'running'), 'offline')
    const before = summarize([machine])
    machineAlerts(machine, baseNow)
    expect(machine.alerts).toEqual([])
    expect(andonTone(machine, baseNow).tone).toBe('offline')
    expect(summarize([machine])).toEqual(before)
  })
})

describe('alertFeed', () => {
  it('puts unacknowledged before acknowledged, then severity, then the newest first', () => {
    const older = new Date(baseNow - 600_000).toISOString()
    const newer = new Date(baseNow - 60_000).toISOString()
    const machine = {
      ...makeMachine({ id: 'm-1' }),
      alerts: [
        bridgeAlert('warning', 'Cảnh báo cũ', older),
        bridgeAlert('critical', 'Đã xác nhận', newer, ack),
        bridgeAlert('warning', 'Cảnh báo mới', newer),
        bridgeAlert('critical', 'Nghiêm trọng', older),
      ],
    }
    expect(alertFeed([machine], baseNow).map((row) => row.alert.title))
      .toEqual(['Nghiêm trọng', 'Cảnh báo mới', 'Cảnh báo cũ', 'Đã xác nhận'])
  })

  it('sorts by machine name when severity and time tie', () => {
    const at = new Date(baseNow).toISOString()
    const machines = [
      { ...makeMachine({ id: 'm-2', name: 'Máy B' }), alerts: [bridgeAlert('warning', 'X', at)] },
      { ...makeMachine({ id: 'm-1', name: 'Máy A' }), alerts: [bridgeAlert('warning', 'X', at)] },
    ]
    expect(alertFeed(machines, baseNow).map((row) => row.machineName)).toEqual(['Máy A', 'Máy B'])
  })

  it('drops archived machines entirely', () => {
    const machine = { ...makeMachine({ id: 'm-1', archived: true }), alerts: [bridgeAlert('critical', 'Lỗi')] }
    expect(alertFeed([machine], baseNow)).toEqual([])
  })
})

describe('alertDigest', () => {
  it('counts only unacknowledged, and leaves info out of the number on the bell', () => {
    const machines = [
      withConnection(withStatus('m-1', 'running'), 'offline'),
      withConnection(withStatus('m-2', 'running'), 'stale'),
      { ...makeMachine({ id: 'm-3' }), alerts: [bridgeAlert('critical', 'Đã xem', null, ack)] },
    ]
    const digest = alertDigest(alertFeed(machines, baseNow))
    expect(digest).toMatchObject({ critical: 1, warning: 0, info: 1, open: 1, acknowledged: 1, machines: 1 })
  })

  it('counts machines, not rows, so one machine with three problems is still one machine', () => {
    const machine = {
      ...stoppedSince('m-1', 41),
      alerts: [bridgeAlert('critical', 'A'), bridgeAlert('warning', 'B')],
    }
    const digest = alertDigest(alertFeed([machine], baseNow))
    expect(digest.open).toBe(3)
    expect(digest.machines).toBe(1)
  })
})

describe('newAlerts', () => {
  it('reports only what the operator has not been shown yet', () => {
    const rows = alertFeed([withConnection(withStatus('m-1', 'running'), 'offline')], baseNow)
    expect(newAlerts(new Set(), rows).map((row) => row.key)).toEqual(['m-1::connection:offline'])
    expect(newAlerts(new Set(['m-1::connection:offline']), rows)).toEqual([])
  })

  it('never surfaces info or already-acknowledged rows', () => {
    const machines = [
      withConnection(withStatus('m-1', 'running'), 'stale'),
      { ...makeMachine({ id: 'm-2' }), alerts: [bridgeAlert('critical', 'Đã xem', null, ack)] },
    ]
    expect(newAlerts(new Set(), alertFeed(machines, baseNow))).toEqual([])
  })
})

describe('filterAlerts', () => {
  const machines = [
    withConnection(withStatus('m-1', 'running'), 'offline'),
    withConnection({ ...withStatus('m-2', 'running'), identity: { ...makeMachine({ id: 'm-2' }).identity, id: 'm-2', siteId: 'hcm' } }, 'stale'),
  ]

  it('keeps only actionable rows by default', () => {
    expect(filterAlerts(alertFeed(machines, baseNow), 'open', 'all').map((row) => row.machineId)).toEqual(['m-1'])
  })

  it('shows everything, including info, when asked', () => {
    expect(filterAlerts(alertFeed(machines, baseNow), 'all', 'all')).toHaveLength(2)
  })

  it('scopes to one site', () => {
    expect(filterAlerts(alertFeed(machines, baseNow), 'all', 'hcm').map((row) => row.machineId)).toEqual(['m-2'])
  })
})

describe('titleBadge', () => {
  it('prefixes the count so a background tab still shows it', () => {
    expect(titleBadge(2, 'Giám sát')).toBe('(2) Giám sát')
  })

  it('leaves the title alone when nothing is open', () => {
    // Số 0 vẫn là "không có gì": tiêu đề tab phải sạch, nếu không người dùng học được rằng
    // dấu ngoặc trên tiêu đề là chuyện bình thường và thôi nhìn nó.
    expect(titleBadge(0, 'Giám sát')).toBe('Giám sát')
  })
})
