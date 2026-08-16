import type { Alert, AlertSeverity, ConnectionStateName, MachineView, OperationalStatus } from '../types/fleet'
import { compositionBucket, compositionLabel } from './composition'
import type { CompositionKey } from './composition'
import { isLongStop } from './derived'
import { effectiveStatus, refreshConnection } from './freshness'

export { effectiveStatus }

/**
 * Fleet aggregation, filtering and sorting.
 *
 * Pure functions over the machines the bridge sent, so a 100-machine site can be filtered
 * and re-sorted without asking the bridge anything and without re-rendering rows that did
 * not change.
 */

export const severityRank: Record<AlertSeverity, number> = { critical: 3, warning: 2, info: 1 }

export interface FleetFilter {
  search: string
  siteId: string | 'all'
  zone: string | 'all'
  connection: ConnectionStateName | 'all'
  /** `idle` = `stopped` hoặc `paused`, để chip KPI "Dừng" lọc đúng bằng con số nó in ra. */
  status: OperationalStatus | 'all' | 'idle'
  adapter: string | 'all'
  severity: AlertSeverity | 'all'
  verification: 'all' | 'verified' | 'unverified'
  /** Lọc dẫn xuất: máy dừng quá ngưỡng, hoặc máy sắp/quá hạn bảo trì. */
  escalation: 'all' | 'idle-long' | 'maintenance'
  /**
   * Lọc theo khúc trên thanh thành phần đội máy. Khác `status` ở chỗ mỗi máy chỉ thuộc **một**
   * khúc: máy đang chạy nhưng dữ liệu quá hạn nằm ở "Không đọc được", không nằm ở "Đang chạy".
   * Nhờ vậy số in trên nhãn khúc và số dòng sau khi bấm luôn bằng nhau.
   */
  tone: 'all' | CompositionKey
  /** Preset một chạm cho quản đốc: mọi thứ cần một người đến xem. */
  attention: boolean
  includeArchived: boolean
}

export const emptyFilter: FleetFilter = {
  search: '', siteId: 'all', zone: 'all', connection: 'all', status: 'all',
  adapter: 'all', severity: 'all', verification: 'all', escalation: 'all',
  tone: 'all', attention: false, includeArchived: false,
}

/**
 * Bấm-để-lọc: chip KPI và khúc trên thanh thành phần đều dùng chung hai hàm này, nên "bấm lần
 * nữa để gỡ" hành xử y hệt ở cả hai chỗ. Trước đây mỗi component tự viết một bản, và một bản
 * thiếu nhánh gỡ là người dùng bấm vào rồi không có đường ra.
 */
export function isFilterApplied(filter: FleetFilter, patch: Partial<FleetFilter>): boolean {
  return (Object.keys(patch) as (keyof FleetFilter)[]).every((key) => filter[key] === patch[key])
}

/** Đưa đúng những trường của `patch` về mặc định, không đụng trường khác. */
export function clearFilterPatch(patch: Partial<FleetFilter>): Partial<FleetFilter> {
  const cleared: Partial<FleetFilter> = {}
  for (const key of Object.keys(patch) as (keyof FleetFilter)[]) {
    if (key === 'escalation') cleared.escalation = 'all'
    else if (key === 'attention') cleared.attention = false
    else if (key === 'includeArchived') cleared.includeArchived = false
    else if (key === 'search') cleared.search = ''
    else Object.assign(cleared, { [key]: 'all' })
  }
  return cleared
}

/** Bật nếu chưa áp, gỡ nếu đang áp. */
export function toggleFilterPatch(filter: FleetFilter, patch: Partial<FleetFilter>): FleetFilter {
  return { ...filter, ...(isFilterApplied(filter, patch) ? clearFilterPatch(patch) : patch) }
}

export interface FleetKpi {
  verified: number
  unverified: number
  running: number
  idle: number
  /** Máy dừng quá `stopEscalationMinutes` — tập con của `idle`, không cộng thêm. */
  idleLong: number
  fault: number
  offline: number
  stale: number
  unknown: number
  criticalAlerts: number
  maintenanceDue: number
  archived: number
  /** Số máy cần một người tới xem. Đây là con số to nhất trên màn hình. */
  needsAttention: number
}

