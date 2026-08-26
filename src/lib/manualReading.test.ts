import { describe, expect, it } from 'vitest'
import { isoToLocalInput, localInputToIso, previewManualReading, zonesDisagree } from './manualReading'
import type { CountedReading } from '../types/fleet'

const previous: CountedReading = { odometer: 1_000_000, at: '2026-08-14T03:00:00Z', quality: 'verified' }

/**
 * Các mốc ở đây phải trùng với bridge/lib/manual-entry.test.mjs. Hai bên lệch nhau thì màn hình
 * hoặc chặn con số bridge sẽ nhận, hoặc mời người ta gõ con số bridge sẽ từ chối.
 */
describe('previewManualReading', () => {
  it('lượt đầu là mốc, và nói thẳng là chưa có mũi nào vào sổ', () => {
    const preview = previewManualReading({ odometer: 1_000_000, observedAt: '2026-08-14T03:00:00Z', previous: null })
    expect(preview).toMatchObject({ verdict: 'baseline', blocked: false, delta: null })
    expect(preview.message).toContain('mốc')
  })

  it('nêu số mũi và số mũi/phút để người đứng máy soi được', () => {
    const preview = previewManualReading({ odometer: 1_009_000, observedAt: '2026-08-14T03:30:00Z', previous })
    expect(preview).toMatchObject({ verdict: 'counted', blocked: false, delta: 9_000, elapsedSeconds: 1_800, impliedStitchesPerMinute: 300 })
    expect(preview.message).toContain('300')
  })

  it('chặn con số thừa một chữ số', () => {
    const preview = previewManualReading({ odometer: 11_000_000, observedAt: '2026-08-14T03:30:00Z', previous })
    expect(preview).toMatchObject({ verdict: 'too-fast', blocked: true })
    expect(preview.message).toContain('thừa một chữ số')
  })

  it('chấp nhận đúng ngưỡng giới hạn vật lý, y như bridge', () => {
    // 60 phút → (60 + 1) × 1500 = 91.500 mũi. Đúng ngưỡng là nhận, hơn một mũi là chặn.
    expect(previewManualReading({ odometer: 1_091_500, observedAt: '2026-08-14T04:00:00Z', previous }).verdict).toBe('counted')
    expect(previewManualReading({ odometer: 1_091_501, observedAt: '2026-08-14T04:00:00Z', previous }).verdict).toBe('too-fast')
  })

  it('số lùi thì đòi khai bộ đếm về 0, và khai rồi thì mở nút nhưng nói rõ là không tính mũi', () => {
    const refused = previewManualReading({ odometer: 500, observedAt: '2026-08-14T03:30:00Z', previous })
    expect(refused).toMatchObject({ verdict: 'backwards', blocked: true, delta: -999_500 })
    const declared = previewManualReading({ odometer: 500, observedAt: '2026-08-14T03:30:00Z', previous, counterReset: true })
    expect(declared).toMatchObject({ verdict: 'backwards', blocked: false })
    expect(declared.message).toContain('không tính mũi nào')
  })

  it('chặn giờ đọc lùi về trước lượt đọc trước', () => {
    const preview = previewManualReading({ odometer: 1_009_000, observedAt: '2026-08-14T02:00:00Z', previous })
    expect(preview).toMatchObject({ verdict: 'out-of-order', blocked: true })
    expect(preview.message).toContain('hai lần')
  })

  it('bằng đúng số cũ là ca không ra hàng, không phải lỗi', () => {
    const preview = previewManualReading({ odometer: 1_000_000, observedAt: '2026-08-14T03:30:00Z', previous })
    expect(preview).toMatchObject({ verdict: 'idle', blocked: false, delta: 0 })
  })

  it('ô trống và số không hợp lệ đều khoá nút, mỗi cái một lý do', () => {
    expect(previewManualReading({ odometer: null, observedAt: '2026-08-14T03:30:00Z', previous })).toMatchObject({ verdict: 'empty', blocked: true })
    expect(previewManualReading({ odometer: -5, observedAt: '2026-08-14T03:30:00Z', previous })).toMatchObject({ verdict: 'invalid', blocked: true })
    expect(previewManualReading({ odometer: 1_000, observedAt: 'hôm nọ', previous })).toMatchObject({ verdict: 'invalid', blocked: true })
  })
})

describe('giờ của ô nhập', () => {
  it('đi vòng ISO → ô nhập → ISO mà không trôi phút', () => {
    const iso = new Date(Date.parse('2026-08-14T03:30:00Z')).toISOString()
    const roundTrip = localInputToIso(isoToLocalInput(iso))
    expect(roundTrip).not.toBeNull()
    expect(Math.abs(Date.parse(roundTrip as string) - Date.parse(iso))).toBeLessThan(60_000)
  })

  it('ô trống và chuỗi rác cho ra null, không cho ra ngày hôm nay', () => {
    expect(localInputToIso('')).toBeNull()
    expect(localInputToIso('không phải giờ')).toBeNull()
  })
})


describe('zonesDisagree', () => {
  const at = new Date('2026-08-18T10:27:00Z')

  it('không kêu khi hai cái tên là cùng một múi giờ', () => {
    // Asia/Saigon là tên cũ của Asia/Ho_Chi_Minh. So tên thì banner nổi lên giữa lúc đồng hồ đúng,
    // và người gõ số học được rằng banner đó vô nghĩa — đúng cái thói quen giết cảnh báo thật.
    expect(zonesDisagree(at, 'Asia/Saigon', 'Asia/Ho_Chi_Minh')).toBe(false)
  })

  it('kêu khi hai múi giờ đọc ra hai giờ khác nhau', () => {
    expect(zonesDisagree(at, 'Asia/Bangkok', 'Asia/Ho_Chi_Minh')).toBe(false)
    expect(zonesDisagree(at, 'Asia/Tokyo', 'Asia/Ho_Chi_Minh')).toBe(true)
    expect(zonesDisagree(at, 'UTC', 'Asia/Ho_Chi_Minh')).toBe(true)
  })

  it('coi múi giờ không đọc được là lệch: không kiểm được khác với đã kiểm', () => {
    expect(zonesDisagree(at, 'Mars/Olympus', 'Asia/Ho_Chi_Minh')).toBe(true)
  })

  it('im lặng khi chưa có mốc thời gian hợp lệ, để ô trống không sinh cảnh báo', () => {
    expect(zonesDisagree(new Date('khong-phai-gio'), 'UTC', 'Asia/Ho_Chi_Minh')).toBe(false)
  })
})
