import type { MachineView, Site } from '../types/fleet'
import { effectiveStatus } from './freshness'
import { UNREAD, formatClock, formatNumber } from './format'

/**
 * Số dẫn xuất phía dashboard.
 *
 * Đây là chỗ dễ vi phạm PRD nhất: một con số dashboard tự tính, đặt cạnh số máy báo, sẽ bị
 * đọc là "máy nói thế". Nên mọi hàm ở đây trả về cùng một hình dạng `DerivedValue`, mang
 * theo ba thứ mà chỗ hiển thị bắt buộc phải dùng:
 *
 *  - `note`: công thức bằng lời ("Dashboard ước tính…"), không được rút gọn thành icon.
 *  - `unavailable`: lý do *không tính được*, khác hẳn "Chưa đọc được từ controller".
 *    Trường máy báo mà thiếu thì là chưa đọc được; số dẫn xuất thiếu đầu vào thì là chưa
 *    tính được. Hai chuyện khác nhau, hai chuỗi khác nhau.
 *  - `basedOn`: timestamp *cũ nhất* trong các đầu vào, để người xem biết số này dựa trên
 *    dữ liệu lúc nào.
 *
 * Và quy tắc không đóng băng: đầu vào rơi vào stale/offline/unknown thì số dẫn xuất biến
 * mất, không giữ giá trị cũ. Số máy báo thì ngược lại — giữ nguyên kèm timestamp.
 */

export interface DerivedValue<T> {
  value: T | null
  text: string
  note: string
  unavailable: string | null
  basedOn: string | null
}

function unavailable<T>(reason: string, note = ''): DerivedValue<T> {
  return { value: null, text: reason, note, unavailable: reason, basedOn: null }
}

/** Mốc cũ nhất trong các đầu vào — số dẫn xuất chỉ mới bằng đầu vào cũ nhất của nó. */
function oldest(...stamps: (string | null | undefined)[]): string | null {
  const parsed = stamps
    .filter((stamp): stamp is string => typeof stamp === 'string' && stamp !== '')
    .map((stamp) => [stamp, Date.parse(stamp)] as const)
    .filter(([, ms]) => Number.isFinite(ms))
  if (!parsed.length) return null
  return parsed.reduce((left, right) => (right[1] < left[1] ? right : left))[0]
}

/** Dữ liệu đủ tươi để tính tiếp hay không. Chỉ `online` mới được dùng cho số dự báo. */
function isLive(machine: MachineView): boolean {
  return machine.connection.state === 'online'
}

// ---------------------------------------------------------------- tiến độ job

export interface JobProgress {
  percent: number
  currentStitch: number
  totalStitches: number
  /** Bộ đếm vượt tổng mũi: dấu hiệu lỗi bộ đếm, cố ý KHÔNG kẹp trần 100%. */
  overrun: boolean
}

/**
 * Tiến độ mũi, không kẹp trần.
 *
 * Kẹp về 100% là cách che một bộ đếm hỏng: 52.100/46.453 hiện thành "100%" trông y hệt một
 * máy sắp xong. Ở đây vượt tổng là một cờ riêng để giao diện in ra chữ cảnh báo.
 */
export function jobProgress(machine: MachineView): JobProgress | null {
  const job = machine.telemetry?.job?.value
  if (!job || job.currentStitch === null || !job.totalStitches) return null
  const percent = Math.round((job.currentStitch / job.totalStitches) * 100)
  return {
    percent,
    currentStitch: job.currentStitch,
    totalStitches: job.totalStitches,
    overrun: job.currentStitch > job.totalStitches,
  }
}

export function overrunText(progress: JobProgress): string {
  return `Bộ đếm vượt tổng mũi (${formatNumber(progress.currentStitch)}/${formatNumber(progress.totalStitches)}) — kiểm tra tại máy`
}

// ---------------------------------------------------------------- ETA

const etaNote = 'Dashboard ước tính từ tốc độ hiện tại, không phải máy báo'

/**
 * Giờ xong dự kiến.
 *
 * Cố ý tắt khi dữ liệu cũ: một ETA tính trên RPM mười phút tuổi là lời hứa sai với khách.
 */
