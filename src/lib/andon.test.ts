import { describe, expect, it } from 'vitest'
import { andonSummary, andonTiles, andonTone, attentionPages, pageCount, pageOf, stitchesByMachine } from './andon'
import { baseNow, makeMachine, makeTelemetry } from '../test/factories'
import type { Alert, ConnectionStateName, MachineView, OperationalStatus } from '../types/fleet'

function withConnection(machine: MachineView, state: ConnectionStateName, reason = ''): MachineView {
  return { ...machine, connection: { ...machine.connection, state, reason } }
}

function alert(severity: Alert['severity'], title: string): Alert {
  return {
    id: `al-${severity}`, severity, kind: 'controller-event', title, detail: title,
    source: 'controller', since: null, acknowledged: null,
  }
}

function machineWithStatus(id: string, status: OperationalStatus): MachineView {
  return makeMachine({ id, telemetry: makeTelemetry({ machineId: id, status: { value: status, observedAt: new Date().toISOString(), source: 'controller', quality: 'verified' } }) })
}

/** Máy đã dừng liên tục `minutes` phút tính đến `baseNow`. */
function stoppedSince(id: string, minutes: number): MachineView {
  const observedAt = new Date(baseNow).toISOString()
  return makeMachine({
    id,
    lastTelemetryAt: observedAt,
    telemetry: makeTelemetry({ machineId: id, observedAt, status: { value: 'stopped', observedAt, source: 'controller', quality: 'verified' } }),
    statusSince: { status: 'stopped', at: new Date(baseNow - minutes * 60_000).toISOString(), approximate: false },
  })
}

describe('andonTone', () => {
  it('puts a controller fault above every other reason', () => {
    const machine = machineWithStatus('m-1', 'fault')
    expect(andonTone({ ...machine, alerts: [alert('critical', 'Đứt chỉ liên tục')] }).tone).toBe('fault')
  })

  it('reports an offline machine as offline and quotes the bridge reason', () => {
    const machine = withConnection(machineWithStatus('m-1', 'running'), 'offline', 'Quá 90 giây không đọc được')
    expect(andonTone(machine)).toEqual({ tone: 'offline', reason: 'Quá 90 giây không đọc được' })
  })

  it('raises an unacknowledged warning above a running machine', () => {
    const machine = { ...machineWithStatus('m-1', 'running'), alerts: [alert('warning', 'Tỉ lệ đứt chỉ cao')] }
    expect(andonTone(machine)).toEqual({ tone: 'alert', reason: 'Tỉ lệ đứt chỉ cao' })
  })

  it('ignores an acknowledged alert so a handled problem stops shouting', () => {
    const acknowledged: Alert = {
      ...alert('critical', 'Đã xử lý'),
      acknowledged: { by: 'ktv.an', at: new Date().toISOString(), note: null },
    }
    expect(andonTone({ ...machineWithStatus('m-1', 'running'), alerts: [acknowledged] }).tone).toBe('running')
  })

  it('never calls an unreadable machine "đang chạy"', () => {
    const stale = withConnection(machineWithStatus('m-1', 'running'), 'stale', 'Dữ liệu 2 phút trước')
    expect(andonTone(stale).tone).toBe('stale')
    const unknown = withConnection(makeMachine({ telemetry: null, lastTelemetryAt: null }), 'unknown')
    expect(andonTone(unknown)).toEqual({ tone: 'unknown', reason: 'Chưa đọc được từ controller' })
  })

  it('separates a plain stop from a problem', () => {
    expect(andonTone(machineWithStatus('m-1', 'stopped'))).toEqual({ tone: 'idle', reason: 'Đã dừng' })
    expect(andonTone(machineWithStatus('m-2', 'paused')).tone).toBe('idle')
  })

  it('escalates a stop that has lasted past the site threshold', () => {
    const short = stoppedSince('m-1', 3)
    const long = stoppedSince('m-2', 41)
    expect(andonTone(short, baseNow).tone).toBe('idle')
    expect(andonTone(long, baseNow)).toEqual({ tone: 'idle-long', reason: 'Đã dừng liên tục quá 5 phút' })
  })

  it('puts a long stop above stale data — a stopped machine is a person problem', () => {
    const machine = withConnection(stoppedSince('m-1', 41), 'stale', 'Dữ liệu 60 giây')
    expect(andonTone(machine, baseNow).tone).toBe('idle-long')
  })
})

describe('andonTiles', () => {
  it('sorts what needs a person first and keeps ties in a stable name order', () => {
    const tiles = andonTiles([
      machineWithStatus('m-3', 'running'),
      withConnection(machineWithStatus('m-1', 'running'), 'offline'),
      machineWithStatus('m-2', 'fault'),
      makeMachine({ id: 'm-4', name: 'Máy A', telemetry: makeTelemetry({ machineId: 'm-4' }) }),
    ])
    expect(tiles.map((tile) => tile.id)).toEqual(['m-2', 'm-1', 'm-4', 'm-3'])
  })

  it('hides archived machines from the wall', () => {
    const tiles = andonTiles([machineWithStatus('m-1', 'running'), makeMachine({ id: 'm-2', archived: true })])
    expect(tiles.map((tile) => tile.id)).toEqual(['m-1'])
  })

  it('shows shift stitches when the ledger has them and null when it does not', () => {
    const tiles = andonTiles(
      [machineWithStatus('m-1', 'running'), machineWithStatus('m-2', 'running')],
      new Map([['m-1', 42_000]]),
    )
    expect(tiles.find((tile) => tile.id === 'm-1')?.stitches).toBe(42_000)
    expect(tiles.find((tile) => tile.id === 'm-2')?.stitches).toBeNull()
  })

  it('prints how long a stop has lasted — 2 phút and 41 phút must not look alike', () => {
    const [tile] = andonTiles([stoppedSince('m-1', 41)], new Map(), baseNow)
    expect(tile).toMatchObject({ tone: 'idle-long', toneSymbol: '■!', duration: '41 phút', durationSource: 'dashboard' })
  })

  it('uses the controller-reported run time for a running machine, not its own clock', () => {
    const [tile] = andonTiles([machineWithStatus('m-1', 'running')], new Map(), baseNow)
    // Factory job.elapsedSeconds = 640 → "10p 40s", máy báo chứ dashboard không tính.
    expect(tile).toMatchObject({ tone: 'running', duration: '10p 40s', durationSource: 'controller' })
  })

  it('carries a word and a symbol for every tone, never colour alone', () => {
    const [tile] = andonTiles([machineWithStatus('m-1', 'fault')])
    expect(tile.toneLabel).toBe('LỖI MÁY')
    expect(tile.toneSymbol).toBe('✕')
    expect(tile.reason).toBe('Controller báo lỗi')
  })
})

