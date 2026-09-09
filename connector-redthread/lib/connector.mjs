import { readFile } from 'node:fs/promises'
import { EventQueue, readJson, writeJsonAtomic } from './json-store.mjs'
import { heartbeatMachine, machineEvent, mapMachine } from './mapping.mjs'

const EMPTY_STATE = Object.freeze({ lastPushAt: null, statuses: {}, repairCursor: 0, repairSerials: {} })

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export async function readMachineMap(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'))
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('machine-map.json phải là object')
    const result = {}
    for (const [bridgeId, externalId] of Object.entries(parsed)) {
      if (!Number.isInteger(externalId) || externalId <= 0) throw new Error(`Machine map không hợp lệ cho ${bridgeId}`)
      result[bridgeId] = externalId
    }
    return result
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

export class Connector {
  constructor({ client, queueFile, stateFile, machineMap = {}, now = () => new Date(), logger = console, gapMs = 5 * 60_000 }) {
    this.client = client
    this.queue = new EventQueue(queueFile)
    this.stateFile = stateFile
    this.machineMap = machineMap
    this.now = now
    this.logger = logger
    this.gapMs = gapMs
    this.machines = new Map()
    this.warnedUnmapped = new Set()
    this.state = { ...EMPTY_STATE, statuses: {}, repairSerials: {} }
    this.initializedSnapshot = false
    this.stats = { postsOk: 0, postsFailed: 0 }
  }

  async init() {
    const saved = await readJson(this.stateFile, EMPTY_STATE)
    this.state = {
      lastPushAt: validDate(saved?.lastPushAt) ? saved.lastPushAt : null,
      statuses: saved?.statuses && typeof saved.statuses === 'object' ? saved.statuses : {},
      repairCursor: Number.isInteger(saved?.repairCursor) && saved.repairCursor >= 0 ? saved.repairCursor : 0,
      repairSerials: saved?.repairSerials && !Array.isArray(saved.repairSerials) && typeof saved.repairSerials === 'object' ? saved.repairSerials : {},
    }
  }

  // Input là SERIAL trần từ va-mau.out (vd 602602A6F22B). KHÔNG dùng làm key
  // this.machines được: key là identity.id dạng "mch-602602a6f22b" (prefix +
  // lowercase) — sự cố 9/9 lần 2 chính là tra map bằng serial nên miss 100%.
  // Serial thật nằm ở identity.serial (fallback assetTag); 19 máy nên quét tuyến
  // tính là đủ rẻ.
  resolveExternalId(serial) {
    const wanted = String(serial).trim().toUpperCase()
    if (!wanted) return null
    for (const machine of this.machines.values()) {
      const candidate = String(machine?.identity?.serial ?? machine?.identity?.assetTag ?? '').trim().toUpperCase()
      if (candidate && candidate === wanted) return this.#map(machine)?.externalMachineId ?? null
    }
    return null
  }

  persistState() {
    return this.#saveState()
  }

  mappedMachines() {
    return [...this.machines.values()]
      .map((machine) => this.#map(machine))
      .filter(Boolean)
      .sort((a, b) => a.externalMachineId - b.externalMachineId)
  }

  #map(machine) {
    const mapped = mapMachine(machine, this.machineMap)
    if (!mapped) {
      const id = String(machine?.identity?.id ?? 'unknown')
      if (!this.warnedUnmapped.has(id)) {
        this.warnedUnmapped.add(id)
        this.logger.warn(`Bỏ qua máy chưa map: ${id}`)
      }
    }
    return mapped
  }

  async ingestMessage(message) {
    if (message?.type === 'fleet_state') return this.ingestFleet(message.machines)
    if (message?.type === 'machine_update') return this.ingestMachine(message.machine)
    if (message?.type === 'machine_removed') {
      this.machines.delete(String(message.machineId))
      return
    }
  }

  async ingestFleet(machines) {
    if (!Array.isArray(machines)) throw new Error('fleet_state.machines phải là mảng')
    if (!this.initializedSnapshot) {
      this.machines = new Map(machines.map((machine) => [String(machine?.identity?.id), machine]))
      await this.#reconcileInitialSnapshot()
      this.initializedSnapshot = true
      return
    }
    const incomingIds = new Set(machines.map((machine) => String(machine?.identity?.id)))
    for (const machine of machines) await this.ingestMachine(machine)
    for (const bridgeId of this.machines.keys()) {
      if (!incomingIds.has(bridgeId)) this.machines.delete(bridgeId)
    }
  }

  async ingestMachine(machine) {
    const bridgeId = String(machine?.identity?.id ?? '')
    if (!bridgeId) throw new Error('machine_update thiếu identity.id')
    const previousMachine = this.machines.get(bridgeId)
    const previousMapped = previousMachine ? this.#map(previousMachine) : null
    this.machines.set(bridgeId, machine)
    const current = this.#map(machine)
    if (!current) return

    const previousStatus = previousMapped?.status ?? this.state.statuses[String(current.externalMachineId)]
    if (previousStatus && previousStatus !== current.status) {
      this.logger.info(`Máy ${current.externalMachineId}: ${previousStatus} → ${current.status}`)
      await this.#sendOrQueue(machineEvent(current, previousStatus, current.statusSince ?? this.now().toISOString()))
    }
    this.state.statuses[String(current.externalMachineId)] = current.status
    await this.#saveState()
  }

  async #reconcileInitialSnapshot() {
    const current = this.mappedMachines()
    const nowIso = this.now().toISOString()
    const gap = this.state.lastPushAt ? this.now().getTime() - Date.parse(this.state.lastPushAt) : 0

    for (const mapped of current) {
      const key = String(mapped.externalMachineId)
      const previousStatus = this.state.statuses[key]
      if (previousStatus && gap > this.gapMs && previousStatus !== 'OFFLINE') {
        const offline = { ...mapped, status: 'OFFLINE', errorCode: '', statusNote: '' }
        await this.#sendOrQueue(machineEvent(offline, previousStatus, this.state.lastPushAt))
        if (mapped.status !== 'OFFLINE') {
          await this.#sendOrQueue(machineEvent(mapped, 'OFFLINE', nowIso))
        }
      } else if (previousStatus && previousStatus !== mapped.status) {
        await this.#sendOrQueue(machineEvent(mapped, previousStatus, mapped.statusSince ?? nowIso))
      }
      this.state.statuses[key] = mapped.status
    }
    await this.#saveState()
  }

  async #sendOrQueue(event) {
    try {
      await this.client.event(event)
      this.stats.postsOk += 1
      return true
    } catch (error) {
      this.stats.postsFailed += 1
      await this.queue.append(event)
      this.logger.error(`Queue event ${event.eventId}: ${error.message}`)
      return false
    }
  }

  async replayQueue() {
    const result = await this.queue.replay(async (event) => {
      await this.client.event(event)
      this.stats.postsOk += 1
    })
    if (result.remaining > 0) this.stats.postsFailed += 1
    return result
  }

  async heartbeat() {
    const machines = this.mappedMachines().map(heartbeatMachine)
    if (machines.length === 0) return { accepted: 0 }
    try {
      const result = await this.client.heartbeat(machines)
      this.stats.postsOk += 1
      this.state.lastPushAt = this.now().toISOString()
      for (const machine of this.mappedMachines()) this.state.statuses[String(machine.externalMachineId)] = machine.status
      await this.#saveState()
      return result
    } catch (error) {
      this.stats.postsFailed += 1
      throw error
    }
  }

  summary() {
    const line = `summary machines=${this.mappedMachines().length} posts_ok=${this.stats.postsOk} posts_fail=${this.stats.postsFailed}`
    this.logger.info(line)
    this.stats = { postsOk: 0, postsFailed: 0 }
    return line
  }

  #saveState() {
    return writeJsonAtomic(this.stateFile, this.state)
  }
}
