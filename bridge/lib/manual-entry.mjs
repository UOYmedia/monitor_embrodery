import { operationalStatuses } from './contract.mjs'

/**
 * Validation for a stitch-counter reading a person typed in.
 *
 * This exists because the alternative is worse. When a controller has no protocol the bridge can
 * read — and for the BECS-A15 in this workshop it does not — the choice is not "automatic numbers
 * or hand-typed numbers". It is "hand-typed numbers with discipline, or hand-typed numbers on
 * paper that nobody can audit". So the path exists, and everything here is about making it
 * refuse a bad entry *at the keyboard*, while the person who typed it is still standing there
 * and can look at the screen again.
 *
 * That timing is the whole design. `production.mjs` already flags a bad automatic reading after
 * the fact, which is right for a machine — you cannot ask a controller to re-read. You *can* ask
 * a person. So a manual entry that fails a check is rejected with a message naming the numbers
 * involved, not accepted-and-flagged. A flag in a report is read days later by someone who
 * cannot tell a typo from a board swap; a rejection is read immediately by the one person who
 * can.
 *
 * What is deliberately NOT checked here, because no check could be honest about it:
 *
 * - Whether the number on the screen is what the person typed. Nothing on this side of the
 *   keyboard can know that. The physical bound below catches an extra digit only when the gap
 *   since the last reading is short — over an eight-hour gap the machine could genuinely have
 *   stitched 700k, so 700k cannot be rejected. The countermeasure is not a tighter threshold,
 *   it is a shorter gap: `impliedStitchesPerMinute` is returned so the UI can show the rate the
 *   entry implies and let a person recognise their own typo before confirming.
 * - Which shift the stitches belong to. That comes from `observedAt` through `resolveShift`.
 *   Letting a person choose the shift is how stitches get moved between people's envelopes.
 */

/** Fastest industrial embroidery heads run ~1200 spm; matches `production.mjs`. */
const DEFAULT_MAX_STITCHES_PER_MINUTE = 1_500

/**
 * A wall clock on a phone or a workshop PC can sit a little ahead of the bridge. A minute of
 * skew is tolerated so an honest entry is not rejected for being three seconds in the future;
 * beyond that the timestamp is wrong and the shift it lands in would be wrong with it.
 */
export const MAX_CLOCK_SKEW_SECONDS = 60

/**
 * How far back a first entry may be dated. There is a limit at all because a shift that has been
 * reported and paid should not silently gain stitches afterwards; 72 hours covers "Monday morning,
 * for Friday's late shift" and stops there. Later entries are bounded far more tightly by the
 * cursor: they must be strictly newer than the last reading of the same counter.
 */
export const MAX_BACKDATE_HOURS = 72

/**
 * Ten billion stitches — about nineteen years of continuous running. A number above this is not a
 * counter value, it is a keyboard accident, and it is the one typo that is safe to reject outright
 * because no gap is long enough to make it plausible.
 */
export const MAX_ODOMETER = 9_999_999_999

export class ManualEntryError extends Error {
  constructor(message, field) {
    super(message)
    this.name = 'ManualEntryError'
    this.field = field
    this.status = 400
  }
}

function fail(message, field) { throw new ManualEntryError(message, field) }

function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }

/**
 * Validates one hand-typed reading against the previous reading of the same counter.
 *
 * `cursor` is the shared odometer cursor from `production.mjs` — shared, not a separate manual
 * one, because both lanes read the *same physical counter*. Two cursors over one counter would
 * book the same stitches twice the moment both lanes were live.
 *
 * Returns the telemetry payload to hand to `normalizeTelemetry`, plus the derived numbers the UI
 * and the audit entry need. Throws `ManualEntryError` for anything a person should retype.
 */
