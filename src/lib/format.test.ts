import { describe, expect, it } from 'vitest'
import { UNREAD, connectionSymbols, formatAge, formatDuration, formatNumber, formatStitchProgress, formatTime } from './format'

describe('hiển thị giá trị chưa đọc được', () => {
  it('không bịa số khi controller chưa trả về gì', () => {
    expect(formatNumber(null)).toBe(UNREAD)
    expect(formatNumber(undefined)).toBe(UNREAD)
    expect(formatNumber(Number.NaN)).toBe(UNREAD)
    expect(formatStitchProgress(null, 51_000)).toBe(UNREAD)
    expect(formatDuration(null)).toBe(UNREAD)
  })

  it('vẫn hiển thị số 0 thật thay vì coi là chưa đọc', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatDuration(0)).toBe('0s')
  })
})

describe('thời gian', () => {
  it('quy đổi ISO UTC sang múi giờ của site', () => {
    const iso = '2026-08-14T07:00:00.000Z'
    expect(formatTime(iso, 'Asia/Ho_Chi_Minh')).toContain('14:00:00')
    expect(formatTime(iso, 'UTC')).toContain('07:00:00')
  })

  it('không hiển thị chuỗi rác khi thiếu hoặc sai định dạng', () => {
    expect(formatTime(null)).toBe('—')
    expect(formatTime('hôm qua')).toBe('—')
  })

  it('diễn đạt tuổi dữ liệu bằng chữ', () => {
    expect(formatAge(0)).toBe('0s trước')
    expect(formatAge(95)).toBe('1 phút trước')
    expect(formatAge(7200)).toBe('2 giờ trước')
    expect(formatAge(null)).toBe('chưa có dữ liệu')
    // Clock skew between bridge and browser must not surface as a negative age.
    expect(formatAge(-3)).toBe('0s trước')
  })
})

describe('kênh thông tin ngoài màu sắc', () => {
  it('mỗi trạng thái kết nối có một ký hiệu riêng', () => {
    const symbols = Object.values(connectionSymbols)
    expect(new Set(symbols).size).toBe(symbols.length)
  })
})