export function estimatedFinish(machine: MachineView, nowMs: number, timeZone?: string): DerivedValue<number> {
  if (!isLive(machine)) return unavailable('Không ước tính khi dữ liệu cũ', etaNote)
  if (effectiveStatus(machine) !== 'running') return unavailable('Chỉ ước tính khi máy đang chạy', etaNote)

  const progress = jobProgress(machine)
  if (!progress) return unavailable('Không tính được (thiếu tổng mũi)', etaNote)
  if (progress.overrun) return unavailable('Không tính được (bộ đếm vượt tổng mũi)', etaNote)

  const rpm = machine.telemetry?.rpm?.value ?? null
  if (rpm === null || rpm <= 0) return unavailable('Không tính được (thiếu tốc độ máy)', etaNote)

  const minutes = (progress.totalStitches - progress.currentStitch) / rpm
  const at = nowMs + minutes * 60_000
  return {
    value: at,
    text: `≈ xong ${formatClock(new Date(at).toISOString(), timeZone)}`,
    note: `${etaNote} — ${formatNumber(rpm)} v/ph`,
    unavailable: null,
    basedOn: oldest(machine.telemetry?.rpm?.observedAt, machine.telemetry?.job?.observedAt),
  }
}

// ---------------------------------------------------------------- thời lượng trạng thái

export function formatMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.floor(totalMinutes))
  // "0 phút" đọc như "không có thời lượng"; thứ ta biết là "chưa tới một phút".
  if (minutes === 0) return 'dưới 1 phút'
  if (minutes < 60) return `${minutes} phút`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} giờ` : `${hours} giờ ${rest} phút`
}

/**
 * `12g 32p` — bản ngắn cho ô bảng.
 *
 * "ít nhất 12 giờ 32 phút" chiếm 233 px trên một dòng không xuống hàng được; nhân với cột
 * trạng thái là lý do bảng phải cuộn ngang khi mở panel chi tiết. Câu đầy đủ không mất: nó
 * nằm trong tooltip của ô và trong panel chi tiết, nơi có chỗ để đọc.
 */
export function formatMinutesShort(totalMinutes: number): string {
  const minutes = Math.max(0, Math.floor(totalMinutes))
  if (minutes === 0) return 'dưới 1p'
  if (minutes < 60) return `${minutes}p`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}g` : `${hours}g ${rest}p`
}

export interface StatusDuration {
  minutes: number
  since: string
  approximate: boolean
}

/** Bao lâu rồi máy ở trạng thái hiện tại. `approximate` = bridge chỉ biết từ lúc nó khởi động. */
export function statusDuration(machine: MachineView, nowMs: number): StatusDuration | null {
  const since = machine.statusSince
  if (!since) return null
  const startedMs = Date.parse(since.at)
  if (!Number.isFinite(startedMs)) return null
  return { minutes: Math.max(0, (nowMs - startedMs) / 60_000), since: since.at, approximate: since.approximate }
}

/** `Dừng · 2 phút (từ 09:51)` — chữ ngắn đi cạnh nhãn trạng thái ở bảng và tile andon. */
export function statusDurationText(machine: MachineView, nowMs: number, timeZone?: string): string | null {
  const duration = statusDuration(machine, nowMs)
  if (!duration) return null
  const clock = formatClock(duration.since, timeZone)
  return duration.approximate
    ? `ít nhất ${formatMinutes(duration.minutes)} (từ ${clock}, chưa rõ mốc trước đó)`
    : `${formatMinutes(duration.minutes)} (từ ${clock})`
}

// ---------------------------------------------------------------- leo thang "dừng lâu"

/**
 * Một máy dừng 2 giờ trông y hệt một máy dừng 2 phút là lỗi giao diện nghiêm trọng nhất của
 * bản trước. `idle-long` là *tone hiển thị*, không phải trạng thái dữ liệu mới: dữ liệu vẫn
 * là `stopped`/`paused`, chỉ cách bày đổi.
 */
export function isLongStop(machine: MachineView, nowMs: number): boolean {
  const status = effectiveStatus(machine)
  if (status !== 'stopped' && status !== 'paused') return false
  const duration = statusDuration(machine, nowMs)
  if (!duration) return false
  return duration.minutes >= machine.thresholds.stopEscalationMinutes
}