export function normalizeManualReading(input, {
  cursor = null,
  now = new Date().toISOString(),
  maxStitchesPerMinute = DEFAULT_MAX_STITCHES_PER_MINUTE,
  maxBackdateHours = MAX_BACKDATE_HOURS,
} = {}) {
  if (!isObject(input)) fail('Cần một object có ít nhất trường odometer.', 'body')

  const nowMs = Date.parse(now)
  if (Number.isNaN(nowMs)) throw new Error('normalizeManualReading nhận `now` không phải thời gian hợp lệ.')

  // ---------------------------------------------------------------- bộ đếm
  const odometer = input.odometer
  if (odometer === undefined || odometer === null || odometer === '') {
    fail('Chưa có số trên bộ đếm mũi. Đây là con số duy nhất bắt buộc phải đọc từ màn hình máy.', 'odometer')
  }
  if (typeof odometer !== 'number' || !Number.isFinite(odometer)) fail('odometer phải là số.', 'odometer')
  if (!Number.isInteger(odometer)) fail('odometer phải là số nguyên — bộ đếm mũi không có phần thập phân.', 'odometer')
  if (odometer < 0) fail('odometer không thể là số âm.', 'odometer')
  if (odometer > MAX_ODOMETER) {
    fail(`odometer ${odometer.toLocaleString('vi-VN')} lớn hơn mọi giá trị bộ đếm có thật (trần ${MAX_ODOMETER.toLocaleString('vi-VN')}). Kiểm tra lại số chữ số.`, 'odometer')
  }

  // ---------------------------------------------------------------- thời điểm đọc
  const observedRaw = input.observedAt ?? null
  let observedMs = nowMs
  if (observedRaw !== null) {
    if (typeof observedRaw !== 'string') fail('observedAt phải là chuỗi thời gian ISO 8601.', 'observedAt')
    observedMs = Date.parse(observedRaw)
    if (Number.isNaN(observedMs)) fail('observedAt không phải thời gian ISO 8601 hợp lệ (ví dụ 2026-08-18T10:30:00Z).', 'observedAt')
  }
  const observedAt = new Date(observedMs).toISOString()

  const skewSeconds = (observedMs - nowMs) / 1_000
  if (skewSeconds > MAX_CLOCK_SKEW_SECONDS) {
    fail(`Thời điểm đọc nằm ở tương lai ${Math.round(skewSeconds)}s. Đồng hồ của máy đang nhập bị lệch, hoặc gõ sai giờ — sửa trước khi ghi, vì giờ này quyết định số vào ca nào.`, 'observedAt')
  }
  const backdateHours = (nowMs - observedMs) / 3_600_000
  if (backdateHours > maxBackdateHours) {
    fail(`Thời điểm đọc đã cách đây ${Math.round(backdateHours)} giờ, quá hạn ${maxBackdateHours} giờ cho phép nhập bù. Ca đó có thể đã chốt lương; muốn sửa thì phải sửa có người phê duyệt, không phải nhập thêm.`, 'observedAt')
  }

  // ---------------------------------------------------------------- các trường khai kèm
  const status = input.status ?? 'unknown'
  if (typeof status !== 'string' || !operationalStatuses.includes(status)) {
    fail(`status phải thuộc: ${operationalStatuses.join(', ')}. Không chắc thì để "unknown" — đó là câu trả lời trung thực.`, 'status')
  }

  const noteRaw = input.note ?? null
  if (noteRaw !== null && typeof noteRaw !== 'string') fail('note phải là chuỗi.', 'note')
  const note = noteRaw ? noteRaw.trim().slice(0, 300) || null : null

  const counterResetRaw = input.counterReset ?? false
  if (typeof counterResetRaw !== 'boolean') {
    fail('counterReset phải là true hoặc false — đây là một lời khai, không phải một ô đánh dấu cho tiện.', 'counterReset')
  }
  const counterReset = counterResetRaw

  const payload = { observedAt, status, odometer }

  // ---------------------------------------------------------------- đối chiếu với số đọc trước
  if (!cursor) {
    // Không có mốc nào thì không có gì để so, và cũng không có gì để đếm: bản ghi đầu tiên chỉ
    // dựng mốc. `production.mjs` tự trả về `baseline`, ở đây chỉ nói trước cho giao diện biết.
    return { payload, observedAt, odometer, status, note, counterReset, baseline: true, previous: null, delta: null, elapsedSeconds: null, impliedStitchesPerMinute: null }
  }

  const previousMs = Date.parse(cursor.at)
  if (Number.isNaN(previousMs)) {
    return { payload, observedAt, odometer, status, note, counterReset, baseline: true, previous: null, delta: null, elapsedSeconds: null, impliedStitchesPerMinute: null }
  }

  if (observedMs <= previousMs) {
    const when = new Date(previousMs).toISOString()
    fail(`Máy này đã có số đọc lúc ${when} (bộ đếm ${cursor.odometer.toLocaleString('vi-VN')}). Số nhập tay phải MỚI HƠN số đọc trước, không được trùng giờ và không được chèn vào phía sau — nếu không thì cùng một khoảng mũi sẽ vào sổ hai lần.`, 'observedAt')
  }

  const elapsedSeconds = (observedMs - previousMs) / 1_000
  const delta = odometer - cursor.odometer

  if (delta < 0) {
    if (!counterReset) {
      fail(`Bộ đếm lùi từ ${cursor.odometer.toLocaleString('vi-VN')} xuống ${odometer.toLocaleString('vi-VN')}. Nếu gõ sai thì sửa lại. Nếu bộ đếm thật đã bị đặt lại hoặc thay bảng điều khiển thì phải khai rõ counterReset — lúc đó số này thành mốc mới và khoảng vừa rồi KHÔNG được tính, vì không ai biết nó là bao nhiêu.`, 'odometer')
    }
    return { payload, observedAt, odometer, status, note, counterReset, baseline: true, previous: { ...cursor }, delta, elapsedSeconds, impliedStitchesPerMinute: null }
  }

  // Cùng công thức với `production.mjs`: một phút dự phòng cho lệch giờ, phần còn lại là giới hạn
  // vật lý thật. Khoảng cách càng dài thì cửa sổ này càng rộng — đó là sự thật, không phải lỗ hổng,
  // và cách thu hẹp nó là nhập dày hơn chứ không phải hạ ngưỡng.
  const plausibleMax = Math.ceil((elapsedSeconds / 60 + 1) * maxStitchesPerMinute)
  if (delta > plausibleMax) {
    if (!counterReset) {
      const hours = elapsedSeconds / 3_600
      const gap = hours >= 1 ? `${hours.toFixed(1)} giờ` : `${Math.round(elapsedSeconds / 60)} phút`
      fail(`Chênh ${delta.toLocaleString('vi-VN')} mũi trong ${gap} là vượt sức máy (tối đa ${plausibleMax.toLocaleString('vi-VN')} mũi ở ${maxStitchesPerMinute} mũi/phút). Gần như chắc chắn là thừa một chữ số — đọc lại màn hình. Nếu bộ đếm thật đã bị thay hoặc đặt lại thì khai counterReset.`, 'odometer')
    }
    return { payload, observedAt, odometer, status, note, counterReset, baseline: true, previous: { ...cursor }, delta, elapsedSeconds, impliedStitchesPerMinute: null }
  }

  // Cái mà con người phải tự nhìn: một lỗi thừa chữ số nằm trong giới hạn vật lý thì chỉ tốc độ
  // suy ra mới lộ. Giao diện phải hiện con số này ở bước xác nhận.
  const impliedStitchesPerMinute = elapsedSeconds > 0 ? Math.round(delta / (elapsedSeconds / 60)) : null

  return { payload, observedAt, odometer, status, note, counterReset, baseline: false, previous: { ...cursor }, delta, elapsedSeconds, impliedStitchesPerMinute }
}
