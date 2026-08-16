import { describe, expect, it } from 'vitest'
import { describeDesign } from './design'

describe('describeDesign', () => {
  it('khớp đúng tên thì không kèm chữ nào trong ô — chỉ có hình', () => {
    const described = describeDesign({ status: 'found', matchedFile: '73_4096_Hoa.dst' }, '73_4096_Hoa.dst')
    expect(described.short).toBe('')
    expect(described.full).toContain('73_4096_Hoa.dst')
  })

  /**
   * Khớp theo tiền tố là *suy ra*, không phải *đọc được*. Câu đầy đủ phải nói ra cả hai tên để
   * người vận hành tự đối chiếu được — nếu chỉ hiện ảnh thì không có cách nào biết nó là suy ra.
   */
  it('khớp theo tên rút gọn thì nói rõ controller báo gì và thư viện có gì', () => {
    const described = describeDesign(
      { status: 'found', matchedFile: '73_4096_Hoa.dst', viaPrefix: true },
      '73_4096~.DST',
    )
    expect(described.full).toContain('73_4096~.DST')
    expect(described.full).toContain('73_4096_Hoa.dst')
  })

  /** Ba lý do "không có ảnh" dẫn tới ba việc phải làm khác nhau, nên ba nhãn phải khác nhau. */
  it('mỗi lý do không có ảnh là một nhãn riêng, không gộp thành một câu chung', () => {
    const labels = (['disabled', 'missing', 'ambiguous', 'invalid-name', 'unreadable'] as const)
      .map((status) => describeDesign({ status }, 'x.dst').short)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('trùng tên rút gọn thì liệt kê các mẫu trùng, không chọn đại một cái', () => {
    const described = describeDesign(
      { status: 'ambiguous', candidates: ['80_4127_LogoAnhChi.DST', '80_4127_LogoAnhHai.DST'] },
      '80_4127~.DST',
    )
    expect(described.full).toContain('80_4127_LogoAnhChi.DST')
    expect(described.full).toContain('80_4127_LogoAnhHai.DST')
  })

  it('chưa tra xong khác hẳn tra xong mà không có', () => {
    expect(describeDesign(undefined, 'x.dst').short).not.toBe(describeDesign({ status: 'missing' }, 'x.dst').short)
  })

  it('controller chưa đọc được tên mẫu thì nói đúng là chưa đọc được, không nói là thiếu file', () => {
    expect(describeDesign(undefined, null).full).toContain('Chưa đọc được tên mẫu')
  })
})
