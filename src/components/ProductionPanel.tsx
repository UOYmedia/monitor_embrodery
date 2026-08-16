import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatClock, formatNumber, formatTime } from '../lib/format'
import { csvFileName, formatHours, formatVnd, groupByMachine, groupByShift, toCsv } from '../lib/production'
import { BridgeApiError, type BridgeApi } from '../services/bridgeApi'
import type { ProductionReport, Site } from '../types/fleet'

/**
 * Shift production and piece-rate pay.
 *
 * Everything on this screen is a difference between two odometer readings the controller
 * reported. Nothing is estimated: a shift with no readings shows nothing, a machine with no
 * rate shows stitches and a blank amount, and a counter glitch is shown as a glitch rather
 * than rolled into the total.
 */

type Grouping = 'machine' | 'shift' | 'row'

function today(timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function daysAgo(days: number, timeZone?: string): string {
  const base = new Date(Date.now() - days * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(base)
}

export function ProductionPanel({ api, sites, timeZone }: { api: BridgeApi; sites: Site[]; timeZone?: string }) {
  const [from, setFrom] = useState(() => daysAgo(6, timeZone))
  const [to, setTo] = useState(() => today(timeZone))
  const [siteId, setSiteId] = useState('all')
  const [grouping, setGrouping] = useState<Grouping>('machine')
  const [report, setReport] = useState<ProductionReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setReport(await api.production({ from, to, siteId }))
      setError(null)
    } catch (cause) {
      setError(cause instanceof BridgeApiError ? cause.message : 'Không đọc được sản lượng từ bridge.')
    } finally {
      setLoading(false)
    }
  }, [api, from, to, siteId])

  useEffect(() => { void load() }, [load])

  const groups = useMemo(() => {
    if (!report) return []
    return grouping === 'shift' ? groupByShift(report.rows) : groupByMachine(report.rows)
  }, [report, grouping])

  /**
   * `totals.anomalies` gộp hai loại khoảng đọc bị loại; tách ra để KPI đối chiếu được với bảng.
   *
   * Không tách thì màn hình có một con số "1 bộ đếm bất thường" mà không dòng nào ghi bất
   * thường — người chốt lương sẽ không biết 1 đó ở đâu ra và có mất mũi nào không.
   */
  const excludedBreakdown = useMemo(() => {
    const rows = report?.rows ?? []
    return {
      resets: rows.reduce((sum, row) => sum + row.resets, 0),
      jumps: rows.reduce((sum, row) => sum + row.anomalies, 0),
    }
  }, [report])

  /** Export is a local file: the browser writes it, nothing leaves the LAN. */
  const exportCsv = () => {
    if (!report) return
    const blob = new Blob([toCsv(report)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = csvFileName(report)
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="production" aria-label="Sản lượng ca và lương khoán">
      <div className="draft-head">
        <h2>Sản lượng ca &amp; lương khoán</h2>
        <div className="detail-actions">
          <button type="button" className="ghost" onClick={() => void load()} disabled={loading}>
            {loading ? 'Đang tải…' : 'Tải lại'}
          </button>
          <button type="button" className="ghost" onClick={exportCsv} disabled={!report || report.rows.length === 0}>
            Xuất Excel (CSV)
          </button>
        </div>
      </div>

      <p className="field-hint">
        Số mũi lấy từ chênh lệch bộ đếm của controller giữa hai lần đọc. Ca nào không có dữ liệu đọc thì
        không có dòng — bảng này không ước lượng thay máy.
      </p>

      <div className="filters" role="group" aria-label="Kỳ báo cáo">
        <label className="filter-field">
          <span>Từ ngày</span>
          <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="filter-field">
          <span>Đến ngày</span>
          <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label className="filter-field">
          <span>Xưởng</span>
          <select value={siteId} onChange={(event) => setSiteId(event.target.value)}>
            <option value="all">Tất cả</option>
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </label>
        <label className="filter-field">
          <span>Gộp theo</span>
          <select value={grouping} onChange={(event) => setGrouping(event.target.value as Grouping)}>
            <option value="machine">Máy (tính lương)</option>
            <option value="shift">Ngày &amp; ca</option>
            <option value="row">Từng dòng</option>
          </select>
        </label>
      </div>

      {error && <p className="detail-error" role="alert">{error}</p>}

      {report && (
        <>
          <div className="kpi-bar" aria-label="Tổng kỳ báo cáo">
            <div className="kpi-card">
              <span className="kpi-value">{formatNumber(report.totals.stitches)}</span>
              <span className="kpi-label">Tổng số mũi</span>
              <span className="kpi-hint">{report.totals.machines} máy đã xác minh</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-value">{formatVnd(report.totals.amount)}</span>
              <span className="kpi-label">Tiền khoán</span>
              <span className="kpi-hint">
                {report.totals.rowsWithoutPrice > 0 ? `${report.totals.rowsWithoutPrice} dòng chưa có đơn giá` : 'Mọi dòng đều có đơn giá'}
              </span>
            </div>
            <div className="kpi-card">
              <span className="kpi-value">{formatHours(report.totals.runSeconds)}</span>
              <span className="kpi-label">Giờ máy chạy</span>
              <span className="kpi-hint">Chỉ tính lúc controller báo đang chạy</span>
            </div>
            <div className={report.totals.anomalies > 0 ? 'kpi-card kpi-warning kpi-active' : 'kpi-card'}>
              <span className="kpi-value">{report.totals.anomalies}</span>
              <span className="kpi-label">Khoảng đọc bị loại</span>
              <span className="kpi-hint">
                {report.totals.anomalies === 0
                  ? 'Mọi khoảng đọc đều vào sản lượng'
                  : [
                      excludedBreakdown.resets > 0 ? `${excludedBreakdown.resets} lần bộ đếm về 0` : null,
                      excludedBreakdown.jumps > 0 ? `${excludedBreakdown.jumps} lần số nhảy bất thường` : null,
                    ].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>

          {/* Bảng lương không được để người ta hiểu nhầm là số đã chốt: đơn giá là giá của lúc
              mở báo cáo, không phải giá tại thời điểm máy chạy. Sửa đơn giá là cả kỳ đổi theo. */}
          {report.totals.amount > 0 && (
            <div className="banner banner-info" role="status">
              <strong>Cột tiền tính theo đơn giá đang đặt hôm nay.</strong>
              <span>
                Dashboard không lưu đơn giá tại thời điểm máy chạy, nên sửa đơn giá sẽ tính lại toàn bộ kỳ này.
                Chốt lương xong thì xuất CSV để giữ lại con số của hôm chốt.
              </span>
            </div>
          )}

          {report.totals.rowsWithoutPrice > 0 && (
            <div className="banner banner-warning" role="status">
              <strong>{report.totals.rowsWithoutPrice} dòng chưa có đơn giá:</strong>
              <span>
                Số mũi vẫn được tính, cột tiền để trống. Đặt đơn giá cho máy hoặc cho xưởng ở panel chi tiết máy.
              </span>
            </div>
          )}

          {report.excluded.unverifiedRows > 0 && (
            <div className="banner banner-warning" role="status">
              <strong>{report.excluded.unverifiedRows} dòng không vào tổng:</strong>
              <span>{report.excluded.reason}</span>
            </div>
          )}

          {report.rows.length === 0 && (
            <p className="muted">
              Chưa có dữ liệu sản lượng trong kỳ {report.range.from} → {report.range.to}. Máy phải dùng adapter
              đọc được bộ đếm mũi thì bảng này mới có số.
            </p>
          )}

          {grouping === 'row' ? <RowTable report={report} timeZone={timeZone} /> : <GroupTable groups={groups} grouping={grouping} />}

          <p className="reading-meta">
            Kỳ {report.range.from} → {report.range.to} theo giờ {report.timeZone ?? 'địa phương'} · lập lúc {formatTime(report.generatedAt, timeZone)}.
            Cột thành tiền dùng đơn giá đang đặt hiện tại; đổi đơn giá sẽ tính lại cả kỳ, nên hãy xuất file khi đã chốt lương.
          </p>
        </>
      )}
    </section>
  )
}

function GroupTable({ groups, grouping }: { groups: ReturnType<typeof groupByMachine>; grouping: Grouping }) {
  if (!groups.length) return null
  return (
    <table className="mini-table">
      <caption>{grouping === 'machine' ? 'Gộp theo máy' : 'Gộp theo ngày và ca'}</caption>
      <thead>
        <tr>
          <th scope="col">{grouping === 'machine' ? 'Máy' : 'Ngày · ca'}</th>
          <th scope="col" className="cell-number">Số mũi</th>
          <th scope="col" className="cell-number">Giờ chạy</th>
          <th scope="col" className="cell-number">Tiền (theo đơn giá hiện tại)</th>
          <th scope="col">Ghi chú</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <tr key={group.key}>
            <td>
              <span className="row-title">{group.label}</span>
              {group.sublabel && <span className="row-sub">{group.sublabel}</span>}
            </td>
            <td className="cell-number">{formatNumber(group.stitches)}</td>
            <td className="cell-number">{formatHours(group.runSeconds)}</td>
            <td className="cell-number">{formatVnd(group.amount)}</td>
            <td>
              {!group.verified && <span className="badge badge-unverified">Chưa xác minh — không vào tổng</span>}
              {group.anomalies > 0 && <span className="badge badge-severity-warning">{group.anomalies} khoảng đọc bị loại</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function RowTable({ report, timeZone }: { report: ProductionReport; timeZone?: string }) {
  if (!report.rows.length) return null
  return (
    <div className="table-wrap">
      <table className="mini-table">
        <caption>Từng ca, từng máy</caption>
        <thead>
          <tr>
            <th scope="col">Ngày</th><th scope="col">Ca</th><th scope="col">Máy</th><th scope="col">Chuyền</th>
            <th scope="col" className="cell-number">Số mũi</th>
            <th scope="col" className="cell-number">Giờ chạy</th>
            <th scope="col" className="cell-number">Đơn giá /1.000 mũi</th>
            <th scope="col" className="cell-number">Tiền (theo đơn giá hiện tại)</th>
            <th scope="col">Khoảng đọc</th>
            <th scope="col">Chất lượng dữ liệu</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.key} className={row.countedInTotals ? undefined : 'fleet-row-archived'}>
              <td>{row.date}</td>
              <td>{row.shiftName}</td>
              <td>
                <span className="row-title">{row.machineName ?? row.machineId}</span>
                <span className="row-sub">
                  {row.assetTag ?? '—'}
                  {row.machineMissing ? ' · máy đã bị xoá khỏi sổ' : ''}
                  {row.verified ? '' : ' · chưa xác minh'}
                </span>
              </td>
              <td>{row.zone ?? '—'}</td>
              <td className="cell-number">{formatNumber(row.stitches)}</td>
              <td className="cell-number">{formatHours(row.runSeconds)}</td>
              <td className="cell-number">{row.pricePer1000Stitches === null ? 'Chưa đặt' : formatVnd(row.pricePer1000Stitches)}</td>
              <td className="cell-number">{formatVnd(row.amount)}</td>
              {/* Khoảng đọc thật, không phải khoảng giờ của ca: ca 8 tiếng mà chỉ đọc được 40
                  phút thì con số sản lượng nói rất ít, và người xem phải thấy điều đó. */}
              <td>
                {row.firstAt && row.lastAt
                  ? `${formatClock(row.firstAt, timeZone)} → ${formatClock(row.lastAt, timeZone)}`
                  : 'Không có mốc đọc'}
              </td>
              <td className="cell-quality">
                {row.readings} lần đọc
                {/* Cả hai loại đều là khoảng đọc bị loại, nên đều gọi đúng tên đó rồi mới nói
                    nguyên nhân — KPI ở trên cộng chung hai con số này. */}
                {row.resets > 0 && <span className="badge badge-severity-info">{row.resets} khoảng bị loại · bộ đếm về 0</span>}
                {row.anomalies > 0 && <span className="badge badge-severity-warning">{row.anomalies} khoảng bị loại · số nhảy bất thường</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
