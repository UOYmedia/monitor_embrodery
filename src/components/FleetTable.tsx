import { memo, useEffect, useRef } from 'react'
import { andonTone } from '../lib/andon'
import {
  estimatedFinish, jobProgress, overrunText, statusDuration, formatMinutes, formatMinutesShort,
} from '../lib/derived'
import { effectiveStatus, highestSeverity, unacknowledgedAlerts } from '../lib/fleet'
import { UNREAD, formatAge, formatClock, formatNumber, formatTime } from '../lib/format'
import type { MachineView } from '../types/fleet'
import { ConnectionBadge, SeverityBadge, StatusBadge, VerificationBadge } from './StateBadge'

/**
 * Một hàng mỗi máy, hai dòng chữ, cao 40–44 px.
 *
 * Ba lỗi của bản trước được sửa ở đây:
 *  1. Máy dừng 2 phút trông y hệt máy dừng 2 giờ → cột trạng thái luôn in thời lượng.
 *  2. RPM in trơn cách badge "dữ liệu cũ" ba cột, đọc như số hiện tại → khi kết nối `stale`,
 *     từng ô telemetry tự mang dấu `◐` và giờ đọc của chính nó.
 *  3. Bảo trì đến hạn không nhìn thấy được từ danh sách → thêm cột BT, sort được.
 *
 * Và lỗi thứ tư, nặng nhất, sửa ở bản này: **mọi hàng hét to bằng nhau.** Một xưởng 13 máy có
 * 10 máy chạy bình thường; nếu 10 hàng đó cũng đeo hai viên badge viền màu như hàng mất kết
 * nối thì mắt phải đọc từng dòng mới tìm ra máy cần người. Quy ước mới:
 *
 *  - Hàng bình thường **im lặng**: "Đang kết nối"/"Đang chạy" bỏ viền bỏ nền, chỉ còn chữ xám.
 *  - Hàng bất thường mới có nền màu + vạch màu ở mép trái, tô theo đúng `andonTone` — cùng
 *    thang đang dùng để sắp xếp "Ưu tiên xử lý", nên màu và thứ tự luôn nói cùng một câu.
 *  - Chữ lặp lại trên MỌI hàng ("(chưa rõ mốc trước đó)", "Không có") rút thành một dấu `†` /
 *    một gạch `—`, giải thích một lần ở chú thích dưới bảng. Không mất thông tin, mất tiếng ồn.
 *
 * Hàng được memo theo object máy: mỗi delta chỉ thay đúng một máy, 99 hàng còn lại giữ nguyên
 * tham chiếu và React bỏ qua. `nowMs` là prop của hàng vì thời lượng trạng thái phải chạy theo
 * đồng hồ — nhưng nó chỉ đổi mỗi giây một lần cho cả bảng.
 */

/** Đánh dấu ngay tại ô: một con số cũ đứng cạnh badge ở cột khác vẫn bị đọc là số hiện tại. */
function StaleCell({ stale, at, timeZone, children }: {
  stale: boolean
  at: string | null | undefined
  timeZone?: string
  children: React.ReactNode
}) {
  if (!stale) return <>{children}</>
  return (
    <span className="cell-stale" title={`Số này đọc lúc ${formatTime(at, timeZone)}, đã quá ngưỡng tươi.`}>
      <span aria-hidden="true">◐</span> {children} <span className="cell-stale-at">({formatClock(at, timeZone)})</span>
    </span>
  )
}

