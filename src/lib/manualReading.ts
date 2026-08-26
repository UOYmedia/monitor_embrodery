import type { CountedReading } from '../types/fleet'

/**
 * Xem trước một lượt đọc gõ tay, TRƯỚC khi nó thành tiền trong túi ai.
 *
 * Đây là bản sao của các phép kiểm trong `bridge/lib/manual-entry.mjs`, và chiều phụ thuộc chỉ
 * có một: bridge là bên quyết, màn hình chỉ nói trước cho người gõ biết bridge sẽ nói gì. Nếu
 * hai bên lệch nhau thì bridge đúng — chỗ này không được phép nới một luật nào của bridge, vì
 * làm vậy là dựng một ô nhập chấp nhận con số mà sổ sẽ từ chối.
 *
 * Lý do phải xem trước thay vì gửi đi rồi báo lỗi: người gõ đang đứng trước máy, đọc được lại
 * màn hình HMI ngay lúc đó. Một dòng chữ "9.000 mũi trong 30 phút = 300 mũi/phút" hiện ngay
 * cạnh nút Ghi là thứ duy nhất bắt được lỗi thừa một chữ số mà vẫn nằm trong giới hạn vật lý —
 * bridge không bắt được lỗi đó sau một khoảng nghỉ dài, mà người đứng máy thì nhìn là biết.
 */

/** Giống `production.mjs`: 1.500 mũi/phút cao hơn mọi máy thêu công nghiệp, nên vượt là sai số. */
export const MAX_STITCHES_PER_MINUTE = 1_500

export type PreviewVerdict = 'empty' | 'invalid' | 'baseline' | 'counted' | 'idle' | 'backwards' | 'too-fast' | 'out-of-order'

export interface ManualReadingPreview {
  verdict: PreviewVerdict
  /** `true` khi bridge sẽ từ chối con số này — nút Ghi phải khoá lại. */
  blocked: boolean
  delta: number | null
  elapsedSeconds: number | null
  impliedStitchesPerMinute: number | null
  plausibleMax: number | null
  message: string
}

