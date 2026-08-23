import { describe, expect, it } from 'vitest'
import { MAX_BACKDATE_HOURS, MAX_ODOMETER, normalizeManualReading } from './manual-entry.mjs'

const now = '2026-08-18T10:00:00.000Z'
const at = (iso) => ({ now: iso ?? now })

/** Every rejection has to name the numbers involved, or the person cannot act on it. */
const rejects = (input, options, field) => {
  let thrown = null
  try { normalizeManualReading(input, { now, ...options }) } catch (error) { thrown = error }
  expect(thrown, 'lẽ ra phải từ chối').not.toBeNull()
  expect(thrown.name).toBe('ManualEntryError')
  expect(thrown.status).toBe(400)
  if (field) expect(thrown.field).toBe(field)
  return thrown
}

describe('normalizeManualReading — bộ đếm', () => {
  it('bắt buộc phải có số bộ đếm: đây là con số duy nhất không suy ra được', () => {
    rejects({}, {}, 'odometer')
    rejects({ odometer: null }, {}, 'odometer')
    rejects({ odometer: '' }, {}, 'odometer')
  })

  it('từ chối chuỗi, số thập phân và số âm', () => {
    rejects({ odometer: '12000' }, {}, 'odometer')
    rejects({ odometer: 12_000.5 }, {}, 'odometer')
    rejects({ odometer: -1 }, {}, 'odometer')
  })

  it('từ chối số vượt mọi bộ đếm có thật — lỗi thừa chữ số duy nhất chặn được vô điều kiện', () => {
    const error = rejects({ odometer: MAX_ODOMETER + 1 }, {}, 'odometer')
    expect(error.message).toContain('số chữ số')
  })

  it('nhận số hợp lệ và dựng mốc khi chưa có con trỏ', () => {
    const result = normalizeManualReading({ odometer: 1_000_000 }, at())
    expect(result).toMatchObject({ baseline: true, previous: null, delta: null, odometer: 1_000_000, status: 'unknown' })
    expect(result.payload).toEqual({ observedAt: now, status: 'unknown', odometer: 1_000_000 })
  })
})

describe('normalizeManualReading — thời điểm đọc', () => {
  it('mặc định là bây giờ khi không khai', () => {
    expect(normalizeManualReading({ odometer: 10 }, at()).observedAt).toBe(now)
  })

  it('tha cho lệch đồng hồ nhỏ nhưng từ chối giờ ở tương lai', () => {
    expect(normalizeManualReading({ odometer: 10, observedAt: '2026-08-18T10:00:30Z' }, at()).observedAt).toBe('2026-08-18T10:00:30.000Z')
    const error = rejects({ odometer: 10, observedAt: '2026-08-18T11:00:00Z' }, {}, 'observedAt')
    expect(error.message).toContain('tương lai')
  })

  it('từ chối nhập bù quá xa vì ca đó có thể đã chốt lương', () => {
    const error = rejects({ odometer: 10, observedAt: '2026-08-10T10:00:00Z' }, {}, 'observedAt')
    expect(error.message).toContain(String(MAX_BACKDATE_HOURS))
    // Ngay bên trong hạn thì vẫn nhận: giới hạn là một quyết định, không phải một sự cấm đoán.
    expect(normalizeManualReading({ odometer: 10, observedAt: '2026-08-16T11:00:00Z' }, at()).observedAt).toBe('2026-08-16T11:00:00.000Z')
  })

  it('từ chối chuỗi không phải ISO 8601', () => {
    rejects({ odometer: 10, observedAt: '18/08/2026 17:00' }, {}, 'observedAt')
    rejects({ odometer: 10, observedAt: 1_755_511_200_000 }, {}, 'observedAt')
  })
})

describe('normalizeManualReading — các trường khai kèm', () => {
  it('mặc định status là unknown và từ chối giá trị lạ', () => {
    expect(normalizeManualReading({ odometer: 10 }, at()).status).toBe('unknown')
    expect(normalizeManualReading({ odometer: 10, status: 'running' }, at()).status).toBe('running')
    rejects({ odometer: 10, status: 'dang-chay' }, {}, 'status')
  })

  it('counterReset phải là boolean thật — không nhận chuỗi "true"', () => {
    rejects({ odometer: 10, counterReset: 'true' }, {}, 'counterReset')
    rejects({ odometer: 10, counterReset: 1 }, {}, 'counterReset')
  })

  it('cắt ghi chú ở 300 ký tự và coi chuỗi trắng là không có ghi chú', () => {
    expect(normalizeManualReading({ odometer: 10, note: 'x'.repeat(400) }, at()).note).toHaveLength(300)
    expect(normalizeManualReading({ odometer: 10, note: '   ' }, at()).note).toBeNull()
  })
})

