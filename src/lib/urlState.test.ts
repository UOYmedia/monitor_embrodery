import { describe, expect, it } from 'vitest'
import { emptyFilter } from './fleet'
import { allTabs, decodeFilter, decodeView, defaultView, encodeFilter, encodeView, tabs } from './urlState'

describe('encodeFilter', () => {
  it('chỉ ghi những gì khác mặc định', () => {
    expect(encodeFilter(emptyFilter)).toBe('')
  })

  it('ghi cả trường chuỗi lẫn cờ bật/tắt', () => {
    const encoded = encodeFilter({
      ...emptyFilter, search: 'MT-07', status: 'idle', escalation: 'idle-long', attention: true,
    })
    expect(encoded).toBe('q:MT-07;st:idle;esc:idle-long;attention')
  })
})

describe('decodeFilter', () => {
  it('đi vòng tròn được', () => {
    const filter = { ...emptyFilter, siteId: 'site-1', zone: 'Chuyền A', severity: 'critical' as const, includeArchived: true }
    expect(decodeFilter(encodeFilter(filter))).toEqual(filter)
  })

  it('bỏ qua khoá lạ thay vì làm hỏng màn hình', () => {
    expect(decodeFilter('xyz:1;q:abc;;:')).toEqual({ ...emptyFilter, search: 'abc' })
  })

  it('giữ nguyên giá trị lạ: lọc không khớp máy nào còn hơn là hiện sai', () => {
    expect(decodeFilter('st:khong-ton-tai').status).toBe('khong-ton-tai')
  })

  it('URL rỗng trả về bộ lọc mặc định', () => {
    expect(decodeFilter(null)).toEqual(emptyFilter)
    expect(decodeFilter('')).toEqual(emptyFilter)
  })
})

describe('encodeView', () => {
  it('màn hình mặc định không sinh query nào', () => {
    expect(encodeView(defaultView)).toBe('')
  })

  it('mang theo tab, máy đang mở, bộ lọc và cách sắp xếp', () => {
    // Tab cuối trong danh sách đang bật, không viết cứng: tắt/bật tab không được làm hỏng
    // phép thử "màn hình đi vòng tròn qua URL còn nguyên".
    const view = {
      tab: tabs[tabs.length - 1],
      machineId: 'm-3',
      filter: { ...emptyFilter, attention: true },
      sortKey: 'maintenance' as const,
      sortDirection: 'asc' as const,
      layout: 'cards' as const,
    }
    expect(decodeView(encodeView(view))).toEqual(view)
  })

  it('mang theo cả cách bày danh sách', () => {
    const asTable = { ...defaultView, layout: 'table' as const }
    expect(encodeView(asTable)).toBe('?xem=bang')
    expect(decodeView(encodeView(asTable))).toEqual(asTable)
  })
})

describe('decodeView', () => {
  it('tab và sort lạ rơi về mặc định', () => {
    const view = decodeView('?tab=khong-co&sort=abc:xyz')
    expect(view.tab).toBe('fleet')
    expect(view.sortKey).toBe('attention')
    expect(view.sortDirection).toBe('asc')
  })

  it('không có ?machine thì không có máy nào được mở', () => {
    expect(decodeView('?tab=audit').machineId).toBeNull()
  })

  /**
   * Tab bị tắt mà vẫn nhận từ URL thì người dùng rơi vào một màn hình không có thanh tab để
   * bấm quay ra — chỉ còn cách sửa tay thanh địa chỉ. Rơi về Tổng quan là lối thoát.
   */
  it('link tới tab đang tắt rơi về Tổng quan đội máy', () => {
    for (const off of allTabs.filter((entry) => !tabs.includes(entry))) {
      expect(decodeView(`?tab=${off}`).tab).toBe('fleet')
    }
  })

  it('tab đang bật vẫn mở được từ URL', () => {
    for (const on of tabs) expect(decodeView(`?tab=${on}`).tab).toBe(on)
  })

  it('`xem` lạ rơi về ô vuông chứ không làm hỏng màn hình', () => {
    expect(decodeView('?xem=xyz').layout).toBe('cards')
    expect(decodeView('?xem=').layout).toBe('cards')
    expect(decodeView('').layout).toBe('cards')
  })
})
