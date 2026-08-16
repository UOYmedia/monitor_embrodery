/**
 * Mirror of the bridge's v2 view model (`bridge/lib/bridge-service.mjs`).
 *
 * Every value the controller reports arrives as a `Reading`, so the UI always has the
 * timestamp and provenance it needs to say when something was last true — or to say
 * "Chưa đọc được từ controller" when the adapter never read it.
 */

export const SCHEMA_VERSION = 2

export type OperationalStatus = 'running' | 'paused' | 'stopped' | 'fault' | 'unknown'
export type ConnectionStateName = 'online' | 'stale' | 'offline' | 'unknown'
export type AlertSeverity = 'info' | 'warning' | 'critical'
export type AlertSource = 'controller' | 'bridge' | 'dashboard'
/** `dial-in` là máy tự gọi vào bridge (Dahao C44 Server IP / C41 Server Port), bridge không poll. */
export type AdapterKind = 'manual' | 'http-json' | 'tcp-json-line' | 'dial-in'
export type Role = 'viewer' | 'technician' | 'admin'
export type VerificationStatus = 'verified' | 'unverified'

export interface Reading<T> {
  value: T
  observedAt: string
  source: string
  quality: 'verified'
}

export interface ShiftDefinition {
  id: string
  name: string
  start: string
  end: string
}

export interface Site {
  id: string
  name: string
  timeZone: string
  allowedCidrs: string[]
  freshSeconds: number
  staleSeconds: number
  /** Dừng liên tục quá bấy nhiêu phút thì dashboard gọi là "DỪNG LÂU". */
  stopEscalationMinutes: number
  /** Ngưỡng cảnh báo đứt chỉ, lần/1.000 mũi. `null` = xưởng chưa đặt, chỉ hiển thị số đo. */
  threadBreakWarnPer1000: number | null
  shifts: ShiftDefinition[]
  /** Đơn giá khoán mặc định của xưởng, VND cho 1.000 mũi. `null` = chưa đặt. */
  pricePer1000Stitches: number | null
}

export interface Verification {
  status: VerificationStatus
  verifiedAt: string | null
  verifiedBy: string | null
  evidence: 'mac' | 'serial' | 'assetTag' | null
}

export interface MachineIdentity {
  id: string
  assetTag: string
  name: string
  siteId: string
  siteName: string
  zone: string
  model: string | null
  serial: string | null
  ipAddress: string
  macAddress: string | null
  adapter: AdapterKind
  adapterHasProtocol: boolean
  /** Đơn giá khoán riêng của máy này; đè lên đơn giá của site. `null` = dùng của site. */
  pricePer1000Stitches: number | null
  verification: Verification
  enabled: boolean
  archived: boolean
  note: string | null
  migratedFrom: string | null
  migrationError: string | null
  createdAt: string
  updatedAt: string
  updatedBy: string
}

export interface PollDiagnostics {
  failures: number
  breakerOpen: boolean
  breakerOpensForMs: number
  nextPollInMs: number
  lastError: string | null
}

export interface ConnectionInfo {
  state: ConnectionStateName
  reason: string
  ageSeconds: number | null
  lastTelemetryAt: string | null
  lastReachableAt: string | null
  lastCheckedAt: string | null
  reachable: boolean | null
  poll: PollDiagnostics
}

export interface JobReading {
  fileName: string | null
  product: string | null
  needle: number | null
  threadColor: string | null
  currentStitch: number | null
  totalStitches: number | null
  elapsedSeconds: number | null
}

export interface ControllerDesign {
  id: string
  name: string
  slot: number | null
  totalStitches: number | null
  colorChanges: number | null
  bounds: { minX: number; maxX: number; minY: number; maxY: number } | null
}

export interface ControllerReadout {
  observedAt: string
  source: string
  quality: string
  selectedDesign: (Omit<ControllerDesign, 'id' | 'name'> & { id: string | null; name: string | null }) | null
  designCount: number | null
  designs: ControllerDesign[] | null
  frame: { width: number; height: number } | null
  network: { transport: 'wifi' | 'ethernet'; band: string | null; signalPercent: number | null; ssid: string | null } | null
  firmware: string | null
  hoopName: string | null
}

export interface ControllerEvent {
  id: string
  occurredAt: string
  code: string
  severity: AlertSeverity
  message: string | null
  needle: number | null
  source: 'controller'
  observedAt: string
}

export interface TelemetrySnapshot {
  schemaVersion: number
  machineId: string
  observedAt: string
  receivedAt: string
  source: string
  status: Reading<OperationalStatus>
  rpm: Reading<number> | null
  rpmHistory: Reading<number[]> | null
  job: Reading<JobReading> | null
  needlePosition: Reading<{ x: number; y: number }> | null
  odometer: Reading<number> | null
  threadBreakWindow: Reading<{ needle: number | null; breaks: number; stitches: number }> | null
  controller: ControllerReadout | null
  events: ControllerEvent[]
}

