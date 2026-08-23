import { describe, expect, it } from 'vitest'
import { docCsv, phanTich } from './growth-curve.mjs'

const csv = (dong) => ['ts,nTopics,nStates,nFields,newFieldsThisCycle', ...dong].join('\n')
const chuKy = (i, nFields, moi, nStates = 2) =>
  `2026-08-23T00:${String(i).padStart(2, '0')}:00Z,3,${nStates},${nFields},${moi}`

describe('đọc enum-growth.csv', () => {
  it('bỏ qua tiêu đề và đọc đúng các cột', () => {
    const h = docCsv(csv([chuKy(0, 13, 13), chuKy(1, 13, 0)]))
    expect(h).toHaveLength(2)
    expect(h[0].nFields).toBe(13)
    expect(h[1].moi).toBe(0)
  })

  it('file rỗng không làm sập, trả về danh sách rỗng', () => {
    expect(docCsv('')).toEqual([])
  })

  it('thiếu tiêu đề thì báo lỗi chứ không đọc nhầm dòng dữ liệu đầu thành tên cột', () => {
    expect(() => docCsv('2026-08-23T00:00:00Z,3,2,13,0')).toThrow(/tiêu đề/)
  })
})

describe('đường cong bão hoà', () => {
  it('chưa đủ chu kỳ sạch thì nói thẳng là chưa bão hoà', () => {
    const h = docCsv(csv([chuKy(0, 13, 13), ...Array.from({ length: 5 }, (_, i) => chuKy(i + 1, 13, 0))]))
    const k = phanTich(h, { K: 20 })
    expect(k.baoHoa).toBe(false)
    expect(k.ketLuan).toMatch(/5\/20/)
  })

  it('GỌI ĐÚNG TÊN đáy giả: bão hoà với 2 trạng thái là máy nhàn rỗi, không phải hết field', () => {
    // Đây là cái bẫy chính của cả phép đo. Một báo cáo nói "đã đầy" sau 30 giờ máy đứng im
    // sẽ khiến người ta đóng việc lại, trong khi trạng thái chạy/đứt chỉ chưa từng lộ ra.
    const h = docCsv(csv([chuKy(0, 13, 13), ...Array.from({ length: 25 }, (_, i) => chuKy(i + 1, 13, 0))]))
    const k = phanTich(h, { K: 20 })
    expect(k.baoHoa).toBe(true)
    expect(k.dayGia).toBe(true)
    expect(k.ketLuan).toMatch(/đáy giả/)
  })

  it('bão hoà thật khi đã đi qua nhiều trạng thái', () => {
    const h = docCsv(csv([chuKy(0, 13, 13, 5), ...Array.from({ length: 25 }, (_, i) => chuKy(i + 1, 40, 0, 5))]))
    const k = phanTich(h, { K: 20 })
    expect(k.dayGia).toBe(false)
    expect(k.ketLuan).toMatch(/5 trạng thái/)
  })

  it('field mới xuất hiện muộn làm đồng hồ chu kỳ sạch chạy lại từ đầu', () => {
    const h = docCsv(csv([
      chuKy(0, 13, 13),
      ...Array.from({ length: 20 }, (_, i) => chuKy(i + 1, 13, 0)),
      chuKy(21, 15, 2),
      chuKy(22, 15, 0),
    ]))
    const k = phanTich(h, { K: 20 })
    expect(k.chuKySach).toBe(1)
    expect(k.baoHoa).toBe(false)
  })
})
