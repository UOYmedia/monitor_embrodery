import { pollMachine } from './adapters.mjs'
import { deriveAlerts, maintenanceForMachine } from './alerts.mjs'
import { AuditLog } from './audit.mjs'
import { SCHEMA_VERSION, adapterHasProtocol, adapterIsPolled, normalizeTelemetry } from './contract.mjs'
import { DialInListener, normalizeRemoteAddress } from './dial-in.mjs'
import { connectionState } from './freshness.mjs'
import { assertNoDuplicates, validateMachineInput, validateMaintenancePlan } from './machine-record.mjs'
import { assertAllowedTarget } from './net-policy.mjs'
import { probePort } from './network.mjs'
import { ProductionLog, pieceRateAmount } from './production.mjs'
import { addDays, localParts } from './shifts.mjs'
import { PollScheduler } from './scheduler.mjs'
import { FleetStore } from './store.mjs'
import { silentLogger } from './logger.mjs'

function mapWithConcurrency(values, limit, mapper) {
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 1))
  const results = new Array(values.length)
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++
      results[index] = await mapper(values[index], index)
    }
  }
  return Promise.all(Array.from({ length: Math.min(safeLimit, values.length) }, worker)).then(() => results)
}

/**
 * Read-only fleet service.
 *
 * It owns the paired-machine registry, the polling loop and the view model published to
 * dashboards. There is deliberately no method that writes to a controller: no start, no
 * stop, no design selection, no file transfer. Every state-changing method here changes
 * dashboard bookkeeping only, and every one of them writes an audit entry.
 */
export class BridgeService {
  constructor(config, { publish = () => {}, logger = silentLogger, audit = null, now = () => Date.now() } = {}) {
    this.config = config
    this.logger = logger
    this.publish = publish
    this.now = now
    this.store = new FleetStore(config.dataPath, { logger })
    this.audit = audit ?? new AuditLog(config.auditPath, { logger })
    this.scheduler = new PollScheduler(config.poll, { now })
    this.production = new ProductionLog({
      filePath: config.productionPath,
      retentionDays: config.production?.retentionDays,
      maxStitchesPerMinute: config.production?.maxStitchesPerMinute,
      maxRunGapSeconds: config.production?.maxRunGapSeconds,
      logger,
    })
    this.productionFlush = null
    this.dialIn = new DialInListener(config.ingest, {
      identify: (remote) => this.identifyDialIn(remote),
      accept: (machine, payload, meta) => this.acceptDialIn(machine, payload, meta),
      undecoded: (machine, description, meta) => this.recordUndecoded(machine, description, meta),
      logger,
      now,
    })
    this.telemetry = new Map()
    this.telemetryErrors = new Map()
    this.statusSince = new Map()
    this.reachability = new Map()
    this.revision = 0
    this.polling = null
    this.mutationQueue = Promise.resolve()
    this.startedAt = new Date().toISOString()
    this.lastPollAt = null
  }

  async load() {
    await this.store.load({ sites: this.config.sites })
    await this.production.load()
    this.production.prune()
    for (const machine of this.store.machines) this.scheduler.seed(machine.id)
    return this.store.machines
  }

  /**
   * Periodic durable write of the production ledger.
   *
   * Counting happens in memory on every poll; the disk write is batched so a 100-machine
   * fleet on a weak workshop PC is not doing an fsync per machine per poll. Worst case on a
   * power cut is one flush interval of stitches, and the odometer cursor makes that
   * self-correcting: the next reading after restart re-baselines rather than double-counts.
   */
  startProductionFlush() {
    if (this.productionFlush) return
    const intervalMs = this.config.production?.flushIntervalMs ?? 60_000
    this.productionFlush = setInterval(() => {
      this.production.prune()
      void this.production.flush()
    }, intervalMs)
    this.productionFlush.unref?.()
  }

  async stopProductionFlush() {
    if (this.productionFlush) {
      clearInterval(this.productionFlush)
      this.productionFlush = null
    }
    await this.production.flush()
  }

  get machines() { return this.store.machines }
  get migrationWarnings() { return this.store.migrationWarnings }

