import { pollMachine } from './adapters.mjs'
import { deriveAlerts, maintenanceForMachine } from './alerts.mjs'
import { derivedAlerts } from './derived-alerts.mjs'
import { AuditLog } from './audit.mjs'
import { FaultEpisodeLog, CHUA_BIET_VI } from './fault-episodes.mjs'
import { durationSeconds, formatSpokenDuration, latestSignificantEvent } from './downtime.mjs'
import { SCHEMA_VERSION, adapterHasProtocol, adapterIsPolled, normalizeTelemetry } from './contract.mjs'
import { DialInListener, normalizeRemoteAddress } from './dial-in.mjs'
import { connectionState } from './freshness.mjs'
import { assertNoDuplicates, validateMachineInput, validateMaintenancePlan } from './machine-record.mjs'
import { normalizeManualReading } from './manual-entry.mjs'
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
    this.audit = audit ?? new AuditLog(config.auditPath, {
      logger,
      maxBytes: config.audit?.maxBytes,
      retentionDays: config.audit?.retentionDays ?? null,
      now,
    })
    this.scheduler = new PollScheduler(config.poll, { now })
    this.production = new ProductionLog({
      filePath: config.productionPath,
      retentionDays: config.production?.retentionDays,
      maxStitchesPerMinute: config.production?.maxStitchesPerMinute,
      maxRunGapSeconds: config.production?.maxRunGapSeconds,
      logger,
    })
    this.productionFlush = null
    // Một quyển sổ lần lỗi cho mỗi xưởng, dựng khi cần chứ không dựng sẵn: xưởng chưa bao giờ
    // có máy lỗi thì cũng không nên có một file rỗng nằm đó trông như đã mất dữ liệu.
    this.faultLogs = new Map()
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
    // Máy nào đang có episode ngừng mở, chờ đóng; mốc lấy thẳng từ statusSince.
    this.downtimeRecorded = new Set()
    this.reachability = new Map()
    this.revision = 0
    this.polling = null
    this.mutationQueue = Promise.resolve()
    this.startedAt = new Date().toISOString()
    this.lastPollAt = null
    this.lastAuditPruneAt = null
  }

  /**
   * Quyển sổ lần lỗi của một xưởng. `<site>` trong `faultPath` được thay bằng id xưởng đã lọc
   * sạch: id đi thẳng vào tên file, mà id thì do người khai trong cấu hình, nên một dấu `/`
   * lọt vào sẽ ghi sổ ra ngoài `bridge-data`.
   */
  soLanLoi(siteId) {
    const khoa = String(siteId ?? 'khong-ro').replace(/[^a-zA-Z0-9._-]/g, '-') || 'khong-ro'
    let so = this.faultLogs.get(khoa)
    if (!so) {
      so = new FaultEpisodeLog(this.config.faultPath.replace('<site>', khoa), { logger: this.logger, now: this.now })
      this.faultLogs.set(khoa, so)
    }
    return so
  }

  async load() {
    await this.store.load({ sites: this.config.sites })
    await this.production.load()
    this.production.prune()
    // Không khai `audit.retentionDays` thì lời gọi này không xoá gì cả.
    await this.audit.prune()
    this.lastAuditPruneAt = this.now()
    for (const machine of this.store.machines) this.scheduler.seed(machine.id)
    // Lần lỗi còn mở lúc bridge tắt phải được đóng lại bằng lý do `dong-bang-khoi-dong-lai`.
    // Bỏ qua bước này thì lần khởi động sau sẽ thấy một lần lỗi mở treo vô hạn, và bất kỳ ai
    // đọc bảng cũng sẽ đọc ra "máy đang lỗi" trong khi sự thật chỉ là ta đã ngừng nhìn.
    for (const site of this.config.sites) await this.soLanLoi(site.id).donDep({ moc: new Date(this.now()).toISOString() })
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
      this.sweepDowntime()
      this.production.prune()
      void this.production.flush()
      // Bridge ở xưởng chạy hàng tháng không nghỉ, nên hạn giữ nhật ký phải tự đến hạn mà
      // không cần khởi động lại. Mỗi ngày một lần là đủ: xoá theo ngày, không theo phút.
      if (this.now() - (this.lastAuditPruneAt ?? 0) >= 86_400_000) {
        this.lastAuditPruneAt = this.now()
        void this.audit.prune()
      }
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

  /**
   * Lịch sử lần lỗi của một máy, đã hợp nhất mở + đóng + mở-lại.
   *
   * Khoảng thời gian không có lần lỗi nào trả về mảng RỖNG, không phải lỗi. "Máy không
   * hỏng lần nào trong tuần rồi" là một câu trả lời hoàn toàn bình thường, và nếu nó nổ
   * thành 500 thì màn hình sẽ hiện "lỗi hệ thống" đúng vào lúc mọi thứ đang tốt nhất.
   */
  async docLichSuLoi(id, { from = null, to = null, limit = 100 } = {}) {
    const machine = this.findMachine(id)
    const ket = await this.soLanLoi(machine.siteId).docHopNhat({
      machineId: machine.id, from, to, limit,
    })
    return { machineId: machine.id, ...ket }
  }

  /**
   * R3: mở lại một lần lỗi đã đóng — "tưởng sửa xong rồi, hoá ra chưa".
   *
   * Ghi THÊM một dòng chứ không sửa dòng cũ. Bản ghi sai vẫn nằm nguyên đó, và đó là chủ ý:
   * người ta cần thấy được rằng đã có lúc hệ thống tưởng máy đã chạy lại. Xoá nó đi thì
   * cái sổ trông sạch hơn sự thật.
   */
  async moLaiLanLoi(id, episodeId, input, session) {
    const machine = this.findMachine(id)
    const lyDo = String(input?.reason ?? '').trim()
    if (!lyDo) throw badRequest('Phải ghi lý do mở lại — một dòng không lý do thì không ai kiểm được.', 'reason')
    if (lyDo.length > 400) throw badRequest('Lý do mở lại tối đa 400 ký tự.', 'reason')
    try {
      return await this.soLanLoi(machine.siteId).moLai(episodeId, {
        actor: session.actor, role: session.role, lyDo, message: input?.message ?? null,
      })
    } catch (error) {
      // Mã lần lỗi không có thật → 404 và KHÔNG ghi gì. Một dòng `reopen` mồ côi sẽ nằm
      // trong sổ mãi mãi, trỏ vào hư không, và mọi bản hợp nhất về sau đều phải đoán.
      const hong = new Error(error.message)
      hong.status = 404
      hong.field = 'episodeId'
      throw hong
    }
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
      telemetryQuality: telemetry?.status?.quality ?? null,
      now: this.now(),
      freshSeconds: site.freshSeconds,
      staleSeconds: site.staleSeconds,
    })
    const maintenance = maintenanceForMachine(record, telemetry)
    const view = {
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
      // Con trỏ của sổ sản lượng, không phải số telemetry gần nhất. Hai thứ này lệch nhau được
      // (một khung lỗi giữ nguyên ảnh chụp cũ mà không dời con trỏ), và ô nhập tay phải tính hiệu
      // với ĐÚNG con số mà sổ sẽ trừ, nếu không thì người gõ xác nhận một con chênh lệch không có
      // thật rồi ngạc nhiên vì báo cáo ra khác.
      lastCountedReading: this.production.cursorFor(record.id),
      telemetry,
      telemetryError: error,
      maintenance,
      alerts: deriveAlerts(record, telemetry, maintenance, { threadBreakWarnPer1000: site.threadBreakWarnPer1000 ?? null }),
    }
    // Cảnh báo SUY RA (máy lỗi, mất kết nối, dừng quá lâu, dữ liệu cũ) — tính tại thời điểm phục
    // vụ yêu cầu, để riêng khỏi `alerts`. Hai nhóm có vòng đời khác nhau: `alerts` do bridge giữ
    // và XÁC NHẬN ĐƯỢC; nhóm này tự tắt khi máy trở lại, nên không có nút "đã xem" và bridge sẽ
    // trả 400 nếu ai đó thử acknowledge id của nó. Trộn hai nhóm là làm hỏng cả hai.
    // `this.now()` trả về SỐ mili-giây (mặc định `() => Date.now()`, và các bài thử thay bằng
    // `() => base + 10_000`). `Date.parse` của một con số sẽ ép nó về chuỗi "1787743974360" rồi
    // chịu thua -> NaN. Mọi so sánh với NaN đều false, nên `state:idle-long` — dòng duy nhất có
    // cửa chặn theo thời lượng — CHƯA BAO GIỜ nổ trên production, im lặng suốt, không lỗi nào.
    // Các bài thử cũ không bắt được vì chúng gọi thẳng `derivedAlerts(may, mocDung)`; chỗ hỏng
    // nằm ở khúc nối, nên bài thử hồi quy phải đi qua `machineView`.
    view.derivedAlerts = derivedAlerts(view, this.now())
    return view
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
   * A hand-typed reading becomes the machine's current state — but only the parts a person can
   * honestly vouch for. This is deliberately NOT `ingestSnapshot`, and every omission is a claim
   * that would be false if it were made:
   *
   * - no `recordReachability(id, true)`. A person typing a number proves the person was standing
   *   at the machine, not that the bridge can reach it over the network. Marking it reachable
   *   would put a machine we have never exchanged a byte with into the "còn liên lạc" column.
   * - no `telemetryErrors.delete(id)`. A typed number does not repair a broken adapter. Clearing
   *   the error would erase the reason somebody is typing in the first place, on the exact screen
   *   a technician would go to in order to find that reason.
   * - no `scheduler.recordSuccess(id)`. The poll backoff describes the adapter's health. A manual
   *   entry would reset it and send the bridge back to polling a dead address at full rate.
   * - no `trackStatusChange`. The "dừng 41 phút" clock claims the machine has been in one state
   *   *since* a moment. One person sampling one instant cannot establish a since, and overwriting
   *   a real clock with a sample would shorten every stop it touched.
   */
  ingestManualSnapshot(machine, snapshot) {
    // Ngoại lệ duy nhất của đoạn trên: nếu máy đang có một lần lỗi mở, con số gõ tay là bằng
    // chứng cuối cùng ta có về nó, và sổ lần lỗi phải đóng lại ở đây bằng lý do `nhap-tay` —
    // KHÔNG kèm thời lượng. Người gõ số biết máy đang chạy lúc họ đứng đó; họ không biết máy
    // hết lỗi từ lúc nào. Đây là ghi vào sổ lần lỗi, không phải `trackStatusChange`: cái đồng
    // hồ "đang ở trạng thái này từ …" vẫn không bị một mẫu đơn lẻ ghi đè.
    if (this.downtimeRecorded.has(machine.id) && this.statusSince.get(machine.id)?.status === 'fault') {
      this.soLanLoi(machine.siteId).dongLanLoi(machine.id, {
        ketThuc: snapshot.observedAt, trangThaiSau: null, chuaBietVi: CHUA_BIET_VI.NHAP_TAY,
      })
    }
    this.telemetry.set(machine.id, snapshot)
    const counted = this.countProduction(machine, snapshot)
    this.logger.info('Đã nhận số nhập tay.', { machineId: machine.id, source: snapshot.source, observedAt: snapshot.observedAt, counted: counted.counted })
    return counted
  }

  /**
   * Records one stitch-counter reading a person read off the controller screen.
   *
   * The validation lives in `manual-entry.mjs` and rejects rather than flags — see the reasoning
   * there. This method's own job is the three things that need the service: the shared cursor to
   * validate against, an audit row naming who typed what, and an immediate flush.
   *
   * The flush is awaited, and its outcome is reported back instead of assumed. Automatic readings
   * can afford to wait for the periodic flush because the next poll will re-derive them; a typed
   * number exists nowhere else, so telling somebody "đã ghi" while it sits only in memory would be
   * a lie that survives exactly until the next restart.
   */
  async recordManualReading(id, input, session) {
    const machine = this.findMachine(id)
    if (machine.archived) throw badRequest('Máy đã lưu trữ. Bỏ lưu trữ trước khi ghi số cho nó.', 'id')

    let entry
    try {
      entry = normalizeManualReading(input, {
        cursor: this.production.cursorFor(machine.id),
        now: new Date(this.now()).toISOString(),
        maxStitchesPerMinute: this.production.maxStitchesPerMinute,
      })
    } catch (error) {
      if (error.name === 'ManualEntryError') throw badRequest(error.message, error.field)
      throw error
    }

    // `manual:<người gõ>` chứ không phải `manual`: nguồn của một số đọc phải chỉ về được một
    // người, vì đó là toàn bộ khả năng đối chứng còn lại khi con số bị tranh chấp.
    const snapshot = normalizeTelemetry(entry.payload, { machine, source: `manual:${session.actor}`, quality: 'manual' })
    const counted = this.ingestManualSnapshot(machine, snapshot)
    const persisted = await this.production.flush(new Date(this.now()))

    this.audit.record({
      actor: session.actor, role: session.role, correlationId: session.correlationId, remote: session.remote,
      action: 'production.manual-reading', targetType: 'machine', targetId: machine.id,
      before: entry.previous,
      after: {
        odometer: entry.odometer,
        observedAt: entry.observedAt,
        status: entry.status,
        counterReset: entry.counterReset,
        delta: entry.delta,
        impliedStitchesPerMinute: entry.impliedStitchesPerMinute,
        countedStitches: counted.counted ? counted.stitches : 0,
        countedReason: counted.reason,
        bucketKey: counted.bucketKey ?? null,
        persisted,
      },
      message: entry.note,
    })

    this.publishMachine(machine)
    if (!persisted) {
      this.logger.error('Số nhập tay chưa lưu được xuống đĩa.', { machineId: machine.id, odometer: entry.odometer })
    }
    return {
      machine: this.machineView(machine),
      reading: {
        observedAt: entry.observedAt,
        odometer: entry.odometer,
        status: entry.status,
        note: entry.note,
        counterReset: entry.counterReset,
        baseline: entry.baseline,
        previous: entry.previous,
        delta: entry.delta,
        elapsedSeconds: entry.elapsedSeconds,
        impliedStitchesPerMinute: entry.impliedStitchesPerMinute,
      },
      counted,
      // `false` nghĩa là con số đang chỉ nằm trong bộ nhớ. Giao diện phải nói ra, không được
      // hiện "đã lưu" rồi để nó mất sau lần khởi động lại.
      persisted,
    }
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

    // Rời một trạng thái đang mở episode ngừng (lỗi hoặc dừng-lâu đã ghi): đóng nó lại kèm thời
    // lượng, tính từ mốc controller vào trạng thái đó tới mốc nó thoát ra.
    if (this.downtimeRecorded.has(machineId) && previous) {
      this.recordDowntimeClose(machineId, previous, status, snapshot.observedAt)
      this.downtimeRecorded.delete(machineId)
    }
    // `fault` ghi ngay. Dừng thường để `sweepDowntime` nâng lên khi vượt ngưỡng, nếu không thì
    // mỗi lần thay chỉ vài chục giây lại đẻ một dòng ngừng máy vô nghĩa.
    if (status === 'fault') {
      this.recordDowntimeOpen(machineId, {
        status, since: snapshot.observedAt, approximate: previous === undefined, reason: 'fault', events: snapshot.events,
      })
      this.downtimeRecorded.add(machineId)
    }

    this.statusSince.set(machineId, { status, at: snapshot.observedAt, approximate: previous === undefined })
  }

  /**
   * Nâng một lần dừng thường thành dòng "dừng lâu" khi nó vượt ngưỡng xưởng, dù trong lúc đó không
   * có ảnh chụp mới nào (thời gian trôi, trạng thái không đổi, `trackStatusChange` không nổ). Gọi
   * định kỳ từ vòng flush. `fault` không đi qua đây — nó đã được ghi ngay lúc chuyển trạng thái.
   */
  sweepDowntime(now = this.now()) {
    for (const machine of this.store.machines) {
      if (machine.archived || !machine.enabled) continue
      if (this.downtimeRecorded.has(machine.id)) continue
      const since = this.statusSince.get(machine.id)
      if (!since || (since.status !== 'stopped' && since.status !== 'paused')) continue
      const startMs = Date.parse(since.at)
      if (!Number.isFinite(startMs)) continue
      const thresholdMinutes = this.site(machine.siteId).stopEscalationMinutes ?? 5
      if ((now - startMs) / 60_000 < thresholdMinutes) continue
      this.recordDowntimeOpen(machine.id, {
        status: since.status, since: since.at, approximate: since.approximate, reason: 'long-stop', thresholdMinutes,
      })
      this.downtimeRecorded.add(machine.id)
    }
  }

  /** Dòng "máy vào ngừng" trong sổ audit. `fault` kèm mã lỗi controller gửi (nếu có). */
  recordDowntimeOpen(machineId, { status, since, approximate, reason, events = [], thresholdMinutes = null }) {
    const event = reason === 'fault' ? latestSignificantEvent(events) : null
    const message = reason === 'fault'
      ? `Controller báo máy lỗi${event ? ` · mã ${event.code}${event.message ? `: ${event.message}` : ''}` : ''}${approximate ? ' (máy đã ở trạng thái lỗi khi bridge bắt đầu quan sát)' : ''}.`
      : `Máy dừng liên tục quá ngưỡng ${thresholdMinutes} phút của xưởng — controller chưa gửi mã lý do.`
    this.audit.record({
      actor: 'bridge', role: 'system', action: 'machine.downtime.open',
      targetType: 'machine', targetId: machineId, message,
      after: { status, reason, since, approximate: approximate ?? false, code: event?.code ?? null, eventMessage: event?.message ?? null, thresholdMinutes },
    })
    // Chỉ `fault` mới vào sổ lần lỗi. Dừng-lâu là một câu chuyện khác — nó nói về sản lượng,
    // không nói về hỏng hóc — và trộn hai loại vào một quyển sẽ làm mọi con số "máy hỏng bao
    // nhiêu lâu" phồng lên bằng những lần công nhân đi ăn trưa.
    if (reason === 'fault') {
      const machine = this.store.machines.find((entry) => entry.id === machineId)
      this.soLanLoi(machine?.siteId).moLanLoi(machineId, {
        siteId: machine?.siteId ?? null, batDau: since, events, uocChung: approximate ?? false,
      })
    }
  }

  /** Dòng "máy ra khỏi ngừng" kèm thời lượng. `approximate` = không chắc mốc bắt đầu (in "ít nhất"). */
  recordDowntimeClose(machineId, previous, newStatus, clearedAt) {
    const seconds = durationSeconds(previous.at, clearedAt)
    const wasFault = previous.status === 'fault'
    const spoken = seconds === null ? null : formatSpokenDuration(seconds)
    const verb = wasFault ? 'rời trạng thái lỗi' : 'chạy lại'
    this.audit.record({
      actor: 'bridge', role: 'system', action: 'machine.downtime.close',
      targetType: 'machine', targetId: machineId,
      message: spoken === null
        ? `Máy ${verb}, chuyển sang: ${newStatus}.`
        : `Máy ${verb} sau ${spoken}${previous.approximate ? ' (ít nhất)' : ''}, chuyển sang: ${newStatus}.`,
      after: {
        previousStatus: previous.status, reason: wasFault ? 'fault' : 'long-stop', status: newStatus,
        since: previous.at, clearedAt, durationSeconds: seconds, approximate: previous.approximate ?? false,
      },
    })
    // Không còn `if (!wasFault) return`: từ khi dừng-lâu cũng được mở trong sổ, bỏ qua ở đây
    // là để lại một lần mở treo vĩnh viễn, và mọi bản hợp nhất về sau đều đọc ra "máy đang
    // dừng" kể cả khi nó đã chạy lại từ tuần trước.
    //
    // `unknown` KHÔNG phải "đã hết lỗi". Nó là "ta mất dấu con máy". Đóng nó như một lần lỗi
    // kết thúc bình thường sẽ in ra "máy lỗi 12 phút" trong khi sự thật là "ta nhìn được tới
    // phút thứ 12 thì mất tín hiệu" — máy có thể vẫn đang đứng đó với cùng cái lỗi.
    const machine = this.store.machines.find((entry) => entry.id === machineId)
    this.soLanLoi(machine?.siteId).dongLanLoi(machineId, {
      ketThuc: clearedAt,
      trangThaiSau: newStatus,
      chuaBietVi: newStatus === 'unknown' ? CHUA_BIET_VI.MAT_TIN_HIEU : null,
    })
  }

  // ---------------------------------------------------------------- dial-in ingest

  /**
   * Resolves the address a controller dialled from to exactly one paired machine.
   *
   * Ambiguity is refused rather than guessed at: two machines recorded at one address means
   * the registry is wrong, and attributing telemetry to the first match would silently write
   * one machine's production onto another's ledger.
   *
   * Unless that address is a declared gateway — then several machines there is the intended
   * setup, and each frame's `machineId` says which one is speaking.
   */
  /** Máy dial-in đang nhận telemetry tại một địa chỉ. */
  dialInMachinesAt(address) {
    return this.store.machines.filter(
      (machine) => machine.adapter === 'dial-in' && machine.enabled && !machine.archived && machine.ipAddress === address,
    )
  }

  /** Địa chỉ này có được khai là cổng tin cậy trong cấu hình không. */
  isGatewayAddress(address) {
    const gateways = this.config.ingest?.gateways ?? []
    return gateways.includes(address)
  }

  /**
   * Phân giải `machineId` một khung khai, trong phạm vi những máy đã ghép tại cổng đó.
   *
   * Đây là chỗ giữ lời hứa "không tin lời khai": id không tra được trong sổ máy TẠI ĐỊA CHỈ
   * NÀY thì trả null, chứ không tạo máy mới và cũng không rơi về máy nào khác.
   */
  resolveGatewayMachine(address, machineId) {
    if (typeof machineId !== 'string' || machineId === '') return null
    const machine = this.dialInMachinesAt(address).find((candidate) => candidate.id === machineId)
    if (!machine) return null
    // Cùng lý do như đường trực tiếp: allowlist có thể đã bị siết lại sau khi ghép máy.
    try {
      assertAllowedTarget(address, { sites: this.config.sites, siteId: machine.siteId, safety: this.safety() })
    } catch (error) {
      this.telemetryErrors.set(machine.id, { message: error.message, at: new Date().toISOString(), kind: 'policy', field: 'ipAddress' })
      this.publishMachine(machine)
      return null
    }
    return machine
  }

  identifyDialIn(remote) {
    const address = normalizeRemoteAddress(remote)
    if (!address) return { reason: 'unknown_source' }
    // Cổng tin cậy được xét TRƯỚC phép đếm bên dưới. Ở một cổng, "nhiều máy cùng một địa
    // chỉ" chính là cấu hình đúng chứ không phải lỗi khai báo — đó là lý do nó tồn tại.
    if (this.isGatewayAddress(address)) {
      const machines = this.dialInMachinesAt(address)
      if (machines.length === 0) return { reason: 'unknown_source' }
      return { gateway: { address, resolve: (machineId) => this.resolveGatewayMachine(address, machineId) } }
    }
    const matches = this.dialInMachinesAt(address)
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

  /**
   * Cổng ingest + danh sách địa chỉ đã gọi vào, dùng cho màn hình "máy đang gọi vào".
   *
   * Mỗi dòng được đối chiếu lại với sổ máy *tại thời điểm đọc*: `machineId` là máy đã nhận
   * kết nối lúc đó, còn `pairedMachineId` là máy đang khai ở địa chỉ đó bây giờ. Hai giá trị
   * này khác nhau đúng ở khoảnh khắc quan trọng nhất — vừa ghép máy xong, controller chưa
   * gọi lại — nên màn hình có thể nói "đã ghép, chờ máy gọi lại" thay vì vẫn báo lạ.
   *
   * Không gọi identifyDialIn() ở đây: hàm đó ghi lỗi lên máy và phát bản tin, không được
   * phép chạy chỉ vì có người mở dashboard.
   */
  ingestStatus() {
    const ingest = this.dialIn.describeIngest()
    return {
      ...ingest,
      callers: ingest.callers.map((caller) => {
        const matches = this.dialInMachinesAt(caller.remote)
        const paired = matches.length === 1 ? matches[0] : null
        return {
          ...caller,
          pairedMachineId: paired?.id ?? null,
          pairedMachineName: paired?.name ?? null,
          pairedCount: matches.length,
        }
      }),
    }
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
   * - Hand-typed stitches ARE paid, and every row says how many of its stitches were hand-typed.
   *   Refusing to pay them would be the wrong answer: on a controller with no readable protocol
   *   every stitch is hand-typed, and the operator still did the work. But paying them without
   *   showing them would quietly turn one person's reading of a screen into a measurement, so
   *   `stitches` (machine) and `manualStitches` (person) stay separate all the way to the total
   *   and only `stitchesBilled` adds them up.
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
          stitchesBilled: bucket.stitches + bucket.manualStitches,
          amount: pieceRateAmount(bucket.stitches + bucket.manualStitches, price),
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
        manualStitches: counted.reduce((sum, row) => sum + row.manualStitches, 0),
        stitchesBilled: counted.reduce((sum, row) => sum + row.stitchesBilled, 0),
        runSeconds: counted.reduce((sum, row) => sum + row.runSeconds, 0),
        amount: counted.reduce((sum, row) => sum + (row.amount ?? 0), 0),
        rowsWithoutPrice: counted.filter((row) => row.amount === null).length,
        // Số hàng có ít nhất một lượt gõ tay. Không phải cảnh báo, là điều kiện đọc: một bảng
        // lương dựng trên số gõ tay phải nhìn thấy được điều đó ngay ở dòng tổng.
        rowsWithManualEntry: counted.filter((row) => row.manualReadings > 0).length,
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
