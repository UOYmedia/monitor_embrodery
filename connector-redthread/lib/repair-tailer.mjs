import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import { HttpError } from './redthread-client.mjs'

// eventId ổn định theo episode (serial + lúc mở episode) — đọc lại file bao
// nhiêu lần cũng ra cùng id, BE idempotent theo (workspace, eventId).
export function repairEventId(serial, tuLuc) {
  return createHash('sha256').update(`nghi-dut-chi|${serial}|${tuLuc}`).digest('hex')
}

export function repairPayload(line, externalMachineId) {
  return {
    eventId: repairEventId(line.may, line.tu_luc),
    externalMachineId,
    occurredAt: line.at,
    backSteps: line.lui,
    stopSeconds: Math.round(line.giay),
    stitchAt: Number.isFinite(line.mui) ? line.mui : 0,
    totalStitches: Number.isFinite(line.tong) ? line.tong : 0,
    fileName: typeof line.mau === 'string' ? line.mau : '',
    reasonText: typeof line.y_nghia === 'string' ? line.y_nghia : '',
  }
}

// 4xx (trừ 408/429) là từ chối vĩnh viễn — retry mãi cũng vậy, mà queue replay
// dừng ở event lỗi đầu tiên nên một event 400 kẹt sẽ chặn cả hàng đợi phía sau.
function isPermanentReject(error) {
  return error instanceof HttpError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429
}

export class RepairTailer {
  // sendBudget: trần số POST mỗi tick. Backfill nguyên file (~vài nghìn event)
  // trong MỘT tick sẽ chiếm operationChain nhiều phút liền — heartbeat bị nghẽn
  // quá ngưỡng sweeper (~3 phút) là máy bị đánh OFFLINE oan. Chia nhỏ mỗi tick
  // ≤200 event thì backfill xong trong ~10 phút mà heartbeat vẫn đều nhịp.
  constructor({ filePath, client, queue, getState, saveState, resolveExternalId, logger = console, sendBudget = 200 }) {
    this.filePath = filePath
    this.client = client
    this.queue = queue
    this.getState = getState
    this.saveState = saveState
    this.resolveExternalId = resolveExternalId
    this.logger = logger
    this.sendBudget = sendBudget
    this.warnedSerials = new Set()
    this.warnedMissing = false
  }

  async tick() {
    const state = this.getState()
    const read = await this.#readNewBytes(state)
    if (!read) return { sent: 0 }

    const lines = read.text.split('\n')
    lines.pop() // phần tử rỗng sau newline cuối
    let consumed = 0
    let sent = 0
    for (const line of lines) {
      if (sent >= this.sendBudget) break
      consumed += Buffer.byteLength(line, 'utf8') + 1
      const event = this.#parse(line, state)
      if (!event) continue
      await this.#send(event)
      sent += 1
    }
    state.repairCursor = read.cursor + consumed
    await this.saveState()
    if (sent > 0) this.logger.info(`Repair tailer: xử lý ${sent} event vá, cursor ${state.repairCursor}`)
    return { sent }
  }

  replayQueue() {
    return this.queue.replay(async (event) => {
      try {
        await this.client.repair(event)
      } catch (error) {
        if (isPermanentReject(error)) {
          this.logger.error(`Repair ${event.eventId} trong queue bị từ chối (HTTP ${error.status}) — bỏ`)
          return
        }
        throw error
      }
    })
  }

  async #readNewBytes(state) {
    let size
    try {
      size = (await stat(this.filePath)).size
    } catch (error) {
      if (error?.code === 'ENOENT') {
        if (!this.warnedMissing) {
          this.warnedMissing = true
          this.logger.warn(`Không thấy file vá ${this.filePath} — bỏ qua tới khi file xuất hiện`)
        }
        return null
      }
      throw error
    }
    this.warnedMissing = false

    let cursor = Number.isInteger(state.repairCursor) && state.repairCursor >= 0 ? state.repairCursor : 0
    if (size < cursor) {
      this.logger.warn(`File vá bị xoay (size ${size} < cursor ${cursor}) — đọc lại từ đầu`)
      cursor = 0
    }
    if (size === cursor) return null

    const handle = await open(this.filePath, 'r')
    try {
      const buffer = Buffer.alloc(size - cursor)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, cursor)
      const chunk = buffer.subarray(0, bytesRead)
      // Dòng cuối chưa có newline = classifier đang ghi dở — để lại, tick sau đọc tiếp.
      const lastNewline = chunk.lastIndexOf(0x0a)
      if (lastNewline === -1) return null
      return { cursor, text: chunk.subarray(0, lastNewline + 1).toString('utf8') }
    } finally {
      await handle.close()
    }
  }

  #parse(raw, state) {
    const trimmed = raw.trim()
    if (!trimmed) return null
    let line
    try {
      line = JSON.parse(trimmed)
    } catch {
      this.logger.warn(`Dòng vá hỏng, bỏ qua: ${trimmed.slice(0, 120)}`)
      return null
    }
    if (line?.viec !== 'dong' || line?.nghi !== 'nghi-dut-chi') return null
    const serial = String(line.may ?? '')
    if (!serial || typeof line.tu_luc !== 'string' || typeof line.at !== 'string') {
      this.logger.warn(`Dòng vá thiếu may/tu_luc/at, bỏ qua: ${trimmed.slice(0, 120)}`)
      return null
    }
    // BE từ chối backSteps <= 0 (400 vĩnh viễn) — chặn từ nguồn.
    if (!Number.isFinite(line.lui) || line.lui <= 0) {
      this.logger.warn(`Dòng vá có lui=${line.lui} không hợp lệ, bỏ qua (${serial} ${line.tu_luc})`)
      return null
    }
    const externalId = this.#resolveSerial(serial, state)
    if (externalId === null) return null
    return repairPayload(line, externalId)
  }

  // Map serial → externalMachineId qua fleet đang sống; kết quả cache vào state
  // để backfill vẫn map được khi máy tạm vắng khỏi fleet (mini vừa khởi động).
  #resolveSerial(serial, state) {
    const resolved = this.resolveExternalId(serial)
    if (Number.isInteger(resolved) && resolved > 0) {
      if (state.repairSerials[serial] !== resolved) state.repairSerials[serial] = resolved
      return resolved
    }
    const cached = state.repairSerials?.[serial]
    if (Number.isInteger(cached) && cached > 0) return cached
    if (!this.warnedSerials.has(serial)) {
      this.warnedSerials.add(serial)
      this.logger.warn(`Bỏ qua repair máy chưa map được serial: ${serial}`)
    }
    return null
  }

  async #send(event) {
    try {
      await this.client.repair(event)
    } catch (error) {
      if (isPermanentReject(error)) {
        this.logger.error(`Repair ${event.eventId} bị từ chối (HTTP ${error.status}) — bỏ, không retry`)
        return
      }
      await this.queue.append(event)
      this.logger.error(`Queue repair ${event.eventId}: ${error.message}`)
    }
  }
}
