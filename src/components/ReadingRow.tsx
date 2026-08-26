import { readingAgeSeconds } from '../lib/freshness'
import { UNREAD, formatAge, formatTime, sourceLabels } from '../lib/format'
import type { Reading } from '../types/fleet'

/**
 * A single controller-reported field.
 *
 * Every value carries when it was observed and who reported it. When the adapter never read
 * the field there is no value to soften: it says "Chưa đọc được từ controller" and nothing
 * else, because inferring it from the IP, a local file or a sample would be a lie.
 */
export function ReadingRow<T>({
  label, reading, render, freshSeconds, timeZone, nowMs,
}: {
  label: string
  reading: Reading<T> | null | undefined
  render?: (value: T) => string
  freshSeconds: number
  timeZone?: string
  nowMs: number
}) {
  const age = reading ? readingAgeSeconds(reading.observedAt, nowMs) : null
  const stale = age !== null && age > freshSeconds

  return (
    <div className={`reading${reading ? '' : ' reading-unread'}${stale ? ' reading-stale' : ''}`}>
      <dt>{label}</dt>
      <dd>
        <span className="reading-value">
          {reading ? (render ? render(reading.value) : String(reading.value)) : UNREAD}
        </span>
        {reading && (
          <span className="reading-meta">
            {formatTime(reading.observedAt, timeZone)} · {formatAge(age)} · {sourceLabels[reading.source] ?? reading.source}
            {stale && ' · dữ liệu đã quá ngưỡng tươi'}
          </span>
        )}
      </dd>
    </div>
  )
}

/** Same layout for a field that is not a `Reading` — the timestamp comes from the snapshot. */
export function PlainRow({ label, value, meta }: { label: string; value: string | null; meta?: string }) {
  return (
    <div className={`reading${value ? '' : ' reading-unread'}`}>
      <dt>{label}</dt>
      <dd>
        <span className="reading-value">{value ?? UNREAD}</span>
        {meta && <span className="reading-meta">{meta}</span>}
      </dd>
    </div>
  )
}
