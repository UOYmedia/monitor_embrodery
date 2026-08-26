import { memo } from 'react'
import { isFilterApplied, toggleFilterPatch } from '../lib/fleet'
import type { FleetFilter, FleetKpi } from '../lib/fleet'

/**
 * Dải chỉ số hai bậc, cao 56 px, mọi con số bấm được để lọc.
 *
 * Bản trước là 10 thẻ bằng nhau chiếm 200 px: "Chưa xác minh" to ngang "Lỗi máy", và mỗi thẻ
 * lấy mất một hàng máy. Ở đây chỉ có **một** con số to — số máy đang cần một người tới — còn
 * lại là chip nhỏ. Bấm chip là lọc; lọc đang áp hiện thành token gỡ được ở thanh bên dưới,
 * nên không bao giờ có chuyện màn hình lọc sẵn mà người xem không biết.
 *
 * Chỉ số sản xuất vẫn chỉ đếm máy đã xác minh; riêng "Cần xử lý" đếm cả máy chưa xác minh vì
 * một máy đang báo lỗi thì giấy tờ xác minh không liên quan gì tới việc phải chạy tới xem.
 */

interface Chip {
  key: keyof FleetKpi
  label: string
  symbol: string
  hint: string
  tone?: 'critical' | 'warning'
  patch: Partial<FleetFilter>
}

const chips: Chip[] = [
  { key: 'running', label: 'Đang chạy', symbol: '▶', hint: 'Controller báo running và dữ liệu chưa quá hạn tươi.', patch: { status: 'running' } },
  { key: 'idle', label: 'Dừng', symbol: '■', hint: 'Controller báo stopped hoặc paused, kể cả dừng ngắn khi thay khung.', patch: { status: 'idle' } },
  { key: 'idleLong', label: 'Dừng lâu', symbol: '■!', hint: 'Dừng liên tục quá ngưỡng của xưởng (mặc định 5 phút). Là tập con của "Dừng".', tone: 'warning', patch: { status: 'idle', escalation: 'idle-long' } },
  { key: 'fault', label: 'Lỗi máy', symbol: '✕', hint: 'Controller tự báo fault. Mất kết nối KHÔNG tính là lỗi máy.', tone: 'critical', patch: { status: 'fault' } },
  { key: 'offline', label: 'Mất kết nối', symbol: '○', hint: 'Quá ngưỡng stale và bridge không liên lạc được với máy.', tone: 'warning', patch: { connection: 'offline' } },
  { key: 'stale', label: 'Dữ liệu cũ', symbol: '◐', hint: 'Còn dữ liệu nhưng đã quá ngưỡng tươi của xưởng.', tone: 'warning', patch: { connection: 'stale' } },
  { key: 'unknown', label: 'Chưa rõ', symbol: '?', hint: 'Chưa đọc được trạng thái: adapter manual hoặc chưa có telemetry hợp lệ.', patch: { connection: 'unknown' } },
  { key: 'criticalAlerts', label: 'Cảnh báo', symbol: '▲', hint: 'Cảnh báo nghiêm trọng chưa được xác nhận.', tone: 'critical', patch: { severity: 'critical' } },
  { key: 'maintenanceDue', label: 'Bảo trì', symbol: '⌾', hint: 'Hạng mục sắp đến hạn hoặc quá hạn theo odometer controller.', patch: { escalation: 'maintenance' } },
  { key: 'unverified', label: 'Chưa xác minh', symbol: '!', hint: 'Đã ghép nhưng kỹ thuật viên chưa đối chiếu tại máy. Không tính vào KPI sản xuất.', patch: { verification: 'unverified' } },
]

export const KpiBar = memo(function KpiBar({
  kpi, scope, filter, total, onFilter,
}: {
  kpi: FleetKpi
  scope: string
  filter: FleetFilter
  total: number
  onFilter: (next: FleetFilter) => void
}) {
  const toggle = (patch: Partial<FleetFilter>) => onFilter(toggleFilterPatch(filter, patch))

  // Đội nhỏ thì chip bằng 0 chỉ làm nhiễu; đội lớn thì một số 0 lại là thông tin ("không máy
  // nào mất kết nối"), nên chỉ ẩn khi ít máy.
  const visible = total > 8 ? chips : chips.filter((chip) => kpi[chip.key] > 0)
  const attentionOn = filter.attention

  return (
    <section className="kpi-strip" aria-label={`Chỉ số tổng quan ${scope}`}>
      <button
        type="button"
        className={`kpi-attention${kpi.needsAttention > 0 ? ' kpi-attention-on' : ''}${attentionOn ? ' kpi-chip-applied' : ''}`}
        aria-pressed={attentionOn}
        title="Máy đang lỗi, mất kết nối, có cảnh báo nghiêm trọng chưa xác nhận, hoặc dừng quá ngưỡng. Bấm để chỉ hiện những máy này."
        onClick={() => onFilter({ ...filter, attention: !attentionOn })}
      >
        <span className="kpi-attention-label">Cần xử lý</span>
        <span className="kpi-attention-value">{kpi.needsAttention}</span>
      </button>

      <div className="kpi-chips">
        {visible.map((chip) => {
          const applied = isFilterApplied(filter, chip.patch)
          return (
            <button
              key={chip.key}
              type="button"
              className={`kpi-chip${chip.tone ? ` kpi-chip-${chip.tone}` : ''}${kpi[chip.key] > 0 && chip.tone ? ' kpi-chip-active' : ''}${applied ? ' kpi-chip-applied' : ''}`}
              aria-pressed={applied}
              title={`${chip.hint} Bấm để lọc.`}
              onClick={() => toggle(chip.patch)}
            >
              <span aria-hidden="true" className="kpi-chip-symbol">{chip.symbol}</span>
              <span className="kpi-chip-value">{kpi[chip.key]}</span>
              <span className="kpi-chip-label">{chip.label}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
})
