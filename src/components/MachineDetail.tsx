import { useEffect, useState } from 'react'
import { useDesignIndex } from '../hooks/useDesignIndex'
import {
  effectivePrice, estimatedFinish, jobProgress, noThreadBreakThreshold, offlineReason,
  overrunText, rpmRange, sparklinePoints, statusDurationText, threadBreakRate, threadBreakText,
} from '../lib/derived'
import { describeDesign } from '../lib/design'
import { effectiveStatus, highestSeverity, unacknowledgedAlerts } from '../lib/fleet'
import {
  UNREAD, adapterLabels, formatAge, formatClock, formatDuration, formatNumber,
  formatStitchProgress, formatTime, maintenanceLabels, sourceLabels, statusLabels,
} from '../lib/format'
import { formatHours, formatVnd } from '../lib/production'
import type { BridgeApi } from '../services/bridgeApi'
import { BridgeApiError } from '../services/bridgeApi'
import type { AuditEntry, MachineView, ProductionReport, Site } from '../types/fleet'
import { DesignThumb } from './DesignThumb'
import { ManualReadingForm } from './ManualReadingForm'
import { PlainRow, ReadingRow } from './ReadingRow'
import { ConnectionBadge, SeverityBadge, StatusBadge, VerificationBadge } from './StateBadge'

/**
 * Read-only detail view of one machine.
 *
 * The only writes available here are dashboard bookkeeping — acknowledging an alert and
 * recording that maintenance was done. Nothing on this screen sends anything to a
 * controller: there is no start, stop, design selection or file action, by design.
 *
 * Bố cục theo PRD giao diện: dòng trạng thái + thời lượng là thứ to nhất, ngay dưới là lý do
 * gần nhất, rồi mới tới các khối chi tiết. Panel dài nên chia tab phụ — mở ra là thấy ngay
 * "máy đang sao, vì sao, bao lâu rồi" mà không phải cuộn.
 */

type DetailTab = 'overview' | 'maintenance' | 'alerts' | 'production' | 'audit'

const tabLabels: [DetailTab, string][] = [
  ['overview', 'Tổng quan'],
  ['maintenance', 'Bảo trì'],
  ['alerts', 'Cảnh báo'],
  ['production', 'Sản lượng máy'],
  ['audit', 'Audit'],
]

/** Ngưỡng in cùng kiểu số với tỉ lệ nó so sánh: `0,5` chứ không phải `0.5` cạnh `0,8`. */
function formatRate(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('vi-VN', { maximumFractionDigits: 2 })
}

