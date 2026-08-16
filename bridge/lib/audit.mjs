import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { redact } from './logger.mjs'

/**
 * Append-only audit trail, one JSON object per line.
 *
 * Entries are never edited or removed in place. When the file passes the configured size
 * it is rotated to a timestamped sibling, so retention becomes an explicit file-management
 * decision instead of a silent truncation.
 *
 * Retention xoá theo ngày (`prune`) **mặc định tắt**. Nhật ký kiểm toán mà tự nó rụng bớt
 * thì không còn là bằng chứng, nên việc xoá phải là một dòng người ta cố ý ghi vào
 * `bridge.config.json` chứ không phải một nút bấm trên màn hình. Khi có xoá, chính lần xoá
 * đó cũng được ghi lại thành một dòng audit.
 */
export class AuditLog {
  constructor(filePath, { logger, maxBytes = 8 * 1024 * 1024, retentionDays = null, now = () => Date.now() } = {}) {
    this.filePath = filePath
    this.logger = logger
    this.maxBytes = maxBytes
    /** `null` = giữ mãi. Chỉ số nguyên dương mới bật đường xoá. */
    this.retentionDays = retentionDays && retentionDays > 0 ? Math.floor(retentionDays) : null
    this.now = now
    this.queue = Promise.resolve()
  }

  /**
   * Records one attempted action. `result` distinguishes an allowed mutation from a
   * denied one, so a blocked Viewer attempt is still evidence rather than a silent drop.
   */
  record(entry) {
    const line = {
      id: randomUUID(),
      at: new Date(this.now()).toISOString(),
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
    const rotated = `${this.filePath}.${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}`
    await rename(this.filePath, rotated)
    this.logger?.info('Đã xoay vòng audit log.', { rotated })
  }

  /** Waits for every queued append; used by tests and by graceful shutdown. */
  async flush() { await this.queue }

  /** Read-only tail for the dashboard timeline. Never exposes a delete path. */
  async tail(options = {}) {
    const { entries } = await this.read(options)
    return entries
  }

  /**
   * Đọc ngược từ mới về cũ, đi qua cả các mảnh đã xoay vòng.
   *
   * Chỉ đọc mảnh đang ghi thì bản xuất ra sẽ *im lặng* cắt mất phần cũ đúng vào lúc người ta
   * cần nó nhất — sau một đợt xoay vòng. `truncated` nói ra khi còn mảnh chưa đọc tới, để
   * giao diện không trình bày một bản xuất thiếu như thể nó đầy đủ.
   */
  async read({
    limit = 100, targetId = null, targetPrefix = null, from = null, to = null,
    actor = null, action = null, result = null, maxSegments = 12,
  } = {}) {
    const segments = await this.segments()
    const scanned = segments.slice(0, Math.max(1, maxSegments))
    const fromMs = from ? Date.parse(from) : null
    const toMs = to ? Date.parse(to) : null
    const needle = (value) => (value ? String(value).toLowerCase() : null)
    const wantActor = needle(actor)
    const wantAction = needle(action)

    const entries = []
    for (const segment of scanned) {
      const rows = await this.readSegment(segment.name)
      // Trong một mảnh, dòng cuối là dòng mới nhất.
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        const entry = rows[index]
        if (targetId && entry.targetId !== targetId) continue
        // Máy `m-1` cũng là chủ của `m-1:alert:...`; lọc theo tiền tố ngay trong lúc đọc chứ
        // không cắt 100 dòng rồi mới lọc — cách sau trả về rỗng ở đội máy đông.
        if (targetPrefix && !String(entry.targetId ?? '').startsWith(targetPrefix)) continue
        if (result && entry.result !== result) continue
        if (wantActor && !String(entry.actor ?? '').toLowerCase().includes(wantActor)) continue
        if (wantAction && !String(entry.action ?? '').toLowerCase().includes(wantAction)) continue
        const atMs = Date.parse(entry.at)
        if (fromMs !== null && Number.isFinite(atMs) && atMs < fromMs) continue
        if (toMs !== null && Number.isFinite(atMs) && atMs > toMs) continue
        entries.push(entry)
        if (entries.length >= limit) {
          return { entries, truncated: true, scannedSegments: scanned.length, totalSegments: segments.length }
        }
      }
    }
    return {
      entries,
      truncated: scanned.length < segments.length,
      scannedSegments: scanned.length,
      totalSegments: segments.length,
    }
  }

