import type { FleetAlert } from '../lib/alerts'
import { SeverityBadge } from './StateBadge'

/**
 * Thẻ cảnh báo nổi ở góc màn hình.
 *
 * Đây là kênh duy nhất chạm được vào người đang không nhìn bảng đội máy — cùng với con số
 * trên tiêu đề tab (`useAlertWatch`). **Không có tiếng.** `PRD_UI_MONITORING.md` §14 đã loại
 * âm thanh vì xưởng ồn và loa thường bị tắt: một hệ thống "có kêu" mà thực tế không kêu tạo
 * cảm giác an toàn giả.
 *
 * Thẻ chỉ báo tin, không phải nơi xử lý: mọi hành động nằm trong trung tâm cảnh báo. Đóng
 * một thẻ chỉ là đóng thẻ — cảnh báo vẫn còn nguyên trong danh sách.
 */
export function AlertToasts({
  toasts, overflow, onDismiss, onDismissAll, onOpen,
}: {
  toasts: FleetAlert[]
  overflow: number
  onDismiss: (key: string) => void
  onDismissAll: () => void
  onOpen: () => void
}) {
  if (toasts.length === 0) return null

  return (
    // `polite` chứ không phải `assertive`: trình đọc màn hình đọc nốt câu đang đọc rồi mới
    // tới đây. Cảnh báo này không cần cắt lời ai — người xử lý sự cố đang ở cạnh máy.
    <div className="toast-stack" role="status" aria-live="polite" aria-label="Cảnh báo mới">
      {toasts.map((row) => (
        <article key={row.key} className={`toast toast-${row.alert.severity}`}>
          <div className="toast-head">
            <SeverityBadge severity={row.alert.severity} />
            <strong className="toast-title">{row.alert.title}</strong>
            <button type="button" className="ghost toast-close" onClick={() => onDismiss(row.key)} aria-label="Ẩn thẻ này">
              ✕
            </button>
          </div>
          <p className="toast-detail">{row.alert.detail}</p>
          <p className="reading-meta">{row.machineName} · {row.assetTag} · {row.zone}</p>
        </article>
      ))}
      <div className="toast-foot">
        {overflow > 0 && <span className="reading-meta">…và {overflow} cảnh báo nữa</span>}
        <button type="button" className="ghost" onClick={onOpen}>Mở trung tâm cảnh báo</button>
        <button type="button" className="ghost" onClick={onDismissAll}>Ẩn hết</button>
      </div>
    </div>
  )
}
