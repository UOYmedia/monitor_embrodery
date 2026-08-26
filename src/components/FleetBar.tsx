import { memo } from 'react'
import { fleetComposition } from '../lib/composition'
import type { CompositionSegment } from '../lib/composition'
import { isFilterApplied, toggleFilterPatch } from '../lib/fleet'
import type { FleetFilter } from '../lib/fleet'
import type { MachineView } from '../types/fleet'

/**
 * Thanh chồng ngang: đội máy đang ở tình trạng nào, đọc trong một cái liếc.
 *
 * Vì sao là thanh chồng chứ không phải biểu đồ tròn: mắt người so **chiều dài** chính xác hơn
 * so **góc quạt** rất nhiều, và một cái tròn chiếm cả một hàng máy để nói cùng chừng ấy điều.
 *
 * Bốn quy tắc vẽ, không nới:
 *  - **Khe 2 px màu nền tách các khúc**, không viền. Viền là mực không mang dữ liệu, và ở khúc
 *    hẹp thì viền chiếm chỗ nhiều hơn chính khúc đó.
 *  - **Nhãn nằm dưới thanh, không nhét trong khúc.** Khúc 4% không chứa nổi chữ "Lỗi máy";
 *    nhét vào là chữ bị cắt cụt, tệ hơn không có nhãn.
 *  - **Màu không bao giờ là kênh duy nhất**: mỗi nhãn có ký hiệu chữ và con số đứng cạnh.
 *  - **Khúc bằng 0 biến mất khỏi thanh nhưng vẫn còn ở nhãn** khi đội đủ lớn: "0 máy lỗi" là
 *    một thông tin, còn một khúc rộng 0 px thì không vẽ được.
 *
 * Bấm một khúc là lọc đúng nhóm đó — cùng cơ chế với chip phía trên, nên không có con đường
 * nào lọc mà người xem không thấy token lọc hiện ra.
 */

/** Bề rộng tối thiểu để một khúc còn nhìn thấy được; khúc 1/400 máy vẫn phải hiện ra. */
const minWidthPercent = 1.5

/**
 * Dưới ba máy thì không vẽ.
 *
 * Bàn thử nghiệm một máy in cho ra một thanh vàng chiếm trọn bề ngang ghi "1 Cần để mắt 100%" —
 * một dải mực to bằng cả màn hình để nói đúng cái mà chip ngay trên đã nói bằng một chữ số, và
 * "100%" gợi một độ chính xác mà một mẫu duy nhất không có. Với 1–2 máy, đếm nhanh hơn đo.
 */
const minFleetForBar = 3

function widths(segments: CompositionSegment[], total: number): number[] {
  if (total === 0) return segments.map(() => 0)
  const raw = segments.map((segment) => (segment.count / total) * 100)
  // Kéo khúc bé lên mức nhìn thấy được rồi trừ lại vào khúc lớn nhất, để tổng vẫn là 100%.
  const lifted = raw.map((value) => (value > 0 && value < minWidthPercent ? minWidthPercent : value))
  const debt = lifted.reduce((sum, value) => sum + value, 0) - 100
  if (debt <= 0) return lifted
  const largest = lifted.indexOf(Math.max(...lifted))
  lifted[largest] -= debt
  return lifted
}

export const FleetBar = memo(function FleetBar({
  machines, nowMs, filter, onFilter,
}: {
  machines: MachineView[]
  nowMs: number
  filter: FleetFilter
  onFilter: (next: FleetFilter) => void
}) {
  const { segments, counted, unverified, archived } = fleetComposition(machines, nowMs)
  if (counted < minFleetForBar) return null

  const size = widths(segments, counted)
  // Đội nhỏ thì nhãn bằng 0 chỉ làm nhiễu; đội lớn thì "0 máy mất kết nối" lại đáng đọc.
  const labelled = segments.filter((segment) => segment.count > 0 || counted > 8)

  return (
    <section className="fleet-bar" aria-label="Thành phần đội máy">
      <div className="fleet-bar-track" role="img" aria-label={
        segments.filter((segment) => segment.count > 0)
          .map((segment) => `${segment.label}: ${segment.count} trên ${counted} máy`)
          .join('; ')
      }>
        {segments.map((segment, index) => segment.count > 0 && (
          <span
            key={segment.key}
            className={`fleet-bar-seg fleet-bar-${segment.key}`}
            style={{ width: `${size[index]}%` }}
            title={`${segment.label}: ${segment.count}/${counted} máy (${segment.percent}%). ${segment.hint}`}
          />
        ))}
      </div>

      <ul className="fleet-bar-keys">
        {labelled.map((segment) => {
          const applied = isFilterApplied(filter, segment.patch)
          return (
            <li key={segment.key}>
              <button
                type="button"
                className={`fleet-bar-key${applied ? ' fleet-bar-key-applied' : ''}`}
                aria-pressed={applied}
                title={`${segment.hint} Bấm để lọc.`}
                onClick={() => onFilter(toggleFilterPatch(filter, segment.patch))}
              >
                <span aria-hidden="true" className={`fleet-bar-swatch fleet-bar-${segment.key}`} />
                <span aria-hidden="true" className="fleet-bar-key-symbol">{segment.symbol}</span>
                <strong className="fleet-bar-key-count">{segment.count}</strong>
                <span className="fleet-bar-key-label">{segment.label}</span>
                <span className="fleet-bar-key-pct reading-meta">{segment.percent}%</span>
              </button>
            </li>
          )
        })}

        {/* Máy bị loại khỏi thanh không được biến mất im lặng: một cái thanh "100% đang chạy"
            trong khi hai máy chưa xác minh đang đứng im là cách con số đi lừa người đọc. */}
        {(unverified > 0 || archived > 0) && (
          <li className="fleet-bar-excluded reading-meta">
            trên {counted} máy đã xác minh
            {unverified > 0 && <> · {unverified} chưa xác minh, chưa tính</>}
            {archived > 0 && <> · {archived} đã lưu trữ</>}
          </li>
        )}
      </ul>
    </section>
  )
})
