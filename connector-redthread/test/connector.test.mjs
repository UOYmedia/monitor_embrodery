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


test('counter resets survive transient overrun, restart, partial rejection and failure before valid recovery', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'redthread-counter-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let reply = { accepted: 1, machines: [{ externalMachineId: 1 }] }
  const posts = []
  const client = { event: async () => {}, heartbeat: async (machines) => { posts.push(machines); if (reply instanceof Error) throw reply; return reply } }
  const options = { client, queueFile: join(directory, 'q.jsonl'), stateFile: join(directory, 's.json'), logger: { info() {}, warn() {}, error() {} } }
  let connector = new Connector(options)
  await connector.init()
  await connector.ingestFleet([bridgeMachine()])
  await connector.heartbeat()
  assert.equal(posts.at(-1)[0].currentStitch, null, 'first startup clears pre-fix remote baseline')
  await connector.heartbeat()
  assert.equal(posts.at(-1)[0].currentStitch, 1)
  const bad = bridgeMachine()
  bad.telemetry.job.value.currentStitch = 50
  await connector.ingestMachine(bad)
  const good = bridgeMachine()
  good.telemetry.job.value.currentStitch = 8
  await connector.ingestMachine(good)
  reply = new Error('network failed')
  await assert.rejects(connector.heartbeat(), /network failed/)
  assert.equal(posts.at(-1)[0].currentStitch, null)
  connector = new Connector(options)
  await connector.init()
  await connector.ingestFleet([good])
  reply = { accepted: 1, machines: [{ externalMachineId: 2 }], rejected: [{ externalMachineId: 1 }] }
  await connector.heartbeat()
  assert.ok(connector.state.counterResets['1'])
  reply = { accepted: 1 }
  await connector.heartbeat()
  assert.ok(connector.state.counterResets['1'], 'ambiguous 200 is not a reset acknowledgement')
  reply = { accepted: 1, machines: [{ externalMachineId: 1 }] }
  await connector.heartbeat()
  assert.equal(posts.at(-1)[0].currentStitch, null)
  assert.equal(connector.state.counterResets['1'], undefined)
  await connector.heartbeat()
  assert.equal(posts.at(-1)[0].currentStitch, 8)
  await connector.noteBridgeGap()
  await connector.heartbeat()
  await connector.heartbeat()
  assert.equal(posts.at(-1)[0].currentStitch, null, 'cached counters stay suppressed throughout link loss')
  await connector.ingestFleet([good])
  await connector.heartbeat()
  assert.equal(posts.at(-1)[0].currentStitch, null, 'fresh reconnect also resets baseline')
  await connector.heartbeat()
  assert.equal(posts.at(-1)[0].currentStitch, 8)
})

test('OFFLINE recovery uses receipt time and retains it in heartbeat after restart', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'redthread-recovery-time-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const events = [], posts = []
  const now = '2026-09-28T03:51:00.000Z'
  const options = { client: { event: async (e) => events.push(e), heartbeat: async (ms) => { posts.push(ms); return { machines: [{ externalMachineId: 1 }] } } }, queueFile: join(directory, 'q.jsonl'), stateFile: join(directory, 's.json'), now: () => new Date(now), logger: { info() {}, warn() {}, error() {} } }
  let connector = new Connector(options)
  await connector.init()
  const offline = bridgeMachine('paused')
  offline.connection.state = 'unknown'
  await connector.ingestFleet([offline])
  await connector.ingestMachine(bridgeMachine('paused'))
  assert.equal(events.at(-1).occurredAt, now)
  await connector.heartbeat()
  assert.equal(posts.at(-1)[0].statusSince, now)
  connector = new Connector(options)
  await connector.init()
  await connector.ingestFleet([bridgeMachine('paused')])
  await connector.heartbeat()
  assert.equal(posts.at(-1)[0].statusSince, now)
})


test('a missing total preserves valid current counters; a missing current clears the baseline', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'redthread-null-total-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const posts = []
  const connector = new Connector({ client: { event: async () => {}, heartbeat: async (ms) => { posts.push(ms); return { machines: [{ externalMachineId: 1 }] } } }, queueFile: join(directory, 'q'), stateFile: join(directory, 's'), logger: { info() {}, warn() {}, error() {} } })
  await connector.init()
  const m = bridgeMachine()
  m.telemetry.job.value.totalStitches = null
  await connector.ingestFleet([m])
  await connector.heartbeat() // initial reset acknowledgement
  m.telemetry.job.value.currentStitch = 2
  await connector.ingestMachine(structuredClone(m))
  await connector.heartbeat()
  assert.equal(posts.at(-1)[0].currentStitch, 2)
  assert.equal(posts.at(-1)[0].totalStitches, null)
  m.telemetry.job.value.currentStitch = null
  await connector.ingestMachine(structuredClone(m))
  m.telemetry.job.value.currentStitch = 9
  await connector.ingestMachine(structuredClone(m))
  await connector.heartbeat()
  assert.equal(posts.at(-1)[0].currentStitch, null)
  await connector.heartbeat()
  assert.equal(posts.at(-1)[0].currentStitch, 9)
})
