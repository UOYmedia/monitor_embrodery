import { useState } from 'react'
import type { BridgeApi, MachineInput } from '../services/bridgeApi'
import { BridgeApiError } from '../services/bridgeApi'
import { adapterLabels, formatTime } from '../lib/format'
import type { AdapterKind, DiscoveredDevice, MachineView, ScanResult, Site } from '../types/fleet'

/**
 * Trusted onboarding.
 *
 * A scan result is a host that answered a TCP port on a subnet the site is allowed to
 * scan. That is all it is. Nothing here calls a result a Dahao machine, guesses a model
 * from an IP, or fills a name for the technician: identity comes from the label on the
 * machine, read by a person standing in front of it.
 */

interface Draft extends MachineInput {
  key: string
  confirmed: boolean
  evidence: 'mac' | 'serial' | 'assetTag'
}

const adapters: AdapterKind[] = ['manual', 'http-json', 'tcp-json-line', 'dial-in']

/** `dial-in` đảo chiều kết nối, nên phải nói rõ ở chỗ người dùng chọn nó. */
const adapterHints: Record<string, string> = {
  'dial-in': 'Máy tự gọi vào bridge (Dahao C44/C41). Bridge không hỏi máy; địa chỉ IP ở trên chỉ dùng để nhận dạng máy gọi vào. Cần bật khối ingest trong config bridge.',
}
let draftCounter = 0

function draftFrom(device: DiscoveredDevice | null, siteId: string): Draft {
  draftCounter += 1
  return {
    key: `draft-${draftCounter}`,
    assetTag: '', name: '', siteId, zone: '', model: '', serial: '',
    ipAddress: device?.ipAddress ?? '', macAddress: device?.macAddress ?? '',
    adapter: 'manual', note: '', confirmed: false, evidence: 'assetTag',
  }
}

