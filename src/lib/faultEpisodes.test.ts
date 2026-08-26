import { describe, expect, it } from 'vitest'
import { CHUA_BIET_VI, dauMoLai, maNguyenVan, moTaThoiLuong, nghiaKetThuc, tienToBatDau } from './faultEpisodes'
import type { FaultEpisode } from '../types/fleet'

/**
 * Các trường ở đây phải trùng với bản hợp nhất mà `bridge/lib/fault-episodes.mjs` trả ra
 * (`docHopNhat`). Hai bên lệch nhau thì màn hình sẽ đọc một trường không tồn tại và im lặng
 * hiện ra `undefined` — đúng kiểu lỗi mà không test nào ở tầng dưới bắt được.
 */
function lanLoi(overrides: Partial<FaultEpisode> = {}): FaultEpisode {
  return {
    episodeId: 'ep-1',
    machineId: 'm-1',
    siteId: 'xuong-1',
    batDau: '2026-08-25T08:00:00.000Z',
    ketThuc: '2026-08-25T08:12:30.000Z',
    thoiLuongGiay: 750,
    dangMo: false,
    lyDoDong: 'controller-bao-trang-thai-khac',
    chuaBietVi: null,
    trangThaiSau: 'running',
    ma: 'E12',
    moTa: 'Đứt chỉ kim 3',
    previousEpisodeId: null,
    batDauUocChung: false,
    mocDangNgo: false,
    ghiLuc: '2026-08-25T08:12:30.100Z',
    daMoLai: false,
    soLanMoLai: 0,
    moLaiLuc: null,
    moLaiBoi: null,
    lyDoMoLai: null,
    cauChu: 'Controller báo máy rời trạng thái lỗi.',
    ...overrides,
  }
}

describe('moTaThoiLuong — ô "kéo dài" (L‑27)', () => {
  it('khoảng đo được thì hiện ra SỐ', () => {
    const ra = moTaThoiLuong(lanLoi({ thoiLuongGiay: 750 }))
    expect(ra).toEqual({ text: '12p 30s', laChu: false, vi: null })
  })

  it('số 0 ĐO ĐƯỢC vẫn là số, không bôi thành chữ', () => {
    // Controller báo lỗi rồi báo hết trong cùng một giây là một quan sát thật. Biến nó thành
    // "chưa biết" cũng là nói dối, chỉ theo chiều ngược lại.
    const ra = moTaThoiLuong(lanLoi({ thoiLuongGiay: 0, ketThuc: '2026-08-25T08:00:00.000Z' }))
    expect(ra).toEqual({ text: '0s', laChu: false, vi: null })
  })

  for (const [ten, vi] of [
    ['mất tín hiệu', CHUA_BIET_VI.MAT_TIN_HIEU],
    ['có người gõ tay', CHUA_BIET_VI.NHAP_TAY],
    ['bridge khởi động lại', CHUA_BIET_VI.KHOI_DONG_LAI],
  ] as const) {
    it(`"chưa biết" vì ${ten}: ra CHỮ, và không một chữ số nào lọt vào`, () => {
      const ra = moTaThoiLuong(lanLoi({ thoiLuongGiay: null, lyDoDong: 'chua-biet', chuaBietVi: vi, cauChu: null }))
      expect(ra.laChu).toBe(true)
      expect(ra.text).toContain('Chưa biết')
      // Đây là chốt thật của L‑27: `0 phút`, `0s`, `0` — bất kỳ chữ số nào ở ô này cũng sẽ được
      // đọc thành một phép đo, mà đúng cái đang thiếu là phép đo.
      expect(ra.text).not.toMatch(/\d/)
      expect(ra.vi).not.toMatch(/\d/)
    })
  }

  it('ưu tiên câu chữ bridge gửi kèm, không tự viết lại', () => {
    const cauChu = 'Chưa biết — mất tín hiệu máy giữa chừng, im lặng không phải là hết lỗi.'
    const ra = moTaThoiLuong(lanLoi({ thoiLuongGiay: null, chuaBietVi: CHUA_BIET_VI.MAT_TIN_HIEU, cauChu }))
    expect(ra.vi).toBe(cauChu)
  })

  it('lý do lạ (bridge mới hơn giao diện) hiện NGUYÊN VĂN chứ không bị nuốt', () => {
    const ra = moTaThoiLuong(lanLoi({ thoiLuongGiay: null, chuaBietVi: 'ly-do-chua-tung-co', cauChu: null }))
    expect(ra.laChu).toBe(true)
    expect(ra.vi).toContain('ly-do-chua-tung-co')
  })

  it('đang lỗi thì nói đang lỗi, không đưa ra một con số nào', () => {
    const ra = moTaThoiLuong(lanLoi({ dangMo: true, ketThuc: null, thoiLuongGiay: null, cauChu: null }))
    expect(ra).toMatchObject({ text: 'Đang lỗi', laChu: true })
    expect(ra.text).not.toMatch(/\d/)
  })

  it('đồng hồ controller nhảy lùi thì nói "không tính được", không ra 0', () => {
    const ra = moTaThoiLuong(lanLoi({ thoiLuongGiay: null, mocDangNgo: true, ketThuc: '2026-08-25T07:00:00.000Z' }))
    expect(ra).toMatchObject({ text: 'Không tính được', laChu: true })
    expect(ra.vi).toContain('lùi về quá khứ')
  })
})

