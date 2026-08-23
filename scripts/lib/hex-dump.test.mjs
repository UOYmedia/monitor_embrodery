import { describe, expect, it } from 'vitest'
import { hexDump } from './hex-dump.mjs'

describe('hexDump', () => {
  it('in offset, hex và chữ đọc được của cùng một byte', () => {
    const [line] = hexDump(Buffer.from('DAHAO'))
    expect(line).toContain('00000000')
    expect(line).toContain('44 41 48 41 4f')
    expect(line).toContain('|DAHAO|')
  })

  it('byte không in được hiện thành dấu chấm, không bị bỏ mất', () => {
    const [line] = hexDump(Buffer.from([0x00, 0x1f, 0x41, 0x7f, 0xff]))
    expect(line).toContain('00 1f 41 7f ff')
    expect(line).toContain('|..A..|')
  })

  it('offset chạy tiếp qua từng dòng nên đọc được vị trí thật trong luồng', () => {
    const lines = hexDump(Buffer.alloc(33))
    expect(lines).toHaveLength(3)
    expect(lines[1].startsWith('00000010')).toBe(true)
    expect(lines[2].startsWith('00000020')).toBe(true)
  })

  it('nhận offset ngoài vào để đọc socket theo từng khúc mà địa chỉ vẫn liền', () => {
    const [line] = hexDump(Buffer.from([0xab]), { offset: 4096 })
    expect(line.startsWith('00001000')).toBe(true)
  })

  it('dòng cuối ngắn vẫn thẳng cột với dòng đủ 16 byte', () => {
    const lines = hexDump(Buffer.alloc(17))
    const bar = (line) => line.indexOf('|')
    expect(bar(lines[1])).toBe(bar(lines[0]))
  })

  it('không có byte nào thì không in dòng nào', () => {
    expect(hexDump(Buffer.alloc(0))).toEqual([])
  })
})
