import { formatMinutes, isLongStop, statusDuration } from './derived'
import { effectiveStatus, highestSeverity, jobProgressPercent, unacknowledgedAlerts } from './fleet'
import { connectionLabels, formatDuration, formatTime, statusLabels } from './format'
import type { MachineView } from '../types/fleet'

/**
 * Andon wall board logic.
 *
 * A TV on the workshop wall is read from five metres away by someone walking past, so the
 * screen answers exactly one question: which machine needs a person right now. The rules
 * here are deliberately pure and ordered — the tile tone is derived once, tested, and the
 * component only paints it.
 *
 * Two constraints that shape everything below:
 *  - tone is never the only channel: every tile carries a word and a symbol as well
 *  - a machine the bridge cannot read is "chưa rõ", never "đang chạy". Silence on a wall
 *    board that means "fine" is how a stopped machine goes unnoticed for an hour.
 */

export type AndonTone = 'fault' | 'offline' | 'alert' | 'idle-long' | 'stale' | 'idle' | 'running' | 'unknown'

/** Highest number wins the sort: what needs a person is at the top-left of the wall. */
const toneRank: Record<AndonTone, number> = {
  fault: 7, offline: 6, alert: 5, 'idle-long': 4, stale: 3, unknown: 2, idle: 1, running: 0,
}

export const toneLabels: Record<AndonTone, string> = {
  fault: 'LỖI MÁY',
  offline: 'MẤT KẾT NỐI',
  alert: 'CẢNH BÁO',
  'idle-long': 'DỪNG LÂU',
  stale: 'DỮ LIỆU CŨ',
  unknown: 'CHƯA RÕ',
  idle: 'DỪNG',
  running: 'ĐANG CHẠY',
}

/** Text symbols so the board still reads on a washed-out projector or in greyscale. */
export const toneSymbols: Record<AndonTone, string> = {
  fault: '✕', offline: '○', alert: '▲', 'idle-long': '■!', stale: '◐', unknown: '?', idle: '■', running: '▶',
}

export interface AndonTile {
  id: string
  name: string
  assetTag: string
  zone: string
  siteId: string
  tone: AndonTone
  toneLabel: string
  toneSymbol: string
  /** Why the tile shows this tone, in words — the second channel next to colour. */
  reason: string
  statusLabel: string
  connectionLabel: string
  ageSeconds: number | null
  rpm: number | null
  progress: number | null
  job: string | null
  /** Tên sản phẩm do controller báo, đứng cạnh tên file — file `80_4127~.DST` không đọc được. */
  product: string | null
  /**
   * Góc phải hàng 1. `running` dùng thời gian chạy job do máy báo; các tone khác dùng thời
   * lượng trạng thái do dashboard tính (footer board ghi chú quy ước này một lần).
   */
  duration: string | null
  durationSource: 'controller' | 'dashboard' | null
  stitches: number | null
  verified: boolean
  /**
   * Máy đang dừng/tạm dừng, và đã dừng quá ngưỡng xưởng hay chưa.
   *
   * Tách khỏi `tone` vì tone là loại trừ nhau: một máy dừng 13 phút mà đồng thời có cảnh báo
   * chưa xác nhận sẽ mang tone `alert`. Đếm "dừng lâu" theo tone thì bảng ghi 0 trong khi vẫn
   * có một máy đứng im 13 phút — đúng thứ mà bảng andon sinh ra để ngăn.
   */
  stopped: boolean
  longStop: boolean
}

/** `running` → máy báo chạy bao lâu; còn lại → dashboard tính từ lúc đổi trạng thái. */
function tileDuration(machine: MachineView, tone: AndonTone, now: number): Pick<AndonTile, 'duration' | 'durationSource'> {
  if (tone === 'running') {
    const elapsed = machine.telemetry?.job?.value?.elapsedSeconds ?? null
    return elapsed === null ? { duration: null, durationSource: null } : { duration: formatDuration(elapsed), durationSource: 'controller' }
  }
  const duration = statusDuration(machine, now)
  if (!duration) return { duration: null, durationSource: null }
  const text = formatMinutes(duration.minutes)
  return { duration: duration.approximate ? `≥ ${text}` : text, durationSource: 'dashboard' }
}

