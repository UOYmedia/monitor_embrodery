import { createHash } from 'node:crypto'

const STATUS_MAP = Object.freeze({
  running: 'RUNNING',
  fault: 'ERROR',
  unknown: 'OFFLINE',
})

const OFFLINE_CONNECTIONS = new Set(['offline', 'stale', 'unknown'])

function readingValue(reading) {
  return reading && Object.hasOwn(reading, 'value') ? reading.value : null
}

function stoppedStatus(currentStitch, totalStitches) {
  if (totalStitches !== null && totalStitches > 0 && currentStitch !== null) {
    if (currentStitch >= totalStitches) return 'COMPLETED'
    if (currentStitch > 0) return 'PAUSED'
  }
  return 'IDLE'
}

export function externalMachineId(machine, overrides = {}) {
  const bridgeId = String(machine?.identity?.id ?? '')
  const override = overrides[bridgeId]
  if (Number.isInteger(override) && override > 0) return override

  const match = String(machine?.identity?.name ?? '').trim().match(/^Máy\s+(\d+)$/iu)
  if (!match) return null
  const value = Number(match[1])
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

export function latestFaultCode(machine) {
  const events = Array.isArray(machine?.telemetry?.events) ? machine.telemetry.events : []
  const latest = events
    .filter((event) => typeof event?.code === 'string' && event.code.trim() && event.severity !== 'info')
    .sort((a, b) => {
      if (a.severity === 'critical' && b.severity !== 'critical') return -1
      if (b.severity === 'critical' && a.severity !== 'critical') return 1
      const aTime = Number.isFinite(Date.parse(a.occurredAt)) ? Date.parse(a.occurredAt) : -Infinity
      const bTime = Number.isFinite(Date.parse(b.occurredAt)) ? Date.parse(b.occurredAt) : -Infinity
      return bTime - aTime
    })[0]
  return latest?.code ?? ''
}

export function mapMachine(machine, overrides = {}) {
  const externalId = externalMachineId(machine, overrides)
  if (externalId === null) return null

  const telemetry = machine?.telemetry
  const bridgeStatus = readingValue(telemetry?.status) ?? 'unknown'
  const connectionState = machine?.connection?.state ?? 'unknown'
  const job = readingValue(telemetry?.job) ?? {}
  const currentStitch = Number.isInteger(job.currentStitch) ? job.currentStitch : null
  const totalStitches = Number.isInteger(job.totalStitches) ? job.totalStitches : null
  const currentFile = typeof job.fileName === 'string' ? job.fileName : ''

  const status = OFFLINE_CONNECTIONS.has(connectionState)
    ? 'OFFLINE'
    : (bridgeStatus === 'stopped' || bridgeStatus === 'paused'
        ? stoppedStatus(currentStitch, totalStitches)
        : (STATUS_MAP[bridgeStatus] ?? 'OFFLINE'))
  const statusNote = status === 'COMPLETED' && currentFile ? `Xong mẫu ${currentFile}` : ''
  const errorCode = status === 'ERROR' ? latestFaultCode(machine) : ''
  const statusSince = typeof machine?.statusSince?.at === 'string' ? machine.statusSince.at : null
  const rpmValue = readingValue(telemetry?.rpm)

  return {
    bridgeMachineId: String(machine.identity.id),
    externalMachineId: externalId,
    status,
    statusSince,
    currentFile,
    currentStitch,
    totalStitches,
    rpm: Number.isFinite(rpmValue) && rpmValue >= 0 ? Math.round(rpmValue) : null,
    errorCode,
    statusNote,
  }
}

export function heartbeatMachine(mapped) {
  const { bridgeMachineId: _bridgeMachineId, ...payload } = mapped
  return payload
}

export function stableEventId({ externalMachineId, fromStatus, toStatus, occurredAt }) {
  return createHash('sha256')
    .update(`${externalMachineId}|${fromStatus}|${toStatus}|${occurredAt}`)
    .digest('hex')
}

export function machineEvent(mapped, fromStatus, occurredAt = mapped.statusSince ?? new Date().toISOString()) {
  return {
    eventId: stableEventId({
      externalMachineId: mapped.externalMachineId,
      fromStatus,
      toStatus: mapped.status,
      occurredAt,
    }),
    externalMachineId: mapped.externalMachineId,
    fromStatus,
    toStatus: mapped.status,
    occurredAt,
    reasonCode: mapped.errorCode,
    reasonText: mapped.statusNote,
    fileName: mapped.currentFile,
  }
}
