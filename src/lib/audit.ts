import { csvDocument, csvRow } from './csv'
import type { AuditEntry, AuditRetention } from '../types/fleet'

/**
 * Xuất nhật ký kiểm toán ra file, và diễn giải hạn giữ nhật ký.
 *
 * Hai định dạng, hai mục đích khác nhau:
 *
 *  - **CSV** cho người: mở bằng Excel, lọc theo người thực hiện, in ra kẹp vào hồ sơ. Cột
 *    `before`/`after` bị nén thành một dòng chữ, chấp nhận mất cấu trúc để bảng đọc được.
 *  - **JSON** cho máy và cho đối chiếu: giữ nguyên `before`/`after` từng chi tiết. Đây là
 *    bản dùng khi cần chứng minh "trước khi sửa nó là gì".
 *
 * Cả hai đều là file ghi ra ngay trên máy đang mở dashboard — không có bước nào gửi dữ liệu
 * ra khỏi LAN xưởng.
 */

export interface AuditExportMeta {
  /** Bộ lọc đang áp dụng lúc xuất, in vào chân file để bản in tự nói nó là bản gì. */
  filters: Record<string, string>
  generatedAt: string
  /** Bridge còn dữ liệu chưa trả về hết (chạm trần `limit` hoặc còn mảnh chưa đọc tới). */
  truncated: boolean
}

const CSV_HEADERS = [
  'Thời gian (ISO)', 'Người thực hiện', 'Vai trò', 'Hành động', 'Loại đối tượng', 'Đối tượng',
  'Kết quả', 'Mã tra cứu', 'Địa chỉ gọi', 'Ghi chú', 'Giá trị trước', 'Giá trị sau',
]

/**
 * Nén `before`/`after` xuống một ô.
 *
 * Không phải để đọc lại bằng máy — bản JSON lo việc đó. Ô này chỉ cần đủ để người đọc thấy
 * "à, đổi tên máy từ X sang Y" mà không phải mở bản JSON.
 */
function snapshot(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'object') return String(value)
  return Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => `${key}=${entry === null || entry === undefined ? '—' : String(typeof entry === 'object' ? JSON.stringify(entry) : entry)}`)
    .join(' | ')
}

export function toAuditCsv(entries: AuditEntry[], meta: AuditExportMeta): string {
  const lines = [csvRow(CSV_HEADERS)]
  for (const entry of entries) {
    lines.push(csvRow([
      entry.at,
      entry.actor,
      entry.role,
      entry.action,
      entry.targetType,
      entry.targetId,
      entry.result,
      entry.correlationId,
      entry.remote,
      entry.message,
      snapshot(entry.before),
      snapshot(entry.after),
    ]))
  }
  lines.push('')
  lines.push(csvRow([`Xuất lúc ${meta.generatedAt} · ${entries.length} dòng · ${describeFilters(meta.filters)}`]))
  // Dòng cảnh báo nằm ngay trong file: một bản xuất bị cắt mà người nhận không biết là bị
  // cắt sẽ bị đọc như "khoảng này không ai làm gì".
  if (meta.truncated) {
    lines.push(csvRow(['CẢNH BÁO: bản xuất này chưa đủ — bridge còn dòng cũ hơn chưa trả về. Thu hẹp khoảng ngày rồi xuất tiếp.']))
  }
  return csvDocument(lines)
}

export function toAuditJson(entries: AuditEntry[], meta: AuditExportMeta): string {
  return `${JSON.stringify({
    kind: 'dahao-audit-export',
    generatedAt: meta.generatedAt,
    filters: meta.filters,
    count: entries.length,
    truncated: meta.truncated,
    entries,
  }, null, 2)}\n`
}

export function describeFilters(filters: Record<string, string>): string {
  const parts = Object.entries(filters).filter(([, value]) => value)
  return parts.length ? parts.map(([key, value]) => `${key}: ${value}`).join(', ') : 'không lọc'
}

export function auditFileName(meta: AuditExportMeta, extension: 'csv' | 'json'): string {
  // Dấu hai chấm trong ISO không dùng được làm tên file trên Windows.
  const stamp = meta.generatedAt.slice(0, 19).replace(/[:T]/g, '-')
  return `nhat-ky-kiem-toan-${stamp}.${extension}`
}

const megabyte = 1024 * 1024

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < megabyte) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / megabyte).toFixed(1)} MB`
}

/**
 * Câu trả lời cho "nhật ký này giữ tới bao giờ", nói bằng tiếng người.
 *
 * Mặc định là giữ mãi, và câu chữ phải nói rõ điều đó — người đọc màn hình cần biết mình
 * đang ở chế độ nào trước khi đi tìm một dòng của tháng trước.
 */
export function describeRetention(retention: AuditRetention): string {
  const size = `${retention.segments.length} mảnh, tổng ${formatBytes(retention.totalBytes)}`
  if (retention.retentionDays === null) {
    return `Giữ mãi — không có mảnh nào bị xoá tự động (${size}).`
  }
  return `Giữ ${retention.retentionDays} ngày; mảnh đã xoay vòng cũ hơn mốc đó sẽ bị bridge xoá (${size}).`
}
