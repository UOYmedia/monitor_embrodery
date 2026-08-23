/**
 * Cảnh báo SUY RA từ trạng thái kết nối và trạng thái máy.
 *
 * Nhóm này trước đây được tính trong trình duyệt, vì tuổi dữ liệu chạy tiếp giữa hai tin nhắn
 * bridge nên chỉ màn hình mới biết lúc này máy đã cũ bao lâu. Khi dashboard bị bỏ và sản phẩm
 * thành dịch vụ thuần API, để nguyên như vậy nghĩa là **API không phục vụ nhóm cảnh báo nào** và
 * mỗi bên tích hợp phải tự nghĩ lại toàn bộ logic — mỗi bên nghĩ một kiểu, và không ai kiểm được.
 *
 * Nên nó chuyển về đây, tính tại thời điểm phục vụ yêu cầu. Ba ranh giới giữ nguyên từ bản cũ:
 *
 *  1. **Không bao giờ ghi vào `machine.alerts`.** Đây là khung nhìn dựng thêm, không phải dữ liệu
 *     mới. Nhét vào đó sẽ lặng lẽ đổi màu bảng andon và đổi con số KPI của bên tích hợp.
 *  2. **Không xác nhận được.** Bridge chỉ nhận `acknowledge` cho alert id nó đang giữ (id lạ ⇒
 *     400). Một cảnh báo tự tắt khi máy trở lại thì không cần nút "đã xem".
 *  3. **Không suy ra trạng thái máy.** Mọi dòng đều bắt nguồn từ thứ bridge đã biết.
 */

const NHAN_LOI_TELEMETRY = {
  contract: 'sai hợp đồng dữ liệu',
  transport: 'lỗi đường truyền',
  policy: 'bị chính sách mạng chặn',
}

/** Trạng thái thật sự dùng được: mất kết nối thì ảnh chụp cũ không còn nói lên hiện tại. */
export function effectiveStatus(machine) {
  const { state } = machine.connection
  if (state === 'online' || state === 'stale') return machine.telemetry?.status?.value ?? 'unknown'
  return 'unknown'
}

export function statusDuration(machine, nowMs) {
  const since = machine.statusSince
  if (!since) return null
  const startedMs = Date.parse(since.at)
  if (!Number.isFinite(startedMs)) return null
  return { minutes: Math.max(0, (nowMs - startedMs) / 60_000), since: since.at, approximate: since.approximate }
}

function phut(value) {
  const n = Math.round(value)
  return n < 60 ? `${n} phút` : `${Math.floor(n / 60)} giờ ${n % 60} phút`
}

export function derivedAlerts(machine, nowMs = Date.now()) {
  const { identity, connection } = machine
  if (identity.archived) return []

  const alerts = []
  const status = effectiveStatus(machine)
  const keoDai = statusDuration(machine, nowMs)
  const mo = keoDai?.approximate ? 'ít nhất ' : ''

  if (status === 'fault') {
    alerts.push({
      id: 'state:fault',
      severity: 'critical',
      kind: 'connection',
      title: `${identity.name}: controller đang báo lỗi máy.`,
      detail: keoDai
        ? `Máy ở trạng thái lỗi ${mo}${phut(keoDai.minutes)}. Mã lỗi kèm theo (nếu controller có gửi) nằm ở dòng cảnh báo riêng trong \`alerts\`.`
        : 'Controller báo trạng thái lỗi. Chưa có mốc thời gian vào trạng thái này.',
      source: 'bridge',
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
      detail: connection.reason ?? 'Không rõ nguyên nhân mất kết nối.',
      source: 'bridge',
      since: connection.lastTelemetryAt ?? connection.lastReachableAt,
      acknowledged: null,
    })
  }

  // Máy `dial-in` KHÔNG BAO GIỜ chạm `offline` (bridge không thăm dò nó, nên `reachable` không
  // bao giờ thành false) — nó trôi sang `unknown`. Không có nhánh này thì con máy A15 duy nhất ở
  // xưởng mất tín hiệu mà API không nói một câu nào.
  if (connection.state === 'unknown' && identity.enabled && identity.adapterHasProtocol) {
    alerts.push({
      id: 'connection:unknown',
      severity: 'warning',
      kind: 'connection',
      title: `${identity.name}: chưa kết luận được máy có đang kết nối.`,
      detail: connection.reason ?? 'Không có ảnh chụp telemetry nào đủ mới để kết luận.',
      source: 'bridge',
      since: connection.lastTelemetryAt,
      acknowledged: null,
    })
  }

  if (machine.telemetryError) {
    const { kind, message, field, at } = machine.telemetryError
    alerts.push({
      id: 'telemetry:error',
      severity: 'warning',
      kind: 'connection',
      title: `${identity.name}: dữ liệu máy gửi về không dùng được (${NHAN_LOI_TELEMETRY[kind] ?? kind}).`,
      detail: `${message}${field ? ` · trường: ${field}` : ''} — ảnh chụp tốt gần nhất vẫn giữ nguyên và sẽ tự già đi.`,
      source: 'bridge',
      since: at,
      acknowledged: null,
    })
  }

  const nguong = machine.thresholds.stopEscalationMinutes
  if ((status === 'stopped' || status === 'paused') && keoDai && keoDai.minutes >= nguong) {
    alerts.push({
      id: 'state:idle-long',
      severity: 'warning',
      kind: 'connection',
      title: `${identity.name}: ${status === 'paused' ? 'tạm dừng' : 'đã dừng'} ${mo}${phut(keoDai.minutes)}.`,
      detail: `Quá ngưỡng ${nguong} phút của xưởng. Bridge không biết lý do dừng — controller chưa gửi mã lý do.`,
      source: 'bridge',
      since: machine.statusSince?.at ?? null,
      acknowledged: null,
    })
  }

  // Máy adapter `manual` không bao giờ được kỳ vọng trả lời, nên "dữ liệu cũ" của nó không phải
  // sự cố — đưa vào danh sách chỉ tạo tiếng ồn che mất máy thật sự im.
  if (connection.state === 'stale' && identity.adapterHasProtocol) {
    alerts.push({
      id: 'connection:stale',
      severity: 'info',
      kind: 'connection',
      title: `${identity.name}: số liệu đang cũ dần.`,
      detail: `Lần đọc gần nhất ${connection.ageSeconds}s trước (ngưỡng tươi ${machine.thresholds.freshSeconds}s). Việc của IT chứ chưa phải việc của tổ trưởng.`,
      source: 'bridge',
      since: connection.lastTelemetryAt,
      acknowledged: null,
    })
  }

  return alerts
}
