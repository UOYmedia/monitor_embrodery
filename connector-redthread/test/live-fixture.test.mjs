import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { mapMachine } from '../lib/mapping.mjs'

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').then(JSON.parse)

test('parse fleet_state và machine_update capture từ bridge sống', async () => {
  const fleet = await fixture('fleet_state.json')
  const update = await fixture('machine_update.json')
  assert.equal(fleet.type, 'fleet_state')
  assert.equal(fleet.machines.length, 19)
  assert.equal(fleet.machines.map(mapMachine).filter(Boolean).length, 19)
  assert.equal(update.type, 'machine_update')
  assert.equal(mapMachine(update.machine).externalMachineId, 8)
})
