import { useMemo, useState } from 'react'
import { formatClock, formatNumber, statusLabels } from '../lib/format'
import { browserTimeZone, isoToLocalInput, localInputToIso, previewManualReading, zonesDisagree } from '../lib/manualReading'
import { BridgeApiError, type BridgeApi, type ManualReadingResult } from '../services/bridgeApi'
import type { MachineView, OperationalStatus } from '../types/fleet'

/**
 * Ô nhập số mũi bằng tay.
 *
 * Vì sao có ô này: BECS-A15 ở xưởng không nói được giao thức nào bridge đọc được, nên lựa chọn
 * thật không phải "số tự động hay số gõ tay" mà là "số gõ tay có kỷ luật, hay số gõ tay trên
 * giấy mà không ai kiểm lại được". Ô này chọn cái thứ nhất: có tên người gõ, có giờ đọc, có
 * nhật ký kiểm toán, và có một phép trừ hiện ngay trước mắt trước khi con số thành tiền.
 *
 * Ba điều màn hình này KHÔNG được làm, vì mỗi điều là một lời nói dối:
 *   - không tô xanh ô trạng thái máy: người gõ số chỉ chứng minh có người đứng đó;
 *   - không nói "đã lưu" khi bridge trả `persisted: false` — lúc đó con số chỉ nằm trong RAM;
 *   - không trộn mũi gõ tay vào cột mũi máy đọc; báo cáo giữ hai cột riêng tới tận dòng tổng.
 *
 * Không có nút sửa hay xoá một lượt đã ghi. Cách chữa một con số sai là gõ tiếp con số đúng —
 * lượt sai vẫn nằm trong nhật ký, vì nó đã từng là căn cứ để trả tiền cho ai đó.
 */

const statuses: OperationalStatus[] = ['running', 'paused', 'stopped', 'fault', 'unknown']

/** Vì sao sổ nhận hay không nhận lượt đọc này — chữ của người, không phải mã của máy. */
const countedLabels: Record<string, string> = {
  counted: 'đã vào sổ sản lượng',
  idle: 'đã ghi, không thêm mũi nào so với lượt trước',
  baseline: 'đã ghi làm mốc — lượt gõ sau mới ra số mũi',
  'counter-reset': 'đã ghi làm mốc mới sau khi bộ đếm về 0; khoảng vừa rồi không tính mũi',
  'implausible-jump': 'KHÔNG vào sổ: chênh lệch vượt giới hạn vật lý của máy',
  'out-of-order': 'KHÔNG vào sổ: giờ đọc không muộn hơn lượt trước',
  'unverified-reading': 'KHÔNG vào sổ: loại số đọc này không được tính sản lượng',
  'no-odometer': 'KHÔNG vào sổ: thiếu số bộ đếm',
  'no-timestamp': 'KHÔNG vào sổ: thiếu giờ đọc',
}

