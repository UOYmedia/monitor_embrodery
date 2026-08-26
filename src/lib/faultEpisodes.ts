import type { FaultEpisode } from '../types/fleet'
import { formatDuration } from './format'

/**
 * Quyết định "ô này phải nói gì" cho bảng lần lỗi.
 *
 * Tách khỏi component vì đây là chỗ dễ nói dối nhất trên cả màn hình: ba trong bốn cột của bảng
 * lần lỗi đều có thể mang một con số trông rất chắc chắn trong khi sự thật là hệ thống **không
 * quan sát được** cái nó đang in ra. Hàm thuần thì bắt được chuyện đó bằng test; JSX thì không.
 *
 * Nguồn dữ liệu là bản hợp nhất của `bridge/lib/fault-episodes.mjs` (mở + đóng + mở-lại). Module
 * này không tự suy ra gì thêm từ telemetry — bridge đã quyết, giao diện chỉ chọn câu chữ.
 */

/** Ba lý do controller KHÔNG hề báo là máy đã hết lỗi — chép đúng hằng `CHUA_BIET_VI` phía bridge. */
export const CHUA_BIET_VI = {
  MAT_TIN_HIEU: 'mat-tin-hieu',
  NHAP_TAY: 'nhap-tay',
  KHOI_DONG_LAI: 'dong-bang-khoi-dong-lai',
} as const

/**
 * Nhãn ngắn cho ô hẹp. Câu đầy đủ vẫn lấy từ `cauChu` mà bridge gửi kèm, không viết lại ở đây —
 * hai bản chữ cho cùng một sự việc thì sớm muộn cũng lệch nhau, và bản lệch nằm ở giao diện là
 * bản người ta đọc.
 */
const NHAN_NGAN: Record<string, string> = {
  [CHUA_BIET_VI.MAT_TIN_HIEU]: 'Chưa biết — mất tín hiệu',
  [CHUA_BIET_VI.NHAP_TAY]: 'Chưa biết — có người gõ tay',
  [CHUA_BIET_VI.KHOI_DONG_LAI]: 'Chưa biết — bridge khởi động lại',
}

export interface ODoDai {
  /** Chữ hiện trong ô "kéo dài". */
  text: string
  /** `true` = đây là một CÂU, không phải một số đo. Màn hình phải hiện nó khác đi. */
  laChu: boolean
  /** Câu giải thích đầy đủ, đặt ngay dưới ô. `null` khi con số tự nó đã đủ. */
  vi: string | null
}

function nhanNgan(vi: string | null): string {
  if (vi === null) return 'Chưa biết'
  return NHAN_NGAN[vi] ?? 'Chưa biết'
}

function cauDuPhong(vi: string | null): string {
  if (vi === null) return 'Chưa biết — hệ thống không quan sát được lúc lần lỗi này kết thúc.'
  // Một lý do lạ (bridge mới hơn giao diện) phải hiện NGUYÊN VĂN chứ không bị nuốt thành một câu
  // chung chung — cùng kỷ luật với mã lỗi ở `maNguyenVan` phía dưới.
  return NHAN_NGAN[vi]
    ? `${NHAN_NGAN[vi]} — không quan sát được lúc lần lỗi này kết thúc.`
    : `Chưa biết — bridge ghi lý do "${vi}", giao diện chưa có câu chữ cho lý do đó.`
}

/**
 * Ô "kéo dài" — **ca L‑27**.
 *
 * Luật: một khoảng KHÔNG quan sát được thì phải ra chữ, tuyệt đối không ra `0 phút`. Một số 0 ở
 * đây đọc thành "máy lỗi rồi hết ngay", mà sự thật là "ta chỉ nhìn được tới đó" — hai câu trái
 * ngược nhau, và câu sai lại là câu trấn an.
 */