  site(siteId) { return this.config.sites.find((entry) => entry.id === siteId) ?? this.config.sites[0] }

  safety() { return { allowLoopback: this.config.scan.allowLoopback, allowPublicRanges: this.config.scan.allowPublicRanges } }

  findMachine(id) {
    const machine = this.store.machines.find((entry) => entry.id === id)
    if (!machine) {
      const error = new Error('Không tìm thấy máy đã ghép.')
      error.status = 404
      throw error
    }
    return machine
  }

  /** Serialises every write so two concurrent batches cannot interleave a save. */
  mutate(change) {
    const run = this.mutationQueue.then(() => change(), () => change())
    this.mutationQueue = run.then(() => undefined, () => undefined)
    return run
  }

  // ---------------------------------------------------------------- view model

  /** The full read-only projection of one machine sent to dashboards. */
  machineView(record) {
    const telemetry = this.telemetry.get(record.id) ?? null
    const site = this.site(record.siteId)
    const reach = this.reachability.get(record.id) ?? null
    const error = this.telemetryErrors.get(record.id) ?? null
    const hasProtocol = adapterHasProtocol(record.adapter)
    const connection = connectionState({
      enabled: record.enabled,
      hasProtocol,
      lastTelemetryAt: telemetry?.observedAt ?? null,
      lastReachableAt: reach?.lastReachableAt ?? null,
      reachable: reach?.reachable ?? null,
      lastError: error?.message ?? null,
      now: this.now(),
      freshSeconds: site.freshSeconds,
      staleSeconds: site.staleSeconds,
    })
    const maintenance = maintenanceForMachine(record, telemetry)
    return {
      schemaVersion: SCHEMA_VERSION,
      identity: {
        id: record.id,
        assetTag: record.assetTag,
        name: record.name,
        siteId: record.siteId,
        siteName: site.name,
        zone: record.zone,
        model: record.model,
        serial: record.serial,
        ipAddress: record.ipAddress,
        macAddress: record.macAddress,
        adapter: record.adapter,
        adapterHasProtocol: hasProtocol,
        // Đơn giá khoán: business metadata a person typed, never something the controller said.
        pricePer1000Stitches: record.pricePer1000Stitches ?? null,
        verification: record.verification,
        enabled: record.enabled,
        archived: record.archived,
        note: record.note ?? null,
        migratedFrom: record.migratedFrom ?? null,
        migrationError: record.migrationError ?? null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        updatedBy: record.updatedBy,
      },
      connection: {
        state: connection.state,
        reason: connection.reason,
        ageSeconds: connection.ageSeconds,
        lastTelemetryAt: telemetry?.observedAt ?? null,
        lastReachableAt: reach?.lastReachableAt ?? null,
        lastCheckedAt: reach?.checkedAt ?? null,
        reachable: reach?.reachable ?? null,
        poll: this.scheduler.describe(record.id),
      },
      thresholds: {
        freshSeconds: site.freshSeconds,
        staleSeconds: site.staleSeconds,
        stopEscalationMinutes: site.stopEscalationMinutes ?? 5,
        threadBreakWarnPer1000: site.threadBreakWarnPer1000 ?? null,
      },
      statusSince: this.statusSince.get(record.id) ?? null,
      telemetry,
      telemetryError: error,
      maintenance,
      alerts: deriveAlerts(record, telemetry, maintenance, { threadBreakWarnPer1000: site.threadBreakWarnPer1000 ?? null }),
    }
  }

  fleet() { return this.store.machines.map((record) => this.machineView(record)) }

  fleetState() {
    return {
      type: 'fleet_state',
      schemaVersion: SCHEMA_VERSION,
      revision: this.revision,
      at: new Date().toISOString(),
      sites: this.config.sites.map((site) => siteView(site)),
      machines: this.fleet(),
    }
  }

  publishMachine(record) {
    this.revision += 1
    this.publish({ type: 'machine_update', schemaVersion: SCHEMA_VERSION, revision: this.revision, at: new Date().toISOString(), machine: this.machineView(record) })
  }

  publishRemoved(machineId) {
    this.revision += 1
    this.publish({ type: 'machine_removed', schemaVersion: SCHEMA_VERSION, revision: this.revision, at: new Date().toISOString(), machineId })
  }

