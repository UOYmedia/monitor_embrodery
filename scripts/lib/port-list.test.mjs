import { describe, expect, it } from 'vitest'
import { parsePorts } from './port-list.mjs'

describe('parsePorts', () => {
  it('một cổng đơn trả về đúng một cổng', () => {
    expect(parsePorts('1600')).toEqual([1600])
  })

  it('danh sách được sắp xếp và bỏ trùng', () => {
    expect(parsePorts('1600,80,1600,443')).toEqual([80, 443, 1600])
  })

  it('khoảng lấy cả hai đầu', () => {
    expect(parsePorts('1598-1601')).toEqual([1598, 1599, 1600, 1601])
  })

  it('trộn khoảng với cổng đơn, phần chồng nhau chỉ tính một lần', () => {
    expect(parsePorts('1600,1599-1601,53')).toEqual([53, 1599, 1600, 1601])
  })

  it('đúng khoảng C41 mà màn hình HMI ghi là hợp lệ', () => {
    const ports = parsePorts('1-3865')
    expect(ports.length).toBe(3865)
    expect(ports[0]).toBe(1)
    expect(ports.at(-1)).toBe(3865)
  })

  it('bỏ qua khoảng trắng quanh dấu phẩy và dấu gạch', () => {
    expect(parsePorts(' 80 , 1600 - 1602 ')).toEqual([80, 1600, 1601, 1602])
  })

  it('khoảng ngược đầu bị từ chối chứ không âm thầm đảo lại', () => {
    expect(() => parsePorts('1700-1600')).toThrow(/backwards/)
  })

  it('cổng 0 và 65536 đều ngoài khoảng', () => {
    expect(() => parsePorts('0')).toThrow(/outside/)
    expect(() => parsePorts('65536')).toThrow(/outside/)
  })

  it('chuỗi không phải số bị từ chối, không lặng lẽ thành NaN', () => {
    expect(() => parsePorts('1600a')).toThrow(/not a port number/)
    expect(() => parsePorts('abc')).toThrow(/not a port number/)
  })

  it('chuỗi rỗng hoặc chỉ có dấu phẩy bị từ chối', () => {
    expect(() => parsePorts('')).toThrow(/no port given/)
    expect(() => parsePorts(' , , ')).toThrow(/no port given/)
  })
})
