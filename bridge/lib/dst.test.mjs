import { describe, expect, it } from 'vitest'
import { DstError, parseDst, renderDstSvg, simplify } from './dst.mjs'

/**
 * Không có file `.DST` thật trong repo, nên test tự **ghi ra** byte đúng theo đặc tả Tajima rồi
 * đọc lại. Đó là kiểm tra bảng bit, chứ không phải kiểm tra một file mẫu ai đó đã sinh sẵn —
 * nếu bảng bit chép sai thì hình dựng ra sẽ méo mà không có gì báo.
 */

/**
 * Mã hoá một bước dời theo đúng bảng bit của đặc tả.
 *
 * Mỗi mức (1/3/9/27/81) có **một** bit cộng và **một** bit trừ, nên mỗi mức đóng góp đúng một
 * lần với dấu `+`, `-` hoặc `0` — tức là **ba ternary cân bằng**. Hệ quả: một bản ghi dời được
 * tối đa ±121, và *mọi* số nguyên trong khoảng đó đều mã hoá được, không phải chỉ vài số.
 *
 * Bản đầu của hàm này chia tham lam (`x >= size` thì trừ dần) nên nó ghi hụt những số cần một
 * mức mang dấu âm — 100 = 81+27−9+1 chẳng hạn — mà không báo gì. Vẫn ném lỗi nếu còn dư, để
 * test không bao giờ "pass" trên dữ liệu do chính nó ghi sai.
 */
function encodeStitch(dx, dy, kind = 'stitch') {
  const bytes = [0, 0, kind === 'color' ? 0xc3 : kind === 'jump' ? 0x83 : 0x03]
  // Từ mức nhỏ tới mức lớn: 1, 3, 9, 27, 81.
  const levels = [
    [0, 0x01, 0x02, 0x80, 0x40],
    [1, 0x01, 0x02, 0x80, 0x40],
    [0, 0x04, 0x08, 0x20, 0x10],
    [1, 0x04, 0x08, 0x20, 0x10],
    [2, 0x04, 0x08, 0x20, 0x10],
  ]
  let x = dx
  let y = dy
  for (const [index, plusX, minusX, plusY, minusY] of levels) {
    const digitX = [0, 1, -1][((x % 3) + 3) % 3]
    const digitY = [0, 1, -1][((y % 3) + 3) % 3]
    if (digitX > 0) bytes[index] |= plusX
    else if (digitX < 0) bytes[index] |= minusX
    if (digitY > 0) bytes[index] |= plusY
    else if (digitY < 0) bytes[index] |= minusY
    x = (x - digitX) / 3
    y = (y - digitY) / 3
  }
  if (x !== 0 || y !== 0) throw new Error(`Bước ${dx},${dy} không mã hoá được trong một bản ghi DST.`)
  return bytes
}

function buildDst(moves, { label = 'TEST' } = {}) {
  const header = Buffer.alloc(512, 0x20)
  header.write(`LA:${label}\r`, 0, 'latin1')
  header[511] = 0x1a
  const body = []
  for (const move of moves) body.push(...encodeStitch(move[0], move[1], move[2]))
  body.push(0x00, 0x00, 0xf3)
  return Buffer.concat([header, Buffer.from(body)])
}

/** Hình vuông 81×81 đơn vị (8,1×8,1 mm), đi bốn cạnh. 81 là mức lớn nhất mã hoá được một nhát. */
const square = [[81, 0], [0, 81], [-81, 0], [0, -81]]