function ymd(offsetDays: number, timeZone?: string): string {
  const base = new Date(Date.now() - offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(base)
}

export function MachineDetail({
  machine, api, can, site, timeZone, nowMs, onMachine, onClose,
}: {
  machine: MachineView
  api: BridgeApi
  can: (permission: string) => boolean
  site: Site | null
  timeZone?: string
  nowMs: number
  onMachine: (machine: MachineView) => void
  onClose: () => void
}) {
  const { identity, connection, telemetry, telemetryError, thresholds } = machine
  const [tab, setTab] = useState<DetailTab>('overview')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [audit, setAudit] = useState<AuditEntry[]>([])
  // Một lượt đọc gõ tay không sửa hồ sơ máy nên `identity.updatedAt` không đổi, mà sổ sản lượng và
  // nhật ký thì vừa đổi. Thiếu con đếm này thì ngay sau câu "đã vào sổ" bảng sản lượng vẫn trống
  // trơn — và người vừa gõ đọc cái bảng trống đó thành "chưa lưu", rồi gõ lại lần nữa.
  const [readingEpoch, setReadingEpoch] = useState(0)

  const status = effectiveStatus(machine)
  const durationText = statusDurationText(machine, nowMs, timeZone)
  const longStop = machine.statusSince !== null && (status === 'stopped' || status === 'paused')
    && (nowMs - Date.parse(machine.statusSince.at)) / 60_000 >= thresholds.stopEscalationMinutes
  const topAlert = unacknowledgedAlerts(machine)[0] ?? null
  const severity = highestSeverity(unacknowledgedAlerts(machine))
  const offline = offlineReason(machine, timeZone)

  useEffect(() => {
    let cancelled = false
    api.machineAudit(identity.id, 25)
      .then((result) => { if (!cancelled) setAudit(result.entries) })
      .catch(() => { if (!cancelled) setAudit([]) })
    return () => { cancelled = true }
  }, [api, identity.id, identity.updatedAt, readingEpoch])

  const run = async (key: string, action: () => Promise<{ machine: MachineView } | void>, success: string) => {
    setBusy(key); setError(null); setNotice(null)
    try {
      const result = await action()
      if (result && 'machine' in result) onMachine(result.machine)
      setNotice(success)
    } catch (caught) {
      setError(caught instanceof BridgeApiError
        ? `${caught.message}${caught.correlationId ? ` (mã tra cứu ${caught.correlationId})` : ''}`
        : 'Không gọi được bridge.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <aside className="detail" aria-label={`Chi tiết máy ${identity.name}`}>
      <header className="detail-header">
        <div>
          <h2>{identity.name}</h2>
          <p className="detail-sub">{identity.assetTag} · {identity.siteName} · {identity.zone}</p>
        </div>
        <button type="button" className="ghost detail-back" onClick={onClose} aria-label="Đóng chi tiết máy">
          ← Danh sách máy
        </button>
      </header>

      <div className="detail-state">
        <span className="detail-state-main">
          {longStop
            ? <span className="badge badge-status badge-status-idle-long"><span aria-hidden="true" className="badge-symbol">■!</span>Dừng lâu</span>
            : <StatusBadge status={status} />}
          {durationText && <span className="detail-state-duration">{durationText}</span>}
        </span>
        <span className="detail-state-side">
          <ConnectionBadge state={connection.state} title={connection.reason} />
          <span className="reading-meta">{formatAge(connection.ageSeconds)}</span>
          <VerificationBadge status={identity.verification.status} />
          {identity.archived && <span className="badge badge-archived">Đã lưu trữ</span>}
        </span>
      </div>

      {topAlert && (
        <p className="detail-reason detail-reason-alert">
          Lý do gần nhất: {topAlert.title}
          {topAlert.since ? ` (${sourceLabels[topAlert.source] ?? topAlert.source} ${formatTime(topAlert.since, timeZone)})` : ''}
        </p>
      )}
      <p className="detail-reason">{offline ?? connection.reason}</p>

      {telemetryError && (
        <p className="detail-error" role="alert">
          Bridge từ chối gói dữ liệu gần nhất ({telemetryError.kind}
          {telemetryError.field ? `, trường ${telemetryError.field}` : ''}): {telemetryError.message.replace(/\.$/, '')}.
          Ảnh chụp cũ bên dưới được giữ nguyên, không hợp nhất dữ liệu sai.
          <span className="detail-error-time"> Lúc {formatTime(telemetryError.at, timeZone)}.</span>
        </p>
      )}
      {error && <p className="detail-error" role="alert">{error}</p>}
      {notice && <p className="detail-notice" role="status">{notice}</p>}

      <nav className="detail-tabs" aria-label="Phần chi tiết">
        {tabLabels.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'tab tab-active' : 'tab'}
            aria-current={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
            {key === 'alerts' && severity && <span className="tab-dot" aria-hidden="true">●</span>}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <>
          <ConnectionBlock machine={machine} timeZone={timeZone} nowMs={nowMs} />
          <JobBlock machine={machine} api={api} timeZone={timeZone} nowMs={nowMs} />
          <ControllerBlock machine={machine} timeZone={timeZone} />
          <IdentityBlock
            machine={machine} api={api} can={can} site={site} timeZone={timeZone}
            busy={busy} setBusy={setBusy} setError={setError} setNotice={setNotice} run={run}
          />
        </>
      )}

      {tab === 'maintenance' && (
        <section className="detail-block">
          <h3>Bảo trì</h3>
          {machine.maintenance.length === 0 && <p className="muted">Chưa cấu hình hạng mục bảo trì nào cho máy này.</p>}
          <ul className="maintenance-list">
            {machine.maintenance.map((plan) => (
              <li key={plan.id} className={`maintenance-item maintenance-${plan.dueState}`}>
                <div className="timeline-head">
                  <strong>{plan.title}</strong>
                  <span className={`badge badge-maintenance badge-maintenance-${plan.dueState}`}>{maintenanceLabels[plan.dueState]}</span>
                </div>
                <p className="reading-meta">
                  Chu kỳ {formatNumber(plan.intervalStitches, ' mũi')} ·{' '}
                  {plan.remainingStitches !== null
                    ? `còn ${formatNumber(plan.remainingStitches, ' mũi')}`
                    : (plan.reason ?? UNREAD)}
                </p>
                <p className="reading-meta">
                  Lần bảo trì gần nhất:{' '}
                  {plan.lastServiceAt ? `${formatTime(plan.lastServiceAt, timeZone)} bởi ${plan.lastServiceBy ?? 'không rõ'}` : 'chưa ghi nhận'}
                </p>
                {can('maintenance:complete') && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      const note = window.prompt(`Ghi nhận đã hoàn thành "${plan.title}"? Nhập ghi chú (tuỳ chọn).`)
                      if (note === null) return
                      void run(`maint-${plan.id}`, () => api.completeMaintenance(identity.id, plan.id, note || null), 'Đã ghi nhận hoàn thành bảo trì.')
                    }}
                  >
                    {busy === `maint-${plan.id}` ? 'Đang ghi…' : 'Ghi nhận đã bảo trì'}
                  </button>
                )}
                {plan.history.length > 0 && (
                  <details>
                    <summary>Lịch sử ({plan.history.length})</summary>
                    <ul>
                      {plan.history.map((entry) => (
                        <li key={`${entry.at}-${entry.odometer}`} className="reading-meta">
                          {formatTime(entry.at, timeZone)} · {entry.by} · odometer {formatNumber(entry.odometer)}
                          {entry.note ? ` · ${entry.note}` : ''}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
          <p className="block-note">
            Mốc bảo trì đo bằng odometer của cả máy, không phải theo từng kim — controller chưa báo số mũi
            theo kim, nên dashboard không tự chia ra.
          </p>
        </section>
      )}

      {tab === 'alerts' && (
        <section className="detail-block">
          <h3>Cảnh báo &amp; sự kiện</h3>
          {machine.alerts.length === 0 && <p className="muted">Không có cảnh báo nào đang mở.</p>}
          <ul className="timeline">
            {machine.alerts.map((alert) => (
              <li key={alert.id} className={`timeline-item timeline-${alert.severity}${alert.acknowledged ? ' timeline-acked' : ''}`}>
                <div className="timeline-head">
                  <SeverityBadge severity={alert.severity} />
                  <strong>{alert.title}</strong>
                  <span className="reading-meta">{sourceLabels[alert.source] ?? alert.source} · {formatTime(alert.since, timeZone)}</span>
                </div>
                <p>{alert.detail}</p>
                {alert.acknowledged
                  ? (
                    <p className="reading-meta">
                      Đã xác nhận bởi {alert.acknowledged.by} lúc {formatTime(alert.acknowledged.at, timeZone)}
                      {alert.acknowledged.note ? ` — ${alert.acknowledged.note}` : ''}
                    </p>
                  )
                  : can('alert:acknowledge') && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        const note = window.prompt('Ghi chú xác nhận (tuỳ chọn). Thao tác này chỉ ghi nhận trên dashboard, không gửi gì tới controller.')
                        if (note === null) return
                        void run(`ack-${alert.id}`, () => api.acknowledge(identity.id, alert.id, note || null, true), 'Đã ghi nhận xác nhận cảnh báo.')
                      }}
                    >
                      {busy === `ack-${alert.id}` ? 'Đang ghi…' : 'Xác nhận đã xem'}
                    </button>
                  )}
              </li>
            ))}
          </ul>

          {telemetry && telemetry.events.length > 0 && (
            <>
              <h4>Sự kiện controller gần nhất</h4>
              <ul className="timeline timeline-compact">
                {telemetry.events.map((event) => (
                  <li key={event.id} className={`timeline-item timeline-${event.severity}`}>
                    <div className="timeline-head">
                      <SeverityBadge severity={event.severity} />
                      <strong>Mã {event.code}</strong>
                      <span className="reading-meta">{formatTime(event.occurredAt, timeZone)}</span>
                    </div>
                    <p>{event.message ?? 'Controller không kèm mô tả cho mã này.'}</p>
                    {event.needle !== null && <p className="reading-meta">Kim {event.needle}</p>}
                  </li>
                ))}
              </ul>
              <p className="block-note">
                Mã lỗi hiển thị đúng như controller báo. Bảng giải nghĩa mã cần tài liệu firmware Dahao,
                chưa có nên dashboard không tự suy diễn ý nghĩa.
              </p>
            </>
          )}
        </section>
      )}

      {tab === 'production' && (
        <>
          {/* Ô nhập tay đứng ngay trên bảng sản lượng của chính máy này, không ở một trang riêng:
              người gõ phải thấy được lượt đọc trước và mấy ca gần nhất trong cùng một tầm mắt,
              vì đó là cách duy nhất nhìn ra một con số vừa gõ lệch hẳn khỏi mọi ca trước đó. */}
          {can('production:enter') && !machine.identity.archived && (
            <ManualReadingForm
              api={api}
              machine={machine}
              timeZone={timeZone}
              onMachine={onMachine}
              onRecorded={() => setReadingEpoch((count) => count + 1)}
            />
          )}
          <MachineProduction api={api} machine={machine} site={site} timeZone={timeZone} reloadKey={readingEpoch} />
        </>
      )}

      {tab === 'audit' && (
        <section className="detail-block">
          <h3>Nhật ký thay đổi của máy</h3>
          {audit.length === 0 && <p className="muted">Chưa có thay đổi nào được ghi cho máy này.</p>}
          <ul className="timeline timeline-compact">
            {audit.map((entry) => (
              <li key={entry.id} className="timeline-item">
                <div className="timeline-head">
                  <strong>{entry.action}</strong>
                  <span className="reading-meta">
                    {entry.actor} ({entry.role}) · {formatTime(entry.at, timeZone)} · {entry.result}
                  </span>
                </div>
                {entry.message && <p>{entry.message}</p>}
                {entry.correlationId && <p className="reading-meta">Mã tra cứu {entry.correlationId}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="detail-footer reading-meta">
        Ngưỡng tươi {thresholds.freshSeconds}s · ngưỡng cũ {thresholds.staleSeconds}s ·
        ngưỡng dừng lâu {thresholds.stopEscalationMinutes} phút ·
        lần thăm dò kế tiếp sau {Math.round(connection.poll.nextPollInMs / 1000)}s
      </footer>
    </aside>
  )
}

/** Máy tắt nguồn và adapter hỏng là hai việc sửa khác nhau — khối này nói rõ đang là việc nào. */
function ConnectionBlock({ machine, timeZone, nowMs }: { machine: MachineView; timeZone?: string; nowMs: number }) {
  const { connection } = machine
  return (
    <section className="detail-block">
      <h3>Kết nối</h3>
      <dl className="reading-list">
        <PlainRow
          label="Telemetry gần nhất"
          value={connection.lastTelemetryAt ? `${formatTime(connection.lastTelemetryAt, timeZone)} · ${formatAge(connection.ageSeconds)}` : null}
          meta={connection.lastTelemetryAt ? undefined : 'Chưa từng nhận được telemetry hợp lệ từ máy này.'}
        />
        <PlainRow
          label="Lần liên lạc được gần nhất"
          value={connection.lastReachableAt ? formatTime(connection.lastReachableAt, timeZone) : null}
          meta={connection.reachable === true
            ? 'Lần kiểm tra gần nhất: máy còn trả lời.'
            : connection.reachable === false
              ? 'Lần kiểm tra gần nhất: máy không trả lời.'
              : 'Bridge chưa kiểm tra được khả năng liên lạc.'}
        />
        <PlainRow
          label="Kiểm tra gần nhất"
          value={connection.lastCheckedAt
            ? `${formatTime(connection.lastCheckedAt, timeZone)} · ${formatAge(Math.round((nowMs - Date.parse(connection.lastCheckedAt)) / 1000))}`
            : null}
        />
        <PlainRow
          label="Lỗi đọc gần nhất"
          value={connection.poll.lastError}
          meta={connection.poll.breakerOpen
            ? `Mạch bảo vệ đang mở thêm ${Math.round(connection.poll.breakerOpensForMs / 1000)}s sau ${connection.poll.failures} lần lỗi liên tiếp.`
            : `${connection.poll.failures} lần lỗi liên tiếp.`}
        />
      </dl>
    </section>
  )
}

/** Job đang chạy, kèm những số dashboard tự tính — mỗi số đều mang nhãn nguồn của nó. */
function JobBlock({ machine, api, timeZone, nowMs }: { machine: MachineView; api: BridgeApi; timeZone?: string; nowMs: number }) {
  const { telemetry, thresholds } = machine
  const job = telemetry?.job?.value ?? null
  // Tra riêng một tên ở đây thay vì kéo bảng tra từ lưới xuống: panel mở được cả khi đến thẳng
  // bằng link `?machine=`, lúc đó lưới có thể chưa tra xong hoặc đang lọc mất máy này.
  const fileName = job?.fileName ?? null
  const designs = useDesignIndex(api, fileName ? [fileName] : [])
  const design = fileName ? designs.entries[fileName] : undefined
  const described = describeDesign(design, fileName)
  const progress = jobProgress(machine)
  const eta = estimatedFinish(machine, nowMs, timeZone)
  const breaks = threadBreakRate(machine)
  const history = telemetry?.rpmHistory?.value ?? null
  const range = rpmRange(machine)
  const spark = history ? sparklinePoints(history, 240, 32) : null

  return (
    <section className="detail-block">
      <h3>Mẫu đang chạy</h3>
      {!telemetry && (
        <p className="muted">
          {machine.identity.adapterHasProtocol
            ? 'Chưa nhận được telemetry hợp lệ nào từ máy này.'
            : 'Adapter manual: bridge không có giao thức để đọc controller. Mọi thông số bên dưới là "chưa đọc được", không phải số giả lập.'}
        </p>
      )}
      {/* Ảnh to hơn ô lưới, kèm nguyên câu giải thích nó từ đâu ra. Tooltip trong ô lưới không
          đọc được trên máy tính bảng, nên chỗ nói đầy đủ phải là ở đây. */}
      {fileName !== null && (
        <figure className="design-figure">
          <DesignThumb api={api} fileName={fileName} entry={design} size="detail" />
          <figcaption className="reading-meta">{described.full}</figcaption>
        </figure>
      )}

      <dl className="reading-list">
        <ReadingRow label="Trạng thái" reading={telemetry?.status ?? null} render={(value) => statusLabels[value]} freshSeconds={thresholds.freshSeconds} timeZone={timeZone} nowMs={nowMs} />
        <ReadingRow label="Mẫu" reading={telemetry?.job ?? null} render={(value) => `${value.fileName ?? UNREAD}${value.product ? ` — ${value.product}` : ''}`} freshSeconds={thresholds.freshSeconds} timeZone={timeZone} nowMs={nowMs} />
        <ReadingRow label="Mũi thêu" reading={telemetry?.job ?? null} render={(value) => formatStitchProgress(value.currentStitch, value.totalStitches)} freshSeconds={thresholds.freshSeconds} timeZone={timeZone} nowMs={nowMs} />
        <ReadingRow label="Thời gian chạy" reading={telemetry?.job ?? null} render={(value) => formatDuration(value.elapsedSeconds)} freshSeconds={thresholds.freshSeconds} timeZone={timeZone} nowMs={nowMs} />
        <ReadingRow label="Kim hiện tại" reading={telemetry?.job ?? null} render={(value) => (value.needle === null ? UNREAD : `Kim ${value.needle}${value.threadColor ? ` · ${value.threadColor}` : ''}`)} freshSeconds={thresholds.freshSeconds} timeZone={timeZone} nowMs={nowMs} />
        <ReadingRow label="Tốc độ (v/ph)" reading={telemetry?.rpm ?? null} render={(value) => formatNumber(value)} freshSeconds={thresholds.freshSeconds} timeZone={timeZone} nowMs={nowMs} />
        <ReadingRow label="Vị trí đầu kim" reading={telemetry?.needlePosition ?? null} render={(value) => `X ${formatNumber(value.x)} · Y ${formatNumber(value.y)}`} freshSeconds={thresholds.freshSeconds} timeZone={timeZone} nowMs={nowMs} />
        <ReadingRow label="Odometer (tổng mũi)" reading={telemetry?.odometer ?? null} render={(value) => formatNumber(value, ' mũi')} freshSeconds={thresholds.freshSeconds} timeZone={timeZone} nowMs={nowMs} />
      </dl>

      {progress && (
        progress.overrun
          ? <p className="detail-error" role="status">⚠ {overrunText(progress)}</p>
          : (
            <div className="progress progress-large" role="img" aria-label={`Tiến độ ${progress.percent} phần trăm`}>
              <span className="progress-bar" style={{ width: `${progress.percent}%` }} />
              <span className="progress-text">
                {progress.percent}% · {job ? formatStitchProgress(job.currentStitch, job.totalStitches) : ''}
              </span>
            </div>
          )
      )}

      <p className={eta.unavailable ? 'derived derived-off' : 'derived'}>
        <span className="derived-value">{eta.text}</span>
        <span className="reading-meta">
          {eta.note}
          {eta.basedOn ? ` · dựa trên số liệu lúc ${formatClock(eta.basedOn, timeZone)}` : ''}
        </span>
      </p>

      {spark && range && (
        <figure className="sparkline">
          {/* viewBox nới 1 đơn vị trên dưới: nét vẽ ở đúng đỉnh/đáy không bị cắt mất một nửa. */}
          <svg
            viewBox="0 -1 240 34"
            preserveAspectRatio="none"
            role="img"
            aria-label={`Biểu đồ tốc độ ${range.samples} lần đọc gần nhất, thấp nhất ${range.min}, cao nhất ${range.max} vòng mỗi phút`}
          >
            {/* non-scaling-stroke: kéo giãn ngang không làm nét dày mỏng theo hướng. */}
            <polyline points={spark} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </svg>
          <figcaption className="reading-meta">
            {range.samples} lần đọc gần nhất · thấp nhất {formatNumber(range.min)} · cao nhất {formatNumber(range.max)} v/ph
          </figcaption>
        </figure>
      )}

      <p className="derived">
        <span className="derived-value">
          {breaks ? threadBreakText(breaks) : `Đứt chỉ: ${UNREAD}`}
        </span>
        <span className="reading-meta">
          {breaks === null
            ? 'Controller chưa báo cửa sổ đo đứt chỉ.'
            : breaks.overThreshold === null
              ? noThreadBreakThreshold
              : `${breaks.overThreshold ? 'Vượt' : 'Trong'} ngưỡng xưởng đặt (${formatRate(machine.thresholds.threadBreakWarnPer1000)} lần/1.000 mũi).`}
        </span>
      </p>
    </section>
  )
}

function ControllerBlock({ machine, timeZone }: { machine: MachineView; timeZone?: string }) {
  const controller = machine.telemetry?.controller ?? null
  return (
    <section className="detail-block">
      <h3>Controller báo cáo</h3>
      <p className="block-note">
        Toàn bộ mục này là dữ liệu chỉ đọc do controller tự báo. Dashboard không liệt kê file cục bộ,
        không chọn mẫu và không gửi lệnh nào tới controller.
      </p>
      {!controller && <p className="muted">{UNREAD}</p>}
      {controller && (
        <>
          <dl className="reading-list">
            <PlainRow label="Mẫu controller đang chọn" value={controller.selectedDesign?.name ?? null} meta={controller.selectedDesign?.slot != null ? `Khe số ${controller.selectedDesign.slot}` : undefined} />
            <PlainRow label="Tổng mũi của mẫu" value={controller.selectedDesign?.totalStitches != null ? formatNumber(controller.selectedDesign.totalStitches) : null} />
            <PlainRow label="Số lần đổi màu" value={controller.selectedDesign?.colorChanges != null ? String(controller.selectedDesign.colorChanges) : null} />
            <PlainRow
              label="Khung giới hạn X/Y"
              value={controller.selectedDesign?.bounds
                ? `X ${controller.selectedDesign.bounds.minX}…${controller.selectedDesign.bounds.maxX} · Y ${controller.selectedDesign.bounds.minY}…${controller.selectedDesign.bounds.maxY}`
                : null}
            />
            <PlainRow label="Khung thêu" value={controller.hoopName ?? (controller.frame ? `${controller.frame.width} × ${controller.frame.height}` : null)} />
            <PlainRow label="Firmware" value={controller.firmware} />
            <PlainRow
              label="Kết nối mạng"
              value={controller.network
                ? `${controller.network.transport === 'wifi' ? 'Wi-Fi' : 'Ethernet'}${controller.network.band ? ` ${controller.network.band}` : ''}${controller.network.ssid ? ` · ${controller.network.ssid}` : ''}`
                : null}
              meta={controller.network?.signalPercent != null ? `Tín hiệu ${controller.network.signalPercent}%` : undefined}
            />
            <PlainRow label="Số mẫu controller báo có" value={controller.designCount != null ? String(controller.designCount) : null} />
          </dl>
          {controller.designs && controller.designs.length > 0 && (
            <details>
              <summary>Danh mục mẫu do controller báo ({controller.designs.length})</summary>
              <table className="mini-table">
                <thead>
                  <tr><th scope="col">Khe</th><th scope="col">Tên</th><th scope="col">Tổng mũi</th><th scope="col">Đổi màu</th></tr>
                </thead>
                <tbody>
                  {controller.designs.map((design) => (
                    <tr key={design.id}>
                      <td>{design.slot ?? '—'}</td>
                      <td>{design.name}</td>
                      <td>{design.totalStitches != null ? formatNumber(design.totalStitches) : UNREAD}</td>
                      <td>{design.colorChanges ?? UNREAD}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          <p className="reading-meta">
            Đọc lúc {formatTime(controller.observedAt, timeZone)} · {sourceLabels[controller.source] ?? controller.source}
          </p>
        </>
      )}
    </section>
  )
}

function IdentityBlock({
  machine, api, can, site, timeZone, busy, setBusy, setError, setNotice, run,
}: {
  machine: MachineView
  api: BridgeApi
  can: (permission: string) => boolean
  site: Site | null
  timeZone?: string
  busy: string | null
  setBusy: (value: string | null) => void
  setError: (value: string | null) => void
  setNotice: (value: string | null) => void
  run: (key: string, action: () => Promise<{ machine: MachineView } | void>, success: string) => Promise<void>
}) {
  const { identity } = machine
  const price = effectivePrice(machine, site)
  void setBusy

  return (
    <section className="detail-block">
      <h3>Định danh &amp; cấu hình</h3>
      <dl className="reading-list">
        <PlainRow label="Mã tài sản" value={identity.assetTag} />
        <PlainRow label="Model" value={identity.model} meta="Do kỹ thuật viên nhập khi ghép, không suy ra từ mạng." />
        <PlainRow label="Serial" value={identity.serial} />
        <PlainRow label="Địa chỉ IP" value={identity.ipAddress} />
        <PlainRow label="MAC" value={identity.macAddress} meta="Chỉ đọc được khi máy cùng L2 với bridge." />
        <PlainRow label="Adapter" value={adapterLabels[identity.adapter] ?? identity.adapter} />
        <PlainRow
          label="Xác minh"
          value={identity.verification.status === 'verified'
            ? `${identity.verification.verifiedBy ?? 'không rõ'} lúc ${formatTime(identity.verification.verifiedAt, timeZone)}`
            : null}
          meta={identity.verification.status === 'verified'
            ? `Bằng chứng: ${identity.verification.evidence}`
            : 'Chưa đối chiếu tại máy — không tính vào KPI sản xuất.'}
        />
        <PlainRow
          label="Đơn giá hiệu lực"
          value={price.value === null ? null : `${formatNumber(price.value)} đ / 1.000 mũi`}
          meta={price.source === 'machine'
            ? `Đơn giá riêng của máy, đè đơn giá xưởng${price.siteValue === null ? ' (xưởng chưa đặt)' : ` ${formatNumber(price.siteValue)} đ`}.`
            : price.source === 'site'
              ? 'Lấy theo đơn giá chung của xưởng — máy này chưa đặt riêng.'
              : 'Cả máy lẫn xưởng đều chưa đặt đơn giá; báo cáo sản lượng sẽ để trống cột tiền.'}
        />
        <PlainRow label="Cập nhật lần cuối" value={`${formatTime(identity.updatedAt, timeZone)} bởi ${identity.updatedBy}`} />
        {identity.note && <PlainRow label="Ghi chú" value={identity.note} />}
        {identity.migrationError && <PlainRow label="Cảnh báo migration" value={identity.migrationError} />}
      </dl>
      <div className="detail-actions">
        {can('machine:probe') && (
          <button type="button" disabled={busy !== null} onClick={() => run('probe', async () => {
            const result = await api.probe(identity.id)
            setNotice(result.open
              ? `Cổng ${result.port} của ${result.ipAddress} đang mở lúc ${formatTime(result.checkedAt, timeZone)}. Điều này chỉ nghĩa là có thiết bị trả lời, không xác nhận đó là máy thêu.`
              : `Cổng ${result.port} của ${result.ipAddress} không mở lúc ${formatTime(result.checkedAt, timeZone)}.`)
          }, '')}>
            {busy === 'probe' ? 'Đang kiểm tra…' : 'Kiểm tra kết nối TCP'}
          </button>
        )}
        {can('machine:update') && (
          <button type="button" disabled={busy !== null} onClick={() => {
            const current = identity.pricePer1000Stitches
            const answer = window.prompt(
              `Đơn giá khoán của ${identity.name}, tính bằng đồng cho 1.000 mũi. Để trống nghĩa là dùng đơn giá chung của xưởng.`,
              current === null ? '' : String(current),
            )
            if (answer === null) return
            const trimmed = answer.trim()
            const value = trimmed === '' ? null : Number(trimmed.replace(/[.,\s]/g, ''))
            if (value !== null && (!Number.isFinite(value) || value < 0)) {
              setError('Đơn giá phải là số tiền không âm. Ví dụ: 1200 nghĩa là 1.200 đ cho 1.000 mũi.')
              return
            }
            void run('price', () => api.update(identity.id, {
              assetTag: identity.assetTag, name: identity.name, siteId: identity.siteId, zone: identity.zone,
              model: identity.model, serial: identity.serial, ipAddress: identity.ipAddress,
              macAddress: identity.macAddress, adapter: identity.adapter, note: identity.note,
              pricePer1000Stitches: value,
            }), value === null ? 'Đã xoá đơn giá riêng của máy.' : 'Đã cập nhật đơn giá khoán.')
          }}>
            {busy === 'price' ? 'Đang lưu…' : 'Đặt đơn giá khoán'}
          </button>
        )}
        {can('machine:archive') && (
          <button
            type="button"
            className="danger"
            disabled={busy !== null}
            onClick={() => {
              const message = identity.archived
                ? `Khôi phục máy ${identity.name} về danh sách đang theo dõi?`
                : `Lưu trữ máy ${identity.name}? Bản ghi và lịch sử được giữ lại, máy chỉ ẩn khỏi danh sách và KPI.`
              if (!window.confirm(message)) return
              void run('archive', () => api.archive(identity.id, !identity.archived),
                identity.archived ? 'Đã khôi phục máy.' : 'Đã lưu trữ máy.')
            }}
          >
            {identity.archived ? 'Khôi phục' : 'Lưu trữ'}
          </button>
        )}
      </div>
    </section>
  )
}

/** Sản lượng 7 ngày của riêng máy này — trả lời "máy này làm được bao nhiêu tiền" tại chỗ. */
function MachineProduction({ api, machine, site, timeZone, reloadKey = 0 }: {
  api: BridgeApi
  machine: MachineView
  site: Site | null
  timeZone?: string
  /** Tăng lên sau mỗi lượt gõ tay: bảng phải đọc lại bridge, không được giữ ảnh cũ. */
  reloadKey?: number
}) {
  const [report, setReport] = useState<ProductionReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const machineId = machine.identity.id

  useEffect(() => {
    let cancelled = false
    api.production({ from: ymd(6, site?.timeZone), to: ymd(0, site?.timeZone), machineId })
      .then((result) => { if (!cancelled) { setReport(result); setError(null) } })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof BridgeApiError ? cause.message : 'Không đọc được sản lượng từ bridge.')
      })
    return () => { cancelled = true }
    // `updatedAt` cũng nằm trong danh sách này: xác minh máy là thứ quyết định dòng đó có được cộng
    // vào tổng hay không, nên vừa xác minh xong mà bảng vẫn giữ ảnh cũ thì tổng hiện sai ngay lúc
    // người ta đang nhìn để đối chiếu.
  }, [api, machineId, machine.identity.updatedAt, site?.timeZone, reloadKey])

  return (
    <section className="detail-block">
      <h3>Sản lượng 7 ngày của máy này</h3>
      {error && <p className="detail-error" role="alert">{error}</p>}
      {!report && !error && <p className="muted">Đang tải…</p>}
      {report && report.rows.length === 0 && (
        <p className="muted">
          Chưa có dòng sản lượng nào trong 7 ngày qua. Máy phải đọc được bộ đếm mũi, hoặc phải có người
          gõ số vào ô ở trên, thì bảng này mới có số.
        </p>
      )}
      {report && report.rows.length > 0 && (
        <>
          <p className="reading-meta">
            Tổng {formatNumber(report.totals.stitchesBilled)} mũi · {formatHours(report.totals.runSeconds)} chạy máy ·{' '}
            {formatVnd(report.totals.amount)} theo đơn giá đang đặt hôm nay.
            {report.totals.manualStitches > 0
              && ` Trong đó ${formatNumber(report.totals.manualStitches)} mũi là số người gõ tay, không phải số máy tự khai.`}
          </p>
          {/* Dòng tổng chỉ cộng máy đã xác minh (PRD), nên một máy chưa xác minh cho ra bảng có số mà
              tổng bằng 0. Không nói ra thì đó trông y như lỗi cộng, và người đọc sẽ đi tìm lỗi ở chỗ
              không có lỗi — thay vì đi xác minh cái máy, là việc thật sự còn thiếu. */}
          {report.excluded.unverifiedRows > 0 && (
            <p className="reading-meta">
              Tổng ở trên đang bằng 0 vì máy chưa được kỹ thuật viên xác minh tại chỗ: dòng của máy chưa
              xác minh không được tính vào sản lượng và tiền khoán của xưởng. Bảng dưới vẫn hiện đủ để đối chiếu.
            </p>
          )}
          <table className="mini-table">
            <thead>
              <tr>
                <th scope="col">Ngày</th><th scope="col">Ca</th>
                <th scope="col" className="cell-number">Số mũi tính tiền</th>
                <th scope="col" className="cell-number">Trong đó người gõ</th>
                <th scope="col" className="cell-number">Giờ chạy</th>
                <th scope="col" className="cell-number">Tiền (theo đơn giá hiện tại)</th>
                <th scope="col">Khoảng đọc</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.date}</td>
                  <td>{row.shiftName}</td>
                  <td className="cell-number">{formatNumber(row.stitchesBilled)}</td>
                  <td className="cell-number">{row.manualStitches > 0 ? formatNumber(row.manualStitches) : '—'}</td>
                  <td className="cell-number">{formatHours(row.runSeconds)}</td>
                  <td className="cell-number">{formatVnd(row.amount)}</td>
                  <td>{formatClock(row.firstAt, timeZone)} → {formatClock(row.lastAt, timeZone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
