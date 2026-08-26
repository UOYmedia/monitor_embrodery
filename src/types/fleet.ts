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
export type AlertSource = 'controller' | 'sensor' | 'bridge' | 'dashboard'
/** `dial-in` là máy tự gọi vào bridge (Dahao C44 Server IP / C41 Server Port), bridge không poll. */
export type AdapterKind = 'manual' | 'http-json' | 'tcp-json-line' | 'dial-in'
export type Role = 'viewer' | 'technician' | 'admin'
export type VerificationStatus = 'verified' | 'unverified'

/**
 * Cách một con số ra đời. `verified` = máy tạo ra nó. `manual` = người đọc màn hình controller
 * rồi gõ vào. Xem `readingQualities` trong `bridge/lib/contract.mjs` — hai loại này đi vào cùng
 * một cột lương, nên nhãn phải đi kèm giá trị chứ không nằm ở chỗ khác.
 */
export type ReadingQuality = 'verified' | 'manual'

export interface Reading<T> {
  value: T
  observedAt: string
  source: string
  quality: ReadingQuality
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

/**
 * Một sự kiện do máy hoặc do node cảm biến gắn ngoài khai báo.
 *
 * `source` phân biệt hai thứ khác nhau về bản chất: controller biết **vì sao** nó dừng, còn cảm
 * biến ngoài chỉ biết **rằng** trục đã ngừng quay. Tên interface còn chữ `Controller` là di sản
 * từ lúc chỉ có một nguồn; đừng đọc nó thành "chỉ controller mới sinh ra được".
 */
export interface ControllerEvent {
  id: string
  occurredAt: string
  code: string
  severity: AlertSeverity
  message: string | null
  needle: number | null
  source: 'controller' | 'sensor'
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
  kind: 'controller-event' | 'sensor-event' | 'thread-break-rate' | 'maintenance' | 'connection'
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

/**
 * Số đọc gần nhất ĐÃ VÀO SỔ sản lượng, kèm việc nó do máy khai hay do người gõ.
 *
 * Khác `telemetry.odometer`: ảnh chụp telemetry giữ nguyên khi một khung tiếp theo bị lỗi hợp
 * đồng, còn con trỏ này chỉ dời khi một lượt đọc thật sự được ghi. Ô nhập tay tính chênh lệch
 * với con số này để cái người ta xác nhận trên màn hình đúng bằng cái sổ sẽ trừ.
 */
export interface CountedReading {
  odometer: number
  at: string
  quality: ReadingQuality
}

export interface MachineView {
  schemaVersion: number
  identity: MachineIdentity
  connection: ConnectionInfo
  thresholds: MachineThresholds
  statusSince: StatusSince | null
  lastCountedReading: CountedReading | null
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

/**
 * Một địa chỉ đã gọi vào cổng ingest — kể cả địa chỉ bị bridge từ chối.
 *
 * `machineId` là máy đã nhận kết nối lúc đó; `pairedMachineId` là máy đang khai ở địa chỉ
 * đó bây giờ. Vừa ghép máy xong mà controller chưa gọi lại thì hai giá trị này khác nhau,
 * và đó chính là lúc màn hình phải nói khác đi.
 */
export interface DialInCaller {
  remote: string
  firstSeenAt: string
  lastSeenAt: string
  connections: number
  framesAccepted: number
  framesUndecoded: number
  machineId: string | null
  accepted: boolean
  lastReason: string | null
  lastBytes: { bytes: number; hex: string; ascii: string; truncated: boolean; reason: string } | null
  pairedMachineId: string | null
  pairedMachineName: string | null
  pairedCount: number
}

/** Cổng "máy tự gọi vào": trạng thái cổng + các địa chỉ vừa gọi tới. */
export interface IngestStatus {
  enabled: boolean
  address: { host: string; port: number } | null
  capture: boolean
  connections: number
  openConnections: number
  framesAccepted: number
  framesUndecoded: number
  rejections: Record<string, number>
  lastFrameAt: string | null
  lastUndecodedAt: string | null
  maxCallers: number
  callers: DialInCaller[]
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

/** Kết quả đọc nhật ký: kèm `truncated` để giao diện không trình bày bản thiếu như bản đủ. */
export interface AuditPage {
  entries: AuditEntry[]
  truncated: boolean
  scannedSegments: number
  totalSegments: number
}

/** Một file nhật ký trên đĩa: file đang ghi (`active`) hoặc một mảnh đã xoay vòng. */
export interface AuditSegment {
  name: string
  bytes: number
  modifiedAt: string
  /** `null` với mảnh đang ghi — nó chưa xoay vòng. */
  rotatedAt: string | null
  active: boolean
}

/**
 * Chính sách giữ nhật ký đang có hiệu lực, đọc từ `bridge.config.json`.
 *
 * Chỉ đọc: dashboard hiển thị và giải thích, không sửa. Một màn hình có thể tự rút ngắn hạn
 * giữ nhật ký kiểm toán thì nhật ký đó không còn dùng làm bằng chứng được nữa.
 */
export interface AuditRetention {
  maxBytes: number
  /** `null` = giữ mãi. */
  retentionDays: number | null
  segments: AuditSegment[]
  totalBytes: number
  oldestAt: string | null
  /** Tên các mảnh sẽ bị xoá ở lần dọn tới. */
  expiring: string[]
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
  /** Mũi do máy tự khai. */
  stitches: number
  /** Mũi do người gõ tay. Tách riêng tới cùng: không cột nào cộng hai số này mà không nói ra. */
  manualStitches: number
  runSeconds: number
  readings: number
  manualReadings: number
  resets: number
  anomalies: number
  firstAt: string | null
  lastAt: string | null
  archived: boolean | null
  machineMissing: boolean
  verified: boolean
  pricePer1000Stitches: number | null
  /** `stitches + manualStitches` — cơ sở tính tiền, và là chỗ duy nhất hai làn được cộng lại. */
  stitchesBilled: number
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
    manualStitches: number
    stitchesBilled: number
    runSeconds: number
    amount: number
    rowsWithoutPrice: number
    rowsWithManualEntry: number
    anomalies: number
  }
  excluded: { unverifiedRows: number; reason: string }
}

export type SocketMessage =
  | { type: 'hello'; schemaVersion: number; serverTime: string; session: SessionSummary; heartbeatSeconds: number }
  | { type: 'fleet_state'; schemaVersion: number; revision: number; at: string; sites: Site[]; machines: MachineView[] }
  | { type: 'machine_update'; schemaVersion: number; revision: number; at: string; machine: MachineView }
  | { type: 'machine_removed'; schemaVersion: number; revision: number; at: string; machineId: string }