export function andonTone(machine: MachineView, now = Date.now()): { tone: AndonTone; reason: string } {
  const status = effectiveStatus(machine)
  const connection = machine.connection.state
  const severity = highestSeverity(unacknowledgedAlerts(machine))

  // Order matters: a faulted machine that also went offline is still first a fault.
  if (status === 'fault') return { tone: 'fault', reason: 'Controller báo lỗi' }
  if (connection === 'offline') return { tone: 'offline', reason: machine.connection.reason || 'Bridge không đọc được máy' }
  if (severity === 'critical' || severity === 'warning') {
    const alert = unacknowledgedAlerts(machine).find((entry) => entry.severity === severity)
    return { tone: 'alert', reason: alert?.title ?? 'Có cảnh báo chưa xác nhận' }
  }
  // Trên "dữ liệu cũ" một bậc, có chủ ý: một máy đã dừng 41 phút là việc của tổ trưởng, còn
  // telemetry trễ vài chục giây là việc của IT. Ngưỡng do site đặt, mặc định 5 phút.
  if (isLongStop(machine, now)) {
    return { tone: 'idle-long', reason: `${statusLabels[status]} liên tục quá ${machine.thresholds.stopEscalationMinutes} phút` }
  }
  if (connection === 'stale') return { tone: 'stale', reason: machine.connection.reason || 'Dữ liệu quá hạn tươi' }
  if (connection === 'unknown') return { tone: 'unknown', reason: 'Chưa đọc được từ controller' }
  if (status === 'running') return { tone: 'running', reason: 'Máy đang chạy' }
  if (status === 'unknown') return { tone: 'unknown', reason: 'Chưa đọc được từ controller' }
  return { tone: 'idle', reason: statusLabels[status] }
}

/**
 * @param stitchesByMachine shift stitches from the production ledger, or an empty map when
 *   the report has not loaded. Missing means "chưa có số", printed as such — never 0.
 */
export function andonTiles(
  machines: MachineView[],
  stitchesByMachine: Map<string, number> = new Map(),
  now = Date.now(),
): AndonTile[] {
  const tiles = machines
    .filter((machine) => !machine.identity.archived)
    .map((machine): AndonTile => {
      const { tone, reason } = andonTone(machine, now)
      const job = machine.telemetry?.job?.value ?? null
      const status = effectiveStatus(machine)
      const longStop = isLongStop(machine, now)
      return {
        id: machine.identity.id,
        name: machine.identity.name,
        assetTag: machine.identity.assetTag,
        zone: machine.identity.zone,
        siteId: machine.identity.siteId,
        tone,
        toneLabel: toneLabels[tone],
        toneSymbol: toneSymbols[tone],
        // Tone `alert` che mất việc máy đang đứng im: ô góc phải in "≥ 15 phút" mà không nói
        // đó là 15 phút của cái gì. Nói thẳng ra trong dòng lý do.
        reason: longStop && tone !== 'idle-long' ? `${reason} · máy đang dừng` : reason,
        statusLabel: statusLabels[status],
        connectionLabel: connectionLabels[machine.connection.state],
        ageSeconds: machine.connection.ageSeconds,
        rpm: machine.telemetry?.rpm?.value ?? null,
        progress: jobProgressPercent(machine),
        job: job?.fileName ?? null,
        product: job?.product ?? null,
        ...tileDuration(machine, tone, now),
        stitches: stitchesByMachine.get(machine.identity.id) ?? null,
        verified: machine.identity.verification.status === 'verified',
        stopped: status === 'stopped' || status === 'paused',
        longStop,
      }
    })

  // Sorted by urgency, then by name so a tile does not jump around between ticks; a board
  // whose tiles shuffle every five seconds is unreadable from a distance.
  return tiles.sort((left, right) =>
    toneRank[right.tone] - toneRank[left.tone] || left.name.localeCompare(right.name, 'vi'))
}

