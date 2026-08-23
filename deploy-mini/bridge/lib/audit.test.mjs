import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditLog } from './audit.mjs'

let dir

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'audit-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const day = 86_400_000

/** Nhật ký với đồng hồ giả, để kiểm được hạn giữ mà không phải chờ hết ngày. */
function makeLog(options = {}) {
  const clock = { at: Date.parse('2026-08-16T02:00:00.000Z') }
  const log = new AuditLog(join(dir, 'audit-log.jsonl'), { now: () => clock.at, ...options })
  return { log, clock }
}

/** Một mảnh đã xoay vòng, đặt tên đúng như `rotateIfNeeded` đặt. */
async function writeRotated(stamp, lines) {
  const name = `audit-log.jsonl.${stamp.replace(/[:.]/g, '-')}`
  await writeFile(join(dir, name), `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8')
  return name
}

describe('read', () => {
  it('walks past a rotation, so an export does not stop at the newest file', async () => {
    await writeRotated('2026-08-01T00:00:00.000Z', [
      { id: 'a', at: '2026-07-31T09:00:00.000Z', actor: 'ktv.an', action: 'machine.pair', targetId: 'm-1', result: 'allowed' },
    ])
    const { log } = makeLog()
    log.record({ actor: 'ktv.binh', action: 'machine.archive', targetId: 'm-2' })
    await log.flush()

    const { entries } = await log.read({ limit: 10 })
    // Mới nhất trước, và dòng nằm ở mảnh cũ vẫn phải có mặt.
    expect(entries.map((entry) => entry.action)).toEqual(['machine.archive', 'machine.pair'])
  })

  it('says when it stopped early, instead of handing back a short list as if it were complete', async () => {
    const { log } = makeLog()
    log.record({ actor: 'a', action: 'one' })
    log.record({ actor: 'b', action: 'two' })
    await log.flush()

    expect(await log.read({ limit: 2 })).toMatchObject({ truncated: true })
    expect(await log.read({ limit: 50 })).toMatchObject({ truncated: false })
  })

  it('filters by time, actor, action and result', async () => {
    const { log, clock } = makeLog()
    log.record({ actor: 'ktv.an', action: 'machine.pair', targetId: 'm-1' })
    clock.at += 2 * day
    log.record({ actor: 'to.truong.hoa', action: 'machine.archive', targetId: 'm-2', result: 'denied' })
    await log.flush()

    expect((await log.read({ actor: 'AN' })).entries.map((entry) => entry.action)).toEqual(['machine.pair'])
    expect((await log.read({ action: 'archive' })).entries).toHaveLength(1)
    expect((await log.read({ result: 'denied' })).entries.map((entry) => entry.actor)).toEqual(['to.truong.hoa'])
    expect((await log.read({ from: '2026-08-17T00:00:00.000Z' })).entries).toHaveLength(1)
    expect((await log.read({ to: '2026-08-16T12:00:00.000Z' })).entries.map((entry) => entry.actor)).toEqual(['ktv.an'])
  })

  it('keeps a machine tab intact when the fleet is busy: it filters while reading, not after', async () => {
    const { log } = makeLog()
    log.record({ actor: 'ktv.an', action: 'machine.pair', targetId: 'm-1' })
    for (let index = 0; index < 20; index += 1) log.record({ actor: 'bridge', action: 'machine.note', targetId: 'm-9' })
    await log.flush()

    const { entries } = await log.read({ limit: 5, targetPrefix: 'm-1' })
    expect(entries.map((entry) => entry.targetId)).toEqual(['m-1'])
  })

  it('skips a half-written final line rather than failing the whole read', async () => {
    const { log } = makeLog()
    log.record({ actor: 'ktv.an', action: 'machine.pair' })
    await log.flush()
    await writeFile(join(dir, 'audit-log.jsonl'), '{"id":"broken"', { flag: 'a' })

    expect((await log.read({})).entries.map((entry) => entry.action)).toEqual(['machine.pair'])
  })
})

describe('tail', () => {
  it('still returns a plain array, because the dashboard timeline reads it that way', async () => {
    const { log } = makeLog()
    log.record({ actor: 'ktv.an', action: 'machine.pair' })
    await log.flush()
    expect(Array.isArray(await log.tail({ limit: 5 }))).toBe(true)
  })
})

describe('retention', () => {
  it('reports keep-forever when nobody configured a limit', async () => {
    const { log } = makeLog()
    log.record({ actor: 'ktv.an', action: 'machine.pair' })
    await log.flush()

    const info = await log.retention()
    expect(info.retentionDays).toBeNull()
    expect(info.expiring).toEqual([])
    expect(info.totalBytes).toBeGreaterThan(0)
    expect(info.segments.filter((segment) => segment.active)).toHaveLength(1)
  })

  it('names the segments that the next prune will delete, before it deletes them', async () => {
    const old = await writeRotated('2026-01-01T00:00:00.000Z', [{ id: 'x', at: '2026-01-01T00:00:00.000Z', action: 'old' }])
    await writeRotated('2026-08-10T00:00:00.000Z', [{ id: 'y', at: '2026-08-10T00:00:00.000Z', action: 'recent' }])
    const { log } = makeLog({ retentionDays: 90 })

    expect((await log.retention()).expiring).toEqual([old])
  })
})

describe('prune', () => {
  it('deletes nothing at all when retention is not configured', async () => {
    await writeRotated('2020-01-01T00:00:00.000Z', [{ id: 'x', at: '2020-01-01T00:00:00.000Z', action: 'old' }])
    const { log } = makeLog()

    expect(await log.prune()).toEqual({ removed: [], retentionDays: null })
    expect(await readdir(dir)).toHaveLength(1)
  })

  it('removes expired rotated segments and leaves the active file alone', async () => {
    await writeRotated('2026-01-01T00:00:00.000Z', [{ id: 'x', at: '2026-01-01T00:00:00.000Z', action: 'old' }])
    await writeRotated('2026-08-10T00:00:00.000Z', [{ id: 'y', at: '2026-08-10T00:00:00.000Z', action: 'recent' }])
    const { log } = makeLog({ retentionDays: 90 })
    log.record({ actor: 'ktv.an', action: 'machine.pair' })
    await log.flush()

    const { removed } = await log.prune()
    expect(removed.map((segment) => segment.rotatedAt)).toEqual(['2026-01-01T00:00:00.000Z'])
    await log.flush()

    const names = await readdir(dir)
    expect(names).toContain('audit-log.jsonl')
    expect(names.some((name) => name.includes('2026-08-10'))).toBe(true)
    expect(names.some((name) => name.includes('2026-01-01'))).toBe(false)
  })

  /**
   * Xoá bằng chứng mà không để lại dấu vết thì bản thân việc xoá trở thành lỗ hổng: đọc
   * nhật ký sau đó sẽ thấy một khoảng trống không giải thích được.
   */
  it('records its own deletion in the log it just trimmed', async () => {
    await writeRotated('2026-01-01T00:00:00.000Z', [{ id: 'x', at: '2026-01-01T00:00:00.000Z', action: 'old' }])
    const { log } = makeLog({ retentionDays: 90 })

    await log.prune()
    await log.flush()

    const [entry] = (await log.read({ limit: 1 })).entries
    expect(entry.action).toBe('audit.retention.prune')
    expect(entry.after.removed).toHaveLength(1)
  })
})