export function PairingPanel({
  api, sites, canScan, canPair, timeZone, onPaired,
}: {
  api: BridgeApi
  sites: Site[]
  canScan: boolean
  canPair: boolean
  timeZone?: string
  onPaired: (machines: MachineView[]) => void
}) {
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '')
  const [cidr, setCidr] = useState(sites[0]?.allowedCidrs[0] ?? '')
  const [ports, setPorts] = useState('80,8080')
  const [acknowledged, setAcknowledged] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const site = sites.find((entry) => entry.id === siteId) ?? null

  const reportError = (caught: unknown, fallback: string) => {
    setError(caught instanceof BridgeApiError
      ? `${caught.message}${caught.field ? ` (trường ${caught.field})` : ''}${caught.correlationId ? ` — mã tra cứu ${caught.correlationId}` : ''}`
      : fallback)
  }

  const runScan = async () => {
    setScanning(true); setError(null); setNotice(null)
    try {
      const parsedPorts = ports.split(',').map((part) => Number(part.trim())).filter((port) => Number.isInteger(port) && port > 0)
      const result = await api.scan({ siteId, cidr: cidr.trim(), ports: parsedPorts })
      setScan(result)
    } catch (caught) {
      setScan(null)
      reportError(caught, 'Không gọi được bridge để quét.')
    } finally {
      setScanning(false)
    }
  }

  const patchDraft = (key: string, patch: Partial<Draft>) => {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)))
  }

  const submit = async () => {
    setSaving(true); setError(null); setNotice(null)
    try {
      const payload: MachineInput[] = drafts.map((draft) => ({
        assetTag: draft.assetTag.trim(),
        name: draft.name.trim(),
        siteId: draft.siteId,
        zone: draft.zone.trim(),
        model: draft.model?.trim() || null,
        serial: draft.serial?.trim() || null,
        ipAddress: draft.ipAddress.trim(),
        macAddress: draft.macAddress?.trim() || null,
        adapter: draft.adapter,
        note: draft.note?.trim() || null,
        verification: draft.confirmed ? { confirmed: true, evidence: draft.evidence } : undefined,
      }))
      const result = await api.pair(payload)
      onPaired(result.machines)
      setDrafts([])
      setNotice(`Đã ghép ${result.machines.length} máy.`)
    } catch (caught) {
      // The bridge writes nothing when a batch fails, so the drafts stay on screen for editing.
      reportError(caught, 'Không ghép được. Toàn bộ lô đã bị huỷ, chưa máy nào được lưu.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="pairing" aria-label="Quét mạng và ghép máy">
      <h2>Quét mạng &amp; ghép máy</h2>

      {!canScan && <p className="muted">Vai trò hiện tại chỉ được xem. Việc quét mạng và ghép máy cần vai trò kỹ thuật viên.</p>}

      {canScan && (
        <div className="scan-form">
          <div className="filter-field">
            <label htmlFor="scan-site">Nhà xưởng</label>
            <select
              id="scan-site"
              value={siteId}
              onChange={(event) => {
                const next = sites.find((entry) => entry.id === event.target.value)
                setSiteId(event.target.value)
                setCidr(next?.allowedCidrs[0] ?? '')
              }}
            >
              {sites.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </div>

          <div className="filter-field">
            <label htmlFor="scan-cidr">Dải mạng (CIDR)</label>
            <input id="scan-cidr" list="allowed-cidrs" value={cidr} onChange={(event) => setCidr(event.target.value)} placeholder="192.168.10.0/24" />
            <datalist id="allowed-cidrs">
              {site?.allowedCidrs.map((allowed) => <option key={allowed} value={allowed} />)}
            </datalist>
            <span className="field-hint">
              Được phép tại {site?.name ?? 'site này'}: {site?.allowedCidrs.join(', ') || 'chưa cấu hình'}.
              Bridge từ chối mọi dải ngoài danh sách này.
            </span>
          </div>

          <div className="filter-field">
            <label htmlFor="scan-ports">Cổng TCP</label>
            <input id="scan-ports" value={ports} onChange={(event) => setPorts(event.target.value)} placeholder="80,8080" />
          </div>

          <label className="filter-check scan-warning">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>
              Tôi được phép quét dải mạng này. Quét sẽ gửi gói TCP tới toàn bộ địa chỉ trong dải và có thể bị
              hệ thống giám sát mạng ghi nhận. Kết quả chỉ cho biết địa chỉ nào mở cổng, không xác nhận đó là máy thêu.
            </span>
          </label>

          <button type="button" disabled={!acknowledged || scanning || !cidr.trim()} onClick={() => void runScan()}>
            {scanning ? 'Đang quét…' : 'Quét dải mạng'}
          </button>
        </div>
      )}

      {error && <p className="detail-error" role="alert">{error}</p>}
      {notice && <p className="detail-notice" role="status">{notice}</p>}

      {scan && (
        <div className="scan-result">
          <p className="block-note">{scan.notice} Đã quét {scan.hostsScanned} địa chỉ trên {scan.cidr}.</p>
          {scan.results.length === 0 && <p className="muted">Không địa chỉ nào mở cổng đã chọn.</p>}
          {scan.results.length > 0 && (
            <table className="mini-table">
              <caption>Thiết bị chưa xác nhận ({scan.results.length})</caption>
              <thead>
                <tr><th scope="col">Địa chỉ IP</th><th scope="col">MAC</th><th scope="col">Cổng mở</th><th scope="col">Thấy lúc</th><th scope="col" /></tr>
              </thead>
              <tbody>
                {scan.results.map((device) => (
                  <tr key={device.ipAddress}>
                    <td>
                      {device.ipAddress}
                      <span className="badge badge-unverified">Thiết bị chưa xác nhận</span>
                    </td>
                    <td>{device.macAddress ?? 'không đọc được'}</td>
                    <td>{device.openPorts.join(', ')}</td>
                    <td>{formatTime(device.seenAt, timeZone)}</td>
                    <td>
                      {canPair && (
                        <button type="button" onClick={() => setDrafts((current) => [...current, draftFrom(device, scan.siteId)])}>
                          Thêm vào lô ghép
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {canPair && (
        <div className="draft-block">
          <div className="draft-head">
            <h3>Lô ghép ({drafts.length})</h3>
            <button type="button" className="ghost" onClick={() => setDrafts((current) => [...current, draftFrom(null, siteId || sites[0]?.id || '')])}>
              Thêm máy thủ công
            </button>
          </div>
          <p className="block-note">
            Đối chiếu tên, serial và mã tài sản trên chính máy trước khi ghép. Cả lô được lưu cùng lúc:
            nếu một máy sai, không máy nào được lưu.
          </p>

          {drafts.map((draft) => (
            <fieldset key={draft.key} className="draft">
              <legend>{draft.name.trim() || draft.ipAddress || 'Máy mới'}</legend>
              <div className="draft-grid">
                <label>Tên máy (theo nhãn tại xưởng)
                  <input value={draft.name} onChange={(event) => patchDraft(draft.key, { name: event.target.value })} required />
                </label>
                <label>Mã tài sản
                  <input value={draft.assetTag} onChange={(event) => patchDraft(draft.key, { assetTag: event.target.value })} required />
                </label>
                <label>Nhà xưởng
                  <select value={draft.siteId} onChange={(event) => patchDraft(draft.key, { siteId: event.target.value })}>
                    {sites.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                  </select>
                </label>
                <label>Khu vực
                  <input value={draft.zone} onChange={(event) => patchDraft(draft.key, { zone: event.target.value })} required />
                </label>
                <label>Model (đọc trên máy)
                  <input value={draft.model ?? ''} onChange={(event) => patchDraft(draft.key, { model: event.target.value })} />
                </label>
                <label>Serial
                  <input value={draft.serial ?? ''} onChange={(event) => patchDraft(draft.key, { serial: event.target.value })} />
                </label>
                <label>Địa chỉ IP
                  <input value={draft.ipAddress} onChange={(event) => patchDraft(draft.key, { ipAddress: event.target.value })} required />
                </label>
                <label>MAC
                  <input value={draft.macAddress ?? ''} onChange={(event) => patchDraft(draft.key, { macAddress: event.target.value })} placeholder="AA:BB:CC:DD:EE:FF" />
                </label>
                <label>Adapter
                  <select value={draft.adapter} onChange={(event) => patchDraft(draft.key, { adapter: event.target.value as AdapterKind })}>
                    {adapters.map((adapter) => <option key={adapter} value={adapter}>{adapterLabels[adapter]}</option>)}
                  </select>
                  {adapterHints[draft.adapter] && <span className="field-hint">{adapterHints[draft.adapter]}</span>}
                </label>
                <label>Ghi chú
                  <input value={draft.note ?? ''} onChange={(event) => patchDraft(draft.key, { note: event.target.value })} />
                </label>
              </div>

              <label className="filter-check">
                <input type="checkbox" checked={draft.confirmed} onChange={(event) => patchDraft(draft.key, { confirmed: event.target.checked })} />
                Tôi đã đứng tại máy và đối chiếu thông tin trên nhãn/màn hình controller.
              </label>
              {draft.confirmed && (
                <label className="filter-field">Bằng chứng đối chiếu
                  <select value={draft.evidence} onChange={(event) => patchDraft(draft.key, { evidence: event.target.value as Draft['evidence'] })}>
                    <option value="mac">Địa chỉ MAC</option>
                    <option value="serial">Số serial trên máy</option>
                    <option value="assetTag">Tem mã tài sản</option>
                  </select>
                </label>
              )}
              {!draft.confirmed && <p className="field-hint">Chưa đối chiếu thì máy vẫn được lưu nhưng đánh dấu chưa xác minh và không vào KPI.</p>}

              <button type="button" className="ghost" onClick={() => setDrafts((current) => current.filter((entry) => entry.key !== draft.key))}>
                Bỏ khỏi lô
              </button>
            </fieldset>
          ))}

          {drafts.length > 0 && (
            <button
              type="button"
              className="primary"
              disabled={saving}
              onClick={() => {
                if (!window.confirm(`Ghép ${drafts.length} máy vào đội? Thao tác này được ghi vào nhật ký kiểm toán.`)) return
                void submit()
              }}
            >
              {saving ? 'Đang lưu…' : `Ghép ${drafts.length} máy`}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