/** Re-ages every machine so the KPI reflects the clock, not the last message. */
export function ageFleet(machines: MachineView[], now = Date.now()): MachineView[] {
  return machines.map((machine) => {
    const connection = refreshConnection(machine, now)
    return connection.state === machine.connection.state && connection.ageSeconds === machine.connection.ageSeconds
      ? machine
      : { ...machine, connection }
  })
}

export function highestSeverity(alerts: Alert[]): AlertSeverity | null {
  return alerts.reduce<AlertSeverity | null>(
    (highest, alert) => (highest === null || severityRank[alert.severity] > severityRank[highest] ? alert.severity : highest),
    null,
  )
}

export function unacknowledgedAlerts(machine: MachineView): Alert[] {
  return machine.alerts.filter((alert) => !alert.acknowledged)
}

/**
 * KPI for one site or the whole fleet.
 * Only technician-verified machines count toward production numbers; unverified ones are
 * reported separately so nobody plans a shift around an unconfirmed device.
 */
export function summarize(machines: MachineView[], now = Date.now()): FleetKpi {
  const kpi: FleetKpi = {
    verified: 0, unverified: 0, running: 0, idle: 0, idleLong: 0, fault: 0, offline: 0,
    stale: 0, unknown: 0, criticalAlerts: 0, maintenanceDue: 0, archived: 0, needsAttention: 0,
  }
  for (const machine of machines) {
    if (machine.identity.archived) { kpi.archived += 1; continue }

    // Đếm trước khi lọc theo xác minh: một máy chưa xác minh mà đang báo lỗi thì vẫn có
    // người phải chạy tới. Con số "cần xử lý" mà bỏ sót nhóm này là con số nói dối.
    if (needsAttention(machine, now)) kpi.needsAttention += 1

    if (machine.identity.verification.status !== 'verified') { kpi.unverified += 1; continue }
    kpi.verified += 1

    if (machine.connection.state === 'offline') kpi.offline += 1
    else if (machine.connection.state === 'stale') kpi.stale += 1
    else if (machine.connection.state === 'unknown') kpi.unknown += 1

    const status = effectiveStatus(machine)
    if (status === 'running') kpi.running += 1
    else if (status === 'paused' || status === 'stopped') {
      kpi.idle += 1
      if (isLongStop(machine, now)) kpi.idleLong += 1
    } else if (status === 'fault') kpi.fault += 1

    kpi.criticalAlerts += machine.alerts.filter((alert) => alert.severity === 'critical' && !alert.acknowledged).length
    kpi.maintenanceDue += machine.maintenance.filter((plan) => plan.dueState === 'due' || plan.dueState === 'overdue').length
  }
  return kpi
}

/**
 * "Cần xử lý" = có người phải đến máy này.
 *
 * Cố ý KHÔNG gộp `stale` và `unverified` vào đây: dữ liệu cũ là việc của IT, máy chưa xác
 * minh là việc giấy tờ. Trộn vào sẽ làm con số to lên và mất nghĩa, rồi không ai nhìn nữa.
 */
export function needsAttention(machine: MachineView, now = Date.now()): boolean {
  if (machine.identity.archived) return false
  const status = effectiveStatus(machine)
  if (status === 'fault') return true
  if (machine.connection.state === 'offline' && machine.identity.enabled) return true
  if (unacknowledgedAlerts(machine).some((alert) => alert.severity === 'critical')) return true
  return isLongStop(machine, now)
}