export function moTaThoiLuong(episode: FaultEpisode): ODoDai {
  if (episode.dangMo) {
    return {
      text: 'Đang lỗi',
      laChu: true,
      vi: episode.cauChu ?? 'Đang lỗi — chưa thấy controller báo trạng thái khác.',
    }
  }

  const giay = episode.thoiLuongGiay
  if (giay === null || giay === undefined || !Number.isFinite(giay)) {
    // Không được rơi vào `formatDuration`: với `null` nó trả `UNREAD` = "Chưa đọc được từ
    // controller" — câu của một SỐ ĐO chưa đọc được, không phải của một KHOẢNG không quan sát
    // được. Trộn hai thứ đó lại thì người đọc mất đúng thông tin quý nhất: vì sao không biết.
    if (episode.mocDangNgo) {
      return {
        text: 'Không tính được',
        laChu: true,
        vi: 'Không tính được — đồng hồ controller lùi về quá khứ giữa lần lỗi này.',
      }
    }
    return {
      text: nhanNgan(episode.chuaBietVi),
      laChu: true,
      vi: episode.cauChu ?? cauDuPhong(episode.chuaBietVi),
    }
  }

  // Số 0 ĐO ĐƯỢC thì vẫn in `0s`: controller báo lỗi rồi báo hết trong cùng một giây là một quan
  // sát thật, và bôi nó thành chữ cũng là nói dối, chỉ theo chiều ngược lại. Cái L‑27 cấm là in
  // số cho một khoảng không quan sát được — nhánh ở trên.
  return { text: formatDuration(giay), laChu: false, vi: null }
}

/**
 * Mã lỗi in **nguyên văn** — **ca L‑28**.
 *
 * Không dịch, không tra bảng, không `trim()`, không đổi hoa thường. Một bảng tra tự chế sẽ biến
 * một mã lạ thành một câu tiếng Việt sai mà trông rất tự tin, và người thợ sẽ đi sửa nhầm chỗ.
 * Chuỗi trả ra ở đây phải khớp từng byte với `events[].code` mà máy đã gửi.
 *
 * Trả `null` khi máy không gửi mã. Chỗ gọi phải nói rõ "máy không gửi mã" — cấm bịa ra một chữ
 * "không rõ" đặt vào chỗ của mã, vì nó trông y như một mã máy khai.
 */
export function maNguyenVan(episode: FaultEpisode): string | null {
  return typeof episode.ma === 'string' && episode.ma.length > 0 ? episode.ma : null
}

export type NghiaKetThuc = 'chua-ket-thuc' | 'het-loi' | 'mat-dau'

/**
 * Cùng một mốc thời gian ở cột "đến" mang hai nghĩa khác hẳn nhau, và bảng phải nói ra nghĩa nào.
 *
 * `het-loi`: controller thật sự báo máy rời trạng thái lỗi.
 * `mat-dau` : ta ngừng nhìn thấy tại mốc đó — không phải máy hết lỗi tại mốc đó.
 */
export function nghiaKetThuc(episode: FaultEpisode): NghiaKetThuc {
  if (episode.dangMo) return 'chua-ket-thuc'
  return episode.chuaBietVi === null ? 'het-loi' : 'mat-dau'
}

export const NHAN_KET_THUC: Record<NghiaKetThuc, string> = {
  'chua-ket-thuc': 'Chưa kết thúc',
  'het-loi': 'Controller báo hết lỗi',
  'mat-dau': 'Mốc mất dấu, không phải mốc hết lỗi',
}

/** Tiền tố cho ô "từ": `null` khi mốc là mốc thật, `'ít nhất từ'` khi máy đã lỗi từ trước lúc bridge kịp nhìn. */
export function tienToBatDau(episode: FaultEpisode): string | null {
  return episode.batDauUocChung ? 'ít nhất từ' : null
}

export interface DauMoLai {
  soLan: number
  luc: string | null
  boi: string | null
  lyDo: string | null
}

/**
 * Dấu "đã mở lại" — **ca L‑29**. Trả `null` khi lần lỗi này chưa từng được mở lại.
 *
 * Bridge KHÔNG sửa dòng cũ khi mở lại: nó ghi thêm một dòng `reopen` rồi hợp nhất khi đọc
 * (`fault-episodes.mjs`, R3). Giao diện phải giữ đúng tinh thần đó — hiện dấu này **bên cạnh**
 * bản ghi cũ chứ không thay chỗ nó. Người ta cần thấy được rằng đã có lúc hệ thống tưởng máy
 * chạy lại rồi; xoá đi thì cái bảng trông sạch hơn sự thật.
 */
export function dauMoLai(episode: FaultEpisode): DauMoLai | null {
  if (!episode.daMoLai && !(episode.soLanMoLai > 0)) return null
  return {
    soLan: episode.soLanMoLai,
    luc: episode.moLaiLuc,
    boi: episode.moLaiBoi,
    lyDo: episode.lyDoMoLai,
  }
}
