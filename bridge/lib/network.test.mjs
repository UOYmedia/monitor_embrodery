import { EventEmitter } from 'node:events'
import net from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { localNetworkIdentity, probePort, scanSubnet } from './network.mjs'

/**
 * Không lệnh ngoài nào được coi là có sẵn: `arp`, `networksetup`, `iwgetid` đều fail.
 * Đây cũng là trạng thái thật của khá nhiều máy bridge ở xưởng, và là ca mà module này
 * phải trả `null` chứ không được đoán.
 */
vi.mock('node:child_process', () => ({
  execFile: (file, _args, _options, callback) => { callback(new Error(`không có lệnh ${file}`)) },
}))

const osState = vi.hoisted(() => ({ platform: 'linux', interfaces: {} }))
vi.mock('node:os', () => ({
  platform: () => osState.platform,
  networkInterfaces: () => osState.interfaces,
}))

const sites = [{ id: 'xuong-a', name: 'Xưởng A', allowedCidrs: ['192.168.10.0/24'] }]
const siteVoi = (cidrs) => [{ id: 'xuong-a', name: 'Xưởng A', allowedCidrs: cidrs }]

/**
 * Chặn `net.createConnection` ở đúng ranh giới mà gói tin rời tiến trình.
 * Nhờ vậy "bridge có phát gói tin không" trở thành thứ khẳng định được, chứ không phải suy đoán.
 */
function batGoiTin({ moCong = {}, khongTraLoi = false } = {}) {
  const daGoi = []
  const dangMo = { hienTai: 0, dinh: 0 }
  const socketDaTao = []
  vi.spyOn(net, 'createConnection').mockImplementation(({ host, port }) => {
    daGoi.push(`${host}:${port}`)
    dangMo.hienTai += 1
    dangMo.dinh = Math.max(dangMo.dinh, dangMo.hienTai)
    const socket = new EventEmitter()
    socket.write = vi.fn()
    socket.destroy = vi.fn(() => { dangMo.hienTai -= 1 })
    socket.setTimeout = (_ms, onTimeout) => { if (khongTraLoi) setTimeout(onTimeout, 0) }
    if (!khongTraLoi) {
      const mo = (moCong[host] ?? []).includes(port)
      setTimeout(() => socket.emit(mo ? 'connect' : 'error', new Error('ECONNREFUSED')), 0)
    }
    socketDaTao.push(socket)
    return socket
  })
  return { daGoi, dangMo, socketDaTao }
}

afterEach(() => {
  vi.restoreAllMocks()
  osState.platform = 'linux'
  osState.interfaces = {}
})