  async readSegment(name) {
    const content = await readFile(join(dirname(this.filePath), name), 'utf8')
      .catch((error) => { if (error?.code === 'ENOENT') return ''; throw error })
    const rows = []
    for (const raw of content.split('\n')) {
      if (!raw.trim()) continue
      try {
        rows.push(JSON.parse(raw))
      } catch {
        // A partially flushed final line is skipped rather than failing the whole read.
      }
    }
    return rows
  }

  /**
   * Kiểm kê các mảnh nhật ký trên đĩa, mới nhất trước.
   *
   * Giao diện cần đúng thứ này để trả lời được câu "nhật ký còn giữ tới bao giờ" bằng số
   * liệu thật, thay vì bằng một câu hứa trong tài liệu.
   */
  async segments() {
    const dir = dirname(this.filePath)
    const base = basename(this.filePath)
    const names = await readdir(dir).catch((error) => { if (error?.code === 'ENOENT') return []; throw error })
    const rows = []
    for (const name of names) {
      if (name !== base && !name.startsWith(`${base}.`)) continue
      const info = await stat(join(dir, name)).catch(() => null)
      if (!info?.isFile()) continue
      const active = name === base
      rows.push({
        name,
        bytes: info.size,
        modifiedAt: info.mtime.toISOString(),
        rotatedAt: active ? null : (rotatedStamp(name, base) ?? info.mtime.toISOString()),
        active,
      })
    }
    return rows.sort((left, right) => {
      if (left.active !== right.active) return left.active ? -1 : 1
      return String(right.rotatedAt).localeCompare(String(left.rotatedAt))
    })
  }

  /** Chính sách đang có hiệu lực + hiện trạng đĩa, cho màn hình nhật ký kiểm toán. */
  async retention() {
    const segments = await this.segments()
    const totalBytes = segments.reduce((sum, segment) => sum + segment.bytes, 0)
    const rotated = segments.filter((segment) => !segment.active)
    const cutoff = this.retentionDays === null ? null : this.now() - this.retentionDays * 86_400_000
    return {
      maxBytes: this.maxBytes,
      retentionDays: this.retentionDays,
      segments,
      totalBytes,
      oldestAt: rotated.length ? rotated[rotated.length - 1].rotatedAt : null,
      // Mảnh sẽ bị xoá ở lần dọn tới — nói trước, để không ai mất dữ liệu vì bất ngờ.
      expiring: cutoff === null ? [] : rotated.filter((segment) => Date.parse(segment.rotatedAt) <= cutoff).map((segment) => segment.name),
    }
  }

  /**
   * Xoá các mảnh đã xoay vòng quá hạn giữ. Mảnh đang ghi không bao giờ bị đụng tới.
   *
   * Không cấu hình `retentionDays` thì hàm này không xoá gì — mặc định của một nhật ký kiểm
   * toán phải là giữ lại.
   */
  async prune() {
    if (this.retentionDays === null) return { removed: [], retentionDays: null }
    const run = this.queue.then(async () => {
      const cutoff = this.now() - this.retentionDays * 86_400_000
      const removed = []
      for (const segment of await this.segments()) {
        if (segment.active) continue
        if (Date.parse(segment.rotatedAt) > cutoff) continue
        await unlink(join(dirname(this.filePath), segment.name))
        removed.push({ name: segment.name, bytes: segment.bytes, rotatedAt: segment.rotatedAt })
      }
      return removed
    })
    this.queue = run.then(() => {}, () => {})
    const removed = await run

    if (removed.length) {
      this.logger?.info('Đã dọn nhật ký kiểm toán quá hạn.', { retentionDays: this.retentionDays, removed: removed.length })
      // Lần xoá cũng là một sự kiện cần kiểm toán: dòng này nằm lại trong mảnh đang ghi.
      this.record({
        actor: 'bridge', role: 'system', action: 'audit.retention.prune',
        targetType: 'audit-log', targetId: basename(this.filePath),
        after: { retentionDays: this.retentionDays, removed },
      })
    }
    return { removed, retentionDays: this.retentionDays }
  }
}

/** `audit-log.jsonl.2026-08-16T03-57-10-201Z` → `2026-08-16T03:57:10.201Z`. */
function rotatedStamp(name, base) {
  const suffix = name.slice(base.length + 1)
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(suffix)
  if (!match) return null
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`
}
