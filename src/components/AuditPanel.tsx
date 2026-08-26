import { useCallback, useEffect, useState } from 'react'
import { auditFileName, describeRetention, formatBytes, toAuditCsv, toAuditJson } from '../lib/audit'
import { formatTime } from '../lib/format'
import { BridgeApiError, type BridgeApi } from '../services/bridgeApi'
import type { AuditEntry, AuditRetention } from '../types/fleet'

/**
 * Fleet-wide audit trail. Denied attempts appear here too — a viewer trying a mutation is
 * itself an event worth keeping.
 *
 * Màn hình này **không sửa được gì**, kể cả hạn giữ nhật ký: hạn giữ chỉ được đọc ra và giải
 * thích, còn muốn đổi thì phải sửa `bridge.config.json` trên máy bridge. Một nút "rút ngắn
 * hạn giữ" trên trình duyệt sẽ biến nhật ký kiểm toán thành thứ mà người bị kiểm toán tự dọn
 * được — và như vậy thì nó không còn dùng để đối chiếu lương hay tranh chấp nữa.
 */

interface Filters { from: string; to: string; actor: string; action: string; result: string }

const emptyFilters: Filters = { from: '', to: '', actor: '', action: '', result: 'all' }

/** Nhãn tiếng Việt cho bộ lọc in vào chân file xuất ra. */
const filterLabels: Record<keyof Filters, string> = {
  from: 'Từ', to: 'Đến', actor: 'Người thực hiện', action: 'Hành động', result: 'Kết quả',
}