export function previewManualReading({
  odometer, observedAt, previous, counterReset = false, maxStitchesPerMinute = MAX_STITCHES_PER_MINUTE,
}: {
  odometer: number | null
  observedAt: string
  previous: CountedReading | null
  counterReset?: boolean
  maxStitchesPerMinute?: number
}): ManualReadingPreview {
  const blank = { delta: null, elapsedSeconds: null, impliedStitchesPerMinute: null, plausibleMax: null }
  if (odometer === null) return { verdict: 'empty', blocked: true, ...blank, message: 'Gõ số mũi tổng đang hiện trên màn hình máy.' }
  if (!Number.isInteger(odometer) || odometer < 0) {
    return { verdict: 'invalid', blocked: true, ...blank, message: 'Số mũi tổng phải là số nguyên không âm — đọc lại màn hình máy.' }
  }
  const observedMs = Date.parse(observedAt)
  if (Number.isNaN(observedMs)) return { verdict: 'invalid', blocked: true, ...blank, message: 'Chưa có giờ đọc hợp lệ.' }

  if (!previous) {
    return {
      verdict: 'baseline', blocked: false, ...blank,
      message: 'Đây là số đọc đầu tiên của máy này, nên nó chỉ làm mốc: chưa có mũi nào vào sổ. Lượt gõ sau mới ra sản lượng.',
    }
  }

  const previousMs = Date.parse(previous.at)
  if (Number.isNaN(previousMs) || observedMs < previousMs) {
    return {
      verdict: 'out-of-order', blocked: true, ...blank,
      message: 'Giờ đọc phải muộn hơn lượt đọc trước, không thì cùng một khoảng mũi vào sổ hai lần.',
    }
  }

  const elapsedSeconds = Math.round((observedMs - previousMs) / 1_000)
  const delta = odometer - previous.odometer

  if (delta < 0) {
    return {
      verdict: 'backwards', blocked: !counterReset, delta, elapsedSeconds, impliedStitchesPerMinute: null, plausibleMax: null,
      message: counterReset
        ? 'Đã khai bộ đếm về 0: lượt này làm mốc mới, không tính mũi nào — vì không ai biết máy chạy bao nhiêu trước lúc về 0.'
        : `Số mới nhỏ hơn số cũ (${previous.odometer.toLocaleString('vi-VN')}). Nếu máy vừa về 0 hoặc vừa thay bo thì tích ô khai bên dưới; nếu không thì đọc lại màn hình.`,
    }
  }

  // Cùng công thức với `production.mjs`: cộng thêm một phút để khoảng đọc ngắn không bị chặn oan.
  const plausibleMax = Math.ceil((elapsedSeconds / 60 + 1) * maxStitchesPerMinute)
  const impliedStitchesPerMinute = elapsedSeconds > 0 ? Math.round(delta / (elapsedSeconds / 60)) : null

  if (delta > plausibleMax) {
    return {
      verdict: 'too-fast', blocked: !counterReset, delta, elapsedSeconds, impliedStitchesPerMinute, plausibleMax,
      message: counterReset
        ? 'Đã khai bộ đếm về 0: lượt này làm mốc mới, không tính mũi nào.'
        : `${delta.toLocaleString('vi-VN')} mũi trong ${formatGap(elapsedSeconds)} là quá giới hạn máy (tối đa ${plausibleMax.toLocaleString('vi-VN')}). Gần như chắc chắn thừa một chữ số.`,
    }
  }

  if (delta === 0) {
    return {
      verdict: 'idle', blocked: false, delta, elapsedSeconds, impliedStitchesPerMinute, plausibleMax,
      message: `Không thêm mũi nào so với lượt đọc trước (${formatGap(elapsedSeconds)} trước). Vẫn nên ghi: một ca đứng máy cũng là một dữ kiện.`,
    }
  }

  return {
    verdict: 'counted', blocked: false, delta, elapsedSeconds, impliedStitchesPerMinute, plausibleMax,
    message: `Sẽ vào sổ ${delta.toLocaleString('vi-VN')} mũi cho khoảng ${formatGap(elapsedSeconds)}`
      + (impliedStitchesPerMinute === null ? '.' : ` — tức ${impliedStitchesPerMinute.toLocaleString('vi-VN')} mũi/phút. Nhìn con số này trước khi bấm Ghi.`),
  }
}

function formatGap(seconds: number): string {
  if (seconds < 60) return `${seconds} giây`
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${minutes} phút`
  const hours = Math.floor(minutes / 60)
  return `${hours} giờ ${String(minutes % 60).padStart(2, '0')} phút`
}

/**
 * `datetime-local` cho ra giờ treo tường của MÁY TÍNH đang gõ, không kèm múi giờ. Người gõ số
 * đang đứng ở xưởng nên đó thường là đúng giờ xưởng, nhưng "thường" không phải "luôn": nếu
 * đồng hồ máy tính lệch múi so với xưởng thì con số sẽ vào sai ca, tức vào sai bảng lương.
 * Nên hàm này chỉ đổi chuỗi, còn màn hình PHẢI nói ra nó đang lấy giờ của máy nào.
 */
export function localInputToIso(value: string): string | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

export function isoToLocalInput(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'giờ máy tính này'
}

/**
 * Two different zone names are not necessarily two different clocks: `Asia/Saigon` is the old
 * name of `Asia/Ho_Chi_Minh`, same offset, same wall clock. Comparing names raises the alarm when
 * nothing is wrong, and a warning that cries wolf twice is a warning nobody reads the day it is
 * right. What deserves a warning is the clocks actually disagreeing at the moment being recorded
 * — which also gets DST right, because it asks about that instant and not about the zone in
 * general. An unparsable zone name counts as disagreement: not being able to check is not the
 * same as having checked.
 */
export function zonesDisagree(at: Date, a: string, b: string): boolean {
  if (a === b) return false
  if (Number.isNaN(at.getTime())) return false
  const wallClock = (zone: string) => {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(at)
    } catch {
      return null
    }
  }
  const left = wallClock(a)
  const right = wallClock(b)
  if (left === null || right === null) return true
  return left !== right
}
