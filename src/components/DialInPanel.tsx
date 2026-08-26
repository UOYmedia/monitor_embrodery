import { useCallback, useEffect, useState } from 'react'
import type { BridgeApi, MachineInput } from '../services/bridgeApi'
import { BridgeApiError } from '../services/bridgeApi'
import { formatAge, formatTime } from '../lib/format'
import { callerAgeSeconds, describeCaller, describeIngest, formatCallerBytes } from '../lib/ingest'
import type { DialInCaller, IngestStatus, MachineView, Site } from '../types/fleet'

/**
 * Màn hình "máy đang gọi vào".
 *
 * Dùng đúng một lúc: khi có người đứng cạnh controller, vừa đặt `C44 Server IP` trỏ về
 * bridge, và cần biết máy đã gọi tới chưa. Trước khi có khối này, một máy gọi vào từ địa
 * chỉ chưa ghép chỉ để lại một dòng warn trong log của bridge — người ở xưởng không thấy
 * gì, nên không phân biệt được "chưa khai máy" với "sai dây".
 *
 * Bảng này KHÔNG phải nhật ký: bridge chỉ nhớ vài chục địa chỉ gần nhất trong bộ nhớ, mất
 * khi khởi động lại. Nhật ký thật là log của bridge và nhật ký kiểm toán.
 */

const refreshMs = 5000

interface PairDraft {
  remote: string
  name: string
  assetTag: string
  zone: string
  siteId: string
  serial: string
  macAddress: string
  confirmed: boolean
  evidence: 'mac' | 'serial' | 'assetTag'
}

/**
 * Chứng cứ nào thì phải nhập ô nào — bridge từ chối lô ghép nếu thiếu, nên hỏi ngay ở đây
 * còn hơn để người ta bấm "Ghép" rồi mới thấy lỗi.
 */
const evidenceField: Record<PairDraft['evidence'], keyof Pick<PairDraft, 'macAddress' | 'serial' | 'assetTag'>> = {
  mac: 'macAddress',
  serial: 'serial',
  assetTag: 'assetTag',
}

const toneClass: Record<string, string> = {
  off: 'ingest-off',
  waiting: 'ingest-waiting',
  rejected: 'ingest-rejected',
  undecoded: 'ingest-undecoded',
  ok: 'ingest-ok',
}

