import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Connector, readMachineMap } from './lib/connector.mjs'
import { RedThreadClient } from './lib/redthread-client.mjs'
import { Runtime } from './lib/runtime.mjs'

const directory = dirname(fileURLToPath(import.meta.url))

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Thiếu biến môi trường ${name}`)
  return value
}

const heartbeatMs = Number(process.env.HEARTBEAT_INTERVAL_MS ?? 30_000)
if (!Number.isInteger(heartbeatMs) || heartbeatMs < 1_000) throw new Error('HEARTBEAT_INTERVAL_MS phải là số nguyên >= 1000')

const machineMap = await readMachineMap(join(directory, 'machine-map.json'))
const connector = new Connector({
  client: new RedThreadClient({
    baseUrl: required('REDTHREAD_URL'),
    apiKey: required('REDTHREAD_LAN_API_KEY'),
  }),
  queueFile: join(directory, 'data', 'queue.jsonl'),
  stateFile: join(directory, 'data', 'state.json'),
  machineMap,
})
const runtime = new Runtime({
  connector,
  bridgeUrl: required('BRIDGE_URL'),
  bridgeToken: required('BRIDGE_TOKEN_VIEWER'),
  heartbeatMs,
})

await runtime.start()
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    runtime.stop()
    process.exit(0)
  })
}