  // ---------------------------------------------------------------- mutations

  /**
   * Registers or re-registers a batch of machines. Validation, allowlist checks and
   * duplicate detection all run against the prospective fleet before a single byte is
   * written, so a rejected batch leaves the registry exactly as it was.
   */
  pairMany(inputs, session) {
    return this.mutate(async () => {
      if (!Array.isArray(inputs) || !inputs.length) throw badRequest('Chọn ít nhất một máy để ghép.')
      const maxBatch = this.config.limits.maxBatchPairing
      if (inputs.length > maxBatch) throw badRequest(`Mỗi lần chỉ ghép tối đa ${maxBatch} máy.`)

      const now = new Date().toISOString()
      const existingById = new Map(this.store.machines.map((record) => [record.id, record]))
      const records = inputs.map((input, index) => {
        try {
          const previous = input.id ? existingById.get(String(input.id)) ?? null : null
          const record = validateMachineInput(input, { sites: this.config.sites, actor: session.actor, now, existing: previous })
          // Editing an existing machine requires naming it explicitly. Without an id this is
          // a new pairing, so colliding with a machine already in the fleet is a conflict,
          // not a silent overwrite of somebody else's record.
          if (!previous && existingById.has(record.id)) {
            const owner = existingById.get(record.id)
            throw new Error(`Mã tài sản ${record.assetTag} đã thuộc về máy ${owner.name} (${owner.ipAddress}). Sửa máy đó thay vì ghép mới.`)
          }
          assertAllowedTarget(record.ipAddress, { sites: this.config.sites, siteId: record.siteId, safety: this.safety() })
          return record
        } catch (error) {
          throw badRequest(`Máy thứ ${index + 1}${input?.ipAddress ? ` (${input.ipAddress})` : ''}: ${error.message}`, error.field)
        }
      })

      const merged = new Map(this.store.machines.map((record) => [record.id, record]))
      for (const record of records) merged.set(record.id, record)
      const next = [...merged.values()]
      if (next.length > this.config.limits.maxMachines) throw badRequest(`Bridge chỉ được cấu hình tối đa ${this.config.limits.maxMachines} máy.`)
      assertNoDuplicates(next)

      await this.store.save(next)
      for (const record of records) {
        this.scheduler.seed(record.id)
        this.audit.record({
          actor: session.actor, role: session.role, correlationId: session.correlationId, remote: session.remote,
          action: existingById.has(record.id) ? 'machine.update' : 'machine.pair',
          targetType: 'machine', targetId: record.id,
          before: existingById.get(record.id) ?? null, after: record,
        })
        this.publishMachine(record)
      }
      void this.poll()
      return records.map((record) => this.machineView(record))
    })
  }

  /** Soft delete. The record and its audit history stay so a mis-pair can be explained later. */
  archiveMachine(id, session, { archived = true } = {}) {
    return this.mutate(async () => {
      const before = this.findMachine(id)
      const now = new Date().toISOString()
      const after = { ...before, archived, archivedAt: archived ? now : null, archivedBy: archived ? session.actor : null, enabled: archived ? false : before.enabled, updatedAt: now, updatedBy: session.actor }
      await this.store.save(this.store.machines.map((record) => (record.id === id ? after : record)))
      if (archived) {
        this.telemetry.delete(id)
        this.telemetryErrors.delete(id)
        this.reachability.delete(id)
        this.scheduler.forget(id)
        // Past shift rows stay; only the odometer cursor goes, so a restored machine
        // re-baselines instead of booking its whole downtime as production.
        this.production.forget(id)
      }
      this.audit.record({
        actor: session.actor, role: session.role, correlationId: session.correlationId, remote: session.remote,
        action: archived ? 'machine.archive' : 'machine.restore', targetType: 'machine', targetId: id, before, after,
      })
      this.publishMachine(after)
      return this.machineView(after)
    })
  }