describe('andonSummary', () => {
  it('counts everything unreadable as abnormal, not as fine', () => {
    const summary = andonSummary(andonTiles([
      machineWithStatus('m-1', 'running'),
      machineWithStatus('m-2', 'fault'),
      withConnection(machineWithStatus('m-3', 'running'), 'stale'),
      machineWithStatus('m-4', 'stopped'),
    ]))
    expect(summary).toMatchObject({ total: 4, running: 1, abnormal: 2, unreadable: 1 })
    expect(summary.byTone.idle).toBe(1)
  })

  it('vẫn đếm máy dừng lâu khi tone của nó là cảnh báo', () => {
    // Máy dừng 41 phút và đang có cảnh báo chưa xác nhận: tone là `alert`, nhưng nó vẫn là
    // một cái máy đứng im 41 phút. Đếm theo tone thì ô "Dừng lâu" ghi 0 — bảng nói dối.
    const machine = { ...stoppedSince('m-1', 41), alerts: [alert('warning', 'Đứt chỉ kim 7')] }
    const tiles = andonTiles([machine], new Map(), baseNow)
    const summary = andonSummary(tiles)
    expect(summary).toMatchObject({ longStop: 1, shortStop: 0 })
    expect(summary.byTone.alert).toBe(1)
    // Và ô đó phải tự nói ra là máy đang dừng, chứ không chỉ in "≥ 41 phút" trống nghĩa.
    expect(tiles[0].reason).toBe('Đứt chỉ kim 7 · máy đang dừng')
  })

  it('dừng ngắn không bị gộp vào dừng lâu', () => {
    const summary = andonSummary(andonTiles([stoppedSince('m-1', 2), stoppedSince('m-2', 41)], new Map(), baseNow))
    expect(summary).toMatchObject({ longStop: 1, shortStop: 1 })
  })

  it('tách máy chưa đọc được ra khỏi máy có người phải tới', () => {
    const summary = andonSummary(andonTiles([
      withConnection(makeMachine({ id: 'm-1', telemetry: null, lastTelemetryAt: null }), 'unknown'),
      withConnection(machineWithStatus('m-2', 'running'), 'stale'),
      machineWithStatus('m-3', 'fault'),
    ]))
    // Cùng một đội máy, hai câu trả lời khác nhau — nên chúng phải mang hai cái tên khác nhau.
    expect(summary).toMatchObject({ abnormal: 3, unreadable: 2 })
  })
})

describe('pagination', () => {
  it('never reports zero pages for an empty fleet', () => {
    expect(pageCount(0, 12)).toBe(1)
    expect(pageOf([], 3, 12)).toEqual([])
  })

  it('clamps an out-of-range page instead of blanking the wall', () => {
    const items = [1, 2, 3, 4, 5]
    expect(pageOf(items, 0, 2)).toEqual([1, 2])
    expect(pageOf(items, 2, 2)).toEqual([5])
    expect(pageOf(items, 99, 2)).toEqual([5])
    expect(pageCount(5, 2)).toBe(3)
  })
})

describe('attentionPages', () => {
  it('không có máy cần xử lý thì không giữ trang', () => {
    const tiles = andonTiles([machineWithStatus('m-1', 'running'), machineWithStatus('m-2', 'stopped')])
    expect(attentionPages(tiles, 4)).toBe(0)
  })

  it('giữ đúng số trang đầu chứa máy cần xử lý', () => {
    // Tile đã sắp theo mức khẩn, nên 3 máy lỗi nằm ở trang đầu với pageSize 4.
    const tiles = andonTiles([
      machineWithStatus('m-1', 'fault'),
      machineWithStatus('m-2', 'fault'),
      machineWithStatus('m-3', 'fault'),
      machineWithStatus('m-4', 'running'),
      machineWithStatus('m-5', 'running'),
      machineWithStatus('m-6', 'running'),
    ])
    expect(attentionPages(tiles, 4)).toBe(1)
    expect(attentionPages(tiles, 2)).toBe(2)
  })
})

describe('stitchesByMachine', () => {
  it('sums a machine across the shifts of the day', () => {
    const totals = stitchesByMachine([
      { machineId: 'm-1', stitches: 1_000 },
      { machineId: 'm-1', stitches: 2_500 },
      { machineId: 'm-2', stitches: 700 },
    ])
    expect(totals.get('m-1')).toBe(3_500)
    expect(totals.get('m-2')).toBe(700)
  })
})
