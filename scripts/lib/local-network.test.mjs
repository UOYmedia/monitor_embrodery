import { describe, expect, it } from 'vitest'
import {
  BLOCKED_CODES, checkLocalNetwork, explainProbe, lanInterfaces, probeLocalNetwork, probeTarget, unusableResult,
} from './local-network.mjs'

/** The shape `os.networkInterfaces()` really returns, trimmed to the fields this module reads. */
const interfaces = {
  lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true }],
  en0: [{ address: '10.88.88.32', netmask: '255.255.255.0', family: 'IPv4', internal: false }],
  utun6: [{ address: '100.120.68.66', netmask: '255.255.255.255', family: 'IPv4', internal: false }],
}

describe('lanInterfaces', () => {
  it('chỉ lấy giao diện LAN thật', () => {
    expect(lanInterfaces(interfaces)).toEqual([{ name: 'en0', address: '10.88.88.32', netmask: '255.255.255.0' }])
  })

  it('bỏ VPN /32 — tunnel không có láng giềng nào để nhắm tới', () => {
    const only = { utun6: interfaces.utun6 }
    expect(lanInterfaces(only)).toEqual([])
  })

  it('bỏ IPv6 và không nổ khi không có giao diện nào', () => {
    expect(lanInterfaces({ en1: [{ address: 'fe80::1', netmask: 'ffff::', family: 'IPv6', internal: false }] })).toEqual([])
    expect(lanInterfaces(undefined)).toEqual([])
  })
})

describe('probeTarget', () => {
  it('nhắm host dùng được cuối cùng trong subnet', () => {
    expect(probeTarget({ address: '10.88.88.32', netmask: '255.255.255.0' })).toBe('10.88.88.254')
    expect(probeTarget({ address: '192.168.7.10', netmask: '255.255.255.0' })).toBe('192.168.7.254')
  })

  it('không bao giờ nhắm vào chính mình', () => {
    const target = probeTarget({ address: '10.88.88.254', netmask: '255.255.255.0' })
    expect(target).not.toBe('10.88.88.254')
    expect(target).toBe('10.88.88.1')
  })

  it('không nhắm vào địa chỉ mạng hay broadcast', () => {
    // Broadcast cần SO_BROADCAST, thiếu nó thì kernel trả EACCES và ta sẽ đọc sai thành "bị chặn".
    expect(probeTarget({ address: '10.88.88.32', netmask: '255.255.255.0' })).not.toBe('10.88.88.255')
    expect(probeTarget({ address: '10.88.88.32', netmask: '255.255.255.0' })).not.toBe('10.88.88.0')
  })

  it('trả null khi subnet không còn host nào khác', () => {
    expect(probeTarget({ address: '10.0.0.1', netmask: '255.255.255.254' })).toBeNull()
    expect(probeTarget({ address: '10.0.0.1', netmask: '255.255.255.255' })).toBeNull()
  })
})

describe('explainProbe', () => {
  it('gửi được thì nói thẳng là số đo đáng tin', () => {
    const verdict = explainProbe({ ok: true, address: '10.88.88.32', target: '10.88.88.254' })
    expect(verdict.blocked).toBe(false)
    expect(verdict.meaning).toContain('vào được')
  })

  it('EHOSTUNREACH là quyền Local Network, không phải thiết bị tắt', () => {
    const verdict = explainProbe({ ok: false, code: 'EHOSTUNREACH', address: '10.88.88.32', target: '10.88.88.254' })
    expect(verdict.blocked).toBe(true)
    expect(verdict.meaning).toContain('curl')
    expect(verdict.next).toContain('Local Network')
  })

  it('mọi mã trong BLOCKED_CODES đều cho blocked = true', () => {
    for (const code of BLOCKED_CODES) {
      expect(explainProbe({ ok: false, code }).blocked).toBe(true)
    }
  })

  it('mã lạ thì trả blocked = null chứ không đoán', () => {
    const verdict = explainProbe({ ok: false, code: 'ECONNRESET' })
    expect(verdict.blocked).toBeNull()
    expect(verdict.meaning).toContain('ECONNRESET')
  })

  it('không có LAN nào thì nói là chưa thử được', () => {
    expect(explainProbe({ ok: false, code: null }).blocked).toBeNull()
    expect(explainProbe({}).blocked).toBeNull()
  })
})

describe('unusableResult', () => {
  it('cấm diễn giải số 0 thành "máy không nói gì"', () => {
    const text = unusableResult('log DNS')
    expect(text.meaning).toContain('KHÔNG KẾT LUẬN ĐƯỢC')
    expect(text.next).toContain('không ghi "máy không nói gì"')
  })
})

describe('probeLocalNetwork', () => {
  it('gửi thật trên loopback và báo gửi được', async () => {
    // Loopback đi trọn đường qua kernel như một lần gửi thật, chỉ khác là không cần thiết bị nào bật.
    const result = await probeLocalNetwork({ address: '127.0.0.1', netmask: '255.0.0.0', target: '127.0.0.1' })
    expect(result).toMatchObject({ ok: true, code: null, target: '127.0.0.1' })
  })

  it('subnet không có host khác thì trả code null, không nổ', async () => {
    const result = await probeLocalNetwork({ address: '10.0.0.1', netmask: '255.255.255.255' })
    expect(result).toEqual({ ok: false, code: null, address: '10.0.0.1', target: null })
  })

  it('địa chỉ không gửi được thì trả mã lỗi thay vì reject', async () => {
    const result = await probeLocalNetwork({ address: '127.0.0.1', netmask: '255.0.0.0', target: '0.0.0.0' })
    expect(result.ok).toBe(false)
    expect(typeof result.code).toBe('string')
  })
})

describe('checkLocalNetwork', () => {
  it('không có LAN nào thì trả verdict "chưa thử được" và results rỗng', async () => {
    const verdict = await checkLocalNetwork({ lo0: interfaces.lo0 })
    expect(verdict.blocked).toBeNull()
    expect(verdict.results).toEqual([])
  })

  it('đo thật trên máy đang chạy test và trả về đúng một kết quả cho mỗi giao diện LAN', async () => {
    const verdict = await checkLocalNetwork(interfaces, { target: '127.0.0.1' })
    expect(verdict.results).toHaveLength(1)
    expect(verdict.blocked).toBe(false)
  })
})
