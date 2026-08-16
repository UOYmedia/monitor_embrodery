import { describe, expect, it } from 'vitest'
import { applyMachineRemoval, applyMachineUpdate, fleetToMap } from './machineSocket'
import { makeMachine } from '../test/factories'

const fleet = Array.from({ length: 100 }, (_, index) => makeMachine({ id: `m${index}` }))

describe('áp delta của WebSocket', () => {
  it('chỉ thay đúng một máy, 99 máy còn lại giữ nguyên tham chiếu', () => {
    const map = fleetToMap(fleet)
    const changed = { ...fleet[7], connection: { ...fleet[7].connection, state: 'stale' as const } }
    const next = applyMachineUpdate(map, changed)

    expect(next.size).toBe(100)
    expect(next.get('m7')).toBe(changed)
    const identical = fleet.filter((machine) => next.get(machine.identity.id) === machine)
    expect(identical).toHaveLength(99)
  })

  it('thêm máy mới mà không đụng máy cũ', () => {
    const map = fleetToMap(fleet.slice(0, 2))
    const next = applyMachineUpdate(map, makeMachine({ id: 'moi' }))
    expect(next.size).toBe(3)
    expect(next.get('m0')).toBe(map.get('m0'))
  })

  it('không tạo Map mới khi máy cần xoá không tồn tại', () => {
    const map = fleetToMap(fleet.slice(0, 3))
    expect(applyMachineRemoval(map, 'không-có')).toBe(map)
  })

  it('xoá máy đã lưu trữ hoặc gỡ ghép khỏi bản đồ', () => {
    const map = fleetToMap(fleet.slice(0, 3))
    const next = applyMachineRemoval(map, 'm1')
    expect(next.has('m1')).toBe(false)
    expect(next.size).toBe(2)
    expect(map.size).toBe(3) // bản gốc không bị sửa tại chỗ
  })

  it('fleetToMap khoá theo id định danh', () => {
    const map = fleetToMap(fleet)
    expect([...map.keys()].slice(0, 3)).toEqual(['m0', 'm1', 'm2'])
  })
})
