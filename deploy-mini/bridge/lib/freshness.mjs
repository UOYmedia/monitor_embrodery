/**
 * Connection semantics shared by the bridge and the dashboard.
 *
 * The four states are deliberately distinct and never inferred from each other:
 *   online  — telemetry newer than the site's fresh window.
 *   stale   — real telemetry exists but is older than the fresh window.
 *   offline — the bridge cannot reach the machine at all.
 *   unknown — no protocol is configured, or the host answers but returns nothing usable.
 *
 * A dropped TCP connection is never turned into `fault`. Only a controller can report a fault.
 *
 * A hand-typed reading is `unknown` too, however recent it is. `online` is a claim about the link
 * between bridge and machine, and a person typing a number proves only that the person was
 * standing there. Letting a manual entry paint a tile green would hide exactly the situation the
 * entry exists to work around.
 *
 * `src/lib/freshness.ts` mirrors this function so the dashboard can keep ageing a machine
 * between bridge messages. Both are covered by the same behaviour table in their tests.
 */
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
}) {
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

/** Per-field provenance: a value read long ago must not be presented as current. */
export function readingQuality(observedAt, { now = Date.now(), freshSeconds, staleSeconds }) {
  if (!observedAt) return 'unknown'
  const age = (now - Date.parse(observedAt)) / 1000
  if (!Number.isFinite(age)) return 'unknown'
  if (age <= freshSeconds) return 'verified'
  if (age <= staleSeconds) return 'stale'
  return 'stale'
}
