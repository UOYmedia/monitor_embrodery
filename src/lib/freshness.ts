import type { ConnectionInfo, ConnectionStateName, MachineView, OperationalStatus } from '../types/fleet'

/**
 * Dashboard-side mirror of `bridge/lib/freshness.mjs`.
 *
 * The bridge computes this too, but a snapshot keeps ageing between bridge messages: a
 * machine that was `online` when the message arrived is `offline` two minutes later even
 * though nothing new was received. Recomputing in the browser is what makes the age on
 * screen honest. The behaviour table in the tests is shared with the bridge module.
 *
 * That mirroring is why `telemetryQuality` is threaded through here as well: a hand-typed reading
 * must read `unknown` in the browser too, or the tile would go green a second after the bridge
 * said it should not.
 */
export interface FreshnessInput {
  enabled?: boolean
  hasProtocol: boolean
  lastTelemetryAt?: string | null
  lastReachableAt?: string | null
  reachable?: boolean | null
  lastError?: string | null
  telemetryQuality?: string | null
  now?: number
  freshSeconds: number
  staleSeconds: number
}

export interface FreshnessResult {
  state: ConnectionStateName
  ageSeconds: number | null
  reason: string
}

export function connectionState({
  enabled = true,
  hasProtocol,
  lastTelemetryAt = null,
  lastReachableAt = null,
  reachable = null,
  lastError = null,
  telemetryQuality = null,
  now = Date.now(),
  freshSeconds,
  staleSeconds,
}: FreshnessInput): FreshnessResult {
  const observedMs = lastTelemetryAt ? Date.parse(lastTelemetryAt) : null
  const ageSeconds = observedMs === null || Number.isNaN(observedMs) ? null : Math.max(0, Math.round((now - observedMs) / 1000))

  if (!enabled) return { state: 'unknown', ageSeconds, reason: 'Máy đang tắt theo dõi trong cấu hình bridge.' }
  // No protocol is the root reason, but if the number on screen was typed by a person, the same
  // sentence has to say so. The tile prints "Dữ liệu 9 phút trước" right under "no protocol to read
  // telemetry", and read as two separate sentences they contradict each other — so the reader
  // reconciles them by assuming the bridge did receive something nine minutes ago. It received
  // nothing. Someone was standing at the machine with a keyboard.
  if (!hasProtocol) {
    return {
      state: 'unknown',
      ageSeconds,
      reason: telemetryQuality === 'manual'
        ? 'Adapter manual: chưa có giao thức đọc telemetry từ controller — số đang hiện là số người gõ tay.'
        : 'Adapter manual: chưa có giao thức đọc telemetry từ controller.',
    }
  }
  if (telemetryQuality === 'manual') {
    return {
      state: 'unknown',
      ageSeconds,
      reason: ageSeconds === null
        ? 'Số mới nhất là số gõ tay, không phải máy tự khai.'
        : `Số mới nhất là số gõ tay ${ageSeconds}s trước, không phải máy tự khai — chưa kết luận được máy có kết nối.`,
    }
  }

  if (ageSeconds === null) {
    if (reachable === false) return { state: 'offline', ageSeconds, reason: 'Bridge không mở được cổng adapter tới máy.' }
    return { state: 'unknown', ageSeconds, reason: lastError ? `Adapter chưa trả dữ liệu hợp lệ: ${lastError}` : 'Chưa nhận được telemetry hợp lệ nào từ máy này.' }
  }
  if (ageSeconds <= freshSeconds) return { state: 'online', ageSeconds, reason: `Telemetry mới ${ageSeconds}s trước.` }
  if (ageSeconds <= staleSeconds) return { state: 'stale', ageSeconds, reason: `Telemetry cũ ${ageSeconds}s, quá ngưỡng ${freshSeconds}s.` }
  if (reachable === true) {
    return { state: 'unknown', ageSeconds, reason: `Host còn phản hồi cổng TCP nhưng adapter ngừng trả dữ liệu hợp lệ ${ageSeconds}s.` }
  }
  // Relative, never a raw ISO string: the reason is read by a person in the workshop, and
  // the absolute timestamp is displayed separately in the site's timezone.
  const unreachableSeconds = lastReachableAt ? Math.max(0, Math.round((now - Date.parse(lastReachableAt)) / 1000)) : null
  return {
    state: 'offline',
    ageSeconds,
    reason: unreachableSeconds === null || Number.isNaN(unreachableSeconds)
      ? `Không nhận được telemetry trong ${ageSeconds}s.`
      : `Mất liên lạc ${unreachableSeconds}s, lần cuối bridge còn gọi được máy này.`,
  }
}

/** Re-ages a machine the bridge sent earlier, without touching its telemetry. */
export function refreshConnection(machine: MachineView, now = Date.now()): ConnectionInfo {
  const result = connectionState({
    enabled: machine.identity.enabled && !machine.identity.archived,
    hasProtocol: machine.identity.adapterHasProtocol,
    lastTelemetryAt: machine.connection.lastTelemetryAt,
    lastReachableAt: machine.connection.lastReachableAt,
    reachable: machine.connection.reachable,
    lastError: machine.telemetryError?.message ?? null,
    telemetryQuality: machine.telemetry?.status.quality ?? null,
    now,
    freshSeconds: machine.thresholds.freshSeconds,
    staleSeconds: machine.thresholds.staleSeconds,
  })
  return { ...machine.connection, ...result }
}

/** Age of one reading, so a field read long ago is never shown as current. */
export function readingAgeSeconds(observedAt: string | null | undefined, now = Date.now()): number | null {
  if (!observedAt) return null
  const parsed = Date.parse(observedAt)
  return Number.isNaN(parsed) ? null : Math.max(0, Math.round((now - parsed) / 1000))
}

export function isReadingStale(observedAt: string | null | undefined, thresholds: { freshSeconds: number }, now = Date.now()): boolean {
  const age = readingAgeSeconds(observedAt, now)
  return age !== null && age > thresholds.freshSeconds
}

/**
 * Operational status only counts when telemetry is actually current.
 *
 * Lives here rather than in `fleet.ts` because the derived-value module needs it too, and a
 * cycle between those two modules is the kind of thing that breaks only in a production
 * build. "Đang chạy" from a machine we cannot reach is exactly the lie this prevents.
 */
export function effectiveStatus(machine: MachineView): OperationalStatus {
  if (machine.connection.state === 'online' || machine.connection.state === 'stale') {
    return machine.telemetry?.status.value ?? 'unknown'
  }
  return 'unknown'
}