describe('normalizeManualReading — đối chiếu với số đọc trước', () => {
  const cursor = { odometer: 1_000_000, at: '2026-08-18T08:00:00.000Z', quality: 'verified' }

  it('tính chênh lệch và tốc độ suy ra khi mọi thứ hợp lệ', () => {
    const result = normalizeManualReading({ odometer: 1_090_000, observedAt: '2026-08-18T09:30:00Z' }, { now, cursor })
    expect(result).toMatchObject({ baseline: false, delta: 90_000, elapsedSeconds: 5_400 })
    expect(result.impliedStitchesPerMinute).toBe(1_000)
  })

  it('từ chối giờ trùng hoặc lùi so với số đọc trước, vì cùng một khoảng sẽ vào sổ hai lần', () => {
    const same = rejects({ odometer: 1_050_000, observedAt: cursor.at }, { cursor }, 'observedAt')
    expect(same.message).toContain('MỚI HƠN')
    rejects({ odometer: 1_050_000, observedAt: '2026-08-18T07:00:00Z' }, { cursor }, 'observedAt')
  })

  it('từ chối bộ đếm lùi, và chỉ nhận khi có lời khai counterReset', () => {
    const error = rejects({ odometer: 500_000, observedAt: '2026-08-18T09:00:00Z' }, { cursor }, 'odometer')
    expect(error.message).toContain('counterReset')
    const declared = normalizeManualReading({ odometer: 500_000, observedAt: '2026-08-18T09:00:00Z', counterReset: true }, { now, cursor })
    // Khai rồi thì thành mốc mới, và khoảng vừa rồi KHÔNG được tính — không ai biết nó bao nhiêu.
    expect(declared).toMatchObject({ baseline: true, counterReset: true, delta: -500_000, impliedStitchesPerMinute: null })
  })

  it('từ chối bước nhảy vượt sức máy và nói ra cả hai con số', () => {
    // 1 giờ ⇒ trần (60+1)*1500 = 91 500 mũi. 900 000 là thừa một chữ số.
    const error = rejects({ odometer: 1_900_000, observedAt: '2026-08-18T09:00:00Z' }, { cursor }, 'odometer')
    expect(error.message).toContain('91.500')
    expect(error.message).toContain('thừa một chữ số')
  })

  it('nhận bước nhảy đúng bằng trần vật lý — giới hạn là ranh giới, không phải vùng mờ', () => {
    const result = normalizeManualReading({ odometer: 1_091_500, observedAt: '2026-08-18T09:00:00Z' }, { now, cursor })
    expect(result.delta).toBe(91_500)
  })

  it('khoảng nghỉ dài làm cửa sổ hợp lệ rộng ra — đó là sự thật, nên tốc độ suy ra phải hiện ra', () => {
    const longGap = { odometer: 1_000_000, at: '2026-08-18T02:00:00.000Z', quality: 'manual' }
    const result = normalizeManualReading({ odometer: 1_600_000, observedAt: '2026-08-18T10:00:00Z' }, { now, cursor: longGap })
    expect(result.delta).toBe(600_000)
    // 600 000 mũi trong 8 giờ = 1250 mũi/phút: hợp lệ về vật lý, nhưng con số này là thứ duy nhất
    // cho người xác nhận thấy được một lỗi thừa chữ số nằm trong giới hạn.
    expect(result.impliedStitchesPerMinute).toBe(1_250)
  })

  it('con trỏ có giờ hỏng thì coi như chưa có mốc, không phải là cớ để bỏ qua mọi kiểm tra', () => {
    const broken = { odometer: 1_000_000, at: 'không-phải-giờ' }
    const result = normalizeManualReading({ odometer: 5 }, { now, cursor: broken })
    expect(result).toMatchObject({ baseline: true, previous: null })
  })

  it('không sửa vào con trỏ được truyền vào', () => {
    const original = { ...cursor }
    normalizeManualReading({ odometer: 1_090_000, observedAt: '2026-08-18T09:30:00Z' }, { now, cursor })
    expect(cursor).toEqual(original)
  })
})
