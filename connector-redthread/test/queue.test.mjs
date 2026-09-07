import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { EventQueue } from '../lib/json-store.mjs'

test('queue replay đúng thứ tự và giữ phần còn lại khi lỗi', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'redthread-queue-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'queue.jsonl')
  const queue = new EventQueue(file)
  await queue.append({ eventId: 'one' })
  await queue.append({ eventId: 'two' })

  const firstPass = []
  assert.deepEqual(await queue.replay(async (event) => {
    firstPass.push(event.eventId)
    if (event.eventId === 'two') throw new Error('offline')
  }), { sent: 1, remaining: 1 })
  assert.deepEqual(firstPass, ['one', 'two'])

  const secondPass = []
  assert.deepEqual(await queue.replay(async (event) => secondPass.push(event.eventId)), { sent: 1, remaining: 0 })
  assert.deepEqual(secondPass, ['two'])
  assert.equal(await readFile(file, 'utf8'), '')
})
