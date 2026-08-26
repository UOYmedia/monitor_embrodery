import type { DesignEntry } from '../services/bridgeApi'

/**
 * Diễn giải kết quả tra thư viện mẫu thành chữ tiếng Việt.
 *
 * Nằm riêng khỏi component vì cả ô lưới lẫn panel chi tiết đều dùng, và vì mỗi trạng thái dẫn
 * tới một **việc phải làm khác nhau** — sửa config bridge, chép file vào thư viện, hay đổi tên
 * mẫu cho khỏi trùng. Gộp cả ba thành "không có ảnh" thì người vận hành không biết sửa gì.
 *
 * Trả về hai mức: `short` để nhét vừa ô 46 px, `full` là nguyên câu cho `title` và chi tiết.
 */
export function describeDesign(entry: DesignEntry | undefined, fileName: string | null): { short: string; full: string } {
  if (!fileName) return { short: '—', full: 'Chưa đọc được tên mẫu từ controller.' }
  if (!entry) return { short: '…', full: 'Đang tra thư viện mẫu.' }
  switch (entry.status) {
    case 'found':
      return {
        short: '',
        full: entry.viaPrefix
          ? `Khớp theo tên rút gọn: controller báo "${fileName}", thư viện có "${entry.matchedFile}".`
          : `Mẫu "${entry.matchedFile}" trong thư viện của xưởng.`,
      }
    case 'disabled':
      return { short: 'Chưa bật', full: 'Chưa cấu hình thư viện mẫu trên bridge (designLibrary.path). Chưa có ảnh cho máy nào.' }
    case 'missing':
      return { short: 'Chưa có', full: `Thư viện không có file nào tên "${fileName}". Chép file .DST vào thư mục thư viện là có ảnh.` }
    case 'ambiguous':
      return {
        short: 'Trùng tên',
        full: `Tên rút gọn "${fileName}" khớp nhiều mẫu (${(entry.candidates ?? []).join(', ')}). Không đoán, vì đoán sai là hiện ảnh của mẫu khác mà người đứng máy không có cách nào biết.`,
      }
    case 'invalid-name':
      return { short: 'Tên lạ', full: `Controller báo tên mẫu không hợp lệ: "${fileName}".` }
    default:
      return { short: 'Lỗi đọc', full: entry.reason ?? 'Không đọc được thư viện mẫu trên bridge.' }
  }
}
