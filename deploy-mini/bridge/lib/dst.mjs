/**
 * Đọc file thêu Tajima `.DST` để dựng **ảnh mẫu** — chỉ đọc, không ghi, không gửi đi đâu.
 *
 * Vì sao cần: màn hình controller hiện thumbnail của mẫu đang thêu vì nó **giữ file** trong bộ
 * nhớ. Dashboard chỉ nhận được cái tên (`80_4127~.DST`) qua telemetry, không nhận được file. Nên
 * muốn có ảnh thì phải dựng lại từ chính file mà xưởng đã có — thư viện mẫu đặt trên máy chạy
 * bridge. Đây là đọc một file trên đĩa của xưởng, không phải hỏi controller, không phải đoán.
 *
 * DST là định dạng công khai của Tajima, không phải giao thức riêng của Dahao: 512 byte header
 * ASCII, rồi các bản ghi 3 byte cho tới `0x00 0x00 0xF3`. Mỗi bản ghi là một **bước dời** tính
 * theo đơn vị 0,1 mm, mã hoá bit chứ không phải số nguyên — nên bảng bit dưới đây là bảng của
 * đặc tả, chép đúng, không suy diễn.
 *
 * Cái file **không** chứa: màu chỉ. Màu trên màn hình controller là do máy gán kim → chỉ, nằm
 * ngoài file. Nên ảnh dựng ra là ảnh một màu; tô màu cho các khối chỉ là bịa ra thông tin không
 * có trong nguồn.
 */

/** 512 byte header rồi tới thân file. Ngắn hơn thì không phải DST. */
const headerBytes = 512
const recordBytes = 3

/** Bảng bit của đặc tả DST: mỗi bit cộng/trừ một lượng cố định vào dx hoặc dy. */
const deltas = [
  // [chỉ số byte, mặt nạ bit, cộng vào x, cộng vào y]
  [0, 0x01, +1, 0], [0, 0x02, -1, 0], [0, 0x04, +9, 0], [0, 0x08, -9, 0],
  [0, 0x80, 0, +1], [0, 0x40, 0, -1], [0, 0x20, 0, +9], [0, 0x10, 0, -9],
  [1, 0x01, +3, 0], [1, 0x02, -3, 0], [1, 0x04, +27, 0], [1, 0x08, -27, 0],
  [1, 0x80, 0, +3], [1, 0x40, 0, -3], [1, 0x20, 0, +27], [1, 0x10, 0, -27],
  [2, 0x04, +81, 0], [2, 0x08, -81, 0],
  [2, 0x20, 0, +81], [2, 0x10, 0, -81],
]

export class DstError extends Error {}