/** `còn 320k` — số mũi còn lại của hạng mục gấp nhất, hoặc lý do không biết. */
function maintenanceCell(machine: MachineView): { text: string; tone: string } {
  let worst: MachineView['maintenance'][number] | null = null
  for (const plan of machine.maintenance) {
    if (plan.dueState === 'unknown' || plan.remainingStitches === null) continue
    if (!worst || plan.remainingStitches < worst.remainingStitches!) worst = plan
  }
  if (!worst) {
    // `tone: 'muted'` ở bản trước dính đúng cái bẫy đã ghi ở `.cell-none`: `.muted` là kiểu của
    // khối rỗng cả trang (`padding: 12px`), dùng làm class cho `<td>` thì riêng hàng đó cao
    // 62 px. `bt-none` chỉ làm xám chữ, không đụng vào chiều cao hàng.
    return machine.maintenance.length === 0
      ? { text: '—', tone: 'bt-none' }
      : { text: 'Chưa đủ dữ liệu', tone: 'bt-none' }
  }
  if (worst.dueState === 'overdue') return { text: `Quá hạn ${compactStitches(Math.abs(worst.remainingStitches!))}`, tone: 'bt-overdue' }
  if (worst.dueState === 'due') return { text: `Sắp đến hạn · ${compactStitches(worst.remainingStitches!)}`, tone: 'bt-due' }
  return { text: `còn ${compactStitches(worst.remainingStitches!)}`, tone: '' }
}

