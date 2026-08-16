import { memo, useEffect, useRef } from 'react'
import { andonTone } from '../lib/andon'
import {
  estimatedFinish, formatMinutes, formatMinutesShort, jobProgress, overrunText, sparklinePoints,
  statusDuration,
} from '../lib/derived'
import { effectiveStatus, highestSeverity, unacknowledgedAlerts } from '../lib/fleet'
import { UNREAD, formatAge, formatClock, formatNumber } from '../lib/format'
import type { DesignIndex } from '../hooks/useDesignIndex'
import type { BridgeApi, DesignEntry } from '../services/bridgeApi'
import type { MachineView } from '../types/fleet'
import { DesignThumb } from './DesignThumb'
import { ConnectionBadge, SeverityBadge, StatusBadge, VerificationBadge } from './StateBadge'

/**
 * Lưới ô vuông — mỗi máy một ô, **sản phẩm đang chạy là chữ to nhất trong ô**.
 *
 * Bảng dày trả lời tốt câu "máy nào cần người". Nhưng câu hỏi thường trực hơn ở xưởng là
 * "máy này đang thêu cái gì, còn bao lâu" — và trong bảng, tên sản phẩm là chữ 13 px nằm
 * lẫn giữa sáu cột khác. Ô vuông đảo lại thứ tự đó: sản phẩm và tiến độ lên trên cùng, đọc
 * được từ vài mét, còn phần kỹ thuật (adapter, IP, mã lỗi) để panel chi tiết lo.
 *
 * Ba ràng buộc giữ nguyên như bảng, không nới:
 *  - Ô không bao giờ *suy đoán*: máy không đọc được thì ghi "Chưa đọc được từ controller",
 *    không mượn tên mẫu của lần chạy trước, không vẽ thanh tiến độ 0%.
 *  - Màu không bao giờ là kênh duy nhất: mỗi ô có chữ trạng thái và ký hiệu, nền màu chỉ là
 *    lớp thứ hai. Tô theo `andonTone` — cùng thang đang sắp xếp "Ưu tiên xử lý".
 *  - Ô bình thường im lặng: nền trắng, badge bỏ viền. Chỉ ô bất thường mới có màu.
 *
 * Bấm vào ô mở đúng panel chi tiết mà bảng vẫn mở, nên `j/k`, `Esc`, và link `?machine=`
 * hoạt động y hệt ở cả hai cách bày.
 */

/** Sản phẩm / mẫu đang chạy, hoặc lý do không biết — không bao giờ để trống. */
function jobLines(machine: MachineView): { product: string; file: string | null; unread: boolean } {
  const job = machine.telemetry?.job?.value ?? null
  if (!job || (!job.product && !job.fileName)) return { product: UNREAD, file: null, unread: true }
  // Controller báo tên file dạng `80_4127~.DST` — với người đứng máy thì tên sản phẩm mới là
  // thứ nhận ra được, nên nó lên dòng chính; tên file xuống dòng phụ để đối chiếu khi cần.
  if (job.product) return { product: job.product, file: job.fileName, unread: false }
  return { product: job.fileName!, file: null, unread: false }
}

/**
 * Đường tốc độ 24 mẫu gần nhất, vẽ ngay trong ô.
 *
 * Một con số RPM nói máy đang chạy; **hình dạng** của nó nói máy chạy có đều không — tụt đều
 * là sắp đứt chỉ hoặc kẹt khung, còn răng cưa là người đứng máy đang dừng-chạy liên tục. Đó là
 * thứ con số đơn lẻ không bao giờ nói được, và cũng là lý do duy nhất để tốn 26 px chiều cao.
 *
 * Chỉ vẽ khi controller **thật sự** gửi mảng lịch sử. Không có thì không dựng đường từ một
 * điểm, không nội suy, không lấy mẫu của lần chạy trước.
 */
const sparkWidth = 76
const sparkHeight = 24
/**
 * Mực phải nằm gọn trong khung khai báo, không tràn ra ngoài.
 *
 * Bản đầu vẽ thẳng trong 72×20 nên khi RPM tụt về 0 — đúng lúc đáng nhìn nhất — chấm "bây giờ"
 * nằm ở `(72, 20)`, tức tâm chấm đặt ngay góc: bán kính 2.5 px cộng vành 1 px thò ra ngoài
 * khung 3.5 px và đè vào chữ "0 v/ph" bên cạnh. Nó *có* hiện ra, chỉ nhờ `overflow: visible`,
 * mà chỗ nó hiện ra là chỗ của chữ khác.
 */
