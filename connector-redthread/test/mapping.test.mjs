import assert from 'node:assert/strict'
import test from 'node:test'
import { externalMachineId, mapMachine, stableEventId } from '../lib/mapping.mjs'

function machine({ status = 'running', connection = 'online', current = 10, total = 20, file = 'A.DST', events = [] } = {}) {
  return {
    identity: { id: 'bridge-7', name: 'Máy 07' },
    connection: { state: connection },
    statusSince: { status, at: '2026-09-07T03:40:00.000Z', approximate: false },
    telemetry: {
      status: { value: status },
      rpm: { value: 700 },
      job: { value: { fileName: file, currentStitch: current, totalStitches: total } },
      events,
    },
  }
}

test('suy trạng thái vận hành giống dashboard bridge', () => {
  assert.equal(mapMachine(machine({ status: 'running' })).status, 'RUNNING')
  assert.deepEqual(
    { status: mapMachine(machine({ status: 'fault', events: [
      { code: 'E12', severity: 'critical', occurredAt: '2026-09-07T03:39:00Z' },
      { code: 'WARN-LATER', severity: 'warning', occurredAt: '2026-09-07T03:40:00Z' },
    ] })).status,
      errorCode: mapMachine(machine({ status: 'fault', events: [
        { code: 'E12', severity: 'critical', occurredAt: '2026-09-07T03:39:00Z' },
        { code: 'WARN-LATER', severity: 'warning', occurredAt: '2026-09-07T03:40:00Z' },
      ] })).errorCode },
    { status: 'ERROR', errorCode: 'E12' },
  )
  assert.deepEqual(
    { status: mapMachine(machine({ status: 'stopped', current: 20, total: 20 })).status,
      note: mapMachine(machine({ status: 'stopped', current: 20, total: 20 })).statusNote },
    { status: 'COMPLETED', note: 'Xong mẫu A.DST' },
  )
  assert.equal(mapMachine(machine({ status: 'paused', current: 20, total: 20 })).status, 'COMPLETED')
  assert.equal(mapMachine(machine({ status: 'stopped', current: 10, total: 20 })).status, 'PAUSED')
  assert.equal(mapMachine(machine({ status: 'paused', current: 10, total: 20 })).status, 'PAUSED')
  assert.equal(mapMachine(machine({ status: 'stopped', current: 0, total: 20 })).status, 'IDLE')
  assert.equal(mapMachine(machine({ status: 'paused', current: 0, total: 0 })).status, 'IDLE')
  assert.equal(mapMachine(machine({ status: 'stopped', current: 10, total: null })).status, 'IDLE')
  assert.equal(mapMachine(machine({ status: 'paused', current: 10, total: 0 })).status, 'PAUSED')
  assert.equal(mapMachine(machine({ status: 'running', connection: 'stale' })).status, 'OFFLINE')
  assert.equal(mapMachine(machine({ status: 'running', connection: 'offline' })).status, 'OFFLINE')
  assert.equal(mapMachine(machine({ status: 'unknown' })).status, 'OFFLINE')
})

test('machine-map override thắng convention tên máy', () => {
  const value = machine()
  assert.equal(externalMachineId(value), 7)
  assert.equal(externalMachineId(value, { 'bridge-7': 42 }), 42)
})

test('rpm dạng số thập phân được làm tròn cho contract số nguyên của RedThread', () => {
  const value = machine()
  value.telemetry.rpm.value = 700.6
  assert.equal(mapMachine(value).rpm, 701)
})

test('eventId ổn định theo nội dung và đủ 64 ký tự', () => {
  const input = { externalMachineId: 7, fromStatus: 'IDLE', toStatus: 'RUNNING', occurredAt: '2026-09-07T03:40:00.000Z' }
  assert.equal(stableEventId(input), stableEventId({ ...input }))
  assert.equal(stableEventId(input).length, 64)
  assert.notEqual(stableEventId(input), stableEventId({ ...input, toStatus: 'ERROR' }))
})


test('repeats keep raw counters, infer items and never pretend a known full-frame total', () => {
  for (const status of ['running', 'stopped', 'paused', 'fault']) {
    const mapped = mapMachine(machine({ status, current: 34628, total: 3912 }))
    assert.equal(mapped.status, status === 'running' ? 'RUNNING' : status === 'fault' ? 'ERROR' : 'PAUSED')
    assert.equal(mapped.currentStitch, 34628)
    assert.equal(mapped.totalStitches, null)
    assert.match(mapped.statusNote, /8 items suy ra/)
    assert.match(mapped.statusNote, /chưa biết tổng khung/)
  }
  for (const [current, total] of [[1, 0], [-1, 5], ['10', 20], [10, -1], [NaN, 10]]) {
    const mapped = mapMachine(machine({ current, total }))
    assert.equal(mapped.currentStitch, null)
    assert.equal(mapped.totalStitches, null)
  }
  for (const connection of ['stale', 'unknown', 'offline']) {
    const mapped = mapMachine(machine({ connection, current: 34628, total: 3912 }))
    assert.equal(mapped.status, 'OFFLINE')
    assert.equal(mapped.currentStitch, null)
  }
  assert.equal(mapMachine(machine({ current: 0, total: 0 })).currentStitch, 0)
  assert.equal(mapMachine(machine({ current: 3, total: null })).totalStitches, null)
})


test('floor item inference handles residual stitches, exact multiple, reset and stale data', () => {
  for (const [current, count] of [[46966, 12], [46944, 12], [34628, 8], [3913, 1]]) {
    for (const status of ['running', 'stopped']) {
      const m = mapMachine(machine({ status, current, total: 3912 }))
      assert.equal(m.currentStitch, current)
      assert.equal(m.totalStitches, null)
      assert.equal(m.status, status === 'running' ? 'RUNNING' : 'PAUSED')
      assert.match(m.statusNote, new RegExp(`${count} items suy ra`))
    }
  }
  const reset = mapMachine(machine({ status: 'stopped', current: 0, total: 7000, file: 'B.DST' }))
  assert.equal(reset.status, 'IDLE')
  assert.equal(reset.statusNote, '')
  assert.equal(reset.totalStitches, 7000)
  for (const connection of ['stale', 'offline', 'unknown']) {
    assert.equal(mapMachine(machine({ current: 46966, total: 3912, connection })).statusNote, '')
  }
})
