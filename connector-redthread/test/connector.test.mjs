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

// Fleet thật trên bridge 9/9: identity.id = "mch-<serial thường>" (có cả máy
// "mch-a15-mqtt" không theo dạng đó), serial trần nằm ở identity.serial.
// va-mau.out ghi serial trần (602602A6F22B) — sự cố 9/9 lần 2: tra map bằng
// serial nên miss 100%, cursor ăn hết backfill.
test('resolveExternalId tra theo identity.serial, không phụ thuộc dạng identity.id', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'redthread-serial-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const connector = new Connector({
    client: { event: async () => {}, heartbeat: async () => ({ accepted: 1 }) },
    queueFile: join(directory, 'queue.jsonl'),
    stateFile: join(directory, 'state.json'),
    logger: { info() {}, warn() {}, error() {} },
  })
  await connector.init()
  const real = {
    identity: { id: 'mch-602602a6f22b', name: 'Máy 01', serial: '602602A6F22B', assetTag: '602602A6F22B' },
    connection: { state: 'online' },
    statusSince: { status: 'running', at: '2026-09-09T03:00:00.000Z' },
    telemetry: { status: { value: 'running' }, rpm: null, job: { value: { fileName: 'A.DST', currentStitch: 1, totalStitches: 10 } }, events: [] },
  }
  const oddball = { ...real, identity: { id: 'mch-a15-mqtt', name: 'Gateway MQTT', serial: null, assetTag: null } }
  await connector.ingestFleet([real, oddball])

  assert.equal(connector.resolveExternalId('602602A6F22B'), 1)
  assert.equal(connector.resolveExternalId('602602a6f22b'), 1)
  assert.equal(connector.resolveExternalId('mch-602602a6f22b'), null)
  assert.equal(connector.resolveExternalId('DEADBEEF0000'), null)
  assert.equal(connector.resolveExternalId(''), null)
})
