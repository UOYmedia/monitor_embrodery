/**
 * Sổ thời gian ngừng máy — phần logic thuần, tách khỏi service để kiểm thử riêng.
 *
 * Vì sao cần: cảnh báo "máy lỗi 12 phút" mà dashboard hiện ra chỉ được tính lại mỗi nhịp trong
 * tab trình duyệt (xem `src/lib/alerts.ts`), F5 là mất và không ai mở dashboard lúc 2 giờ sáng
 * thì không còn dấu vết gì. Bridge mới là thứ chạy 24/7, nên chính bridge phải GHI lại: máy nào
 * vào lỗi lúc nào, và khi thoát ra thì đã ngừng bao lâu.
 *
 * "Ngừng" gồm ba trạng thái controller báo: `fault` (lỗi), `stopped`, `paused`. `fault` được ghi
 * NGAY vì mọi lỗi đều đáng lần theo. Còn dừng thường (thay khung, thay chỉ, nghỉ giữa ca) chỉ
 * thành một dòng đáng ghi khi kéo dài quá ngưỡng xưởng — nếu không, mỗi lần thay chỉ 90 giây lại
 * đẻ một dòng và sổ ngừng máy biến thành tiếng ồn che mất đúng cái lần dừng thật sự cần chú ý.
 */

export const DOWNTIME_STATUSES = new Set(['fault', 'stopped', 'paused'])

export function isDowntime(status) {
  return DOWNTIME_STATUSES.has(status)
}

/** `fault` đáng ghi ngay; các trạng thái dừng khác phải chờ vượt ngưỡng xưởng. */
export function isImmediateDowntime(status) {
  return status === 'fault'
}

/**
 * Sự kiện đáng nêu tên nhất đi kèm lúc máy vào lỗi: ưu tiên `critical`, trong cùng mức thì lấy
 * cái mới nhất. Trả `null` khi controller không gửi kèm mã nào — khi đó dòng ghi chỉ nói "máy
 * lỗi", tuyệt đối không bịa ra một mã lỗi không có thật.
 */
export function latestSignificantEvent(events = []) {
  let best = null
  for (const event of events) {
    if (!event || event.severity === 'info') continue
    if (!best) { best = event; continue }
    const eventCritical = event.severity === 'critical'
    const bestCritical = best.severity === 'critical'
    if (eventCritical !== bestCritical) {
      if (eventCritical) best = event
      continue
    }
    if (Date.parse(event.occurredAt) >= Date.parse(best.occurredAt)) best = event
  }
  return best
}

/**
 * "12 phút 30 giây", "45 giây", "2 giờ 5 phút" — đọc cho người ở xưởng, không phải một chuỗi ISO.
 * Trả `null` khi không tính được (thiếu mốc thời gian), để chỗ gọi nói "không rõ" thay vì "0 giây".
 */
export function formatSpokenDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return null
  const seconds = Math.round(totalSeconds)
  if (seconds < 60) return `${seconds} giây`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    const rest = seconds % 60
    return rest ? `${minutes} phút ${rest} giây` : `${minutes} phút`
  }
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes ? `${hours} giờ ${restMinutes} phút` : `${hours} giờ`
}

/**
 * Số giây giữa hai mốc ISO, làm tròn và không âm. `null` khi một trong hai mốc không đọc được —
 * thà báo "không rõ thời lượng" còn hơn ghi một con số bịa.
 */
export function durationSeconds(fromIso, toIso) {
  const fromMs = Date.parse(fromIso)
  const toMs = Date.parse(toIso)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null
  return Math.max(0, Math.round((toMs - fromMs) / 1000))
}
