import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDesignLibrary } from './design-library.mjs'

/** Một DST tối thiểu nhưng thật: header 512 byte rồi vài mũi rồi dấu kết thúc. */
function tinyDst() {
  const header = Buffer.alloc(512, 0x20)
  header.write('LA:TEST\r', 0, 'latin1')
  header[511] = 0x1a
  // +81 x, rồi +81 y, rồi kết thúc.
  return Buffer.concat([header, Buffer.from([0x00, 0x00, 0x07, 0x00, 0x00, 0x23, 0x00, 0x00, 0xf3])])
}

let dir
let library

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dahao-designs-'))
  for (const name of ['80_4127_LogoAnhChi.DST', '80_4127_LogoAnhHai.DST', '73_4096_Hoa.dst', 'khong-phai-mau.txt']) {
    await writeFile(join(dir, name), name.endsWith('.txt') ? 'x' : tinyDst())
  }
  library = createDesignLibrary({ path: dir })
  await library.refreshIndex()
})

afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('createDesignLibrary', () => {
  it('chỉ nhận file .DST, bỏ qua thứ khác trong thư mục', () => {
    expect(library.status().files).toBe(3)
  })

  it('khớp đúng nguyên tên, không phân biệt hoa thường', () => {
    expect(library.resolve('73_4096_Hoa.DST')).toMatchObject({ status: 'found' })
    expect(library.resolve('73_4096_hoa.dst').entry.name).toBe('73_4096_Hoa.dst')
  })

  /**
   * Đây là lý do cả file này tồn tại. Controller báo `80_4127~.DST`; trong thư viện có hai mẫu
   * cùng bắt đầu bằng `80_4127`. Lấy đại một cái là hiện **ảnh mẫu sai** ngay cạnh tên máy, mà
   * người đứng máy không có cách nào biết là nó sai — tệ hơn hẳn không có ảnh.
   */
  it('tên rút gọn trùng nhiều mẫu thì từ chối đoán', () => {
    const found = library.resolve('80_4127~.DST')
    expect(found.status).toBe('ambiguous')
    expect(found.candidates).toHaveLength(2)
  })

  it('tên rút gọn khớp duy nhất một mẫu thì lấy, và nói rõ là khớp theo tiền tố', () => {
    const found = library.resolve('73_4096~.DST')
    expect(found).toMatchObject({ status: 'found', viaPrefix: true })
    expect(found.entry.name).toBe('73_4096_Hoa.dst')
  })

  it('tên đủ mà không có trong thư viện thì là "missing", không phải đi dò tiền tố', () => {
    expect(library.resolve('99_9999_KhongCo.DST').status).toBe('missing')
  })

  /** Tên do controller gửi lên. Không cho nó thành đường dẫn, và cũng không im lặng bỏ qua. */
  it('tên có ký tự đường dẫn bị từ chối', () => {
    expect(library.resolve('../../etc/passwd').status).toBe('invalid-name')
    expect(library.resolve('a/b.dst').status).toBe('invalid-name')
    expect(library.resolve('').status).toBe('invalid-name')
  })

  it('dựng được SVG và kèm số đo đọc từ chính file', async () => {
    const result = await library.thumbnail('73_4096_Hoa.dst')
    expect(result.status).toBe('found')
    expect(result.svg).toContain('<path')
    expect(result.meta).toMatchObject({ file: '73_4096_Hoa.dst', stitches: 2, colorBlocks: 1 })
  })

  it('chưa cấu hình thư viện thì trả "disabled", không trả ảnh rỗng', async () => {
    const off = createDesignLibrary({ path: null })
    expect(off.enabled).toBe(false)
    expect((await off.thumbnail('bat-ky.dst')).status).toBe('disabled')
  })

  it('thư mục không tồn tại thì nói rõ là không đọc được, không phải là không có mẫu', async () => {
    const broken = createDesignLibrary({ path: join(dir, 'khong-co-thu-muc-nay') })
    const result = await broken.thumbnail('73_4096_Hoa.dst')
    expect(result.status).toBe('unreadable')
    expect(result.reason).toMatch(/Không thấy thư mục/)
  })

  it('file .DST hỏng thì báo không đọc được chứ không dựng ảnh trống', async () => {
    const bad = await mkdtemp(join(tmpdir(), 'dahao-bad-'))
    await writeFile(join(bad, 'hong.dst'), Buffer.alloc(600))
    const broken = createDesignLibrary({ path: bad })
    const result = await broken.thumbnail('hong.dst')
    expect(result.status).toBe('unreadable')
    await rm(bad, { recursive: true, force: true })
  })
})
