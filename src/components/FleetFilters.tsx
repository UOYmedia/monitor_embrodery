import { memo, useEffect, useRef } from 'react'
import { describeFilter, emptyFilter } from '../lib/fleet'
import type { FleetFilter, SortKey } from '../lib/fleet'
import { adapterLabels, connectionLabels, severityLabels, statusLabels } from '../lib/format'
import type { FleetLayout } from '../lib/urlState'
import type { AdapterKind, AlertSeverity, ConnectionStateName, OperationalStatus, Site } from '../types/fleet'

/**
 * Một hàng lọc cao 40 px, phần còn lại nằm trong popover `Lọc khác`.
 *
 * Bản trước có 9 ô select luôn hiện, ăn ~120 px chiều dọc — tức là mất ba hàng máy để bày
 * những ô mà một ca làm việc hầu như không ai đụng. Ba thứ dùng hằng ngày (tìm kiếm, xưởng,
 * khu vực) ở ngoài; phần còn lại thu vào popover.
 *
 * Bù lại cho việc giấu bớt: mọi điều kiện đang áp đều hiện thành token gỡ được, kể cả khi nó
 * được đặt từ chip KPI hay từ URL. Bộ lọc vô hình là cách người ta đọc nhầm cả xưởng.
 *
 * Lọc chạy hoàn toàn trong trình duyệt trên ảnh chụp đội máy đã có sẵn: không request nào
 * theo từng phím gõ, nên mạng xưởng yếu không làm chậm ô tìm kiếm.
 */
