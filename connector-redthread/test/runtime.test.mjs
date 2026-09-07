import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { Runtime } from '../lib/runtime.mjs'

class FakeWebSocket extends EventEmitter {
  static instances = []

  constructor(url, protocols) {
    super()
    this.url = url
    this.protocols = protocols
    FakeWebSocket.instances.push(this)
  }

  close() {}
}

test('WS dùng bearer subprotocol và lúc đứt fallback poll bằng viewer Bearer', async () => {
  FakeWebSocket.instances = []
  const calls = []
  const connector = {
    init: async () => {}, heartbeat: async () => {}, replayQueue: async () => {}, summary: () => {},
    ingestFleet: async (machines) => calls.push({ machines }),
    ingestMessage: async () => {},
  }
  const runtime = new Runtime({
    connector,
    bridgeUrl: 'http://100.105.80.93:8790',
    bridgeToken: 'viewer-test-token',
    WebSocketImpl: FakeWebSocket,
    fetchImpl: async (url, options) => {
      calls.push({ url, authorization: options.headers.authorization })
      return { ok: true, json: async () => ({ machines: [{ identity: { id: 'm-1' } }] }) }
    },
    logger: { info() {}, warn() {}, error() {} },
  })
  await runtime.start()
  const socket = FakeWebSocket.instances[0]
  assert.equal(socket.url, 'ws://100.105.80.93:8790/ws')
  assert.deepEqual(socket.protocols, ['bearer', 'viewer-test-token'])

  socket.emit('close')
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls[0], {
    url: 'http://100.105.80.93:8790/api/v2/fleet',
    authorization: 'Bearer viewer-test-token',
  })
  assert.equal(calls[1].machines.length, 1)
  runtime.stop()
})