export interface TelemetryError {
  message: string
  at: string
  kind: 'contract' | 'transport' | 'policy'
  field: string | null
}

export interface Acknowledgement {
  at: string
  by: string
  note: string | null
}

export interface MaintenanceView {
  id: string
  title: string
  intervalStitches: number
  lastServiceOdometer: number | null
  lastServiceAt: string | null
  lastServiceBy: string | null
  history: { at: string; by: string; odometer: number; note: string | null }[]
  consumedStitches: number | null
  remainingStitches: number | null
  dueState: 'ok' | 'due' | 'overdue' | 'unknown'
  reason: string | null
}

export interface Alert {
  id: string
  severity: AlertSeverity
  kind: 'controller-event' | 'thread-break-rate' | 'maintenance' | 'connection'
  title: string
  detail: string
  source: AlertSource
  since: string | null
  acknowledged: Acknowledgement | null
}

/**
 * Khi `status` của controller đổi lần gần nhất, do bridge ghi lại giữa hai snapshot.
 *
 * `approximate` = snapshot đầu tiên bridge thấy sau khi khởi động: máy nhiều khả năng đã ở
 * trạng thái đó từ trước, nên giao diện phải nói "ít nhất từ …" chứ không khẳng định mốc.
 */
export interface StatusSince {
  status: OperationalStatus
  at: string
  approximate: boolean
}

export interface MachineThresholds {
  freshSeconds: number
  staleSeconds: number
  stopEscalationMinutes: number
  threadBreakWarnPer1000: number | null
}

export interface MachineView {
  schemaVersion: number
  identity: MachineIdentity
  connection: ConnectionInfo
  thresholds: MachineThresholds
  statusSince: StatusSince | null
  telemetry: TelemetrySnapshot | null
  telemetryError: TelemetryError | null
  maintenance: MaintenanceView[]
  alerts: Alert[]
}

export interface SessionSummary {
  actor: string
  role: Role | null
  authMode: 'single-admin' | 'token'
  authenticated: boolean
  permissions: string[]
}

export interface BridgeHealth {
  status: string
  schemaVersion: number
  startedAt: string
  serverTime: string
  lastPollAt: string | null
  bridge: {
    host: string
    port: number
    websocketPath: string
    pollIntervalMs: number
    pollConcurrency: number
    maxBatchPairing: number
    maxMachines: number
    authMode: 'single-admin' | 'token'
  }
  sites: Site[]
  counts: { machines: number; archived: number; verified: number; withTelemetry: number; breakersOpen: number }
  migrationWarnings: string[]
  session?: SessionSummary
}

/** One TCP-open host. Deliberately never described as a Dahao machine. */
export interface DiscoveredDevice {
  ipAddress: string
  openPorts: number[]
  macAddress: string | null
  seenAt: string
  siteId: string
  classification: 'unverified-device'
}

export interface ScanResult {
  siteId: string
  cidr: string
  hostsScanned: number
  portsScanned: number[]
  results: DiscoveredDevice[]
  notice: string
}

export interface AuditEntry {
  id: string
  at: string
  actor: string
  role: string
  action: string
  targetType: string | null
  targetId: string | null
  result: string
  correlationId: string | null
  remote: string | null
  message: string | null
  before: unknown
  after: unknown
}

/** Một dòng sản lượng: một máy, một ca, một ngày làm việc theo giờ của site. */
export interface ProductionRow {
  key: string
  date: string
  shiftId: string
  shiftName: string
  machineId: string
  machineName: string | null
  assetTag: string | null
  zone: string | null
  siteId: string | null
  siteName: string | null
  stitches: number
  runSeconds: number
  readings: number
  resets: number
  anomalies: number
  firstAt: string | null
  lastAt: string | null
  archived: boolean | null
  machineMissing: boolean
  verified: boolean
  pricePer1000Stitches: number | null
  amount: number | null
  countedInTotals: boolean
}

export interface ProductionReport {
  schemaVersion: number
  range: { from: string; to: string }
  generatedAt: string
  timeZone: string | null
  shifts: ShiftDefinition[]
  rows: ProductionRow[]
  totals: {
    machines: number
    stitches: number
    runSeconds: number
    amount: number
    rowsWithoutPrice: number
    anomalies: number
  }
  excluded: { unverifiedRows: number; reason: string }
}

export type SocketMessage =
  | { type: 'hello'; schemaVersion: number; serverTime: string; session: SessionSummary; heartbeatSeconds: number }
  | { type: 'fleet_state'; schemaVersion: number; revision: number; at: string; sites: Site[]; machines: MachineView[] }
  | { type: 'machine_update'; schemaVersion: number; revision: number; at: string; machine: MachineView }
  | { type: 'machine_removed'; schemaVersion: number; revision: number; at: string; machineId: string }