/** Header DST là ASCII dạng `LA:tên\r`, `ST:12345\r`… Thiếu trường nào thì trả null, không đoán. */
function readHeader(buffer) {
  const text = buffer.toString('latin1', 0, headerBytes)
  const field = (code) => {
    const match = text.match(new RegExp(`${code}:([^\\r\\n]*)`))
    return match ? match[1].trim() : null
  }
  const number = (code) => {
    const raw = field(code)
    if (raw === null) return null
    const parsed = Number(raw.replace(/[^\d-]/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return { label: field('LA'), stitchesDeclared: number('ST'), colorChangesDeclared: number('CO') }
}

/**
 * Trả về các nét rời nhau (jump cắt nét) theo đơn vị 0,1 mm, kèm khung bao thật đo từ mũi kim.
 *
 * Dùng khung bao đo được chứ không dùng `+X/-X` trong header: header do phần mềm ghi ra và có
 * file ghi sai, còn toạ độ thì chính là thứ sẽ vẽ. Sai khung bao là ảnh méo hoặc lệch khỏi ô.
 */
export function parseDst(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new DstError('Cần Buffer.')
  if (buffer.length < headerBytes + recordBytes) throw new DstError('File ngắn hơn một header DST hợp lệ.')

  const header = readHeader(buffer)
  const strokes = []
  let current = []
  let x = 0
  let y = 0
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  let stitches = 0
  let colorChanges = 0
  let ended = false

  function grow(px, py) {
    current.push([px, py])
    if (px < minX) minX = px
    if (px > maxX) maxX = px
    if (py < minY) minY = py
    if (py > maxY) maxY = py
  }

  for (let at = headerBytes; at + recordBytes <= buffer.length; at += recordBytes) {
    const bytes = [buffer[at], buffer[at + 1], buffer[at + 2]]
    if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0xf3) { ended = true; break }

    const fromX = x
    const fromY = y
    for (const [index, mask, ax, ay] of deltas) {
      if (bytes[index] & mask) { x += ax; y += ay }
    }

    // `0xC3` trong 2 bit cao + 2 bit thấp là đổi màu; chỉ bit 0x80 là mũi nhảy (kim không xuống).
    const isColorChange = (bytes[2] & 0xc3) === 0xc3
    const isJump = !isColorChange && (bytes[2] & 0x80) !== 0

    if (isColorChange) {
      colorChanges += 1
      if (current.length > 1) strokes.push(current)
      current = [[x, y]]
      continue
    }
    if (isJump) {
      // Mũi nhảy là kim đi trên không: cắt nét, nếu không ảnh sẽ đầy những đường thẳng ngang
      // nối hai cụm hoa văn cách nhau — thứ không hề có trên vải.
      if (current.length > 1) strokes.push(current)
      current = [[x, y]]
      continue
    }

    stitches += 1
    // Nét bắt đầu từ chỗ kim **đang đứng**, không phải chỗ nó vừa tới: bỏ điểm gốc thì mũi đầu
    // của mỗi nét biến mất và nét bị hụt một đoạn.
    if (current.length === 0) grow(fromX, fromY)
    grow(x, y)
  }
  if (current.length > 1) strokes.push(current)

  if (stitches === 0) throw new DstError('Không đọc được mũi kim nào — file hỏng hoặc không phải DST.')
  // Một file toàn byte 0 vẫn "giải mã" thành hàng nghìn mũi đứng yên tại chỗ. Nó không phải
  // mẫu thêu, và dựng ảnh từ nó cho ra một ô trống trông y như ảnh đang tải.
  if (maxX === minX && maxY === minY) throw new DstError('Mẫu không có kích thước — file hỏng hoặc không phải DST.')

  return {
    header,
    strokes,
    stitches,
    /** Số khối chỉ = số lần đổi màu + 1. Không suy ra được **màu** nào, chỉ ra được bao nhiêu khối. */
    colorBlocks: colorChanges + 1,
    ended,
    bounds: { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY },
  }
}

/**
 * Bỏ bớt điểm để SVG còn nhẹ, giữ nguyên hình.
 *
 * Một mẫu logo thật cỡ 46 000 mũi; ghi thẳng ra SVG là ~500 KB cho **một** ô trong lưới máy, tức
 * là màn hình 20 máy tải 10 MB qua Wi-Fi xưởng. Bỏ điểm nào mà bỏ đi mắt không thấy khác: điểm
 * cách điểm trước dưới `tolerance` đơn vị. Luôn giữ điểm đầu và điểm cuối của mỗi nét, nếu không
 * nét sẽ cụt.
 */
export function simplify(strokes, tolerance) {
  if (!(tolerance > 0)) return strokes
  const out = []
  for (const stroke of strokes) {
    const kept = [stroke[0]]
    for (let i = 1; i < stroke.length - 1; i += 1) {
      const [px, py] = kept[kept.length - 1]
      const [cx, cy] = stroke[i]
      if (Math.abs(cx - px) + Math.abs(cy - py) >= tolerance) kept.push(stroke[i])
    }
    if (stroke.length > 1) kept.push(stroke[stroke.length - 1])
    if (kept.length > 1) out.push(kept)
  }
  return out
}

/** Escape cho nội dung XML — tên mẫu do controller gửi lên, không được coi là an toàn. */
function xmlEscape(value) {
  return String(value).replace(/[<>&"']/g, (char) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char]
  ))
}

/**
 * Dựng SVG một màu từ kết quả `parseDst`.
 *
 * Một màu, không tô màu theo khối: DST không chứa màu chỉ (xem đầu file). Vẽ bảy màu rực rỡ cho
 * bảy khối trông giống màn hình controller hơn, nhưng đó là bảy màu bịa.
 */
export function renderDstSvg(design, { title, maxPoints = 3_000, stroke = '#1f3550' } = {}) {
  const { bounds } = design
  const span = Math.max(bounds.width, bounds.height, 1)
  const totalPoints = design.strokes.reduce((sum, stroke_) => sum + stroke_.length, 0)
  // Dung sai suy từ chính kích thước mẫu, nên mẫu bé không bị bỏ mất chi tiết còn mẫu to không
  // ra file khổng lồ.
  const tolerance = totalPoints > maxPoints ? (span / 200) * Math.sqrt(totalPoints / maxPoints) : 0
  const strokes = simplify(design.strokes, tolerance)

  const path = strokes
    .map((points) => points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(0)} ${(-y).toFixed(0)}`).join(''))
    .join('')

  // Toạ độ DST có trục y hướng lên, SVG hướng xuống → lật dấu y ở trên rồi lật luôn khung nhìn.
  const pad = Math.round(span * 0.04) + 1
  const viewBox = `${bounds.minX - pad} ${-bounds.maxY - pad} ${bounds.width + pad * 2} ${bounds.height + pad * 2}`
  const width = Math.max(1, Math.round(bounds.width / 10))
  const height = Math.max(1, Math.round(bounds.height / 10))

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img"`,
    ` aria-label="${xmlEscape(title ?? 'Mẫu thêu')}" preserveAspectRatio="xMidYMid meet">`,
    `<title>${xmlEscape(title ?? 'Mẫu thêu')} — ${width}×${height} mm, ${design.stitches} mũi, ${design.colorBlocks} khối chỉ</title>`,
    `<path d="${path}" fill="none" stroke="${stroke}" stroke-width="${Math.max(1, span / 400).toFixed(2)}"`,
    ' stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>',
    '</svg>',
  ].join('')
}

export const dstInternals = { headerBytes, recordBytes }