describe('scanSubnet: từ chối trước khi gói tin đầu tiên rời bridge', () => {
  it('dải ngoài mạng được cấp cho site thì không một socket nào được mở', async () => {
    const { daGoi } = batGoiTin()
    await expect(scanSubnet({ cidr: '192.168.11.0/24', ports: [9100], sites, siteId: 'xuong-a' }))
      .rejects.toThrow(/không nằm trong danh sách mạng được cấp/)
    await expect(scanSubnet({ cidr: '192.168.10.0/24', ports: [9100], sites, siteId: 'khong-co-site' }))
      .rejects.toThrow(/chưa được cấu hình/)
    expect(daGoi).toEqual([])
  })

  it('cổng 0 là cổng sai, không phải "chưa chọn cổng" âm thầm bỏ qua', async () => {
    const { daGoi } = batGoiTin()
    for (const ports of [[0], [-1], [65536], ['khong-phai-so'], [], null]) {
      await expect(scanSubnet({ cidr: '192.168.10.0/30', ports, sites, siteId: 'xuong-a' }))
        .rejects.toThrow(/ít nhất một cổng TCP hợp lệ/)
    }
    expect(daGoi).toEqual([])
  })

  it('quét quá nhiều cổng một lượt bị chặn để không làm nghẽn Wi-Fi xưởng', async () => {
    const { daGoi } = batGoiTin()
    const muoiBaCong = Array.from({ length: 13 }, (_, index) => 9100 + index)
    await expect(scanSubnet({ cidr: '192.168.10.0/30', ports: muoiBaCong, sites, siteId: 'xuong-a' }))
      .rejects.toThrow(/tối đa 12 cổng/)
    expect(daGoi).toEqual([])
  })

  it('khai nhầm một dải public vào allowedCidrs vẫn không quét ra ngoài xưởng được', async () => {
    // Danh sách site do người gõ tay vào file cấu hình. Nếu allowlist là hàng rào duy nhất thì
    // một lần gõ nhầm biến bridge thành máy quét Internet chạy từ trong mạng khách hàng.
    const { daGoi } = batGoiTin()
    await expect(scanSubnet({ cidr: '203.0.113.0/30', ports: [9100], sites: siteVoi(['203.0.113.0/24']), siteId: 'xuong-a' }))
      .rejects.toThrow(/ngoài dải LAN riêng/)
    expect(daGoi).toEqual([])
  })

  it('cờ mở loopback không mở luôn dải public, và ngược lại', async () => {
    // Hai cờ trả lời hai câu hỏi khác nhau: "đang chạy fixture trên máy lập trình" và
    // "site này thật sự dùng dải định tuyến riêng". Lẫn hai cờ này là mở cổng ra ngoài xưởng.
    const { daGoi } = batGoiTin()
    await expect(scanSubnet({
      cidr: '127.0.0.0/30', ports: [9100], sites: siteVoi(['127.0.0.0/8']), siteId: 'xuong-a',
      safety: { allowPublicRanges: true },
    })).rejects.toThrow(/loopback/)
    await expect(scanSubnet({
      cidr: '203.0.113.0/30', ports: [9100], sites: siteVoi(['203.0.113.0/24']), siteId: 'xuong-a',
      safety: { allowLoopback: true },
    })).rejects.toThrow(/ngoài dải LAN riêng/)
    expect(daGoi).toEqual([])
  })

  it('bật đúng cờ thì mới thật sự phát gói tin ra dải định tuyến ngoài RFC1918', async () => {
    const { daGoi } = batGoiTin()
    const ketQua = await scanSubnet({
      cidr: '203.0.113.0/30', ports: [9100], sites: siteVoi(['203.0.113.0/24']), siteId: 'xuong-a',
      safety: { allowPublicRanges: true },
    })
    expect(ketQua.hostsScanned).toBe(2)
    expect(daGoi.sort()).toEqual(['203.0.113.1:9100', '203.0.113.2:9100'])
  })

  it('người dùng bấm huỷ thì không có thêm gói tin nào được phát', async () => {
    const { daGoi } = batGoiTin()
    const ketQua = await scanSubnet({
      cidr: '192.168.10.0/28', ports: [9100], sites, siteId: 'xuong-a', signal: { aborted: true },
    })
    expect(daGoi).toEqual([])
    expect(ketQua.results).toEqual([])
  })

  it('giữ đúng số kết nối song song đã cấu hình, không dội hết subnet cùng lúc', async () => {
    const { dangMo } = batGoiTin()
    await scanSubnet({ cidr: '192.168.10.0/29', ports: [9100], sites, siteId: 'xuong-a', concurrency: 2 })
    expect(dangMo.dinh).toBe(2)
    expect(dangMo.hienTai).toBe(0)
  })
})