describe('parseDst', () => {
  it('giải mã đúng bước dời và khung bao', () => {
    const design = parseDst(buildDst(square))
    expect(design.stitches).toBe(4)
    expect(design.bounds).toMatchObject({ minX: 0, maxX: 81, minY: 0, maxY: 81, width: 81, height: 81 })
    expect(design.ended).toBe(true)
    expect(design.header.label).toBe('TEST')
  })

  /**
   * Nét phải bắt đầu từ chỗ kim đang đứng. Bản đầu đẩy điểm *sau khi* dời vào hai lần, nên nét
   * mở đầu bằng `M81 0L81 0` — mất hẳn cạnh đầu tiên của hình vuông và khung bao lệch đi 81.
   */
  it('nét bắt đầu từ vị trí kim trước khi dời, không phải sau', () => {
    const design = parseDst(buildDst(square))
    expect(design.strokes[0][0]).toEqual([0, 0])
    expect(design.strokes[0][1]).toEqual([81, 0])
  })

  it('giải mã được bước âm và bước lớn cần nhiều bit cộng lại', () => {
    // 121 = 81+27+9+3+1, tức là dùng cả năm mức cùng lúc — chỗ dễ chép sai nhất trong bảng bit.
    // 100 = 81+27−9+1 trộn cả bit cộng lẫn bit trừ trong cùng một bản ghi.
    const design = parseDst(buildDst([[121, 121], [-121, -121], [40, -40], [100, 0], [-100, 0]]))
    expect(design.bounds).toMatchObject({ minX: 0, maxX: 140, minY: -40, maxY: 121 })
  })

  /**
   * Mũi nhảy là kim đi trên không giữa hai cụm hoa văn. Nối liền nó vào nét là vẽ thêm một
   * đường thẳng dài không hề có trên vải — đúng thứ làm ảnh thumbnail trông như bị gạch chéo.
   */
  it('mũi nhảy cắt nét chứ không nối liền', () => {
    const design = parseDst(buildDst([[10, 0], [10, 0], [81, 81, 'jump'], [10, 0], [10, 0]]))
    expect(design.strokes).toHaveLength(2)
    expect(design.stitches).toBe(4)
  })

  it('đếm khối chỉ theo số lần đổi màu, và không bịa ra màu nào', () => {
    const design = parseDst(buildDst([[10, 0], [0, 0, 'color'], [10, 0], [0, 0, 'color'], [10, 0]]))
    expect(design.colorBlocks).toBe(3)
    expect(design).not.toHaveProperty('colors')
  })

  it('file cụt vẫn đọc được phần đã có nhưng `ended` là false', () => {
    const full = buildDst(square)
    const design = parseDst(full.subarray(0, full.length - 6))
    expect(design.ended).toBe(false)
    expect(design.stitches).toBe(3)
  })

  /**
   * 600 byte 0x00 "giải mã" trót lọt thành 29 mũi đứng nguyên tại gốc — không byte nào sai đặc
   * tả cả. Nếu không chặn, nó ra một ô trống trông y hệt ảnh đang tải.
   */
  it('từ chối file không phải DST thay vì trả hình rỗng', () => {
    expect(() => parseDst(Buffer.alloc(20))).toThrow(DstError)
    expect(() => parseDst(Buffer.alloc(600))).toThrow(/không có kích thước/)
  })
})

describe('simplify', () => {
  it('bỏ điểm sát nhau nhưng luôn giữ điểm đầu và điểm cuối', () => {
    const stroke = Array.from({ length: 50 }, (_, index) => [index, 0])
    const [kept] = simplify([stroke], 10)
    expect(kept[0]).toEqual([0, 0])
    expect(kept[kept.length - 1]).toEqual([49, 0])
    expect(kept.length).toBeLessThan(10)
  })

  it('dung sai 0 thì không đụng gì', () => {
    const strokes = [[[0, 0], [1, 1]]]
    expect(simplify(strokes, 0)).toBe(strokes)
  })
})

describe('renderDstSvg', () => {
  it('lật trục y: DST đi lên, SVG đi xuống', () => {
    const svg = renderDstSvg(parseDst(buildDst(square)))
    // Điểm cao nhất của mẫu (y = 81) phải thành y âm nhất trong path.
    expect(svg).toContain('M0 0')
    expect(svg).toContain('L81 -81')
    expect(svg).toMatch(/viewBox="-\d+ -8\d \d+ \d+"/)
  })

  it('escape tên mẫu — tên do controller gửi lên, không mặc định là an toàn', () => {
    const svg = renderDstSvg(parseDst(buildDst(square)), { title: '<script>alert(1)</script>' })
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
  })

  /** Một logo thật cỡ 46 000 mũi. Ghi thẳng ra là ~500 KB cho một ô trong lưới máy. */
  it('mẫu lớn được giản lược để SVG còn nhẹ', () => {
    const moves = Array.from({ length: 20_000 }, (_, index) => [index % 2 === 0 ? 1 : -1, 1])
    const svg = renderDstSvg(parseDst(buildDst(moves)))
    expect(svg.length).toBeLessThan(80_000)
    expect(svg).toContain('<path')
  })
})