describe('maNguyenVan — mã lỗi in nguyên văn (L‑28)', () => {
  it('trả đúng chuỗi máy gửi, không đổi một byte', () => {
    for (const ma of ['E12', 'e12', ' E12 ', 'E-12/断线 03', '0x1F', '007']) {
      expect(maNguyenVan(lanLoi({ ma }))).toBe(ma)
    }
  })

  it('máy không gửi mã thì trả null, không bịa ra chữ thay chỗ mã', () => {
    expect(maNguyenVan(lanLoi({ ma: null }))).toBeNull()
    expect(maNguyenVan(lanLoi({ ma: '' }))).toBeNull()
  })
})

describe('nghiaKetThuc — cùng một mốc, hai nghĩa khác hẳn nhau', () => {
  it('controller báo trạng thái khác ⇒ hết lỗi', () => {
    expect(nghiaKetThuc(lanLoi())).toBe('het-loi')
  })

  it('ba trường hợp "chưa biết" ⇒ chỉ là mốc mất dấu', () => {
    for (const vi of Object.values(CHUA_BIET_VI)) {
      expect(nghiaKetThuc(lanLoi({ chuaBietVi: vi, lyDoDong: 'chua-biet' }))).toBe('mat-dau')
    }
  })

  it('còn đang lỗi thì chưa kết thúc', () => {
    expect(nghiaKetThuc(lanLoi({ dangMo: true, ketThuc: null }))).toBe('chua-ket-thuc')
  })
})

describe('tienToBatDau', () => {
  it('mốc thật thì không thêm gì', () => {
    expect(tienToBatDau(lanLoi())).toBeNull()
  })

  it('máy đã lỗi từ trước lúc bridge kịp nhìn ⇒ "ít nhất từ"', () => {
    expect(tienToBatDau(lanLoi({ batDauUocChung: true }))).toBe('ít nhất từ')
  })
})

describe('dauMoLai — lần lỗi đã mở lại (L‑29)', () => {
  it('chưa mở lại thì không có dấu nào', () => {
    expect(dauMoLai(lanLoi())).toBeNull()
  })

  it('mở lại rồi thì mang theo đủ ai · lúc nào · vì sao', () => {
    expect(dauMoLai(lanLoi({
      daMoLai: true,
      soLanMoLai: 2,
      moLaiLuc: '2026-08-25T09:00:00.000Z',
      moLaiBoi: 'phong',
      lyDoMoLai: 'Tưởng sửa xong, máy lại dừng ngay sau đó.',
    }))).toEqual({
      soLan: 2,
      luc: '2026-08-25T09:00:00.000Z',
      boi: 'phong',
      lyDo: 'Tưởng sửa xong, máy lại dừng ngay sau đó.',
    })
  })
})
