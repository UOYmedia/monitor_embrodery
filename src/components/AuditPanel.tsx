import { useCallback, useEffect, useState } from 'react'
import { formatTime } from '../lib/format'
import type { BridgeApi } from '../services/bridgeApi'
import type { AuditEntry } from '../types/fleet'

/**
 * Fleet-wide audit trail. Denied attempts appear here too — a viewer trying a mutation is
 * itself an event worth keeping.
 */
export function AuditPanel({ api, timeZone }: { api: BridgeApi; timeZone?: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.audit(100)
      setEntries(result.entries)
      setError(null)
    } catch {
      setError('Không đọc được nhật ký kiểm toán.')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { void load() }, [load])

  return (
    <section className="audit-panel" aria-label="Nhật ký kiểm toán">
      <div className="draft-head">
        <h2>Nhật ký kiểm toán</h2>
        <button type="button" className="ghost" onClick={() => void load()} disabled={loading}>
          {loading ? 'Đang tải…' : 'Tải lại'}
        </button>
      </div>
      {error && <p className="detail-error" role="alert">{error}</p>}
      {!error && entries.length === 0 && <p className="muted">Chưa có thay đổi nào được ghi.</p>}
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
    </section>
  )
}
