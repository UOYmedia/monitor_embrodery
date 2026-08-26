import type { Alert, AlertSeverity, MachineView } from '../types/fleet'
import { formatMinutes, isLongStop, offlineReason, statusDuration } from './derived'
import { effectiveStatus, severityRank } from './fleet'
import { formatAge, statusLabels } from './format'

/**
 * Trung tâm cảnh báo: gom cảnh báo của cả đội máy về một danh sách.
 *
 * Vì sao cần, khi mỗi máy đã có tab *Cảnh báo* riêng: một quản đốc không mở 30 panel chi
 * tiết để biết xưởng đang có chuyện gì. Cảnh báo nằm rải trong từng máy là cảnh báo không
 * ai đọc.
 *
 * Ba ranh giới của module này:
 *
 *  1. **Không bao giờ ghi vào `machine.alerts`.** Danh sách dưới đây là một *khung nhìn*
 *     dựng thêm, không phải dữ liệu mới. `andonTone()` và `summarize()` đọc thẳng
 *     `machine.alerts`; nhét cảnh báo dashboard vào đó sẽ lặng lẽ đổi màu bảng andon và đổi
 *     con số KPI mà không ai yêu cầu.
 *  2. **Cảnh báo do dashboard suy ra thì không xác nhận được.** Bridge chỉ nhận `acknowledge`
 *     cho alert id nó đang giữ (`bridge-service.mjs`: alert lạ ⇒ 400). Một nút "đã xem" chỉ
 *     sống trong tab trình duyệt là nút nói dối: người bên cạnh không thấy, F5 là mất. Nhóm
 *     này tự tắt khi máy hết mất kết nối / hết dừng lâu — đúng bản chất của nó.
 *  3. **Không suy ra trạng thái máy.** Mọi dòng ở đây đều bắt nguồn từ một thứ bridge đã
 *     nói: trạng thái controller báo, tuổi dữ liệu, hoặc lỗi hợp đồng bridge ghi lại.
 */

export interface FleetAlert {
  /** Khoá duy nhất toàn đội. Dùng làm khoá React và làm mốc "đã thấy" cho thông báo nổi. */
  key: string
  machineId: string
  machineName: string
  assetTag: string
  zone: string
  siteId: string
  alert: Alert
  /** Bridge có giữ cảnh báo này không — quyết định có hiện nút "Xác nhận đã xem" hay không. */
  acknowledgeable: boolean
}

const telemetryErrorLabels: Record<string, string> = {
  contract: 'sai hợp đồng dữ liệu',
  transport: 'lỗi đường truyền',
  policy: 'bị chính sách mạng chặn',
}

/**
 * Cảnh báo dashboard tự dựng từ trạng thái kết nối và trạng thái máy.
 *
 * `alerts.mjs` phía bridge cố ý không sinh nhóm này: tuổi dữ liệu chạy tiếp giữa hai tin
 * nhắn bridge, nên chỉ trình duyệt mới biết lúc này máy đã cũ bao lâu.
 */
export function derivedAlerts(machine: MachineView, nowMs: number, timeZone?: string): Alert[] {
  const { identity, connection } = machine
  if (identity.archived) return []

  const alerts: Alert[] = []
  const status = effectiveStatus(machine)
  const duration = statusDuration(machine, nowMs)

  if (status === 'fault') {
    alerts.push({
      id: 'state:fault',
      severity: 'critical',
      kind: 'connection',
      title: `${identity.name}: controller đang báo lỗi máy.`,
      detail: duration
        ? `Máy ở trạng thái lỗi ${duration.approximate ? 'ít nhất ' : ''}${formatMinutes(duration.minutes)}. Mã lỗi kèm theo (nếu controller có gửi) nằm ở dòng cảnh báo riêng.`
        : 'Controller báo trạng thái lỗi. Chưa có mốc thời gian vào trạng thái này.',
      source: 'dashboard',
      since: machine.statusSince?.at ?? null,
      acknowledged: null,
    })
  }

  // Máy đã tắt trong sổ tài sản thì im lặng là đúng: nó không được kỳ vọng trả lời.
  if (connection.state === 'offline' && identity.enabled) {
    alerts.push({
      id: 'connection:offline',
      severity: 'critical',
      kind: 'connection',
      title: `${identity.name}: bridge không đọc được máy.`,
      detail: offlineReason(machine, timeZone) ?? connection.reason ?? 'Không rõ nguyên nhân mất kết nối.',
      source: 'dashboard',
      since: connection.lastTelemetryAt ?? connection.lastReachableAt,
      acknowledged: null,
    })
  }

  // Bridge nhận được byte nhưng không dựng được ảnh chụp — đúng tình huống của một
  // controller Dahao gọi vào khi chưa có bộ giải mã. Lỗi này không được im lặng.
  if (machine.telemetryError) {
    const { kind, message, field, at } = machine.telemetryError
    alerts.push({
      id: 'telemetry:error',
      severity: 'warning',
      kind: 'connection',
      title: `${identity.name}: dữ liệu máy gửi về không dùng được (${telemetryErrorLabels[kind] ?? kind}).`,
      detail: `${message}${field ? ` · trường: ${field}` : ''} — ảnh chụp tốt gần nhất vẫn giữ nguyên và sẽ tự già đi.`,
      source: 'dashboard',
      since: at,
      acknowledged: null,
    })
  }

  if (isLongStop(machine, nowMs) && duration) {
    alerts.push({
      id: 'state:idle-long',
      severity: 'warning',
      kind: 'connection',
      title: `${identity.name}: ${statusLabels[status].toLowerCase()} ${duration.approximate ? 'ít nhất ' : ''}${formatMinutes(duration.minutes)}.`,
      detail: `Quá ngưỡng ${machine.thresholds.stopEscalationMinutes} phút của xưởng. Dashboard không biết lý do dừng — controller chưa gửi mã lý do.`,
      source: 'dashboard',
      since: machine.statusSince?.at ?? null,
      acknowledged: null,
    })
  }

  // Máy adapter `manual` không bao giờ được kỳ vọng trả lời, nên "dữ liệu cũ" của nó không
  // phải sự cố — đưa vào danh sách chỉ tạo tiếng ồn che mất máy thật sự im.
  if (connection.state === 'stale' && identity.adapterHasProtocol) {
    alerts.push({
      id: 'connection:stale',
      severity: 'info',
      kind: 'connection',
      title: `${identity.name}: số liệu đang cũ dần.`,
      detail: `Lần đọc gần nhất ${formatAge(connection.ageSeconds)} (ngưỡng tươi ${machine.thresholds.freshSeconds}s). Việc của IT chứ chưa phải việc của tổ trưởng.`,
      source: 'dashboard',
      since: connection.lastTelemetryAt,
      acknowledged: null,
    })
  }

  return alerts
}