export function DialInPanel({
  api, sites, canPair, timeZone, nowMs, onPaired,
}: {
  api: BridgeApi
  sites: Site[]
  canPair: boolean
  timeZone?: string
  nowMs: number
  onPaired: (machines: MachineView[]) => void
}) {
  const [status, setStatus] = useState<IngestStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [draft, setDraft] = useState<PairDraft | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      setStatus(await api.ingest())
      setError(null)
    } catch (caught) {
      setError(caught instanceof BridgeApiError ? caught.message : 'Không đọc được trạng thái cổng ingest.')
    }
  }, [api])

  useEffect(() => { void load() }, [load])

  // Chỉ hỏi lại liên tục khi khối đang mở. Đây là màn hình của buổi đấu nối, không phải
  // một vòng poll nền cho mọi tab đang mở suốt ca.
  useEffect(() => {
    if (!open) return undefined
    const timer = setInterval(() => void load(), refreshMs)
    return () => clearInterval(timer)
  }, [open, load])

  const verdict = describeIngest(status)
  const callers = status?.callers ?? []
  const pairableCount = callers.filter((caller) => describeCaller(caller).pairable).length

  const startDraft = (caller: DialInCaller) => {
    setNotice(null)
    setDraft({
      remote: caller.remote,
      name: '',
      assetTag: '',
      zone: '',
      siteId: sites[0]?.id ?? '',
      serial: '',
      macAddress: '',
      confirmed: false,
      evidence: 'assetTag',
    })
  }

  const submit = async () => {
    if (!draft) return
    setSaving(true); setError(null); setNotice(null)
    try {
      const payload: MachineInput = {
        assetTag: draft.assetTag.trim(),
        name: draft.name.trim(),
        siteId: draft.siteId,
        zone: draft.zone.trim(),
        serial: draft.serial.trim() || null,
        macAddress: draft.macAddress.trim() || null,
        ipAddress: draft.remote,
        // Địa chỉ này vừa tự gọi vào cổng ingest, nên adapter chỉ có thể là dial-in.
        adapter: 'dial-in',
        verification: draft.confirmed ? { confirmed: true, evidence: draft.evidence } : undefined,
      }
      const result = await api.pair([payload])
      onPaired(result.machines)
      setDraft(null)
      setNotice(`Đã ghép ${draft.remote}. Chờ controller gọi lại là có dữ liệu.`)
      await load()
    } catch (caught) {
      setError(caught instanceof BridgeApiError
        ? `${caught.message}${caught.field ? ` (trường ${caught.field})` : ''}`
        : 'Không ghép được máy ở địa chỉ này.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="dial-in-panel" aria-label="Máy đang gọi vào">
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <span className={`ingest-dot ${toneClass[verdict.tone]}`} aria-hidden="true" />
          <span className="ingest-headline">Máy đang gọi vào — {verdict.headline}</span>
          {pairableCount > 0 && <span className="badge badge-unverified">{pairableCount} địa chỉ chưa ghép</span>}
        </summary>

        <p className="block-note">{verdict.detail}</p>
        {error && <p className="detail-error" role="alert">{error}</p>}
        {notice && <p className="detail-notice" role="status">{notice}</p>}

        {status && (
          <p className="reading-meta">
            {status.enabled ? `Cổng ${status.address ? `${status.address.host}:${status.address.port}` : 'chưa mở'}` : 'Cổng tắt'}
            {' · '}{status.connections} lượt kết nối · {status.openConnections} đang mở
            {' · '}{status.framesAccepted} khung đọc được · {status.framesUndecoded} khung chưa giải mã
            {status.lastFrameAt ? ` · khung gần nhất ${formatTime(status.lastFrameAt, timeZone)}` : ''}
            {status.capture ? ' · đang bắt gói' : ''}
            {open ? ` · tự làm mới mỗi ${refreshMs / 1000}s` : ''}
          </p>
        )}

        {callers.length === 0 && <p className="muted">Chưa địa chỉ nào chạm tới cổng này kể từ lần khởi động bridge gần nhất.</p>}

        {callers.length > 0 && (
          <table className="mini-table">
            <caption>Địa chỉ đã gọi vào ({callers.length}{status ? ` trong tối đa ${status.maxCallers}` : ''})</caption>
            <thead>
              <tr>
                <th scope="col">Địa chỉ</th>
                <th scope="col">Tình trạng</th>
                <th scope="col">Lần gọi gần nhất</th>
                <th scope="col">Kết nối / khung</th>
                <th scope="col">Byte đầu tiên</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {callers.map((caller) => {
                const row = describeCaller(caller)
                return (
                  <tr key={caller.remote}>
                    <td>{caller.remote}</td>
                    <td>
                      <span className={`ingest-dot ${toneClass[row.tone === 'pending' ? 'waiting' : row.tone === 'blocked' ? 'rejected' : row.tone]}`} aria-hidden="true" />
                      {row.label}
                      <span className="field-hint">{row.hint}</span>
                    </td>
                    <td>
                      {formatAge(callerAgeSeconds(caller, nowMs))}
                      <span className="field-hint">{formatTime(caller.lastSeenAt, timeZone)}</span>
                    </td>
                    <td>{caller.connections} / {caller.framesAccepted} đọc được, {caller.framesUndecoded} chưa</td>
                    <td className="mono">{formatCallerBytes(caller)}</td>
                    <td>
                      {row.pairable && canPair && (
                        <button type="button" onClick={() => startDraft(caller)}>Ghép máy ở địa chỉ này</button>
                      )}
                      {row.pairable && !canPair && <span className="field-hint">Cần vai trò kỹ thuật viên để ghép.</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {draft && (
          <fieldset className="draft">
            <legend>Ghép máy tại {draft.remote}</legend>
            <p className="block-note">
              Tên và mã tài sản lấy trên chính máy, không suy ra từ địa chỉ IP. Adapter cố định là
              &quot;máy tự gọi vào&quot; vì địa chỉ này vừa gọi tới cổng ingest.
            </p>
            <div className="draft-grid">
              <label>Tên máy (theo nhãn tại xưởng)
                <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
              </label>
              <label>Mã tài sản
                <input value={draft.assetTag} onChange={(event) => setDraft({ ...draft, assetTag: event.target.value })} required />
              </label>
              <label>Nhà xưởng
                <select value={draft.siteId} onChange={(event) => setDraft({ ...draft, siteId: event.target.value })}>
                  {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                </select>
              </label>
              <label>Khu vực
                <input value={draft.zone} onChange={(event) => setDraft({ ...draft, zone: event.target.value })} required />
              </label>
              <label>Serial (in trên máy)
                <input value={draft.serial} onChange={(event) => setDraft({ ...draft, serial: event.target.value })} />
              </label>
              <label>MAC
                <input value={draft.macAddress} onChange={(event) => setDraft({ ...draft, macAddress: event.target.value })} placeholder="AA:BB:CC:DD:EE:FF" />
              </label>
              <label>Địa chỉ IP
                <input value={draft.remote} readOnly aria-readonly="true" />
              </label>
            </div>

            <label className="filter-check">
              <input type="checkbox" checked={draft.confirmed} onChange={(event) => setDraft({ ...draft, confirmed: event.target.checked })} />
              Tôi đã đứng tại máy và đối chiếu thông tin trên nhãn/màn hình controller.
            </label>
            {draft.confirmed && (
              <label className="filter-field">Bằng chứng đối chiếu
                <select value={draft.evidence} onChange={(event) => setDraft({ ...draft, evidence: event.target.value as PairDraft['evidence'] })}>
                  <option value="assetTag">Tem mã tài sản</option>
                  <option value="serial">Số serial trên máy</option>
                  <option value="mac">Địa chỉ MAC</option>
                </select>
                {!draft[evidenceField[draft.evidence]].trim() && (
                  <span className="field-hint">Chọn chứng cứ này thì phải nhập ô tương ứng ở trên, nếu không bridge sẽ từ chối.</span>
                )}
              </label>
            )}
            {!draft.confirmed && <p className="field-hint">Chưa đối chiếu thì máy vẫn được lưu nhưng đánh dấu chưa xác minh và không vào KPI.</p>}

            <div className="filter-actions">
              <button
                type="button"
                className="primary"
                disabled={
                  saving || !draft.name.trim() || !draft.assetTag.trim() || !draft.zone.trim() || !draft.siteId
                  || (draft.confirmed && !draft[evidenceField[draft.evidence]].trim())
                }
                onClick={() => {
                  if (!window.confirm(`Ghép máy ở địa chỉ ${draft.remote}? Thao tác này được ghi vào nhật ký kiểm toán.`)) return
                  void submit()
                }}
              >
                {saving ? 'Đang lưu…' : 'Ghép máy'}
              </button>
              <button type="button" className="ghost" onClick={() => setDraft(null)}>Huỷ</button>
            </div>
          </fieldset>
        )}

        <p className="reading-meta">
          Bảng này chỉ nhớ tạm trong bộ nhớ bridge và mất khi bridge khởi động lại. Bridge không bao giờ
          gửi ngược một byte nào xuống máy — kể cả ở đây.
        </p>
      </details>
    </section>
  )
}
