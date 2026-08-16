import { describe, expect, it } from 'vitest'
import { fleetComposition } from './composition'
import { applyFilter, emptyFilter, summarize } from './fleet'
import { baseNow, makeMachine, makeTelemetry } from '../test/factories'
import type { Alert, ConnectionStateName, MachineView, OperationalStatus } from '../types/fleet'

function withStatus(id: string, status: OperationalStatus): MachineView {
  const observedAt = new Date(baseNow).toISOString()
  return makeMachine({
    id,
    lastTelemetryAt: observedAt,
    telemetry: makeTelemetry({ machineId: id, observedAt, status: { value: status, observedAt, source: 'controller', quality: 'verified' } }),
  })
}

function withConnection(machine: MachineView, state: ConnectionStateName): MachineView {
  return { ...machine, connection: { ...machine.connection, state, reason: '' } }
}

function withAlert(machine: MachineView, severity: Alert['severity']): MachineView {
  return {
    ...machine,
    alerts: [{
      id: 'al-1', severity, kind: 'controller-event', title: 'Đứt chỉ', detail: 'Đứt chỉ',
      source: 'controller', since: null, acknowledged: null,
    }],
  }
}

function stoppedSince(id: string, minutes: number): MachineView {
  return {
    ...withStatus(id, 'stopped'),
    statusSince: { status: 'stopped', at: new Date(baseNow - minutes * 60_000).toISOString(), approximate: false },
  }
}

function unverified(machine: MachineView): MachineView {
  return { ...machine, identity: { ...machine.identity, verification: { ...machine.identity.verification, status: 'unverified' } } }
}

function archived(machine: MachineView): MachineView {
  return { ...machine, identity: { ...machine.identity, archived: true } }
}

const countOf = (machines: MachineView[], key: string) =>
  fleetComposition(machines, baseNow).segments.find((segment) => segment.key === key)!.count

describe('fleetComposition', () => {
  /**
   * Cái này mới là lý do hàm tồn tại: bề rộng các khúc là phần trăm, nên tổng phải khớp tuyệt
   * đối. Chỉ số KPI cộng lại *không* khớp (dừng lâu nằm trong dừng, máy vừa lỗi vừa mất kết
   * nối bị đếm hai lần) — vẽ thanh từ KPI là vẽ một cái thanh nói dối.
   */
  it('năm khúc cộng lại đúng bằng số máy được đếm', () => {
    const machines = [
      withStatus('m-1', 'running'),
      withStatus('m-2', 'fault'),
      withConnection(withStatus('m-3', 'running'), 'offline'),
      withConnection(withStatus('m-4', 'running'), 'stale'),
      withAlert(withStatus('m-5', 'running'), 'warning'),
      stoppedSince('m-6', 90),
      withStatus('m-7', 'stopped'),
    ]
    const { segments, counted } = fleetComposition(machines, baseNow)
    expect(counted).toBe(machines.length)
    expect(segments.reduce((sum, segment) => sum + segment.count, 0)).toBe(counted)
  })

  it('mỗi tông rơi vào đúng một khúc', () => {
    expect(countOf([withStatus('m-1', 'fault')], 'fault')).toBe(1)
    expect(countOf([withConnection(withStatus('m-1', 'running'), 'offline')], 'unreadable')).toBe(1)
    expect(countOf([withConnection(withStatus('m-1', 'running'), 'stale')], 'unreadable')).toBe(1)
    expect(countOf([withAlert(withStatus('m-1', 'running'), 'warning')], 'attention')).toBe(1)
    expect(countOf([stoppedSince('m-1', 90)], 'attention')).toBe(1)
    expect(countOf([withStatus('m-1', 'stopped')], 'idle')).toBe(1)
    expect(countOf([withStatus('m-1', 'running')], 'running')).toBe(1)
  })

  /**
   * Máy vừa lỗi vừa mất kết nối chỉ được đếm một lần, ở khúc nghiêm trọng hơn — đúng thứ tự
   * ưu tiên mà cả bảng lẫn ô vuông đang dùng để tô màu và sắp xếp.
   */
  it('máy vừa lỗi vừa mất kết nối chỉ đếm một lần', () => {
    const machines = [withConnection(withStatus('m-1', 'fault'), 'offline')]
    const { segments, counted } = fleetComposition(machines, baseNow)
    expect(counted).toBe(1)
    expect(segments.reduce((sum, segment) => sum + segment.count, 0)).toBe(1)
    expect(countOf(machines, 'unreadable')).toBe(1)
  })

  /**
   * Đây là cái suýt lọt ra xưởng: thanh đếm cả đội còn chip KPI bỏ máy chưa xác minh, nên hai
   * chỗ cách nhau 8 px cùng ghi chữ "Đang chạy" mà một bên 9 một bên 10. Khoá lại bằng cách so
   * thẳng với `summarize`, chứ không viết cứng con số.
   */
  it('khúc "Đang chạy" khớp tuyệt đối với chip KPI cùng màn hình', () => {
    const machines = [
      withStatus('m-1', 'running'),
      unverified(withStatus('m-2', 'running')),
      archived(withStatus('m-3', 'running')),
      withStatus('m-4', 'stopped'),
      withStatus('m-5', 'fault'),
    ]
    const { segments, counted, unverified: skipped, archived: stored } = fleetComposition(machines, baseNow)
    const kpi = summarize(machines, baseNow)

    expect(segments.find((segment) => segment.key === 'running')!.count).toBe(kpi.running)
    expect(segments.find((segment) => segment.key === 'idle')!.count).toBe(kpi.idle)
    expect(segments.find((segment) => segment.key === 'fault')!.count).toBe(kpi.fault)
    expect(skipped).toBe(kpi.unverified)
    expect(stored).toBe(kpi.archived)
    expect(counted).toBe(kpi.verified)
  })

  /**
   * Bấm vào khúc phải ra **đúng** chừng ấy dòng. Cái bẫy nằm ở `m-3`: controller báo "đang
   * chạy" nhưng dữ liệu đã quá hạn tươi, nên thanh xếp nó vào "Không đọc được" — lọc theo
   * `status: 'running'` sẽ vẫn tóm nó và trả về nhiều hơn con số vừa in ra.
   */
  it('bấm vào khúc lọc ra đúng số máy mà khúc đó vừa đếm', () => {
    const machines = [
      withStatus('m-1', 'running'),
      withStatus('m-2', 'running'),
      withConnection(withStatus('m-3', 'running'), 'stale'),
      withConnection(withStatus('m-4', 'running'), 'offline'),
      withAlert(withStatus('m-5', 'running'), 'warning'),
      stoppedSince('m-6', 90),
      withStatus('m-7', 'stopped'),
      withStatus('m-8', 'fault'),
      unverified(withStatus('m-9', 'running')),
      archived(withStatus('m-10', 'running')),
    ]
    const { segments } = fleetComposition(machines, baseNow)
    for (const segment of segments) {
      const rows = applyFilter(machines, { ...emptyFilter, ...segment.patch }, baseNow)
      expect(rows, `khúc ${segment.key}`).toHaveLength(segment.count)
    }
  })

  it('đội rỗng trả về năm khúc bằng 0 chứ không phải mảng rỗng', () => {
    const { segments, counted } = fleetComposition([], baseNow)
    expect(segments).toHaveLength(5)
    expect(counted).toBe(0)
    expect(segments.every((segment) => segment.count === 0 && segment.percent === 0)).toBe(true)
  })
})
