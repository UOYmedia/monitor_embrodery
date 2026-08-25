import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Canh bảng đếm ở §4.5 của PRD khớp với chính các dòng ca test ở trên nó.
 *
 * Vì sao cần: PRD tự nhận "*Bảng này đếm bằng máy, không đếm tay*" — nhưng cho tới hôm nay
 * KHÔNG có cái máy nào đếm cả, câu đó chỉ là lời hứa. Và nó đã sai thật: 25/08 dòng nhóm S ghi
 * `10 🟩 / 1 ✅` trong khi đếm thật là `11 🟩 / 0 ✅`.
 *
 * Vì sao đáng canh chứ không phải chuyện làm đẹp: bảng đếm là thứ DUY NHẤT bên nhận đọc để
 * quyết định "phần này xong chưa". Một con số phồng lên vài đơn vị ở đây đắt hơn nhiều so với
 * một bài test đỏ, vì nó không đỏ — nó chỉ lặng lẽ nói quá.
 */

const prd = readFileSync(fileURLToPath(new URL('../PRD_TUYEN_A15_BAN_GIAO.md', import.meta.url)), 'utf8')

const DAU = ['🟩', '✅', '🟡', '🔴']

/** Mọi dòng ca test: `| K‑01 | … | <dấu> |`. Chấp cả hậu tố chữ (K‑14d, K‑20c). */
function demTheoNhom() {
  const dem = { K: {}, S: {}, L: {}, P: {} }
  for (const nhom of Object.keys(dem)) for (const d of DAU) dem[nhom][d] = 0
  const re = /^\| ([KSLP])‑([0-9]+[a-z]?) \|.*\| ([^|]+) \|\s*$/gm
  let m
  while ((m = re.exec(prd)) !== null) {
    const dau = m[3].trim()
    if (DAU.includes(dau)) dem[m[1]][dau] += 1
  }
  return dem
}

/** Bảng ở §4.5: `| K — Kết nối | 26 | **21** | **0** | 3 | 2 |`. */
function docBangDem() {
  const ra = {}
  const re = /^\| ([KSLP]) — [^|]+\| *(\d+) *\| *\**(\d+)\** *\| *\**(\d+)\** *\| *\**(\d+)\** *\| *\**(\d+)\** *\|\s*$/gm
  let m
  while ((m = re.exec(prd)) !== null) {
    ra[m[1]] = { tong: +m[2], '🟩': +m[3], '✅': +m[4], '🟡': +m[5], '🔴': +m[6] }
  }
  const cong = /^\| \*\*Cộng\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \|\s*$/m.exec(prd)
  if (cong) ra.CONG = { tong: +cong[1], '🟩': +cong[2], '✅': +cong[3], '🟡': +cong[4], '🔴': +cong[5] }
  return ra
}

describe('PRD_TUYEN_A15_BAN_GIAO.md §4.5 — bảng đếm', () => {
  const thuc = demTheoNhom()
  const khai = docBangDem()

  it('đọc được cả bốn dòng nhóm và dòng Cộng', () => {
    expect(Object.keys(khai).sort(), 'định dạng bảng đã đổi — sửa regex ở đây trước khi tin số nào cả')
      .toEqual(['CONG', 'K', 'L', 'P', 'S'])
  })

  for (const nhom of ['K', 'S', 'L', 'P']) {
    it(`nhóm ${nhom}: số khai khớp số dòng đếm được`, () => {
      const dem = thuc[nhom]
      expect({ tong: DAU.reduce((t, d) => t + dem[d], 0), ...dem }, `nhóm ${nhom} khai sai so với các dòng ca test ngay phía trên`)
        .toEqual(khai[nhom])
    })
  }

  it('dòng Cộng đúng bằng tổng bốn nhóm', () => {
    const cong = { tong: 0, '🟩': 0, '✅': 0, '🟡': 0, '🔴': 0 }
    for (const nhom of ['K', 'S', 'L', 'P']) {
      for (const d of DAU) { cong[d] += thuc[nhom][d]; cong.tong += thuc[nhom][d] }
    }
    expect(cong).toEqual(khai.CONG)
  })

  it('không có ca nào mang dấu lạ', () => {
    // Một dấu gõ nhầm (ví dụ ✔ thay vì ✅) sẽ rơi khỏi mọi phép đếm — dòng đó biến mất khỏi bảng
    // mà không ai hay, và tổng vẫn khớp vì cả hai bên cùng bỏ sót nó.
    const soDong = (prd.match(/^\| [KSLP]‑[0-9]+[a-z]? \|/gm) ?? []).length
    const soDem = ['K', 'S', 'L', 'P'].reduce((t, n) => t + DAU.reduce((x, d) => x + thuc[n][d], 0), 0)
    expect(soDem, 'có dòng ca test mang dấu ngoài 🟩 ✅ 🟡 🔴').toBe(soDong)
  })
})