/** `320k` / `1,5tr` — cột hẹp, và con số chính xác đã có trong panel chi tiết. */
function compactStitches(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}tr`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(Math.round(value))
}

/** Hai tone này là trạng thái bình thường của một xưởng đang chạy: không tô, không tooltip. */
const quietTones: ReadonlySet<string> = new Set(['running', 'idle'])

const FleetRow = memo(function FleetRow({
  machine, selected, compact, timeZone, nowMs, onSelect,
}: {
  machine: MachineView
  selected: boolean
  /** Panel chi tiết đang mở: bỏ cột IP để bảng không phải cuộn ngang. */
  compact: boolean
  timeZone?: string
  nowMs: number
  onSelect: (id: string) => void
}) {
  const { identity, connection, telemetry } = machine
  const status = effectiveStatus(machine)
  const severity = highestSeverity(unacknowledgedAlerts(machine))
  const progress = jobProgress(machine)
  const job = telemetry?.job?.value ?? null
  const duration = statusDuration(machine, nowMs)
  const longStop = duration !== null && (status === 'stopped' || status === 'paused')
    && duration.minutes >= machine.thresholds.stopEscalationMinutes
  const stale = connection.state === 'stale'
  const eta = estimatedFinish(machine, nowMs, timeZone)
  const maintenance = maintenanceCell(machine)
  // Cùng hàm quyết định thứ tự "Ưu tiên xử lý" và màu ô andon. Dùng lại ở đây để hàng nằm trên
  // cùng cũng là hàng đậm nhất — bản trước tô nền cho máy "dừng lâu" nhưng bỏ trắng máy "mất
  // kết nối" đứng ngay trên nó, tức là màu và thứ tự nói ngược nhau.
  const { tone, reason } = andonTone(machine, nowMs)
  const row = useRef<HTMLTableRowElement>(null)

  // Điều hướng bằng j/k phải kéo hàng đang chọn vào tầm nhìn, nếu không người dùng "đi" xuống
  // một hàng vô hình rồi tưởng bàn phím hỏng.
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <tr
      ref={row}
      className={`fleet-row fleet-tone-${tone}${selected ? ' fleet-row-selected' : ''}${identity.archived ? ' fleet-row-archived' : ''}`}
      aria-selected={selected}
      tabIndex={0}
      onClick={() => onSelect(identity.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(identity.id) }
      }}
    >
      {/* Vạch màu mép trái nằm trên ô này. Vạch không bao giờ là kênh duy nhất: lý do tô màu
          nằm sẵn trong tooltip, và badge chữ ở các cột sau nói lại đúng điều đó. */}
      <th scope="row" className="cell-name" title={quietTones.has(tone) ? undefined : reason}>
        <span className="row-title">{identity.name}</span>
        {/* Mã tài sản co lại nhường chỗ cho badge, không phải ngược lại: "Chưa xác minh" là
            cảnh báo an toàn, còn xuống dòng thì hàng cao thêm 8 px trên mọi máy chưa ghép. */}
        <span className="row-sub row-sub-name">
          <span className="row-sub-text">{identity.assetTag} · {identity.zone}</span>
          {identity.verification.status !== 'verified' && <VerificationBadge status="unverified" />}
          {identity.archived && <span className="badge badge-archived">Đã lưu trữ</span>}
        </span>
      </th>

      <td className="cell-connection">
        <ConnectionBadge state={connection.state} title={connection.reason} />
        <span className="row-sub">{formatAge(connection.ageSeconds)}</span>
      </td>

      <td className="cell-status">
        <span className="cell-status-line">
          {longStop
            ? <span className="badge badge-status badge-status-idle-long"><span aria-hidden="true" className="badge-symbol">■!</span>Dừng lâu</span>
            : <StatusBadge status={status} />}
          {/* `≥` thay cho "ít nhất": cùng nghĩa, ngắn hơn 8 ký tự trên mọi hàng, và đã là quy
              ước sẵn có của bảng andon. Chú thích dưới bảng giải thích dấu này một lần thay vì
              in "(chưa rõ mốc trước đó)" lặp lại trên từng hàng. Câu đầy đủ ở tooltip. */}
          {duration && (
            <span
              className="cell-duration"
              title={duration.approximate
                ? `Ít nhất ${formatMinutes(duration.minutes)}, tính từ ${formatClock(duration.since, timeZone)} — chưa rõ mốc trước đó`
                : `${formatMinutes(duration.minutes)}, từ ${formatClock(duration.since, timeZone)}`}
            >
              · {duration.approximate ? '≥' : ''}{formatMinutesShort(duration.minutes)}
            </span>
          )}
        </span>
        {duration && <span className="row-sub">từ {formatClock(duration.since, timeZone)}</span>}
      </td>

      <td className="cell-job">
        <span className="cell-job-line">
          <StaleCell stale={stale} at={telemetry?.job?.observedAt} timeZone={timeZone}>
            {job?.fileName ?? UNREAD}
            {job?.product && <span className="cell-product"> ▸ {job.product}</span>}
          </StaleCell>
        </span>
        <span className="row-sub">
          {progress === null ? '' : progress.overrun ? (
            <span className="cell-overrun">⚠ {overrunText(progress)}</span>
          ) : (
            <>
              {/* Số phần trăm ra NGOÀI thanh: ở 8% thì chữ nằm trên nền xám, ở 92% nó nằm trên
                  nền xanh — cùng một con số đọc bằng hai độ tương phản khác nhau, và ở cỡ
                  0.72rem thì lần nào cũng có một lần khó đọc. Ngoài thanh thì luôn như nhau. */}
              <span className="cell-pct">{progress.percent}%</span>
              <span className="progress progress-slim" role="img" aria-label={`Tiến độ ${progress.percent} phần trăm`}>
                <span className="progress-bar" style={{ width: `${Math.min(progress.percent, 100)}%` }} />
              </span>
              {eta.value !== null && <span className="cell-eta" title={eta.note}>{eta.text}</span>}
            </>
          )}
        </span>
      </td>

      {!compact && (
        <td className="cell-number col-num">
          <StaleCell stale={stale} at={telemetry?.rpm?.observedAt} timeZone={timeZone}>
            {telemetry?.rpm
              ? formatNumber(telemetry.rpm.value)
              // Cột số hẹp: câu đầy đủ xuống bốn dòng và đẩy hàng từ 44 px lên 73 px. Rút gọn
              // chữ hiển thị, giữ nguyên câu đầy đủ trong tooltip và trong panel chi tiết.
              : <span className="cell-unread" title={UNREAD}>Chưa đọc</span>}
          </StaleCell>
        </td>
      )}

      <td className="cell-alert">
        {/* `.muted` là kiểu của khối rỗng cả trang (padding 12px). Dùng inline trong ô bảng
            thì riêng chữ "Không có" đội hàng từ 44 px lên 48 px.
            Và chữ "Không có" lặp trên 12/13 hàng thì tự nó thành nhiễu: một gạch ngang đọc
            nhanh hơn, đồng bộ với cột BT, và câu đầy đủ nằm trong tooltip. */}
        {severity
          ? <SeverityBadge severity={severity} />
          : <span className="cell-none" title="Không có cảnh báo chưa xác nhận">—</span>}
        {severity && <span className="row-sub">{unacknowledgedAlerts(machine).find((alert) => alert.severity === severity)?.title}</span>}
      </td>

      {!compact && <td className={`cell-maintenance col-bt ${maintenance.tone}`}>{maintenance.text}</td>}
      {!compact && <td className="cell-ip col-ip">{identity.ipAddress}</td>}
    </tr>
  )
})

export function FleetTable({
  machines, selectedId, timeZone, nowMs, onSelect,
}: {
  machines: MachineView[]
  selectedId: string | null
  timeZone?: string
  nowMs: number
  onSelect: (id: string) => void
}) {
  // IP chỉ hữu ích khi đi tìm máy trên mạng, và lúc đó panel chi tiết (nơi luôn có IP đầy đủ)
  // đang đóng. Mở panel ra thì cột này chỉ còn là lý do bảng phải cuộn ngang.
  const compact = selectedId !== null
  return (
    <div className={compact ? 'table-wrap table-wrap-compact' : 'table-wrap'}>
      {/* Cột bị ẩn phải nói ra, và phải nói ở TRÊN bảng: đặt dưới bảng 13 hàng thì dòng này
          nằm ngoài màn hình, mà một bảng thiếu cột không giải thích đọc như bảng đầy đủ. */}
      <p className="table-dropped-cols reading-meta">
        {compact
          // Panel chi tiết lấy mất ~1/3 chiều ngang. Bản trước chỉ bỏ cột IP nên bảng vẫn thừa
          // ~150 px và sinh thanh cuộn ngang, cắt mất cột bên phải — đúng thứ người dùng nhìn
          // thấy. Bỏ thêm RPM và BT: cả hai đều là số tra cứu, và panel bên phải đang mở có đủ
          // cả hai, chứ không phải tín hiệu trạng thái (tín hiệu trạng thái không bao giờ bị bỏ).
          ? 'Đang mở panel chi tiết: bảng ẩn cột RPM, BT (bảo trì) và IP — panel bên phải có đủ ba mục này.'
          : 'Màn hình hẹp: bảng đang ẩn cột IP và BT (bảo trì) — mở một máy để xem đầy đủ ở panel chi tiết.'}
      </p>
      <table className={compact ? 'fleet-table fleet-table-compact' : 'fleet-table'}>
        <caption className="visually-hidden">Danh sách máy thêu đã ghép, sắp xếp theo mức ưu tiên xử lý</caption>
        <thead>
          <tr>
            <th scope="col">Máy</th>
            <th scope="col">Kết nối</th>
            <th scope="col">Trạng thái · thời lượng</th>
            <th scope="col">Mẫu / tiến độ</th>
            {!compact && <th scope="col" className="col-num">RPM</th>}
            <th scope="col" title="Cảnh báo chưa xác nhận ở mức cao nhất của máy">Cảnh báo</th>
            {!compact && <th scope="col" className="col-bt" title="Bảo trì: số mũi còn lại của hạng mục gấp nhất">BT</th>}
            {!compact && <th scope="col" className="col-ip">IP</th>}
          </tr>
        </thead>
        <tbody>
          {machines.map((machine) => (
            <FleetRow
              key={machine.identity.id}
              machine={machine}
              selected={machine.identity.id === selectedId}
              compact={compact}
              timeZone={timeZone}
              nowMs={nowMs}
              onSelect={onSelect}
            />
          ))}
        </tbody>
      </table>
      {machines.length === 0 && <p className="table-empty">Không máy nào khớp bộ lọc.</p>}
      {/* Chú thích chỉ hiện khi thật sự có hàng mang dấu — một dòng giải thích cho dấu không
          tồn tại cũng là nhiễu. Tính lại mỗi giây trên toàn danh sách: `statusDuration` là
          phép trừ hai mốc thời gian, 100 máy vẫn nằm dưới ngưỡng đo được. */}
      {machines.some((machine) => statusDuration(machine, nowMs)?.approximate) && (
        <p className="table-footnote reading-meta">
          <strong>≥</strong> thời lượng là mốc dưới: bridge chỉ đếm từ lần đọc đầu tiên sau khi
          khởi động, trạng thái có thể đã bắt đầu trước đó. Rê chuột vào ô để xem giờ đầy đủ.
        </p>
      )}
    </div>
  )
}
