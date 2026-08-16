/**
 * Derives the exception list for one machine.
 *
 * Every alert carries the source that produced it so the workshop can tell a controller
 * fault ("controller") apart from a bridge-side analysis ("bridge") or a dashboard
 * bookkeeping item ("dashboard"). Nothing here invents machine state.
 */

const dueRatio = 0.1

/** Maintenance is dashboard bookkeeping measured against the controller's odometer. */
export function maintenanceStatus(plan, odometer) {
  if (odometer === null || odometer === undefined) {
    return { ...plan, consumedStitches: null, remainingStitches: null, dueState: 'unknown', reason: 'Chưa đọc được bộ đếm mũi từ controller.' }
  }
  const since = plan.lastServiceOdometer ?? 0
  const consumed = Math.max(0, odometer - since)
  const remaining = plan.intervalStitches - consumed
  const dueState = remaining <= 0 ? 'overdue' : remaining <= plan.intervalStitches * dueRatio ? 'due' : 'ok'
  return { ...plan, consumedStitches: consumed, remainingStitches: remaining, dueState, reason: null }
}

export function maintenanceForMachine(record, telemetry) {
  const odometer = telemetry?.odometer?.value ?? null
  return (record.maintenance ?? []).map((plan) => maintenanceStatus(plan, odometer))
}

/**
 * Alerts derived from data the bridge actually holds. Connection alerts are added by the
 * dashboard instead, because staleness keeps advancing between bridge messages.
 */
export function deriveAlerts(record, telemetry, maintenance, { threadBreakWarnPer1000 = null } = {}) {
  const alerts = []
  const acknowledgements = record.acknowledgements ?? {}

  for (const event of telemetry?.events ?? []) {
    if (event.severity === 'info') continue
    alerts.push({
      id: `event:${event.id}`,
      severity: event.severity,
      kind: 'controller-event',
      title: event.message || `Mã lỗi ${event.code} từ controller.`,
      detail: `Mã ${event.code}${event.needle ? ` · kim #${event.needle}` : ''}`,
      source: 'controller',
      since: event.occurredAt,
    })
  }

  // Ngưỡng do xưởng đặt. Không đặt = không phán xét: dashboard vẫn in tỉ lệ đo được, nhưng
  // bridge không tự dựng ra một mức "bình thường" mà không ai kiểm chứng được.
  const window = telemetry?.threadBreakWindow?.value
  if (window && window.stitches > 0 && threadBreakWarnPer1000 !== null) {
    const rate = (window.breaks / window.stitches) * 1000
    if (rate > threadBreakWarnPer1000) {
      alerts.push({
        id: 'thread-break-rate',
        severity: 'warning',
        kind: 'thread-break-rate',
        title: `Nguy cơ đứt chỉ: ${rate.toFixed(1)} lần / 1.000 mũi${window.needle ? ` ở kim #${window.needle}` : ''}.`,
        detail: `Bridge tính từ ${window.breaks} lần đứt trên ${window.stitches} mũi gần nhất do controller báo cáo. Ngưỡng xưởng đặt: ${threadBreakWarnPer1000} lần/1.000 mũi.`,
        source: 'bridge',
        since: telemetry.threadBreakWindow.observedAt,
      })
    }
  }

  for (const plan of maintenance) {
    if (plan.dueState !== 'due' && plan.dueState !== 'overdue') continue
    alerts.push({
      id: `maintenance:${plan.id}`,
      severity: plan.dueState === 'overdue' ? 'critical' : 'warning',
      kind: 'maintenance',
      title: plan.dueState === 'overdue'
        ? `${plan.title}: quá hạn ${formatStitches(Math.abs(plan.remainingStitches))} mũi.`
        : `${plan.title}: còn ${formatStitches(plan.remainingStitches)} mũi.`,
      detail: `Chu kỳ ${formatStitches(plan.intervalStitches)} mũi · lần bảo trì gần nhất tại ${plan.lastServiceOdometer === null ? 'chưa ghi nhận' : `${formatStitches(plan.lastServiceOdometer)} mũi`}.`,
      source: 'dashboard',
      since: plan.lastServiceAt,
    })
  }

  return alerts.map((alert) => ({ ...alert, acknowledged: acknowledgements[alert.id] ?? null }))
}

function formatStitches(value) {
  return new Intl.NumberFormat('vi-VN').format(Math.round(value))
}

export const alertSeverityRank = { critical: 3, warning: 2, info: 1 }

export function highestSeverity(alerts) {
  return alerts.reduce((highest, alert) => (alertSeverityRank[alert.severity] > alertSeverityRank[highest] ? alert.severity : highest), 'info')
}
