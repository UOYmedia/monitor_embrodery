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

import { isIsoTimestamp } from './contract.mjs'

export const DOWNTIME_STATUSES = new Set(['fault', 'stopped', 'paused'])

export function isDowntime(status) {
  return DOWNTIME_STATUSES.has(status)
}

/** `fault` đáng ghi ngay; các trạng thái dừng khác phải chờ vượt ngưỡng xưởng. */
export function isImmediateDowntime(status) {
  return status === 'fault'
}

/** Mốc không đọc được thì coi như CŨ NHẤT, đừng để nó chặn một sự kiện thật đến sau. */
const MOC_KHONG_DOC_DUOC = -Infinity

function mocSuKien(event) {
  const ms = Date.parse(event.occurredAt)
  return Number.isFinite(ms) ? ms : MOC_KHONG_DOC_DUOC
}

/**
 * Sự kiện đáng nêu tên nhất đi kèm lúc máy vào lỗi: ưu tiên `critical`, trong cùng mức thì lấy
 * cái mới nhất. Trả `null` khi controller không gửi kèm mã nào — khi đó dòng ghi chỉ nói "máy
 * lỗi", tuyệt đối không bịa ra một mã lỗi không có thật.
 */
export function latestSignificantEvent(events = []) {
  // Không phải mảng thì không có sự kiện nào để nêu. Phải chặn ở đây vì `for...of` nhận cả chuỗi:
  // gọi nhầm với một chuỗi sẽ duyệt từng KÝ TỰ và trả về ký tự đầu như thể nó là một sự kiện, rồi
  // dòng audit in ra "mã undefined" — đúng cái việc bịa mã lỗi mà hàm này vừa hứa không làm. Và
  // `events = []` chỉ đỡ được `undefined`, `null` vẫn ném thẳng TypeError lên đường ghi sổ.
  if (!Array.isArray(events)) return null
  let best = null
  let bestMoc = MOC_KHONG_DOC_DUOC
  for (const event of events) {
    if (!event || event.severity === 'info') continue
    // Không có mã thì không "nêu tên" được. Trả về thì chỗ gọi in ra "mã undefined"; bỏ qua thì
    // dòng audit chỉ còn "Controller báo máy lỗi" — thiếu thông tin, nhưng không sai sự thật.
    if (typeof event.code !== 'string' || !event.code.trim()) continue
    const moc = mocSuKien(event)
    if (!best) { best = event; bestMoc = moc; continue }
    const eventCritical = event.severity === 'critical'
    const bestCritical = best.severity === 'critical'
    if (eventCritical !== bestCritical) {
      if (eventCritical) { best = event; bestMoc = moc }
      continue
    }
    // So bằng mốc đã lọc, KHÔNG gọi thẳng `Date.parse` ở đây: `Date.parse` trả NaN cho mốc hỏng
    // mà mọi phép so sánh với NaN đều false, nên một sự kiện có mốc hỏng sẽ chặn đứng mọi sự kiện
    // thật đến sau nó — và kết quả đổi theo thứ tự mảng adapter gửi lên.
    if (moc >= bestMoc) { best = event; bestMoc = moc }
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
  // Bắt buộc mốc phải kèm múi giờ (`Z` hoặc `±HH:MM`), đúng luật `isIsoTimestamp` của hợp đồng.
  // `Date.parse('2026-08-24T00:00:00')` KHÔNG báo lỗi — nó đọc chuỗi đó theo giờ ĐỊA PHƯƠNG của
  // máy đang chạy bridge. Cùng một lần ngừng 12 phút 30 giây, gửi mốc kiểu đó lên thì bridge chạy
  // ở Việt Nam ghi "7 giờ 12 phút" còn bridge chạy ở Los Angeles ghi "0 giây" (hiệu ra âm rồi bị
  // kẹp về 0). Hai con số bịa khác nhau, cùng một dữ liệu, và không một dòng log nào báo.
  if (!isIsoTimestamp(fromIso) || !isIsoTimestamp(toIso)) return null
  const fromMs = Date.parse(fromIso)
  const toMs = Date.parse(toIso)
  return Math.max(0, Math.round((toMs - fromMs) / 1000))
}