export interface AndonSummary {
  total: number
  running: number
  /**
   * Số ô KHÔNG bình thường: mọi tone trừ `running` và `idle` ngắn.
   *
   * Cố ý không đặt tên là "cần xử lý": tab Tổng quan đã có một con số mang tên đó với định
   * nghĩa hẹp hơn (`needsAttention` trong `lib/fleet`, không tính dữ liệu cũ và chưa rõ). Hai
   * con số khác nhau mà trùng tên là cách nhanh nhất để người xem mất niềm tin vào cả hai.
   */
  abnormal: number
  /** Máy bridge không đọc được trạng thái: dữ liệu cũ hoặc chưa rõ. Việc của IT, không phải tổ trưởng. */
  unreadable: number
  /** Dừng quá ngưỡng xưởng, đếm theo trạng thái máy chứ không theo tone (xem `AndonTile.longStop`). */
  longStop: number
  /** Dừng nhưng chưa quá ngưỡng: thay khung, thay chỉ, nghỉ giữa ca. */
  shortStop: number
  byTone: Record<AndonTone, number>
}

/** Tone nào là "chưa bình thường". `idle` ngắn và `running` thì không. */
const abnormalTones: AndonTone[] = ['fault', 'offline', 'alert', 'idle-long', 'stale', 'unknown']

export function andonSummary(tiles: AndonTile[]): AndonSummary {
  const byTone: Record<AndonTone, number> = {
    fault: 0, offline: 0, alert: 0, 'idle-long': 0, stale: 0, unknown: 0, idle: 0, running: 0,
  }
  for (const tile of tiles) byTone[tile.tone] += 1
  return {
    total: tiles.length,
    running: byTone.running,
    // Everything that is not confirmed running and not a short stop wants a human look.
    abnormal: abnormalTones.reduce((sum, tone) => sum + byTone[tone], 0),
    unreadable: byTone.stale + byTone.unknown,
    longStop: tiles.filter((tile) => tile.longStop).length,
    shortStop: tiles.filter((tile) => tile.stopped && !tile.longStop).length,
    byTone,
  }
}

/**
 * Bao nhiêu trang đầu đang chứa ô chưa bình thường.
 *
 * Bảng tự chuyển trang 15 giây một lần là hợp lý khi mọi máy đều chạy, nhưng nếu có máy đang
 * lỗi thì việc xoay sang trang khác đúng bằng việc giấu nó đi trong 45 giây. Tile đã được
 * sắp theo mức khẩn, nên các ô này luôn nằm ở những trang đầu: khi đang có sự cố, bảng chỉ
 * xoay trong khoảng này và nói rõ trên màn hình vì sao nó không chạy tiếp.
 *
 * Giữ trang theo nghĩa rộng (kể cả máy chưa đọc được) chứ không theo nghĩa hẹp của tab Tổng
 * quan: một máy im lặng trên tường cũng là thứ phải có người xem, chỉ là người khác.
 *
 * Trả `0` khi mọi ô đều bình thường — lúc đó cứ xoay hết bảng.
 */
export function attentionPages(tiles: AndonTile[], pageSize: number): number {
  const count = tiles.filter((tile) => abnormalTones.includes(tile.tone)).length
  return count === 0 ? 0 : pageCount(count, pageSize)
}

export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1
  return Math.max(1, Math.ceil(total / pageSize))
}

/** Clamps rather than wraps out-of-range pages: fewer machines must not blank the wall. */
export function pageOf<T>(items: T[], pageIndex: number, pageSize: number): T[] {
  if (pageSize <= 0) return items
  const pages = pageCount(items.length, pageSize)
  const index = Math.min(Math.max(pageIndex, 0), pages - 1)
  return items.slice(index * pageSize, index * pageSize + pageSize)
}

/** Sums the ledger rows for one business day into "stitches so far" per machine. */
export function stitchesByMachine(rows: { machineId: string; stitches: number }[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const row of rows) totals.set(row.machineId, (totals.get(row.machineId) ?? 0) + row.stitches)
  return totals
}

/** Kiosk header line: `?andon=1` has no tabs, so this is the only place it can say so. */
export function andonHeartbeat(lastMessageAt: string | null, timeZone?: string): string {
  return lastMessageAt ? `Tin gần nhất từ bridge lúc ${formatTime(lastMessageAt, timeZone)}` : 'Chưa nhận được tin nào từ bridge'
}
