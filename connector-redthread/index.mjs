import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Connector, readMachineMap } from './lib/connector.mjs'
import { EventQueue } from './lib/json-store.mjs'
import { RedThreadClient } from './lib/redthread-client.mjs'
import { RepairTailer } from './lib/repair-tailer.mjs'
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
const client = new RedThreadClient({
  baseUrl: required('REDTHREAD_URL'),
  apiKey: required('REDTHREAD_LAN_API_KEY'),
})
const connector = new Connector({
  client,
  queueFile: join(directory, 'data', 'queue.jsonl'),
  stateFile: join(directory, 'data', 'state.json'),
  machineMap,
})
const repairTailer = new RepairTailer({
  filePath: process.env.VA_MAU_PATH?.trim() || '/Users/phong/dahao-gateway/logs/va-mau.out',
  client,
  queue: new EventQueue(join(directory, 'data', 'repair-queue.jsonl')),
  getState: () => connector.state,
  saveState: () => connector.persistState(),
  resolveExternalId: (serial) => connector.resolveExternalId(serial),
  fleetReady: () => connector.machines.size > 0,
})
const runtime = new Runtime({
  connector,
  repairTailer,
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
