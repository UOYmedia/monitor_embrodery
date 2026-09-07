import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Connector } from '../lib/connector.mjs'
import { RedThreadClient } from '../lib/redthread-client.mjs'

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').then(JSON.parse)

test('E2E local: 19 máy/heartbeat, event ngay, queue retry sau HTTP 500', async (t) => {
  const requests = []
  let failNextEvent = true
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      requests.push({ url: request.url, apiKey: request.headers['x-lan-api-key'], body: JSON.parse(body) })
      if (request.url.endsWith('/machine-events') && failNextEvent) {
        failNextEvent = false
        response.writeHead(500, { 'content-type': 'application/json' }).end('{}')
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))

  const directory = await mkdtemp(join(tmpdir(), 'redthread-e2e-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const client = new RedThreadClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'test-only-key' })
  const connector = new Connector({
    client,
    queueFile: join(directory, 'queue.jsonl'),
    stateFile: join(directory, 'state.json'),
    logger: { info() {}, warn() {}, error() {} },
  })
  await connector.init()
  const fleet = await fixture('fleet_state.json')
  await connector.ingestFleet(fleet.machines)
  await connector.heartbeat()

  const updateMessage = await fixture('machine_update.json')
  const update = structuredClone(updateMessage.machine)
  update.connection.state = 'online'
  const previous = fleet.machines.find((machine) => machine.identity.id === update.identity.id)
  const previousStatus = previous.telemetry.status.value
  update.telemetry.status.value = previousStatus === 'running' ? 'paused' : 'running'
  update.statusSince = { status: update.telemetry.status.value, at: '2026-09-07T03:41:00.000Z', approximate: false }
  await connector.ingestMachine(update)

  const queued = (await readFile(join(directory, 'queue.jsonl'), 'utf8')).trim().split('\n')
  assert.equal(queued.length, 1)
  assert.deepEqual(await connector.replayQueue(), { sent: 1, remaining: 0 })

  const heartbeat = requests.find((entry) => entry.url.endsWith('/heartbeat'))
  assert.equal(heartbeat.body.machines.length, 19)
  assert.equal(heartbeat.apiKey, 'test-only-key')
  const eventRequests = requests.filter((entry) => entry.url.endsWith('/machine-events'))
  assert.equal(eventRequests.length, 2)
  assert.equal(eventRequests[0].body.eventId, eventRequests[1].body.eventId)
  assert.ok(requests.every((entry) => entry.url.startsWith('/api/v1/lan/')))
})