  /** Acknowledgement is a dashboard note. It never sends anything to the controller. */
  acknowledgeAlert(id, alertId, session, { note = null, acknowledged = true } = {}) {
    return this.mutate(async () => {
      const before = this.findMachine(id)
      if (typeof alertId !== 'string' || !alertId.trim() || alertId.length > 120) throw badRequest('alertId không hợp lệ.', 'alertId')
      const view = this.machineView(before)
      if (acknowledged && !view.alerts.some((alert) => alert.id === alertId)) throw badRequest('Cảnh báo này không còn tồn tại trên máy.', 'alertId')
      const acknowledgements = { ...before.acknowledgements }
      if (acknowledged) acknowledgements[alertId] = { at: new Date().toISOString(), by: session.actor, note: note ? String(note).slice(0, 300) : null }
      else delete acknowledgements[alertId]
      const after = { ...before, acknowledgements, updatedAt: new Date().toISOString(), updatedBy: session.actor }
      await this.store.save(this.store.machines.map((record) => (record.id === id ? after : record)))
      this.audit.record({
        actor: session.actor, role: session.role, correlationId: session.correlationId, remote: session.remote,
        action: acknowledged ? 'alert.acknowledge' : 'alert.unacknowledge', targetType: 'alert', targetId: `${id}:${alertId}`,
        before: before.acknowledgements[alertId] ?? null, after: acknowledgements[alertId] ?? null, message: note ?? null,
      })
      this.publishMachine(after)
      return this.machineView(after)
    })
  }

  /** Records that a maintenance item was done, anchored to the controller's odometer. */
  completeMaintenance(id, planId, session, { note = null } = {}) {
    return this.mutate(async () => {
      const before = this.findMachine(id)
      const plan = (before.maintenance ?? []).find((entry) => entry.id === planId)
      if (!plan) throw badRequest('Không tìm thấy mốc bảo trì này trên máy.', 'planId')
      const odometer = this.telemetry.get(id)?.odometer?.value ?? null
      if (odometer === null) throw badRequest('Chưa đọc được bộ đếm mũi từ controller nên không thể chốt mốc bảo trì. Hãy chờ telemetry hợp lệ.', 'odometer')
      const now = new Date().toISOString()
      const completion = { at: now, by: session.actor, odometer, note: note ? String(note).slice(0, 300) : null }
      const updatedPlan = { ...plan, lastServiceOdometer: odometer, lastServiceAt: now, lastServiceBy: session.actor, history: [...(plan.history ?? []), completion].slice(-50) }
      const after = { ...before, maintenance: before.maintenance.map((entry) => (entry.id === planId ? updatedPlan : entry)), updatedAt: now, updatedBy: session.actor }
      await this.store.save(this.store.machines.map((record) => (record.id === id ? after : record)))
      this.audit.record({
        actor: session.actor, role: session.role, correlationId: session.correlationId, remote: session.remote,
        action: 'maintenance.complete', targetType: 'maintenance', targetId: `${id}:${planId}`, before: plan, after: updatedPlan, message: note ?? null,
      })
      this.publishMachine(after)
      return this.machineView(after)
    })
  }

  /** Replaces the maintenance plan list for a machine. */
  setMaintenancePlans(id, plans, session) {
    return this.mutate(async () => {
      const before = this.findMachine(id)
      if (!Array.isArray(plans)) throw badRequest('maintenance phải là mảng.', 'maintenance')
      if (plans.length > 20) throw badRequest('Mỗi máy chỉ cấu hình tối đa 20 mốc bảo trì.', 'maintenance')
      const validated = plans.map((plan, index) => {
        try { return validateMaintenancePlan(plan, index) } catch (error) { throw badRequest(error.message, error.field) }
      })
      const ids = new Set()
      for (const plan of validated) {
        if (ids.has(plan.id)) throw badRequest(`Mốc bảo trì trùng mã: ${plan.id}.`, 'maintenance')
        ids.add(plan.id)
      }
      // Completion history belongs to the machine, not to the edit, so it is carried over.
      const previous = new Map((before.maintenance ?? []).map((plan) => [plan.id, plan]))
      const merged = validated.map((plan) => ({ ...plan, ...pickHistory(previous.get(plan.id)) }))
      const after = { ...before, maintenance: merged, updatedAt: new Date().toISOString(), updatedBy: session.actor }
      await this.store.save(this.store.machines.map((record) => (record.id === id ? after : record)))
      this.audit.record({
        actor: session.actor, role: session.role, correlationId: session.correlationId, remote: session.remote,
        action: 'maintenance.configure', targetType: 'machine', targetId: id, before: before.maintenance, after: merged,
      })
      this.publishMachine(after)
      return this.machineView(after)
    })
  }

