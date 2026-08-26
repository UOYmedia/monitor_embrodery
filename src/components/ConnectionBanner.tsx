import { formatTime } from '../lib/format'
import type { SocketStatus } from '../services/machineSocket'

/**
 * A lost WebSocket must be impossible to miss: without it every number on screen is a
 * frozen snapshot, and an operator reading a stale RPM as live is exactly the failure
 * this dashboard exists to prevent.
 */
export function ConnectionBanner({
  status, detail, lastMessageAt, loadError, timeZone,
}: {
  status: SocketStatus
  detail: string | null
  lastMessageAt: string | null
  loadError: string | null
  timeZone?: string
}) {
  if (status === 'connected' && !loadError) return null

  const tone = status === 'unauthorized' || status === 'disconnected' || loadError ? 'critical' : 'warning'
  const headline =
    loadError ? loadError
      : status === 'unauthorized' ? 'Bridge từ chối token của phiên này. Nhập lại token để xem dữ liệu.'
        : status === 'connecting' ? 'Đang kết nối tới bridge…'
          : 'Mất kết nối WebSocket tới bridge. Số liệu trên màn hình là ảnh chụp cũ, không phải dữ liệu trực tiếp.'

  return (
    <div className={`banner banner-${tone}`} role="status" aria-live="polite">
      <strong>{headline}</strong>
      <span>
        {detail ? `${detail} ` : ''}
        Cập nhật gần nhất: {lastMessageAt ? formatTime(lastMessageAt, timeZone) : 'chưa có'}
      </span>
    </div>
  )
}
