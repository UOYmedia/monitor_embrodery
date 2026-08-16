import type { AlertSeverity, ConnectionStateName, OperationalStatus } from '../types/fleet'

/**
 * Vietnamese presentation helpers.
 *
 * The API speaks ISO 8601 UTC; only this module turns a timestamp into something a person
 * reads, always in the site's timezone and never as an ambiguous string used as a key.
 */

export const UNREAD = 'Chưa đọc được từ controller'

const numberFormat = new Intl.NumberFormat('vi-VN')

export function formatNumber(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNREAD
  return `${numberFormat.format(Math.round(value))}${suffix}`
}

export function formatTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—'
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone,
  }).format(parsed)
}

/** Chỉ giờ:phút — dùng cho những chỗ chật (tile andon, nhãn ETA, cột trạng thái). */
export function formatClock(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—'
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(parsed)
}

export function formatDate(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—'
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone }).format(parsed)
}

/** Data age in words. Always paired with the absolute timestamp in the UI. */
export function formatAge(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'chưa có dữ liệu'
  // The bridge clock and the browser clock are never exactly equal, so a fresh reading can
  // arrive a fraction "in the future". "-3s trước" reads like a bug; it is just skew.
  const seconds = Math.max(0, Math.round(value))
  if (seconds < 60) return `${seconds}s trước`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} phút trước`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} giờ trước`
  return `${Math.floor(seconds / 86_400)} ngày trước`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return UNREAD
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  return hours > 0 ? `${hours}g ${minutes}p` : minutes > 0 ? `${minutes}p ${rest}s` : `${rest}s`
}

export const connectionLabels: Record<ConnectionStateName, string> = {
  online: 'Đang kết nối',
  stale: 'Dữ liệu cũ',
  offline: 'Mất kết nối',
  unknown: 'Không xác định',
}

/** Text symbols so state is readable without relying on colour. */
export const connectionSymbols: Record<ConnectionStateName, string> = {
  online: '●',
  stale: '◐',
  offline: '○',
  unknown: '?',
}

export const statusLabels: Record<OperationalStatus, string> = {
  running: 'Đang chạy',
  paused: 'Tạm dừng',
  stopped: 'Đã dừng',
  fault: 'Lỗi máy',
  unknown: 'Chưa xác định',
}

export const severityLabels: Record<AlertSeverity, string> = {
  critical: 'Nghiêm trọng',
  warning: 'Cảnh báo',
  info: 'Thông tin',
}

export const sourceLabels: Record<string, string> = {
  controller: 'Controller báo',
  bridge: 'Bridge phân tích',
  dashboard: 'Dashboard ghi nhận',
}

export const adapterLabels: Record<string, string> = {
  manual: 'Manual (chưa có giao thức)',
  'http-json': 'HTTP JSON',
  'tcp-json-line': 'TCP JSON line',
  'dial-in': 'Máy tự gọi vào (dial-in)',
}

export const maintenanceLabels: Record<string, string> = {
  ok: 'Còn hạn',
  due: 'Sắp đến hạn',
  overdue: 'Quá hạn',
  unknown: 'Chưa đủ dữ liệu',
}

export function formatStitchProgress(current: number | null, total: number | null): string {
  if (current === null || total === null) return UNREAD
  return `${numberFormat.format(current)} / ${numberFormat.format(total)} mũi`
}