  // ---------------------------------------------------------------- polling

  /** One-off reachability check a technician can trigger from the machine detail view. */
  async probe(id, session) {
    const machine = this.findMachine(id)
    const port = Number(machine.adapterConfig?.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw badRequest('Máy chưa có cổng adapter để kiểm tra.', 'adapterConfig.port')
    assertAllowedTarget(machine.ipAddress, { sites: this.config.sites, siteId: machine.siteId, safety: this.safety() })
    const open = await probePort(machine.ipAddress, port, this.config.poll.timeoutMs)
    this.recordReachability(machine.id, open)
    this.audit.record({
      actor: session.actor, role: session.role, correlationId: session.correlationId, remote: session.remote,
      action: 'machine.probe', targetType: 'machine', targetId: id, after: { ipAddress: machine.ipAddress, port, open },
    })
    this.publishMachine(machine)
    return { ipAddress: machine.ipAddress, port, open, checkedAt: new Date().toISOString() }
  }

  /**
   * Folds one snapshot into the shift ledger. Never throws into the poll loop: a production
   * bookkeeping problem must not stop the fleet from being monitored.
   */
  countProduction(machine, snapshot) {
    try {
      const result = this.production.record(snapshot, { machine, site: this.site(machine.siteId) })
      if (result.reason === 'implausible-jump') {
        this.logger.warn('Bỏ qua bước nhảy bộ đếm mũi bất thường.', { machineId: machine.id, delta: result.delta, plausibleMax: result.plausibleMax })
      } else if (result.reason === 'counter-reset') {
        this.logger.warn('Bộ đếm mũi lùi lại, lấy mốc mới.', { machineId: machine.id })
      }
      return result
    } catch (error) {
      this.logger.error('Không ghi được sản lượng ca.', { machineId: machine.id, reason: error.message })
      return { counted: false, reason: 'error' }
    }
  }

  /**
   * The single place a validated snapshot becomes the machine's current state, whether the
   * bridge pulled it or the machine pushed it. Keeping one path means a dial-in machine gets
   * exactly the same freshness, production and alert handling as a polled one.
   */
  ingestSnapshot(machine, snapshot) {
    this.trackStatusChange(machine.id, snapshot)
    this.telemetry.set(machine.id, snapshot)
    this.countProduction(machine, snapshot)
    this.telemetryErrors.delete(machine.id)
    this.recordReachability(machine.id, true)
    this.logger.debug('Đã nhận telemetry.', { machineId: machine.id, source: snapshot.source, observedAt: snapshot.observedAt })
  }

  /**
   * Remembers when `status` last changed, so the dashboard can say "dừng 41 phút" instead of
   * showing a two-hour stop identically to a two-minute one.
   *
   * Two honesty rules:
   *  - the very first snapshot of a machine is marked `approximate`, because the machine was
   *    probably already in that state before the bridge started watching. The UI says
   *    "ít nhất từ …" for those.
   *  - the timestamp is the controller's `observedAt`, not the bridge clock, and it is never
   *    persisted across a restart. Inventing a pre-restart moment would be inventing history.
   */
  trackStatusChange(machineId, snapshot) {
    const status = snapshot.status.value
    const previous = this.statusSince.get(machineId)
    if (previous?.status === status) return
    this.statusSince.set(machineId, { status, at: snapshot.observedAt, approximate: previous === undefined })
  }

  // ---------------------------------------------------------------- dial-in ingest

  /**
   * Resolves the address a controller dialled from to exactly one paired machine.
   *
   * Ambiguity is refused rather than guessed at: two machines recorded at one address means
   * the registry is wrong, and attributing telemetry to the first match would silently write
   * one machine's production onto another's ledger.
   */
  identifyDialIn(remote) {
    const address = normalizeRemoteAddress(remote)
    if (!address) return { reason: 'unknown_source' }
    const matches = this.store.machines.filter(
      (machine) => machine.adapter === 'dial-in' && machine.enabled && !machine.archived && machine.ipAddress === address,
    )
    if (matches.length === 0) return { reason: 'unknown_source' }
    if (matches.length > 1) {
      this.logger.error('Nhiều máy dial-in cùng một địa chỉ.', { remote: address, machineIds: matches.map((machine) => machine.id) })
      return { reason: 'ambiguous_source' }
    }
    const machine = matches[0]
    // The address was allowed when the machine was paired, but the site allowlist can have
    // been narrowed since. Re-check on every connection so a revoked subnet takes effect.
    try {
      assertAllowedTarget(address, { sites: this.config.sites, siteId: machine.siteId, safety: this.safety() })
    } catch (error) {
      this.telemetryErrors.set(machine.id, { message: error.message, at: new Date().toISOString(), kind: 'policy', field: 'ipAddress' })
      this.publishMachine(machine)
      return { reason: 'outside_allowlist' }
    }
    return { machine }
  }

  /** A JSON frame the controller pushed. Validated exactly like a polled response. */
  acceptDialIn(machine, payload, meta) {
    try {
      const snapshot = normalizeTelemetry(payload, { machine, source: `dial-in:${meta?.remote ?? 'unknown'}` })
      this.ingestSnapshot(machine, snapshot)
      this.scheduler.recordSuccess(machine.id)
    } catch (error) {
      // Same rule as polling: a malformed push never merges into the previous snapshot.
      this.telemetryErrors.set(machine.id, {
        message: error.message,
        at: new Date().toISOString(),
        kind: error.name === 'ContractError' ? 'contract' : 'transport',
        field: error.field ?? null,
      })
      this.logger.warn('Khung dial-in không hợp lệ.', { machineId: machine.id, reason: error.message })
    }
    this.publishMachine(machine)
  }

  /**
   * Bytes nobody could decode. They become a visible error on the machine — never telemetry,
   * and never a reason to mark the machine online, because "something connected" is not the
   * same as "the controller reported its state".
   */
  recordUndecoded(machine, description, meta) {
    this.telemetryErrors.set(machine.id, {
      message: `Máy gửi dữ liệu chưa giải mã được (${description.reason}, ${description.bytes} byte): ${description.hex}${description.truncated ? '…' : ''}`,
      at: new Date().toISOString(),
      kind: 'contract',
      field: null,
    })
    this.logger.warn('Dữ liệu dial-in chưa giải mã được.', { machineId: machine.id, remote: meta?.remote ?? null, reason: description.reason, bytes: description.bytes })
    this.publishMachine(machine)
  }

  recordReachability(machineId, reachable) {
    const checkedAt = new Date().toISOString()
    const previous = this.reachability.get(machineId)
    this.reachability.set(machineId, { reachable, checkedAt, lastReachableAt: reachable ? checkedAt : previous?.lastReachableAt ?? null })
  }

  poll() {
    if (this.polling) return this.polling
    const run = this.pollOnce()
      .catch((error) => this.logger.error('Vòng poll thất bại.', { reason: error.message }))
      .finally(() => { if (this.polling === run) this.polling = null })
    this.polling = run
    return run
  }

  /**
   * Polls only the machines whose jittered due time has arrived, with bounded concurrency.
   * A failing machine is isolated: its error is recorded on its own view and the rest of
   * the fleet keeps updating.
   */
  async pollOnce() {
    const active = this.store.machines.filter((machine) => machine.enabled && !machine.archived)
    const targets = this.scheduler.due(active)
    this.lastPollAt = new Date().toISOString()
    if (!targets.length) return { polled: 0 }

    await mapWithConcurrency(targets, this.config.poll.concurrency, async (machine) => {
      if (!adapterIsPolled(machine.adapter)) {
        // `manual` machines have no protocol but may still answer a TCP probe. `dial-in`
        // machines are never touched at all — they call us, and the address in their record
        // is only an identity, not somewhere the bridge is allowed to knock.
        if (machine.adapter === 'manual') await this.checkManualReachability(machine)
        this.scheduler.recordSuccess(machine.id)
        this.publishMachine(machine)
        return
      }
      try {
        const snapshot = await pollMachine(machine, { sites: this.config.sites, safety: this.safety(), timeoutMs: this.config.poll.timeoutMs })
        this.ingestSnapshot(machine, snapshot)
        this.scheduler.recordSuccess(machine.id)
      } catch (error) {
        // A malformed or failed response must not be merged into the previous snapshot:
        // the old snapshot stays untouched and simply ages into stale/offline.
        this.telemetryErrors.set(machine.id, { message: error.message, at: new Date().toISOString(), kind: error.name === 'ContractError' ? 'contract' : 'transport', field: error.field ?? null })
        this.recordReachability(machine.id, error.name === 'ContractError')
        const state = this.scheduler.recordFailure(machine.id, error)
        this.logger.warn('Poll máy thất bại.', { machineId: machine.id, reason: error.message, failures: state.failures, breakerOpen: state.breakerOpenUntil > this.now() })
      }
      this.publishMachine(machine)
    })
    return { polled: targets.length }
  }

  async checkManualReachability(machine) {
    const port = Number(machine.adapterConfig?.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return
    try {
      assertAllowedTarget(machine.ipAddress, { sites: this.config.sites, siteId: machine.siteId, safety: this.safety() })
    } catch (error) {
      this.telemetryErrors.set(machine.id, { message: error.message, at: new Date().toISOString(), kind: 'policy', field: 'ipAddress' })
      return
    }
    this.recordReachability(machine.id, await probePort(machine.ipAddress, port, this.config.poll.timeoutMs))
  }

  /**
   * Liveness only: no site names, no subnets, no counts.
   *
   * This is what an unauthenticated probe (load balancer, uptime check, curl in the rack)
   * is allowed to learn. Everything describing the workshop network lives in health(),
   * behind fleet:read.
   */
  liveness() {
    return { status: 'ok', schemaVersion: SCHEMA_VERSION, startedAt: this.startedAt, serverTime: new Date().toISOString() }
  }

  health() {
    const machines = this.store.machines
    return {
      status: 'ok',
      schemaVersion: SCHEMA_VERSION,
      startedAt: this.startedAt,
      serverTime: new Date().toISOString(),
      lastPollAt: this.lastPollAt,
      bridge: {
        host: this.config.host,
        port: this.config.port,
        websocketPath: '/ws',
        pollIntervalMs: this.config.poll.intervalMs,
        pollConcurrency: this.config.poll.concurrency,
        maxBatchPairing: this.config.limits.maxBatchPairing,
        maxMachines: this.config.limits.maxMachines,
        authMode: this.config.auth.mode,
      },
      sites: this.config.sites.map((site) => siteView(site)),
      counts: {
        machines: machines.length,
        archived: machines.filter((machine) => machine.archived).length,
        verified: machines.filter((machine) => machine.verification.status === 'verified' && !machine.archived).length,
        withTelemetry: this.telemetry.size,
        breakersOpen: machines.filter((machine) => this.scheduler.isBreakerOpen(machine.id)).length,
      },
      ingest: this.dialIn.describe(),
      migrationWarnings: this.store.migrationWarnings,
    }
  }

  /**
   * Shift production report: one row per (business date, shift, machine).
   *
   * Two rules the workshop has to be able to trust:
   *
   * - Unverified machines are counted and shown, but kept out of the totals. A record nobody
   *   confirmed at the machine must not decide anyone's pay (PRD).
   * - The money column uses the rate configured *now*, and every row says which rate it used.
   *   Changing a rate therefore reprices future reports and any reprint of an old one — print
   *   or export the payslip when it is agreed, and keep that file.
   */
  productionReport({ from = null, to = null, siteId = null, machineId = null } = {}) {
    if (siteId !== null && !this.config.sites.some((site) => site.id === siteId)) throw badRequest(`Site "${siteId}" chưa được cấu hình trên bridge.`, 'siteId')
    const site = siteId ? this.site(siteId) : this.config.sites[0]
    const today = localParts(new Date(this.now()), site?.timeZone ?? 'Asia/Ho_Chi_Minh').date
    const range = {
      from: parseBusinessDate(from, 'from') ?? addDays(today, -6),
      to: parseBusinessDate(to, 'to') ?? today,
    }
    if (range.from > range.to) throw badRequest('Khoảng ngày không hợp lệ: "from" sau "to".', 'from')

    const machines = new Map(this.store.machines.map((record) => [record.id, record]))
    const rows = this.production
      .query({ ...range, siteId, machineIds: machineId ? [machineId] : null })
      .map((bucket) => {
        const record = machines.get(bucket.machineId) ?? null
        const bucketSite = record ? this.site(record.siteId) : site
        // Machine rate wins over the site default; null means "chưa đặt đơn giá", not zero.
        const price = record?.pricePer1000Stitches ?? bucketSite?.pricePer1000Stitches ?? null
        const verified = record?.verification?.status === 'verified'
        return {
          ...bucket,
          machineName: record?.name ?? null,
          assetTag: record?.assetTag ?? null,
          zone: record?.zone ?? null,
          siteName: bucketSite?.name ?? null,
          archived: record?.archived ?? null,
          // A machine unpaired after the fact leaves its stitches behind; say so instead of hiding the row.
          machineMissing: !record,
          verified,
          pricePer1000Stitches: price,
          amount: pieceRateAmount(bucket.stitches, price),
          countedInTotals: verified,
        }
      })

    const counted = rows.filter((row) => row.countedInTotals)
    return {
      schemaVersion: SCHEMA_VERSION,
      range,
      generatedAt: new Date().toISOString(),
      timeZone: site?.timeZone ?? null,
      shifts: (site?.shifts ?? []).map(({ id, name, start, end }) => ({ id, name, start, end })),
      rows,
      totals: {
        machines: new Set(counted.map((row) => row.machineId)).size,
        stitches: counted.reduce((sum, row) => sum + row.stitches, 0),
        runSeconds: counted.reduce((sum, row) => sum + row.runSeconds, 0),
        amount: counted.reduce((sum, row) => sum + (row.amount ?? 0), 0),
        rowsWithoutPrice: counted.filter((row) => row.amount === null).length,
        anomalies: rows.reduce((sum, row) => sum + row.anomalies + row.resets, 0),
      },
      excluded: {
        unverifiedRows: rows.length - counted.length,
        reason: 'Máy chưa xác minh tại chỗ không được tính vào tổng sản lượng và tiền khoán.',
      },
    }
  }

  /** Readiness is about the bridge itself: config loaded, store readable, poll loop alive. */
  readiness() {
    const storeLoaded = Boolean(this.store.document)
    return {
      ready: storeLoaded,
      checks: {
        configSites: this.config.sites.length,
        storeLoaded,
        lastPollAt: this.lastPollAt,
        pollInFlight: Boolean(this.polling),
      },
    }
  }
}

function pickHistory(plan) {
  return plan
    ? { lastServiceOdometer: plan.lastServiceOdometer, lastServiceAt: plan.lastServiceAt, lastServiceBy: plan.lastServiceBy, history: plan.history ?? [] }
    : {}
}

/** What a dashboard is told about a site: never the raw config object. */
function siteView(site) {
  return {
    id: site.id,
    name: site.name,
    timeZone: site.timeZone,
    allowedCidrs: site.allowedCidrs,
    freshSeconds: site.freshSeconds,
    staleSeconds: site.staleSeconds,
    stopEscalationMinutes: site.stopEscalationMinutes ?? 5,
    threadBreakWarnPer1000: site.threadBreakWarnPer1000 ?? null,
    shifts: (site.shifts ?? []).map(({ id, name, start, end }) => ({ id, name, start, end })),
    pricePer1000Stitches: site.pricePer1000Stitches ?? null,
  }
}

function parseBusinessDate(value, field) {
  if (value === null || value === undefined || value === '') return null
  const text = String(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw badRequest(`${field} phải có dạng YYYY-MM-DD.`, field)
  if (Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw badRequest(`${field} không phải ngày có thật.`, field)
  return text
}

function badRequest(message, field = null) {
  const error = new Error(message)
  error.status = 400
  error.field = field
  return error
}

export { mapWithConcurrency }