// ---------------------------------------------------------------- đứt chỉ

export interface ThreadBreakRate {
  ratePer1000: number
  breaks: number
  stitches: number
  needle: number | null
  /** Vượt ngưỡng xưởng đặt. `null` = xưởng chưa đặt ngưỡng, dashboard không phán xét. */
  overThreshold: boolean | null
}

export function threadBreakRate(machine: MachineView): ThreadBreakRate | null {
  const window = machine.telemetry?.threadBreakWindow?.value
  if (!window || window.stitches <= 0) return null
  const ratePer1000 = (window.breaks / window.stitches) * 1000
  const threshold = machine.thresholds.threadBreakWarnPer1000
  return {
    ratePer1000,
    breaks: window.breaks,
    stitches: window.stitches,
    needle: window.needle,
    overThreshold: threshold === null ? null : ratePer1000 > threshold,
  }
}

const rateFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 })

/** Luôn in cả phân số gốc lẫn cửa sổ đo — một tỉ lệ trần trụi không kiểm chứng được. */
export function threadBreakText(rate: ThreadBreakRate): string {
  const needle = rate.needle === null ? '' : `, kim ${rate.needle}`
  return `${rateFormat.format(rate.ratePer1000)} lần/1.000 mũi (${rate.breaks} lần trong ${formatNumber(rate.stitches)} mũi gần nhất${needle})`
}

export const noThreadBreakThreshold = 'Xưởng chưa đặt ngưỡng cảnh báo đứt chỉ — chỉ hiển thị số đo'

// ---------------------------------------------------------------- đơn giá hiệu lực

export interface EffectivePrice {
  value: number | null
  source: 'machine' | 'site' | 'none'
  siteValue: number | null
}

/** Đơn giá riêng của máy đè đơn giá xưởng. Giao diện phải nói rõ số đang dùng là của ai. */
export function effectivePrice(machine: MachineView, site: Site | null | undefined): EffectivePrice {
  const machinePrice = machine.identity.pricePer1000Stitches
  const sitePrice = site?.pricePer1000Stitches ?? null
  if (machinePrice !== null) return { value: machinePrice, source: 'machine', siteValue: sitePrice }
  if (sitePrice !== null) return { value: sitePrice, source: 'site', siteValue: sitePrice }
  return { value: null, source: 'none', siteValue: null }
}

// ---------------------------------------------------------------- lý do mất kết nối

/**
 * Máy tắt nguồn và adapter hỏng là hai việc sửa hoàn toàn khác nhau, nên dòng lý do phải
 * phân biệt được — `reachable === true` mà vẫn offline nghĩa là máy còn sống, phần đọc hỏng.
 */
export function offlineReason(machine: MachineView, timeZone?: string): string | null {
  if (machine.connection.state !== 'offline') return null
  const lastError = machine.connection.poll.lastError
  if (machine.connection.reachable === true) {
    return `Còn ping được nhưng adapter không đọc được${lastError ? ` — lỗi gần nhất: "${lastError}"` : ''}`
  }
  if (!machine.connection.lastReachableAt) return 'Chưa từng liên lạc được với máy này'
  return `Không liên lạc được — có thể máy tắt nguồn hoặc mất mạng. Lần ping được gần nhất: ${formatClock(machine.connection.lastReachableAt, timeZone)}`
}

// ---------------------------------------------------------------- tốc độ

export interface RpmRange { min: number; max: number; samples: number }

export function rpmRange(machine: MachineView): RpmRange | null {
  const history = machine.telemetry?.rpmHistory?.value
  if (!history || history.length < 2) return null
  return { min: Math.min(...history), max: Math.max(...history), samples: history.length }
}

/** Đường gấp khúc SVG cho sparkline; trả `null` khi chưa đủ mẫu để vẽ thành hình. */
export function sparklinePoints(values: number[], width: number, height: number): string | null {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = width / (values.length - 1)
  return values
    .map((value, index) => `${(index * step).toFixed(1)},${(height - ((value - min) / span) * height).toFixed(1)}`)
    .join(' ')
}

export { UNREAD }