function toFleetAlert(machine: MachineView, alert: Alert, acknowledgeable: boolean): FleetAlert {
  return {
    key: `${machine.identity.id}::${alert.id}`,
    machineId: machine.identity.id,
    machineName: machine.identity.name,
    assetTag: machine.identity.assetTag,
    zone: machine.identity.zone,
    siteId: machine.identity.siteId,
    alert,
    acknowledgeable,
  }
}

/** Cảnh báo bridge giữ (xác nhận được) + cảnh báo dashboard suy ra (không xác nhận được). */
export function machineAlerts(machine: MachineView, nowMs: number, timeZone?: string): FleetAlert[] {
  if (machine.identity.archived) return []
  return [
    ...machine.alerts.map((alert) => toFleetAlert(machine, alert, true)),
    ...derivedAlerts(machine, nowMs, timeZone).map((alert) => toFleetAlert(machine, alert, false)),
  ]
}

const collator = new Intl.Collator('vi')

function sinceMs(row: FleetAlert): number {
  const parsed = row.alert.since ? Date.parse(row.alert.since) : NaN
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Thứ tự: chưa xác nhận trước → nặng trước → mới trước → tên máy.
 *
 * "Mới trước" chứ không phải "cũ trước": danh sách này đọc như một dòng thông báo, thứ vừa
 * xảy ra phải nằm ngay chỗ mắt rơi vào. Thời lượng của mỗi dòng vẫn in ra nên cảnh báo kéo
 * dài không bị giấu — nó chỉ không tự leo lên đầu mỗi khi có việc mới hơn.
 */
export function alertFeed(machines: MachineView[], nowMs: number, timeZone?: string): FleetAlert[] {
  const rows = machines.flatMap((machine) => machineAlerts(machine, nowMs, timeZone))
  return rows.sort((left, right) =>
    Number(Boolean(left.alert.acknowledged)) - Number(Boolean(right.alert.acknowledged))
    || severityRank[right.alert.severity] - severityRank[left.alert.severity]
    || sinceMs(right) - sinceMs(left)
    || collator.compare(left.machineName, right.machineName))
}

export interface AlertDigest {
  /** Chưa xác nhận, theo mức. Đây là các con số đứng trên chuông. */
  critical: number
  warning: number
  info: number
  /** Tổng chưa xác nhận, không tính `info` — `info` không đòi ai làm gì. */
  open: number
  acknowledged: number
  total: number
  /** Bao nhiêu máy đang có ít nhất một cảnh báo chưa xác nhận. */
  machines: number
}

export function alertDigest(rows: FleetAlert[]): AlertDigest {
  const digest: AlertDigest = { critical: 0, warning: 0, info: 0, open: 0, acknowledged: 0, total: rows.length, machines: 0 }
  const machines = new Set<string>()
  for (const row of rows) {
    if (row.alert.acknowledged) { digest.acknowledged += 1; continue }
    digest[row.alert.severity] += 1
    if (row.alert.severity !== 'info') {
      digest.open += 1
      machines.add(row.machineId)
    }
  }
  digest.machines = machines.size
  return digest
}

/** Cảnh báo đáng gọi người: chưa xác nhận và không phải `info`. */
export function isActionable(row: FleetAlert): boolean {
  return !row.alert.acknowledged && row.alert.severity !== 'info'
}

/**
 * Cảnh báo vừa xuất hiện, so với tập đã thấy.
 *
 * `info` không bao giờ nổi lên thành thông báo: một máy trôi vào "dữ liệu cũ" mỗi lần mạng
 * chập là chuyện thường ngày, đẩy nó lên màn hình sẽ dạy người dùng bỏ qua mọi thông báo.
 */
export function newAlerts(seen: ReadonlySet<string>, rows: FleetAlert[]): FleetAlert[] {
  return rows.filter((row) => isActionable(row) && !seen.has(row.key))
}

export type AlertFilter = 'open' | 'all'

export function filterAlerts(rows: FleetAlert[], filter: AlertFilter, siteId: string | 'all'): FleetAlert[] {
  return rows.filter((row) => {
    if (siteId !== 'all' && row.siteId !== siteId) return false
    return filter === 'all' || isActionable(row)
  })
}

/**
 * Nhãn ngắn cho tiêu đề tab trình duyệt: đọc được cả khi tab bị thu nhỏ còn cái favicon.
 *
 * Nhận `open` chứ không nhận cả digest, để chỗ gọi lấy được một dependency ổn định — digest
 * là object mới sau mỗi nhịp 5 giây dù các con số không đổi.
 */
export function titleBadge(open: number, base: string): string {
  return open > 0 ? `(${open}) ${base}` : base
}

export const severityOrder: AlertSeverity[] = ['critical', 'warning', 'info']
