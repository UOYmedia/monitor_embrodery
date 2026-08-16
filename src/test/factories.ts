import type { MachineView, OperationalStatus, Reading, TelemetrySnapshot } from '../types/fleet'

/**
 * Fixtures for tests only.
 *
 * These never ship to the browser and are never rendered as live data: the dashboard's
 * empty state exists precisely so nobody mistakes a fixture for a real machine.
 */

export const baseNow = Date.parse('2026-03-02T08:00:00.000Z')

function reading<T>(value: T, observedAt: string, source = 'controller'): Reading<T> {
  return { value, observedAt, source, quality: 'verified' }
}

export function makeTelemetry(overrides: Partial<TelemetrySnapshot> & { observedAt?: string; status?: Reading<OperationalStatus> } = {}): TelemetrySnapshot {
  const observedAt = overrides.observedAt ?? new Date(baseNow).toISOString()
  return {
    schemaVersion: 2,
    machineId: 'm-1',
    observedAt,
    receivedAt: observedAt,
    source: 'http-json',
    status: overrides.status ?? reading<OperationalStatus>('running', observedAt),
    rpm: reading(720, observedAt),
    rpmHistory: null,
    job: reading({
      fileName: 'LOGO-A.dst', product: null, needle: 3, threadColor: 'Đỏ',
      currentStitch: 4200, totalStitches: 51_000, elapsedSeconds: 640,
    }, observedAt),
    needlePosition: null,
    odometer: reading(1_200_000, observedAt),
    threadBreakWindow: null,
    controller: null,
    events: [],
    ...overrides,
  }
}

export function makeMachine(overrides: {
  id?: string
  name?: string
  assetTag?: string
  siteId?: string
  zone?: string
  adapter?: MachineView['identity']['adapter']
  adapterHasProtocol?: boolean
  verified?: boolean
  archived?: boolean
  enabled?: boolean
  lastTelemetryAt?: string | null
  reachable?: boolean | null
  telemetry?: TelemetrySnapshot | null
  alerts?: MachineView['alerts']
  maintenance?: MachineView['maintenance']
  telemetryError?: MachineView['telemetryError']
  statusSince?: MachineView['statusSince']
  stopEscalationMinutes?: number
  threadBreakWarnPer1000?: number | null
} = {}): MachineView {
  const id = overrides.id ?? 'm-1'
  const lastTelemetryAt = overrides.lastTelemetryAt === undefined ? new Date(baseNow).toISOString() : overrides.lastTelemetryAt
  const telemetry = overrides.telemetry === undefined
    ? (lastTelemetryAt ? makeTelemetry({ machineId: id, observedAt: lastTelemetryAt }) : null)
    : overrides.telemetry

  return {
    schemaVersion: 2,
    identity: {
      id,
      assetTag: overrides.assetTag ?? id.toUpperCase(),
      name: overrides.name ?? `Máy ${id}`,
      siteId: overrides.siteId ?? 'hn',
      siteName: 'Xưởng Hà Nội',
      zone: overrides.zone ?? 'Chuyền A',
      model: 'BEVT-1502',
      serial: `SN-${id}`,
      ipAddress: '192.168.10.20',
      macAddress: 'AA:BB:CC:DD:EE:01',
      adapter: overrides.adapter ?? 'http-json',
      adapterHasProtocol: overrides.adapterHasProtocol ?? (overrides.adapter ?? 'http-json') !== 'manual',
      pricePer1000Stitches: null,
      verification: overrides.verified === false
        ? { status: 'unverified', verifiedAt: null, verifiedBy: null, evidence: null }
        : { status: 'verified', verifiedAt: new Date(baseNow).toISOString(), verifiedBy: 'ktv.an', evidence: 'serial' },
      enabled: overrides.enabled ?? true,
      archived: overrides.archived ?? false,
      note: null,
      migratedFrom: null,
      migrationError: null,
      createdAt: new Date(baseNow).toISOString(),
      updatedAt: new Date(baseNow).toISOString(),
      updatedBy: 'ktv.an',
    },
    connection: {
      state: 'online',
      reason: '',
      ageSeconds: 0,
      lastTelemetryAt,
      lastReachableAt: lastTelemetryAt,
      lastCheckedAt: lastTelemetryAt,
      reachable: overrides.reachable ?? true,
      poll: { failures: 0, breakerOpen: false, breakerOpensForMs: 0, nextPollInMs: 5000, lastError: null },
    },
    thresholds: {
      freshSeconds: 30,
      staleSeconds: 90,
      stopEscalationMinutes: overrides.stopEscalationMinutes ?? 5,
      threadBreakWarnPer1000: overrides.threadBreakWarnPer1000 ?? null,
    },
    statusSince: overrides.statusSince ?? null,
    telemetry,
    telemetryError: overrides.telemetryError ?? null,
    maintenance: overrides.maintenance ?? [],
    alerts: overrides.alerts ?? [],
  }
}
