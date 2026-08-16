import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, stat, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { redact } from './logger.mjs'

/**
 * Append-only audit trail, one JSON object per line.
 *
 * Entries are never edited or removed in place. When the file passes the configured size
 * it is rotated to a timestamped sibling, so retention becomes an explicit file-management
 * decision instead of a silent truncation.
 */
export class AuditLog {
  constructor(filePath, { logger, maxBytes = 8 * 1024 * 1024 } = {}) {
    this.filePath = filePath
    this.logger = logger
    this.maxBytes = maxBytes
    this.queue = Promise.resolve()
  }

  /**
   * Records one attempted action. `result` distinguishes an allowed mutation from a
   * denied one, so a blocked Viewer attempt is still evidence rather than a silent drop.
   */
  record(entry) {
    const line = {
      id: randomUUID(),
      at: new Date().toISOString(),
      actor: entry.actor ?? 'unknown',
      role: entry.role ?? 'unknown',
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      result: entry.result ?? 'allowed',
      correlationId: entry.correlationId ?? null,
      remote: entry.remote ?? null,
      message: entry.message ?? null,
      before: entry.before === undefined ? null : redact(entry.before),
      after: entry.after === undefined ? null : redact(entry.after),
    }
    // Serialise appends so two concurrent mutations cannot interleave a partial line.
    this.queue = this.queue.then(() => this.append(line)).catch((error) => {
      this.logger?.error('Không ghi được audit log.', { reason: error.message, action: line.action })
    })
    return line
  }

  async append(line) {
    await mkdir(dirname(this.filePath), { recursive: true })
    await this.rotateIfNeeded()
    await appendFile(this.filePath, `${JSON.stringify(line)}\n`, 'utf8')
  }

  async rotateIfNeeded() {
    const info = await stat(this.filePath).catch((error) => { if (error?.code === 'ENOENT') return null; throw error })
    if (!info || info.size < this.maxBytes) return
    const rotated = `${this.filePath}.${new Date().toISOString().replace(/[:.]/g, '-')}`
    await rename(this.filePath, rotated)
    this.logger?.info('Đã xoay vòng audit log.', { rotated })
  }

  /** Waits for every queued append; used by tests and by graceful shutdown. */
  async flush() { await this.queue }

  /** Read-only tail for the dashboard timeline. Never exposes a delete path. */
  async tail({ limit = 100, targetId = null } = {}) {
    const content = await readFile(this.filePath, 'utf8').catch((error) => { if (error?.code === 'ENOENT') return ''; throw error })
    const entries = []
    for (const raw of content.split('\n')) {
      if (!raw.trim()) continue
      try {
        const parsed = JSON.parse(raw)
        if (targetId && parsed.targetId !== targetId) continue
        entries.push(parsed)
      } catch {
        // A partially flushed final line is skipped rather than failing the whole read.
      }
    }
    return entries.slice(-limit).reverse()
  }
}
