import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Connector } from '../lib/connector.mjs'

function bridgeMachine(status = 'running') {
  return {
    identity: { id: 'm-1', name: 'Máy 01' },
    connection: { state: 'online' },
    statusSince: { status, at: '2026-09-07T04:00:00.000Z' },
    telemetry: { status: { value: status }, rpm: null, job: { value: { fileName: 'A.DST', currentStitch: 1, totalStitches: 10 } }, events: [] },
  }
}

test('gap healing tạo RUNNING→OFFLINE rồi OFFLINE→trạng thái hiện tại', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'redthread-gap-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const stateFile = join(directory, 'state.json')
  await writeFile(stateFile, JSON.stringify({ lastPushAt: '2026-09-07T03:50:00.000Z', statuses: { 1: 'RUNNING' } }))
  const events = []
  const client = { event: async (event) => events.push(event), heartbeat: async () => ({ accepted: 1 }) }
  const connector = new Connector({
    client,
    queueFile: join(directory, 'queue.jsonl'),
    stateFile,
    now: () => new Date('2026-09-07T04:00:01.000Z'),
    logger: { info() {}, warn() {}, error() {} },
  })
  await connector.init()
  await connector.ingestFleet([bridgeMachine('paused')])

  assert.deepEqual(events.map(({ fromStatus, toStatus, occurredAt }) => ({ fromStatus, toStatus, occurredAt })), [
    { fromStatus: 'RUNNING', toStatus: 'OFFLINE', occurredAt: '2026-09-07T03:50:00.000Z' },
    { fromStatus: 'OFFLINE', toStatus: 'PAUSED', occurredAt: '2026-09-07T04:00:01.000Z' },
  ])
})