export const FleetFilters = memo(function FleetFilters({
  filter, sites, zones, adapters, sortKey, sortDirection, resultCount, totalCount, layout,
  onFilter, onSort, onLayout, searchRef,
}: {
  filter: FleetFilter
  sites: Site[]
  zones: string[]
  adapters: AdapterKind[]
  sortKey: SortKey
  sortDirection: 'asc' | 'desc'
  resultCount: number
  totalCount: number
  layout: FleetLayout
  onFilter: (next: FleetFilter) => void
  onSort: (key: SortKey, direction: 'asc' | 'desc') => void
  onLayout: (next: FleetLayout) => void
  /** Phím `/` focus vào ô tìm kiếm; App giữ ref để không phải query DOM. */
  searchRef?: React.RefObject<HTMLInputElement | null>
}) {
  const patch = (next: Partial<FleetFilter>) => onFilter({ ...filter, ...next })
  const popover = useRef<HTMLDetailsElement>(null)

  /**
   * Popover đóng khi bấm ra ngoài hoặc bấm Esc.
   *
   * `<details>` mặc định chỉ đóng bằng chính cái summary của nó. Popover này phủ lên bảng
   * (z-index 5), nên nếu chỉ có nút "Xong" thì bấm vào một máy ở chỗ khác sẽ chọn máy đó mà
   * tấm che vẫn nằm nguyên trên bảng.
   *
   * Esc bắt ở pha capture và chặn lan: App cũng nghe Esc để đóng panel chi tiết, và thứ tự
   * đúng là đóng cái đang ở trên trước.
   */
  useEffect(() => {
    const element = popover.current
    if (!element) return

    const onPointerDown = (event: PointerEvent) => {
      if (!element.open) return
      if (event.target instanceof Node && element.contains(event.target)) return
      element.open = false
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !element.open) return
      event.stopPropagation()
      element.open = false
      element.querySelector<HTMLElement>('summary')?.focus()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])

  const tokens = describeFilter(filter, {
    site: (id) => sites.find((site) => site.id === id)?.name ?? id,
    status: (value) => (value === 'idle' ? 'Dừng / tạm dừng' : statusLabels[value]),
    connection: (value) => connectionLabels[value],
    adapter: (value) => adapterLabels[value] ?? value,
    severity: (value) => severityLabels[value],
  })

  // Số ô đang khác mặc định bên trong popover, in ngay trên nút để không ai phải mở ra xem.
  const hiddenCount = tokens.filter((token) => !['search', 'site', 'zone'].includes(token.key)).length

  return (
    <section className="fleet-filters" aria-label="Bộ lọc đội máy">
      <div className="filter-row">
        <div className="filter-field filter-search">
          <label className="visually-hidden" htmlFor="filter-search">Tìm kiếm máy</label>
          <input
            id="filter-search"
            ref={searchRef}
            type="search"
            value={filter.search}
            placeholder="Tìm máy, mã tài sản, IP, serial, tên mẫu…  ( / )"
            onChange={(event) => patch({ search: event.target.value })}
          />
        </div>

        <label className="visually-hidden" htmlFor="filter-site">Nhà xưởng</label>
        <select id="filter-site" value={filter.siteId} onChange={(event) => patch({ siteId: event.target.value, zone: 'all' })}>
          <option value="all">Mọi xưởng</option>
          {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
        </select>

        <label className="visually-hidden" htmlFor="filter-zone">Khu vực</label>
        <select id="filter-zone" value={filter.zone} onChange={(event) => patch({ zone: event.target.value })}>
          <option value="all">Mọi khu vực</option>
          {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
        </select>

        <details className="filter-more" ref={popover}>
          <summary>Lọc khác{hiddenCount > 0 ? ` (${hiddenCount})` : ''} ▾</summary>
          <div className="filter-popover">
            <div className="filter-field">
              <label htmlFor="filter-connection">Kết nối</label>
              <select id="filter-connection" value={filter.connection} onChange={(event) => patch({ connection: event.target.value as ConnectionStateName | 'all' })}>
                <option value="all">Tất cả</option>
                {(Object.keys(connectionLabels) as ConnectionStateName[]).map((state) => (
                  <option key={state} value={state}>{connectionLabels[state]}</option>
                ))}
              </select>
            </div>

            <div className="filter-field">
              <label htmlFor="filter-status">Trạng thái máy</label>
              <select id="filter-status" value={filter.status} onChange={(event) => patch({ status: event.target.value as OperationalStatus | 'all' | 'idle' })}>
                <option value="all">Tất cả</option>
                <option value="idle">Dừng / tạm dừng</option>
                {(Object.keys(statusLabels) as OperationalStatus[]).map((status) => (
                  <option key={status} value={status}>{statusLabels[status]}</option>
                ))}
              </select>
            </div>

            <div className="filter-field">
              <label htmlFor="filter-escalation">Nhóm cần theo dõi</label>
              <select id="filter-escalation" value={filter.escalation} onChange={(event) => patch({ escalation: event.target.value as FleetFilter['escalation'] })}>
                <option value="all">Tất cả</option>
                <option value="idle-long">Dừng quá ngưỡng xưởng</option>
                <option value="maintenance">Bảo trì sắp/quá hạn</option>
              </select>
            </div>

            <div className="filter-field">
              <label htmlFor="filter-adapter">Adapter</label>
              <select id="filter-adapter" value={filter.adapter} onChange={(event) => patch({ adapter: event.target.value })}>
                <option value="all">Tất cả</option>
                {adapters.map((adapter) => <option key={adapter} value={adapter}>{adapterLabels[adapter] ?? adapter}</option>)}
              </select>
            </div>

            <div className="filter-field">
              <label htmlFor="filter-severity">Mức cảnh báo tối thiểu</label>
              <select id="filter-severity" value={filter.severity} onChange={(event) => patch({ severity: event.target.value as AlertSeverity | 'all' })}>
                <option value="all">Tất cả</option>
                <option value="critical">{severityLabels.critical}</option>
                <option value="warning">{severityLabels.warning} trở lên</option>
                <option value="info">{severityLabels.info} trở lên</option>
              </select>
            </div>

            <div className="filter-field">
              <label htmlFor="filter-verification">Xác minh</label>
              <select id="filter-verification" value={filter.verification} onChange={(event) => patch({ verification: event.target.value as FleetFilter['verification'] })}>
                <option value="all">Tất cả</option>
                <option value="verified">Đã xác minh</option>
                <option value="unverified">Chưa xác minh</option>
              </select>
            </div>

            <label className="filter-check">
              <input type="checkbox" checked={filter.includeArchived} onChange={(event) => patch({ includeArchived: event.target.checked })} />
              Hiện cả máy đã lưu trữ
            </label>

            <button type="button" className="btn btn-quiet" onClick={() => { if (popover.current) popover.current.open = false }}>
              Xong
            </button>
          </div>
        </details>

        <label className="visually-hidden" htmlFor="filter-sort">Sắp xếp</label>
        <select
          id="filter-sort"
          className="filter-sort"
          value={`${sortKey}:${sortDirection}`}
          onChange={(event) => {
            const [key, direction] = event.target.value.split(':')
            onSort(key as SortKey, direction as 'asc' | 'desc')
          }}
        >
          <option value="attention:asc">Ưu tiên xử lý</option>
          <option value="name:asc">Tên máy A→Z</option>
          <option value="assetTag:asc">Mã tài sản A→Z</option>
          <option value="zone:asc">Khu vực</option>
          <option value="lastSeen:asc">Dữ liệu cũ nhất trước</option>
          <option value="progress:desc">Tiến độ cao nhất trước</option>
          <option value="maintenance:asc">Bảo trì gấp nhất trước</option>
        </select>

        {/* Đổi cách bày, không đổi dữ liệu: cùng bộ lọc, cùng thứ tự, cùng panel chi tiết.
            Là nút bấm chứ không phải select vì chỉ có hai lựa chọn và người dùng đổi qua lại
            nhiều lần trong một ca. */}
        <div className="layout-switch" role="group" aria-label="Cách bày danh sách máy">
          <button
            type="button"
            className={layout === 'cards' ? 'layout-btn layout-btn-on' : 'layout-btn'}
            aria-pressed={layout === 'cards'}
            title="Mỗi máy một ô vuông, sản phẩm đang chạy là chữ to nhất"
            onClick={() => onLayout('cards')}
          >
            <span aria-hidden="true">▦</span> Ô vuông
          </button>
          <button
            type="button"
            className={layout === 'table' ? 'layout-btn layout-btn-on' : 'layout-btn'}
            aria-pressed={layout === 'table'}
            title="Dày hơn: 19 máy trên màn 1080, so được cột với nhau"
            onClick={() => onLayout('table')}
          >
            <span aria-hidden="true">☰</span> Bảng
          </button>
        </div>

        <p className="filter-count" role="status">{resultCount}/{totalCount} máy</p>
      </div>

      {tokens.length > 0 && (
        <div className="filter-tokens" aria-label="Điều kiện lọc đang áp">
          {tokens.map((token) => (
            <button
              key={`${token.key}:${token.label}`}
              type="button"
              className="filter-token"
              onClick={() => patch(token.clear)}
              aria-label={`Gỡ điều kiện lọc ${token.label}`}
            >
              {token.label} <span aria-hidden="true">✕</span>
            </button>
          ))}
          <button type="button" className="btn btn-quiet filter-clear" onClick={() => onFilter(emptyFilter)}>
            Xoá bộ lọc
          </button>
        </div>
      )}
    </section>
  )
})