export function ManualReadingForm({
  api, machine, timeZone, onMachine, onRecorded,
}: {
  api: BridgeApi
  machine: MachineView
  timeZone?: string
  onMachine: (machine: MachineView) => void
  /** Gọi sau khi bridge đã nhận: sổ sản lượng và nhật ký của máy này vừa đổi, phải đọc lại. */
  onRecorded?: () => void
}) {
  const [odometer, setOdometer] = useState('')
  const [when, setWhen] = useState(() => isoToLocalInput(new Date().toISOString()))
  const [status, setStatus] = useState<OperationalStatus>('running')
  const [note, setNote] = useState('')
  const [counterReset, setCounterReset] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<string | null>(null)
  const [result, setResult] = useState<ManualReadingResult | null>(null)

  const previous = machine.lastCountedReading
  const observedIso = localInputToIso(when)
  // Người Việt gõ mốc nghìn bằng dấu chấm, nên `1.209.000` phải hiểu được. Chỉ bỏ dấu chấm và
  // khoảng trắng: còn ký tự nào khác thì để nó thành số không hợp lệ và nói ra, chứ không đoán.
  const cleaned = odometer.replace(/[.\s]/g, '')
  const parsed = cleaned === '' ? null : /^\d+$/.test(cleaned) ? Number(cleaned) : Number.NaN

  // `NaN` đi thẳng vào `previewManualReading`: nó không phải số nguyên nên rơi vào nhánh "không
  // hợp lệ" và tự nói ra lý do — khỏi phải dựng một trạng thái lỗi thứ hai ở đây.
  const preview = useMemo(() => previewManualReading({
    odometer: parsed,
    observedAt: observedIso ?? '',
    previous,
    counterReset,
  }), [parsed, observedIso, previous, counterReset])

  const siteZone = timeZone ?? null
  const localZone = browserTimeZone()
  // Tên múi giờ khác nhau chưa phải là giờ khác nhau — so bằng giờ thật lúc đọc, xem `zonesDisagree`.
  const zonesOff = siteZone !== null && zonesDisagree(observedIso === null ? new Date() : new Date(observedIso), localZone, siteZone)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (preview.blocked || parsed === null || Number.isNaN(parsed) || observedIso === null) return
    setSaving(true); setError(null); setErrorField(null)
    try {
      const submitted = await api.manualReading(machine.identity.id, {
        odometer: parsed,
        observedAt: observedIso,
        status,
        note: note.trim() === '' ? null : note.trim(),
        counterReset,
      })
      onMachine(submitted.machine)
      setResult(submitted)
      onRecorded?.()
      // Xoá số và ghi chú, giữ lại giờ đã làm mới: người chốt ca đi từ máy này sang máy khác,
      // và một con số cũ còn nằm trong ô là con số dễ bị gõ nhầm sang máy kế tiếp nhất.
      setOdometer(''); setNote(''); setCounterReset(false)
      setWhen(isoToLocalInput(new Date().toISOString()))
    } catch (caught) {
      setResult(null)
      if (caught instanceof BridgeApiError) {
        setError(`${caught.message}${caught.correlationId ? ` (mã tra cứu ${caught.correlationId})` : ''}`)
        setErrorField(caught.field)
      } else {
        setError('Không gọi được bridge. Số CHƯA được ghi.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="detail-block" aria-label="Nhập số mũi bằng tay">
      <h3>Nhập số mũi bằng tay</h3>
      <p className="field-hint">
        Dùng khi máy không tự khai được số. Con số này vào thẳng bảng lương khoán, nhưng báo cáo luôn
        ghi rõ dòng nào do người gõ và ai gõ — nó không bao giờ được trộn thành số máy tự đọc.
      </p>

      <p className="reading-meta">
        {previous
          ? <>Số gần nhất đã vào sổ: <strong>{formatNumber(previous.odometer)}</strong> mũi, đọc lúc{' '}
              {formatClock(previous.at, timeZone)} ({previous.quality === 'manual' ? 'người gõ' : 'máy khai'}).</>
          : <>Máy này chưa có số nào trong sổ sản lượng. Lượt gõ đầu tiên chỉ làm mốc.</>}
      </p>

      <form onSubmit={submit}>
        <div className="draft-grid">
          <label>
            <span>Số mũi tổng trên màn hình máy</span>
            <input
              inputMode="numeric" autoComplete="off" value={odometer}
              onChange={(event) => setOdometer(event.target.value)}
              aria-invalid={errorField === 'odometer' || undefined}
              placeholder="ví dụ 1.209.000"
            />
          </label>
          <label>
            <span>Đọc lúc (giờ máy tính này)</span>
            <input
              type="datetime-local" value={when}
              onChange={(event) => setWhen(event.target.value)}
              aria-invalid={errorField === 'observedAt' || undefined}
            />
          </label>
          <label>
            <span>Lúc đọc, máy đang</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as OperationalStatus)}>
              {statuses.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
            </select>
          </label>
          <label>
            <span>Ghi chú (không bắt buộc)</span>
            <input
              value={note} maxLength={200} autoComplete="off"
              onChange={(event) => setNote(event.target.value)}
              placeholder="ví dụ: đọc trên HMI, hết ca 1"
            />
          </label>
        </div>

        {/* Ô khai bộ đếm về 0 là một lời khai, không phải một ô bấm cho qua: khai rồi thì khoảng
            vừa rồi KHÔNG được tính mũi nào, vì không ai biết máy đã chạy bao nhiêu trước lúc về 0. */}
        <label className="filter-check">
          <input type="checkbox" checked={counterReset} onChange={(event) => setCounterReset(event.target.checked)} />
          <span>
            Bộ đếm vừa về 0 hoặc vừa thay bo điều khiển. Khai vậy thì lượt này chỉ làm mốc mới,
            khoảng vừa rồi không tính mũi cho ai.
          </span>
        </label>

        <p className={preview.blocked && preview.verdict !== 'empty' ? 'detail-error' : 'reading-meta'} role="status">
          {preview.message}
        </p>

        {zonesOff && (
          <div className="banner banner-warning" role="status">
            <strong>Máy tính này đang ở múi giờ {localZone}, xưởng thì tính theo {siteZone}.</strong>
            <span>
              Giờ đọc ở trên lấy theo đồng hồ máy tính này. Lệch múi giờ thì con số có thể vào sai ca,
              tức sai bảng lương — kiểm lại đồng hồ máy trước khi ghi.
            </span>
          </div>
        )}

        <div className="detail-actions">
          <button type="submit" className="primary" disabled={saving || preview.blocked}>
            {saving ? 'Đang ghi…' : preview.verdict === 'counted' && preview.delta !== null
              ? `Ghi ${formatNumber(preview.delta)} mũi vào sổ`
              : 'Ghi lượt đọc này'}
          </button>
        </div>
      </form>

      {error && <p className="detail-error" role="alert">{error}</p>}

      {result && (
        <>
          {/* `persisted: false` = con số chỉ nằm trong bộ nhớ bridge. Nói "đã lưu" lúc này là một
              lời nói dối sống tới đúng lần khởi động lại tiếp theo, mà số gõ tay thì không có
              nguồn nào khác để đọc lại. */}
          {result.persisted
            ? <p className="detail-notice" role="status">
                Đã ghi {formatNumber(result.reading.odometer)} mũi, đọc lúc {formatClock(result.reading.observedAt, timeZone)} —{' '}
                {countedLabels[result.counted.reason] ?? result.counted.reason}
                {result.counted.counted && result.counted.stitches ? ` (${formatNumber(result.counted.stitches)} mũi)` : ''}.
              </p>
            : <div className="banner banner-critical" role="alert">
                <strong>Bridge chưa ghi được số này xuống đĩa.</strong>
                <span>
                  Con số đang chỉ nằm trong bộ nhớ và sẽ mất nếu bridge khởi động lại. Ghi lại trên giấy,
                  rồi gọi người quản trị xem đĩa và quyền ghi của file sổ sản lượng.
                </span>
              </div>}

          {result.reading.impliedStitchesPerMinute !== null && (
            <p className="reading-meta">
              Tương đương {formatNumber(result.reading.impliedStitchesPerMinute)} mũi/phút trong khoảng vừa ghi.
              Con số này lệch xa thực tế thì gõ tiếp một lượt đọc đúng — lượt vừa rồi vẫn nằm trong nhật ký.
            </p>
          )}
        </>
      )}
    </section>
  )
}
