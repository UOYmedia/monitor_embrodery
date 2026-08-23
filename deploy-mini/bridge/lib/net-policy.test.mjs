import { describe, expect, it } from 'vitest'
import { assertAllowedTarget, assertScannableCidr, cidrContainsAddress, classifyAddress, hostsFromCidr, normalizeMac, parseCidr } from './net-policy.mjs'

const sites = [
  { id: 'hn-1', name: 'Xưởng Hà Nội', allowedCidrs: ['192.168.10.0/24'] },
  { id: 'hcm-1', name: 'Xưởng HCM', allowedCidrs: ['10.20.0.0/22'] },
]

describe('parseCidr', () => {
  it('normalizes to the network address and rejects malformed input', () => {
    expect(parseCidr('192.168.10.37/24').cidr).toBe('192.168.10.0/24')
    expect(() => parseCidr('192.168.10.0/33')).toThrow(/CIDR không hợp lệ/)
    expect(() => parseCidr('192.168.10.0')).toThrow(/CIDR không hợp lệ/)
    expect(() => parseCidr('nope')).toThrow(/CIDR không hợp lệ/)
  })
})

describe('classifyAddress', () => {
  it('blocks the address families a scanner must never touch', () => {
    for (const address of ['0.0.0.0', '169.254.10.1', '224.0.0.251', '240.0.0.1', '255.255.255.255']) {
      expect(classifyAddress(address).allowed).toBe(false)
    }
  })

  it('keeps loopback and public ranges opt-in', () => {
    expect(classifyAddress('127.0.0.1').allowed).toBe(false)
    expect(classifyAddress('127.0.0.1', { allowLoopback: true }).allowed).toBe(true)
    expect(classifyAddress('8.8.8.8').allowed).toBe(false)
    expect(classifyAddress('8.8.8.8', { allowPublicRanges: true }).allowed).toBe(true)
    expect(classifyAddress('192.168.10.20').allowed).toBe(true)
  })
})

describe('assertAllowedTarget', () => {
  it('refuses an address outside the granted site network', () => {
    expect(assertAllowedTarget('192.168.10.20', { sites, siteId: 'hn-1' }).id).toBe('hn-1')
    expect(() => assertAllowedTarget('10.20.0.5', { sites, siteId: 'hn-1' })).toThrow(/nằm ngoài dải mạng/)
    expect(() => assertAllowedTarget('192.168.99.5', { sites })).toThrow(/nằm ngoài dải mạng/)
    expect(() => assertAllowedTarget('192.168.10.20', { sites, siteId: 'khong-ton-tai' })).toThrow(/chưa được cấu hình/)
  })
})

describe('assertScannableCidr', () => {
  it('accepts a subnet fully inside the site allowlist', () => {
    const { hosts, cidr } = assertScannableCidr('192.168.10.0/24', { sites, siteId: 'hn-1' })
    expect(cidr).toBe('192.168.10.0/24')
    expect(hosts).toHaveLength(254)
    expect(hosts[0]).toBe('192.168.10.1')
  })

  it('refuses ranges that are too wide, outside the site, or not granted at all', () => {
    expect(() => assertScannableCidr('0.0.0.0/0', { sites, siteId: 'hn-1' })).toThrow(/Chỉ quét được dải từ \/22 đến \/30/)
    expect(() => assertScannableCidr('192.168.0.0/16', { sites, siteId: 'hn-1' })).toThrow(/Chỉ quét được dải từ \/22 đến \/30/)
    expect(() => assertScannableCidr('192.168.11.0/24', { sites, siteId: 'hn-1' })).toThrow(/không nằm trong danh sách mạng được cấp/)
    expect(() => assertScannableCidr('10.20.0.0/22', { sites, siteId: 'hn-1' })).toThrow(/không nằm trong danh sách mạng được cấp/)
  })

  it('caps the number of hosts a single scan may enumerate', () => {
    expect(() => assertScannableCidr('10.20.0.0/22', { sites, siteId: 'hcm-1' })).toThrow(/vượt giới hạn quét/)
  })
})

describe('hostsFromCidr', () => {
  it('skips network and broadcast addresses', () => {
    expect(hostsFromCidr('192.168.10.0/30')).toEqual(['192.168.10.1', '192.168.10.2'])
  })
})

describe('helpers', () => {
  it('normalizes MAC formatting and rejects junk', () => {
    expect(normalizeMac('8c-1f-64-ab-cd-ef')).toBe('8C:1F:64:AB:CD:EF')
    expect(normalizeMac('8c1f64abcdef')).toBe('8C:1F:64:AB:CD:EF')
    expect(normalizeMac('khong-phai-mac')).toBeNull()
  })

  it('tests membership inclusively at both edges', () => {
    expect(cidrContainsAddress('192.168.10.0/24', '192.168.10.0')).toBe(true)
    expect(cidrContainsAddress('192.168.10.0/24', '192.168.10.255')).toBe(true)
    expect(cidrContainsAddress('192.168.10.0/24', '192.168.11.0')).toBe(false)
  })
})