describe('scanSubnet: kết quả trả về cho người ở xưởng', () => {
  it('chỉ liệt kê địa chỉ thật sự trả lời, không liệt kê cả subnet', async () => {
    batGoiTin({ moCong: { '192.168.10.5': [9100] } })
    const ketQua = await scanSubnet({ cidr: '192.168.10.0/28', ports: [9100], sites, siteId: 'xuong-a' })
    expect(ketQua.hostsScanned).toBe(14)
    expect(ketQua.results.map((item) => item.ipAddress)).toEqual(['192.168.10.5'])
  })

  it('một cổng TCP mở không được gọi là máy thêu Dahao', async () => {
    // Đây là ca hỏng đắt nhất của tính năng quét: người ta ghép nhầm một cái máy in nhãn
    // hay camera vào danh sách máy thêu rồi đọc sản lượng của nó suốt ca.
    batGoiTin({ moCong: { '192.168.10.2': [9100, 23] } })
    const { results } = await scanSubnet({ cidr: '192.168.10.0/30', ports: [9100, 23], sites, siteId: 'xuong-a' })
    expect(results).toHaveLength(1)
    const [thietBi] = results
    expect(thietBi.classification).toBe('unverified-device')
    expect(Object.keys(thietBi).sort()).toEqual(['classification', 'ipAddress', 'macAddress', 'openPorts', 'seenAt', 'siteId'])
    expect(thietBi.siteId).toBe('xuong-a')
    expect(thietBi.openPorts.sort()).toEqual([23, 9100])
    expect(Number.isNaN(Date.parse(thietBi.seenAt))).toBe(false)
  })

  it('không đoán MAC khi ARP im lặng: trả null chứ không trả chuỗi rỗng', async () => {
    batGoiTin({ moCong: { '192.168.10.1': [9100] } })
    const { results } = await scanSubnet({ cidr: '192.168.10.0/30', ports: [9100], sites, siteId: 'xuong-a' })
    expect(results[0].macAddress).toBeNull()
  })

  it('sắp theo thứ tự số của IP nên .2 đứng trước .10', async () => {
    // Sắp theo chuỗi thì .10 nhảy lên trước .2 và người dò máy phải đọc lại cả danh sách.
    batGoiTin({ moCong: { '192.168.10.10': [9100], '192.168.10.2': [9100] } })
    const { results } = await scanSubnet({ cidr: '192.168.10.0/28', ports: [9100], sites, siteId: 'xuong-a' })
    expect(results.map((item) => item.ipAddress)).toEqual(['192.168.10.2', '192.168.10.10'])
  })

  it('ghi lại đúng dải và danh sách cổng đã quét để nhật ký kiểm toán không nói sai', async () => {
    batGoiTin()
    const ketQua = await scanSubnet({ cidr: '192.168.10.37/30', ports: ['9100', 9100, 23], sites, siteId: 'xuong-a' })
    expect(ketQua.cidr).toBe('192.168.10.36/30')
    expect(ketQua.portsScanned).toEqual([9100, 23])
    expect(ketQua.siteId).toBe('xuong-a')
  })

  it('quét thật qua loopback: cổng đang mở thì thấy, cổng đóng thì không bịa ra thiết bị', async () => {
    const server = net.createServer((socket) => socket.end())
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    try {
      const { results } = await scanSubnet({
        cidr: '127.0.0.0/30', ports: [port], sites: siteVoi(['127.0.0.0/8']), siteId: 'xuong-a',
        safety: { allowLoopback: true },
      })
      expect(results.map((item) => item.ipAddress)).toEqual(['127.0.0.1'])
      expect(results[0].openPorts).toEqual([port])
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})

describe('probePort', () => {
  it('không quay số tới tên miền: chỉ IPv4 mới được kết nối', async () => {
    // Tên miền để DNS quyết định đích đến. Bridge chỉ được đi tới đúng địa chỉ đã qua chính sách.
    const { daGoi } = batGoiTin({ moCong: { 'may-theu.local': [9100] } })
    for (const host of ['may-theu.local', 'localhost', '192.168.10.999', '', null, undefined]) {
      expect(await probePort(host, 9100)).toBe(false)
    }
    expect(daGoi).toEqual([])
  })

  it('không ghi một byte nào vào bộ điều khiển, kể cả khi kết nối được', async () => {
    // Máy thêu đang chạy hàng. Một lần ghi nhầm vào cổng điều khiển là một tấm hỏng.
    const { socketDaTao } = batGoiTin({ moCong: { '192.168.10.4': [9100] } })
    expect(await probePort('192.168.10.4', 9100)).toBe(true)
    expect(socketDaTao[0].write).not.toHaveBeenCalled()
    expect(socketDaTao[0].destroy).toHaveBeenCalled()
  })

  it('máy không trả lời thì kết luận là đóng, không treo cả vòng quét', async () => {
    const { socketDaTao } = batGoiTin({ khongTraLoi: true })
    expect(await probePort('192.168.10.4', 9100, 5)).toBe(false)
    expect(socketDaTao[0].destroy).toHaveBeenCalled()
  })
})

describe('localNetworkIdentity', () => {
  it('chỉ nói về card mạng LAN của chính bridge, bỏ loopback và IPv6', async () => {
    osState.interfaces = {
      lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0', cidr: '127.0.0.1/8', mac: '00:00:00:00:00:00' }],
      utun3: null,
      en0: [
        { family: 'IPv6', internal: false, address: 'fe80::1', netmask: 'ffff::', cidr: 'fe80::1/64', mac: '8c:1f:64:ab:cd:ef' },
        { family: 'IPv4', internal: false, address: '192.168.10.7', netmask: '255.255.255.0', cidr: '192.168.10.7/24', mac: '8c:1f:64:ab:cd:ef' },
      ],
    }
    const { interfaces } = await localNetworkIdentity()
    expect(interfaces).toEqual([{
      name: 'en0', address: '192.168.10.7', netmask: '255.255.255.0', cidr: '192.168.10.0/24', macAddress: '8C:1F:64:AB:CD:EF',
    }])
  })

  it('cidr đọc không được thì để trống, không bịa ra một dải mạng', async () => {
    // Trang này là thứ kỹ thuật viên nhìn để gõ dải quét. Một dải bịa dẫn tới quét nhầm mạng.
    osState.interfaces = {
      en1: [
        { family: 'IPv4', internal: false, address: '10.20.0.9', netmask: '255.255.252.0', cidr: 'rac', mac: '' },
        { family: 'IPv4', internal: false, address: '10.20.4.9', netmask: '255.255.252.0', cidr: null, mac: 'khong-phai-mac' },
      ],
    }
    const { interfaces } = await localNetworkIdentity()
    expect(interfaces.map((item) => item.cidr)).toEqual([null, null])
    expect(interfaces.map((item) => item.macAddress)).toEqual([null, null])
    expect(interfaces.map((item) => item.address)).toEqual(['10.20.0.9', '10.20.4.9'])
  })

  it('không dò được tên Wi-Fi thì trả null, không trả chuỗi rỗng trông như một mạng có thật', async () => {
    osState.interfaces = {}
    const ketQua = await localNetworkIdentity()
    expect(ketQua.wifiName).toBeNull()
    expect(ketQua.interfaces).toEqual([])
  })
})
