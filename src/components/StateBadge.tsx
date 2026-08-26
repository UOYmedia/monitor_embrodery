import type { AlertSeverity, ConnectionStateName, OperationalStatus, VerificationStatus } from '../types/fleet'
import { connectionLabels, connectionSymbols, severityLabels, statusLabels } from '../lib/format'

/**
 * Every state badge carries a text label and a shape/symbol, never colour alone — a
 * workshop screen in daylight and a colour-blind operator both have to read it.
 */

export function ConnectionBadge({ state, title }: { state: ConnectionStateName; title?: string }) {
  return (
    <span className={`badge badge-connection badge-${state}`} title={title}>
      <span aria-hidden="true" className="badge-symbol">{connectionSymbols[state]}</span>
      {connectionLabels[state]}
    </span>
  )
}

export function StatusBadge({ status }: { status: OperationalStatus }) {
  return <span className={`badge badge-status badge-status-${status}`}>{statusLabels[status]}</span>
}

const severitySymbols: Record<AlertSeverity, string> = { critical: '▲', warning: '▲', info: '■' }

export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  return (
    <span className={`badge badge-severity badge-severity-${severity}`}>
      <span aria-hidden="true" className="badge-symbol">{severitySymbols[severity]}</span>
      {severityLabels[severity]}
    </span>
  )
}

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  return (
    <span className={`badge badge-verification badge-${status}`}>
      {status === 'verified' ? '✓ Đã xác minh' : '! Chưa xác minh'}
    </span>
  )
}