/** Ghi file ngay trên máy đang mở dashboard; không có byte nào rời khỏi LAN xưởng. */
function download(content: string, fileName: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

export function AuditPanel({ api, timeZone }: { api: BridgeApi; timeZone?: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [truncated, setTruncated] = useState(false)
  const [retention, setRetention] = useState<AuditRetention | null>(null)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  /** Bộ lọc đã thực sự gửi đi, để chân file xuất ra khớp với bảng đang hiển thị. */
  const [applied, setApplied] = useState<Filters>(emptyFilters)
  const [limit, setLimit] = useState(200)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (query: Filters, rows: number) => {
    setLoading(true)
    try {
      const page = await api.audit({
        limit: rows,
        // Ô ngày chỉ cho ra `2026-08-16`; nới ra hai đầu để "đến ngày" bao trọn cả ngày đó.
        from: query.from ? `${query.from}T00:00:00.000Z` : undefined,
        to: query.to ? `${query.to}T23:59:59.999Z` : undefined,
        actor: query.actor.trim() || undefined,
        action: query.action.trim() || undefined,
        result: query.result === 'all' ? undefined : query.result,
      })
      setEntries(page.entries)
      setTruncated(page.truncated)
      setApplied(query)
      setError(null)
    } catch (cause) {
      setError(cause instanceof BridgeApiError ? cause.message : 'Không đọc được nhật ký kiểm toán.')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { void load(emptyFilters, 200) }, [load])

  useEffect(() => {
    let alive = true
    api.auditRetention()
      .then((info) => { if (alive) setRetention(info) })
      // Hạn giữ không đọc được thì bảng vẫn dùng được: khối này chỉ là phần giải thích.
      .catch(() => { if (alive) setRetention(null) })
    return () => { alive = false }
  }, [api])

  const exportMeta = () => ({
    generatedAt: new Date().toISOString(),
    truncated,
    filters: Object.fromEntries(
      (Object.keys(filterLabels) as Array<keyof Filters>)
        .filter((key) => applied[key] && applied[key] !== 'all')
        .map((key) => [filterLabels[key], applied[key]]),
    ),
  })

  const exportCsv = () => {
    const meta = exportMeta()
    download(toAuditCsv(entries, meta), auditFileName(meta, 'csv'), 'text/csv')
  }

  const exportJson = () => {
    const meta = exportMeta()
    download(toAuditJson(entries, meta), auditFileName(meta, 'json'), 'application/json')
  }

  const set = (key: keyof Filters) => (value: string) => setFilters((current) => ({ ...current, [key]: value }))

  return (
    <section className="audit-panel" aria-label="Nhật ký kiểm toán">
      <div className="draft-head">
        <h2>Nhật ký kiểm toán</h2>
        <div className="detail-actions">
          <button type="button" className="ghost" onClick={() => void load(filters, limit)} disabled={loading}>
            {loading ? 'Đang tải…' : 'Tải lại'}
          </button>
          <button type="button" className="ghost" onClick={exportCsv} disabled={!entries.length}>Xuất Excel (CSV)</button>
          <button type="button" className="ghost" onClick={exportJson} disabled={!entries.length}>Xuất JSON</button>
        </div>
      </div>

      <p className="field-hint">
        Bản CSV để đọc và in; bản JSON giữ nguyên giá trị trước/sau của từng thay đổi, dùng khi cần đối chiếu
        chi tiết. Cả hai được ghi thẳng ra máy đang mở màn hình này, không gửi đi đâu.
      </p>

      <form
        className="filters"
        role="group"
        aria-label="Lọc nhật ký"
        onSubmit={(event) => { event.preventDefault(); void load(filters, limit) }}
      >
        <label className="filter-field">
          <span>Từ ngày</span>
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => set('from')(event.target.value)} />
        </label>
        <label className="filter-field">
          <span>Đến ngày</span>
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => set('to')(event.target.value)} />
        </label>
        <label className="filter-field">
          <span>Người thực hiện</span>
          <input type="search" value={filters.actor} placeholder="ví dụ: ktv.an" onChange={(event) => set('actor')(event.target.value)} />
        </label>
        <label className="filter-field">
          <span>Hành động</span>
          <input type="search" value={filters.action} placeholder="ví dụ: machine.archive" onChange={(event) => set('action')(event.target.value)} />
        </label>
        <label className="filter-field">
          <span>Kết quả</span>
          <select value={filters.result} onChange={(event) => set('result')(event.target.value)}>
            <option value="all">Tất cả</option>
            <option value="allowed">Được phép</option>
            <option value="denied">Bị từ chối</option>
          </select>
        </label>
        <label className="filter-field">
          <span>Số dòng tối đa</span>
          <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
            <option value={200}>200</option>
            <option value={1000}>1.000</option>
            <option value={5000}>5.000</option>
          </select>
        </label>
        <div className="filter-actions">
          <button type="submit" className="ghost" disabled={loading}>Lọc</button>
          <button type="button" className="ghost" onClick={() => { setFilters(emptyFilters); void load(emptyFilters, limit) }} disabled={loading}>
            Bỏ lọc
          </button>
        </div>
      </form>

      {error && <p className="detail-error" role="alert">{error}</p>}
      {!error && entries.length === 0 && !loading && <p className="muted">Không có dòng nào khớp bộ lọc.</p>}

      {truncated && (
        <p className="block-note" role="status">
          Đang hiển thị {entries.length} dòng mới nhất và còn dòng cũ hơn chưa đọc tới. Thu hẹp khoảng ngày
          hoặc nâng số dòng tối đa trước khi xuất file, nếu không bản xuất sẽ thiếu phần cũ.
        </p>
      )}

      <table className="mini-table">
        <thead>
          <tr>
            <th scope="col">Thời gian</th><th scope="col">Người thực hiện</th><th scope="col">Hành động</th>
            <th scope="col">Đối tượng</th><th scope="col">Kết quả</th><th scope="col">Mã tra cứu</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className={entry.result === 'denied' ? 'audit-denied' : undefined}>
              <td>{formatTime(entry.at, timeZone)}</td>
              <td>{entry.actor} ({entry.role})</td>
              <td>{entry.action}</td>
              <td>{entry.targetId ?? '—'}</td>
              <td>{entry.result}</td>
              <td className="mono">{entry.correlationId ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {retention && (
        <div className="audit-retention">
          <h3>Hạn giữ nhật ký</h3>
          <p className="muted">{describeRetention(retention)}</p>
          <p className="field-hint">
            Đặt trong <code>bridge.config.json</code> (<code>audit.retentionDays</code>, <code>audit.maxBytes</code>) trên máy bridge.
            Màn hình này cố tình không sửa được: nhật ký mà người dùng tự rút ngắn được thì không còn đối chiếu được.
          </p>
          {retention.expiring.length > 0 && (
            <p className="block-note" role="status">
              {retention.expiring.length} mảnh sẽ bị xoá ở lần dọn tới. Sao lưu trước nếu cần giữ.
            </p>
          )}
          <ul className="audit-segments">
            {retention.segments.map((segment) => (
              <li key={segment.name}>
                <span className="mono">{segment.name}</span>
                <span className="reading-meta">
                  {formatBytes(segment.bytes)} ·{' '}
                  {segment.active ? 'đang ghi' : `xoay vòng lúc ${formatTime(segment.rotatedAt, timeZone)}`}
                  {retention.expiring.includes(segment.name) ? ' · sắp bị xoá' : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