const inkPad = 1
const dotPad = 5

function RpmSpark({ history }: { history: number[] }) {
  const innerWidth = sparkWidth - dotPad - inkPad
  const innerHeight = sparkHeight - dotPad * 2
  const points = sparklinePoints(history, innerWidth, innerHeight)
  if (points === null) return null
  const last = history[history.length - 1]
  const min = Math.min(...history)
  const max = Math.max(...history)
  const span = max - min || 1
  const cy = dotPad + (innerHeight - ((last - min) / span) * innerHeight)
  return (
    <svg
      className="card-spark"
      width={sparkWidth}
      height={sparkHeight}
      viewBox={`0 0 ${sparkWidth} ${sparkHeight}`}
      role="img"
      aria-label={`Tốc độ ${history.length} lần đọc gần nhất, thấp nhất ${min}, cao nhất ${max} vòng/phút`}
      focusable="false"
    >
      <g transform={`translate(${inkPad} ${dotPad})`}>
        <polyline points={points} />
      </g>
      {/* Chấm cuối có vòng màu nền: nó là "bây giờ", và phải còn thấy được khi đè lên đường. */}
      <circle cx={inkPad + innerWidth} cy={cy} r="2.5" className="card-spark-now" />
    </svg>
  )
}

const FleetCard = memo(function FleetCard({
  machine, selected, timeZone, nowMs, api, design, onSelect,
}: {
  machine: MachineView
  selected: boolean
  timeZone?: string
  nowMs: number
  api: BridgeApi
  design: DesignEntry | undefined
  onSelect: (id: string) => void
}) {
  const { identity, connection, telemetry } = machine
  const status = effectiveStatus(machine)
  const severity = highestSeverity(unacknowledgedAlerts(machine))
  const alert = severity ? unacknowledgedAlerts(machine).find((entry) => entry.severity === severity) : null
  const progress = jobProgress(machine)
  const duration = statusDuration(machine, nowMs)
  const longStop = duration !== null && (status === 'stopped' || status === 'paused')
    && duration.minutes >= machine.thresholds.stopEscalationMinutes
  const eta = estimatedFinish(machine, nowMs, timeZone)
  const { tone, reason } = andonTone(machine, nowMs)
  const job = jobLines(machine)
  // Tên file thật để tra ảnh — `jobLines` giấu nó đi khi nó *là* dòng chính, nhưng thư viện
  // mẫu vẫn cần đúng cái tên đó.
  const fileName = telemetry?.job?.value.fileName ?? null
  const history = telemetry?.rpmHistory?.value ?? null
  const card = useRef<HTMLButtonElement>(null)

  // `j/k` phải kéo ô đang chọn vào tầm nhìn, giống hệt hàng bảng — nếu không thì người dùng
  // "đi" xuống một ô nằm ngoài màn hình rồi tưởng bàn phím hỏng.
  useEffect(() => {
    if (selected) card.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <button
      ref={card}
      type="button"
      aria-pressed={selected}
      className={`fleet-card fleet-tone-${tone}${selected ? ' fleet-card-selected' : ''}${identity.archived ? ' fleet-card-archived' : ''}`}
      onClick={() => onSelect(identity.id)}
    >
      <span className="card-head">
        <span className="card-name">{identity.name}</span>
        <ConnectionBadge state={connection.state} title={connection.reason} />
      </span>
      <span className="card-sub">
        {identity.assetTag} · {identity.zone}
        {identity.verification.status !== 'verified' && <VerificationBadge status="unverified" />}
        {identity.archived && <span className="badge badge-archived">Đã lưu trữ</span>}
      </span>

      {/* Ảnh mẫu bên trái, chữ bên phải — đứng cách vài mét thì nhận ra *hình* trước khi kịp
          đọc tên. Ảnh dựng từ file trong thư viện của xưởng khớp theo tên, không phải ảnh máy
          gửi về; chưa có thư viện thì ô ảnh nói thẳng là chưa có, chứ không lặng lẽ biến mất. */}
      <span className="card-job">
        <DesignThumb api={api} fileName={fileName} entry={design} />
        <span className="card-job-text">
          {/* Dòng to nhất của ô. Máy chưa đọc được thì chính câu "Chưa đọc được từ controller"
              chiếm chỗ đó — im lặng ở đây là cách một máy đứng im cả tiếng không ai thấy. */}
          <span className={job.unread ? 'card-product card-product-unread' : 'card-product'} title={job.file ?? undefined}>
            {job.product}
          </span>
          <span className="card-file">{job.file ?? ' '}</span>
        </span>
      </span>

      <span className="card-progress">
        {progress === null ? (
          <span className="card-progress-none">Chưa có số mũi để tính tiến độ</span>
        ) : progress.overrun ? (
          <span className="cell-overrun">⚠ {overrunText(progress)}</span>
        ) : (
          <>
            <span className="progress progress-card" role="img" aria-label={`Tiến độ ${progress.percent} phần trăm`}>
              <span className="progress-bar" style={{ width: `${Math.min(progress.percent, 100)}%` }} />
            </span>
            <span className="card-pct">{progress.percent}%</span>
          </>
        )}
      </span>

      <span className="card-foot">
        {longStop
          ? <span className="badge badge-status badge-status-idle-long"><span aria-hidden="true" className="badge-symbol">■!</span>Dừng lâu</span>
          : <StatusBadge status={status} />}
        {duration && (
          <span
            className="card-duration"
            title={duration.approximate
              ? `Ít nhất ${formatMinutes(duration.minutes)}, tính từ ${formatClock(duration.since, timeZone)} — chưa rõ mốc trước đó`
              : `${formatMinutes(duration.minutes)}, từ ${formatClock(duration.since, timeZone)}`}
          >
            {duration.approximate ? '≥' : ''}{formatMinutesShort(duration.minutes)}
          </span>
        )}
        <span className="card-foot-right">
          {history && <RpmSpark history={history} />}
          {telemetry?.rpm ? `${formatNumber(telemetry.rpm.value)} v/ph` : 'RPM chưa đọc'}
          {eta.value !== null && <> · <span title={eta.note}>{eta.text}</span></>}
        </span>
      </span>

      {/* Lý do tô màu, bằng chữ, ngay trong ô: tooltip không đọc được trên máy tính bảng và
          không đọc được từ xa. Ô bình thường không có dòng này nên không tốn chỗ. */}
      {alert
        ? <span className="card-reason card-reason-alert"><SeverityBadge severity={severity!} /> {alert.title}</span>
        : tone !== 'running' && tone !== 'idle' && <span className="card-reason">{reason}</span>}

      <span className="card-age reading-meta">Dữ liệu {formatAge(connection.ageSeconds)}</span>
    </button>
  )
})

export function FleetCards({
  machines, selectedId, timeZone, nowMs, api, designs, onSelect,
}: {
  machines: MachineView[]
  selectedId: string | null
  timeZone?: string
  nowMs: number
  api: BridgeApi
  designs: DesignIndex
  onSelect: (id: string) => void
}) {
  return (
    <>
      <div className="fleet-cards" role="list" aria-label="Đội máy, mỗi ô một máy">
        {machines.map((machine) => (
          <div role="listitem" key={machine.identity.id} className="fleet-card-slot">
            <FleetCard
              machine={machine}
              selected={machine.identity.id === selectedId}
              timeZone={timeZone}
              nowMs={nowMs}
              api={api}
              design={designs.entries[machine.telemetry?.job?.value.fileName ?? '']}
              onSelect={onSelect}
            />
          </div>
        ))}
      </div>
      {machines.length === 0 && <p className="table-empty">Không máy nào khớp bộ lọc.</p>}
      {/* Thư viện mẫu hỏng là chuyện của cả lưới, không phải của từng ô: nói một lần ở đây,
          thay vì hai mươi ô cùng ghi "Lỗi đọc" mà không ô nào nói được vì sao. */}
      {designs.error !== null && (
        <p className="table-footnote reading-meta">
          Chưa tra được thư viện mẫu ({designs.error}). Các ô vẫn hiện đúng trạng thái máy, chỉ thiếu ảnh mẫu.
        </p>
      )}
      {machines.some((machine) => statusDuration(machine, nowMs)?.approximate) && (
        <p className="table-footnote reading-meta">
          <strong>≥</strong> thời lượng là mốc dưới: bridge chỉ đếm từ lần đọc đầu tiên sau khi
          khởi động, trạng thái có thể đã bắt đầu trước đó.
        </p>
      )}
    </>
  )
}
