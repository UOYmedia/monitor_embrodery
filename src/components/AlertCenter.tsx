import { useEffect, useMemo, useRef, useState } from 'react'
import { filterAlerts } from '../lib/alerts'
import type { AlertDigest, AlertFilter, FleetAlert } from '../lib/alerts'
import { formatTime, sourceLabels } from '../lib/format'
import type { BridgeApi } from '../services/bridgeApi'
import { BridgeApiError } from '../services/bridgeApi'
import type { MachineView, Site } from '../types/fleet'
import { SeverityBadge } from './StateBadge'

/**
 * Trung tâm cảnh báo: cảnh báo của cả đội máy trong một danh sách.
 *
 * Mở bằng chuông trên header chứ không làm tab riêng, vì hai lẽ: nó phải với tới được từ mọi
 * màn hình, và thanh tab hiện cố ý chỉ có đúng một mục (`lib/urlState.ts`) — thêm tab thứ hai
 * chỉ để chứa một danh sách là đổi cấu trúc điều hướng cho một thứ vốn là thông báo, không
 * phải một nơi để ở lại.
 *
 * Panel này chỉ đọc, và chỉ có đúng một hành động ghi: xác nhận một cảnh báo do bridge giữ —
 * cùng mutation, cùng audit như tab *Cảnh báo* trong panel chi tiết máy.
 */

const kindLabels: Record<string, string> = {
  'controller-event': 'Sự kiện controller',
  'thread-break-rate': 'Tỉ lệ đứt chỉ',
  maintenance: 'Bảo trì',
  connection: 'Kết nối & trạng thái',
}

export function AlertCenter({
  rows, digest, sites, siteId, timeZone, api, can, onMachine, onSelect, onClose,
}: {
  rows: FleetAlert[]
  digest: AlertDigest
  sites: Site[]
  siteId: string | 'all'
  timeZone?: string
  api: BridgeApi
  can: (permission: string) => boolean
  onMachine: (machine: MachineView) => void
  onSelect: (machineId: string) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState<AlertFilter>('open')
  const [scope, setScope] = useState<string | 'all'>(siteId)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Mở ra là con trỏ bàn phím nằm sẵn trong panel, để Esc và Tab làm việc ở đây chứ không
  // lạc về bảng phía sau.
  useEffect(() => { closeRef.current?.focus() }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const visible = useMemo(() => filterAlerts(rows, filter, scope), [rows, filter, scope])

  const acknowledge = async (row: FleetAlert) => {
    setBusy(row.key); setError(null)
    try {
      const result = await api.acknowledge(row.machineId, row.alert.id, null, true)
      onMachine(result.machine)
    } catch (caught) {
      setError(caught instanceof BridgeApiError
        ? `${caught.message}${caught.correlationId ? ` (mã tra cứu ${caught.correlationId})` : ''}`
        : 'Không gọi được bridge.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <aside className="alert-center" aria-label="Trung tâm cảnh báo">
      <header className="detail-header">
        <div>
          <h2>Trung tâm cảnh báo</h2>
          <p className="detail-sub">
            {digest.open === 0
              ? 'Không có cảnh báo nào đang chờ xử lý.'
              : `${digest.open} cảnh báo đang chờ trên ${digest.machines} máy · ${digest.critical} nghiêm trọng, ${digest.warning} cần xem`}
          </p>
        </div>
        <button type="button" ref={closeRef} className="ghost detail-back" onClick={onClose}>
          Đóng ✕
        </button>
      </header>

      <div className="filter-row alert-center-filters">
        <div className="layout-switch" role="group" aria-label="Lọc cảnh báo">
          <button
            type="button"
            className={filter === 'open' ? 'layout-btn layout-btn-on' : 'layout-btn'}
            aria-pressed={filter === 'open'}
            onClick={() => setFilter('open')}
          >
            Đang chờ ({digest.open})
          </button>
          <button
            type="button"
            className={filter === 'all' ? 'layout-btn layout-btn-on' : 'layout-btn'}
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            Tất cả ({digest.total})
          </button>
        </div>
        {sites.length > 1 && (
          <select value={scope} onChange={(event) => setScope(event.target.value)} aria-label="Lọc theo xưởng">
            <option value="all">Tất cả xưởng</option>
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        )}
        <span className="filter-count">{visible.length} dòng</span>
      </div>

      {error && <p className="detail-error" role="alert">{error}</p>}

      {visible.length === 0
        ? (
          <p className="muted">
            {filter === 'open'
              ? 'Không có cảnh báo nào đang chờ. Bấm “Tất cả” để xem cả cảnh báo đã xác nhận và các dòng mức thông tin.'
              : 'Chưa có cảnh báo nào. Danh sách rỗng cũng có thể vì chưa máy nào đọc được — xem cột kết nối ở bảng đội máy.'}
          </p>
        )
        : (
          <ul className="timeline alert-list">
            {visible.map((row) => (
              <li
                key={row.key}
                className={`timeline-item timeline-${row.alert.severity}${row.alert.acknowledged ? ' timeline-acked' : ''}`}
              >
                <div className="timeline-head">
                  <SeverityBadge severity={row.alert.severity} />
                  <strong>{row.alert.title}</strong>
                  <span className="reading-meta">
                    {kindLabels[row.alert.kind] ?? row.alert.kind} · {sourceLabels[row.alert.source] ?? row.alert.source}
                    {row.alert.since ? ` · ${formatTime(row.alert.since, timeZone)}` : ''}
                  </span>
                </div>
                <p>{row.alert.detail}</p>
                <div className="alert-row-actions">
                  <button type="button" className="ghost alert-row-machine" onClick={() => onSelect(row.machineId)}>
                    {row.machineName} →
                  </button>
                  <span className="reading-meta">{row.assetTag} · {row.zone}</span>
                  {row.alert.acknowledged
                    ? (
                      <span className="reading-meta">
                        Đã xác nhận · {row.alert.acknowledged.by} · {formatTime(row.alert.acknowledged.at, timeZone)}
                        {row.alert.acknowledged.note ? ` — ${row.alert.acknowledged.note}` : ''}
                      </span>
                    )
                    : row.acknowledgeable
                      ? can('alert:acknowledge') && (
                        <button type="button" disabled={busy === row.key} onClick={() => void acknowledge(row)}>
                          {busy === row.key ? 'Đang ghi…' : 'Xác nhận đã xem'}
                        </button>
                      )
                      // Nói thẳng vì sao dòng này không có nút, thay vì để một khoảng trống khó
                      // hiểu cạnh những dòng đang có nút.
                      : <span className="reading-meta">Tự hết khi máy trở lại — không cần xác nhận.</span>}
                </div>
              </li>
            ))}
          </ul>
        )}

      <p className="block-note alert-center-note">
        Cảnh báo do <strong>controller</strong> và <strong>bridge</strong> gửi thì xác nhận được, và mỗi lần xác nhận
        đều vào audit. Cảnh báo do <strong>dashboard</strong> suy ra từ kết nối và trạng thái (mất kết nối, dừng lâu,
        dữ liệu cũ) thì không: bridge không giữ chúng, nên một nút “đã xem” ở đây chỉ có tác dụng trong tab trình
        duyệt này — người bên cạnh không thấy, F5 là mất. Nhóm đó tự tắt khi máy trở lại bình thường.
      </p>
    </aside>
  )
}
