/**
 * Đọc `enum-growth.csv` của enumerator thành đường cong khám phá.
 *
 * Định nghĩa "đầy" lấy đúng từ `PRD_DO_THOI_GIAN_DAY_CATALOG.md` mục 3: catalog gọi là **bão hoà**
 * khi đã qua K chu kỳ báo cáo liên tiếp mà không sinh thêm field mới nào.
 *
 * Cảnh báo đã ghi trong PRD và phải nhắc lại ở đây: bão hoà lúc máy NHÀN RỖI là một **đáy giả**.
 * 20 phút không thấy field mới không có nghĩa đã hết field, chỉ có nghĩa máy chưa chạy.
 */

export const CHU_KY_GIAY = 30

export function docCsv(text) {
  const dong = text.trim().split('\n').filter(Boolean)
  if (dong.length === 0) return []
  const [dau, ...con] = dong
  const cot = dau.split(',')
  if (cot[0] !== 'ts') throw new Error('enum-growth.csv thiếu dòng tiêu đề')
  return con.map((d) => {
    const o = Object.fromEntries(d.split(',').map((v, i) => [cot[i], v]))
    return {
      ts: o.ts,
      nTopics: Number(o.nTopics),
      nStates: Number(o.nStates),
      nFields: Number(o.nFields),
      moi: Number(o.newFieldsThisCycle),
    }
  })
}

/**
 * @param {number} K số chu kỳ sạch liên tiếp mới gọi là bão hoà (PRD chọn 20 ≈ 10 phút)
 */
export function phanTich(hang, { K = 20 } = {}) {
  if (hang.length === 0) return { soChuKy: 0, baoHoa: false, ketLuan: 'Chưa có dữ liệu.' }

  const dau = Date.parse(hang[0].ts)
  const cuoi = Date.parse(hang.at(-1).ts)
  const phut = Number.isFinite(dau) && Number.isFinite(cuoi) ? (cuoi - dau) / 60_000 : null

  // Mốc khám phá cuối cùng: chu kỳ gần nhất còn sinh field mới.
  let chiSoCuoiCungCoMoi = -1
  hang.forEach((h, i) => { if (h.moi > 0) chiSoCuoiCungCoMoi = i })

  const chuKySach = hang.length - 1 - chiSoCuoiCungCoMoi
  const baoHoa = chuKySach >= K

  const tongField = hang.at(-1).nFields
  const soState = hang.at(-1).nStates

  return {
    soChuKy: hang.length,
    phutChay: phut,
    tongField,
    soState,
    chuKySach,
    baoHoa,
    // Đây là câu quan trọng nhất của cả module: bão hoà với ÍT trạng thái là đáy giả.
    dayGia: baoHoa && soState <= 2,
    ketLuan: !baoHoa
      ? `Chưa bão hoà: mới ${chuKySach}/${K} chu kỳ sạch.`
      : soState <= 2
        ? `Bão hoà sau ${chuKySach} chu kỳ sạch, NHƯNG mới thấy ${soState} trạng thái — đây là đáy giả của máy nhàn rỗi, không phải đã hết field.`
        : `Bão hoà: ${chuKySach} chu kỳ sạch qua ${soState} trạng thái.`,
  }
}