export function hasMaintenanceDue(machine: MachineView): boolean {
  return machine.maintenance.some((plan) => plan.dueState === 'due' || plan.dueState === 'overdue')
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Search matches name, asset tag, IP, serial and zone, diacritics-insensitively. */
export function matchesSearch(machine: MachineView, search: string): boolean {
  const needle = normalize(search.trim())
  if (!needle) return true
  const haystack = [
    machine.identity.name, machine.identity.assetTag, machine.identity.ipAddress,
    machine.identity.serial ?? '', machine.identity.zone, machine.identity.model ?? '',
    machine.telemetry?.job?.value.fileName ?? '',
  ].map(normalize)
  return haystack.some((entry) => entry.includes(needle))
}

export function applyFilter(machines: MachineView[], filter: FleetFilter, now = Date.now()): MachineView[] {
  return machines.filter((machine) => {
    if (!filter.includeArchived && machine.identity.archived) return false
    if (filter.siteId !== 'all' && machine.identity.siteId !== filter.siteId) return false
    if (filter.zone !== 'all' && machine.identity.zone !== filter.zone) return false
    if (filter.connection !== 'all' && machine.connection.state !== filter.connection) return false
    if (filter.status !== 'all') {
      const status = effectiveStatus(machine)
      const matches = filter.status === 'idle' ? status === 'stopped' || status === 'paused' : status === filter.status
      if (!matches) return false
    }
    if (filter.adapter !== 'all' && machine.identity.adapter !== filter.adapter) return false
    if (filter.verification !== 'all' && machine.identity.verification.status !== filter.verification) return false
    if (filter.tone !== 'all' && compositionBucket(machine, now) !== filter.tone) return false
    if (filter.attention && !needsAttention(machine, now)) return false
    if (filter.escalation === 'idle-long' && !isLongStop(machine, now)) return false
    if (filter.escalation === 'maintenance' && !hasMaintenanceDue(machine)) return false
    if (filter.severity !== 'all') {
      const highest = highestSeverity(unacknowledgedAlerts(machine))
      if (highest === null || severityRank[highest] < severityRank[filter.severity]) return false
    }
    return matchesSearch(machine, filter.search)
  })
}

export type SortKey = 'attention' | 'name' | 'assetTag' | 'zone' | 'lastSeen' | 'progress' | 'maintenance'

/**
 * Attention first: fault, critical alert, offline, then a long stop — a machine that has been
 * stopped past the workshop's threshold outranks a warning and outranks stale data, because
 * it is idle capacity right now while stale data is only a reading problem.
 */
function attentionScore(machine: MachineView, now: number): number {
  const status = effectiveStatus(machine)
  if (status === 'fault') return 0
  const highest = highestSeverity(unacknowledgedAlerts(machine))
  if (highest === 'critical') return 1
  if (machine.connection.state === 'offline') return 2
  if (isLongStop(machine, now)) return 3
  if (highest === 'warning') return 4
  if (machine.connection.state === 'stale') return 5
  if (machine.connection.state === 'unknown') return 6
  if (status === 'paused' || status === 'stopped') return 7
  return 8
}

/**
 * Quá hạn trước, rồi sắp đến hạn, rồi còn hạn theo số mũi còn lại; chưa đủ dữ liệu xuống cuối.
 *
 * Mốc "không có kế hoạch nào" phải là số hữu hạn: `Infinity - Infinity = NaN`, và một hàm so
 * sánh trả NaN làm thứ tự sắp xếp thành không xác định — hai máy chưa đặt bảo trì sẽ nhảy chỗ.
 */
const noMaintenance = Number.MAX_SAFE_INTEGER

function maintenanceScore(machine: MachineView): number {
  let best = noMaintenance
  for (const plan of machine.maintenance) {
    if (plan.dueState === 'unknown' || plan.remainingStitches === null) continue
    best = Math.min(best, plan.remainingStitches)
  }
  return best
}

function progressOf(machine: MachineView): number {
  const job = machine.telemetry?.job?.value
  if (!job || job.currentStitch === null || !job.totalStitches) return -1
  return job.currentStitch / job.totalStitches
}

const collator = new Intl.Collator('vi')

export function sortMachines(machines: MachineView[], key: SortKey, direction: 'asc' | 'desc' = 'asc', now = Date.now()): MachineView[] {
  const factor = direction === 'asc' ? 1 : -1
  const compare = (a: MachineView, b: MachineView): number => {
    switch (key) {
      case 'name': return collator.compare(a.identity.name, b.identity.name) * factor
      case 'assetTag': return collator.compare(a.identity.assetTag, b.identity.assetTag) * factor
      case 'zone': return (collator.compare(a.identity.zone, b.identity.zone) || collator.compare(a.identity.name, b.identity.name)) * factor
      case 'progress': return (progressOf(a) - progressOf(b)) * factor
      case 'lastSeen': {
        const left = a.connection.lastTelemetryAt ? Date.parse(a.connection.lastTelemetryAt) : 0
        const right = b.connection.lastTelemetryAt ? Date.parse(b.connection.lastTelemetryAt) : 0
        return (left - right) * factor
      }
      case 'maintenance': return (maintenanceScore(a) - maintenanceScore(b)) * factor
      default: {
        const score = attentionScore(a, now) - attentionScore(b, now)
        return (score || collator.compare(a.identity.name, b.identity.name)) * factor
      }
    }
  }
  return [...machines].sort(compare)
}

/**
 * Bộ lọc đang áp, dạng token gỡ được.
 *
 * Bộ lọc giấu trong popover là cách một quản đốc nhìn 3 máy và tưởng xưởng chỉ còn 3 máy.
 * Mọi điều kiện đang áp phải hiện thành chữ ngay cạnh bảng, kèm cách gỡ.
 */
export interface FilterToken {
  key: string
  label: string
  /** Phần cần ghi đè để gỡ đúng điều kiện này, không đụng các điều kiện khác. */
  clear: Partial<FleetFilter>
}

export function describeFilter(filter: FleetFilter, labels: {
  site: (id: string) => string
  status: (value: OperationalStatus | 'idle') => string
  connection: (value: ConnectionStateName) => string
  adapter: (value: string) => string
  severity: (value: AlertSeverity) => string
}): FilterToken[] {
  const tokens: FilterToken[] = []
  if (filter.attention) tokens.push({ key: 'attention', label: 'Cần xử lý', clear: { attention: false } })
  if (filter.search.trim()) tokens.push({ key: 'search', label: `Tìm: "${filter.search.trim()}"`, clear: { search: '' } })
  if (filter.siteId !== 'all') tokens.push({ key: 'site', label: `Xưởng: ${labels.site(filter.siteId)}`, clear: { siteId: 'all', zone: 'all' } })
  if (filter.zone !== 'all') tokens.push({ key: 'zone', label: `Khu vực: ${filter.zone}`, clear: { zone: 'all' } })
  if (filter.connection !== 'all') tokens.push({ key: 'connection', label: `Kết nối: ${labels.connection(filter.connection)}`, clear: { connection: 'all' } })
  if (filter.status !== 'all') tokens.push({ key: 'status', label: `Trạng thái: ${labels.status(filter.status)}`, clear: { status: 'all' } })
  if (filter.tone !== 'all') tokens.push({ key: 'tone', label: `Nhóm: ${compositionLabel[filter.tone]}`, clear: { tone: 'all' } })
  if (filter.escalation === 'idle-long') tokens.push({ key: 'escalation', label: 'Dừng lâu', clear: { escalation: 'all' } })
  if (filter.escalation === 'maintenance') tokens.push({ key: 'escalation', label: 'Bảo trì đến hạn', clear: { escalation: 'all' } })
  if (filter.adapter !== 'all') tokens.push({ key: 'adapter', label: `Adapter: ${labels.adapter(filter.adapter)}`, clear: { adapter: 'all' } })
  if (filter.severity !== 'all') tokens.push({ key: 'severity', label: `Cảnh báo từ: ${labels.severity(filter.severity)}`, clear: { severity: 'all' } })
  if (filter.verification !== 'all') {
    tokens.push({
      key: 'verification',
      label: filter.verification === 'verified' ? 'Đã xác minh' : 'Chưa xác minh',
      clear: { verification: 'all' },
    })
  }
  if (filter.includeArchived) tokens.push({ key: 'archived', label: 'Kể cả máy đã lưu trữ', clear: { includeArchived: false } })
  return tokens
}

export function distinctZones(machines: MachineView[], siteId: string | 'all'): string[] {
  const zones = new Set<string>()
  for (const machine of machines) {
    if (siteId === 'all' || machine.identity.siteId === siteId) zones.add(machine.identity.zone)
  }
  return [...zones].sort(collator.compare)
}

/**
 * Phần trăm tiến độ, KHÔNG kẹp trần 100%.
 *
 * Kẹp trần là cách che một bộ đếm hỏng. Chỗ hiển thị dùng `jobProgress()` trong `derived.ts`
 * để biết khi nào vượt tổng và in chữ cảnh báo thay vì thanh đầy.
 */
export function jobProgressPercent(machine: MachineView): number | null {
  const job = machine.telemetry?.job?.value
  if (!job || job.currentStitch === null || !job.totalStitches) return null
  return Math.round((job.currentStitch / job.totalStitches) * 100)
}
