import net from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdapterError, pollMachine } from './adapters.mjs'

/**
 * Ba adapter ở đây là ba *cơ chế truyền*, không phải giao thức Dahao (docs/adapter-contract.md).
 * Nên thứ đáng khoá lại không phải "đọc được gì" mà là ba ranh giới:
 *
 *  1. `manual` không bao giờ đẻ ra một con số nào — nó chỉ là dòng sổ tài sản.
 *  2. Mỗi lần poll đều hỏi lại hàng rào địa chỉ, nên sửa IP một máy không kéo được bridge
 *     ra khỏi mạng nó được cấp.
 *  3. Lỗi phải chia đúng hai loại: tạm thời (thử lại) và vĩnh viễn (người phải sửa cấu hình).
 *     Chia sai thì hoặc breaker khoá nhầm một máy đang chạy, hoặc bridge gõ cửa mãi một
 *     endpoint không bao giờ đúng.
 *
 * Không mở socket thật và không gọi mạng: đường HTTP thay `fetch` bằng hàm giả, đường TCP nạp
 * lại module với `node:net` giả.
 */

const sites = [
  { id: 'hn-1', name: 'Xưởng Hà Nội', allowedCidrs: ['192.168.10.0/24'] },
  { id: 'hcm-1', name: 'Xưởng HCM', allowedCidrs: ['10.20.0.0/24'] },
]

const receivedAt = '2026-08-14T07:00:00.000Z'
const nowFixed = () => receivedAt

const httpMachine = (overrides = {}) => ({
  id: 'mch-hn-001', siteId: 'hn-1', ipAddress: '192.168.10.21', adapter: 'http-json',
  adapterConfig: { port: 8080, path: '/telemetry' }, ...overrides,
})

const tcpMachine = (overrides = {}) => ({
  id: 'mch-hn-002', siteId: 'hn-1', ipAddress: '192.168.10.22', adapter: 'tcp-json-line',
  adapterConfig: { port: 5000 }, ...overrides,
})

/** Response giả đúng những gì adapter chạm tới: ok/status/headers.get/text. */
const httpResponse = ({ ok = true, status = 200, headers = {}, body } = {}) => ({
  ok, status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  text: vi.fn(async () => body),
})

const stubFetch = (implementation) => {
  const spy = vi.fn(implementation)
  vi.stubGlobal('fetch', spy)
  return spy
}

const jsonBody = (payload) => JSON.stringify(payload)

/** Socket giả: ghi lại mọi thứ adapter viết ra và cho test tự bắn sự kiện vào. */
class FakeSocket {
  constructor(options) {
    this.options = options
    this.written = []
    this.destroyed = false
    this.timeoutMs = null
    this.onTimeout = null
    this.handlers = new Map()
  }

  on(event, handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
    return this
  }

  once(event, handler) { return this.on(event, handler) }
  setTimeout(ms, handler) { this.timeoutMs = ms; this.onTimeout = handler }
  write(chunk) { this.written.push(chunk); return true }
  destroy() { this.destroyed = true }
  emit(event, ...args) { for (const handler of this.handlers.get(event) ?? []) handler(...args) }
}

/**
 * Nạp một bản adapters.mjs dùng `node:net` giả rồi bắt đầu một lần poll TCP.
 * Trả về cả promise lẫn socket để test tự quyết định máy "nói" gì.
 */
async function openTcpPoll(machine = tcpMachine(), options = {}) {
  vi.resetModules()
  const sockets = []
  vi.doMock('node:net', () => ({
    default: { createConnection: (connectOptions) => { const socket = new FakeSocket(connectOptions); sockets.push(socket); return socket } },
  }))
  const module = await import('./adapters.mjs')
  const promise = module.pollMachine(machine, { sites, now: nowFixed, ...options })
  const socket = sockets[0]
  socket.emit('connect')
  return { promise, socket }
}

const tick = () => new Promise((resolve) => { setTimeout(resolve, 0) })

/** Bắt lỗi mà không phụ thuộc vào danh tính class (module TCP được nạp lại nên class khác instance). */
async function reasonFor(promise) {
  const outcome = await promise.then((value) => ({ value }), (error) => ({ error }))
  if (!('error' in outcome)) throw new Error(`Lần poll này lẽ ra phải thất bại, nhưng trả về snapshot: ${JSON.stringify(outcome.value).slice(0, 160)}`)
  return outcome.error
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('node:net')
  vi.resetModules()
})

describe('AdapterError', () => {
  it('lỗi không phân loại được coi là tạm thời, để một sự cố mạng không khoá máy khỏi vòng poll', () => {
    const transient = new AdapterError('Máy không trả lời.')
    expect(transient).toBeInstanceOf(Error)
    expect(transient.name).toBe('AdapterError')
    expect(transient.retriable).toBe(true)
    expect(new AdapterError('Cấu hình sai.', { retriable: false }).retriable).toBe(false)
  })
})

describe('adapter manual', () => {
  it('máy manual không bao giờ đẻ ra một con số nào: nó chỉ là dòng sổ tài sản', async () => {
    const spy = stubFetch(() => { throw new Error('Máy manual không được phép gọi ra ngoài.') })
    const error = await reasonFor(pollMachine(httpMachine({ adapter: 'manual', adapterConfig: { port: 8080 } }), { sites, now: nowFixed }))
    expect(error.name).toBe('AdapterError')
    expect(error.retriable).toBe(false)
    expect(error.message).toMatch(/manual/)
    expect(spy).not.toHaveBeenCalled()
  })

  it('lỗi của máy manual nói đúng nguyên nhân (chưa có giao thức), không đổ oan cho mạng', async () => {
    // Máy manual thì địa chỉ chỉ là ghi chú kiểm kê. Nếu lỗi trả về là "IP ngoài dải" thì
    // kỹ thuật viên sẽ đi sửa mạng — sửa xong vẫn không có số, vì chưa hề có giao thức.
    const error = await reasonFor(pollMachine(
      { id: 'mch-kho', siteId: 'hn-1', ipAddress: '8.8.8.8', adapter: 'manual' },
      { sites, now: nowFixed },
    ))
    expect(error.name).toBe('AdapterError')
    expect(error.message).not.toMatch(/dải mạng|IP/)
  })
})

describe('hàng rào địa chỉ, hỏi lại mỗi lần poll', () => {
  it('địa chỉ ngoài phần được cấp bị chặn trước khi một byte rời khỏi bridge', async () => {
    const spy = stubFetch(() => { throw new Error('Không được gọi ra địa chỉ bị chặn.') })
    const refused = ['192.168.99.7', '8.8.8.8', '127.0.0.1', '224.0.0.1', '255.255.255.255', 'khong-phai-ip']
    for (const ipAddress of refused) {
      const error = await reasonFor(pollMachine(httpMachine({ ipAddress }), { sites, now: nowFixed }))
      expect(error.name, ipAddress).toBe('PolicyError')
      expect(error.status, ipAddress).toBe(400)
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('máy khai sai site không mượn được dải mạng của xưởng khác', async () => {
    const spy = stubFetch(() => { throw new Error('Không được gọi sang site khác.') })
    const error = await reasonFor(pollMachine(httpMachine({ siteId: 'hcm-1' }), { sites, now: nowFixed }))
    expect(error.name).toBe('PolicyError')
    expect(error.message).toMatch(/hcm-1/)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('http-json', () => {
  it('gọi đúng cái máy đã ghép và không đi theo chuyển hướng sang nơi khác', async () => {
    // `redirect: 'error'` là ranh giới thật: một endpoint trả 302 sang máy chủ khác sẽ biến
    // số của máy A thành số của một thiết bị lạ mà không ai nhìn thấy chuyện đó trên dashboard.
    const spy = stubFetch(async () => httpResponse({ body: jsonBody({ status: 'running' }) }))
    await pollMachine(httpMachine(), { sites, now: nowFixed })
    expect(spy.mock.calls[0][0]).toBe('http://192.168.10.21:8080/telemetry')
    expect(spy.mock.calls[0][1].redirect).toBe('error')

    await pollMachine(httpMachine({ adapterConfig: { port: 443, path: '/api/v1', tls: true } }), { sites, now: nowFixed })
    expect(spy.mock.calls[1][0]).toBe('https://192.168.10.21:443/api/v1')

    await pollMachine(httpMachine({ adapterConfig: undefined }), { sites, now: nowFixed })
    expect(spy.mock.calls[2][0]).toBe('http://192.168.10.21:80/')
  })

  it('không nhầm 0 mũi thành chưa đọc được: máy đang dừng vẫn là một số đọc được', async () => {
    stubFetch(async () => httpResponse({
      body: jsonBody({ status: 'stopped', rpm: 0, odometer: 0, job: { currentStitch: 0, totalStitches: 12_000 } }),
    }))
    const snapshot = await pollMachine(httpMachine(), { sites, now: nowFixed })
    expect(snapshot.rpm).toMatchObject({ value: 0 })
    expect(snapshot.odometer).toMatchObject({ value: 0 })
    expect(snapshot.job.value.currentStitch).toBe(0)
  })

  it('trường máy không gửi thì để trống, tuyệt đối không điền số thay máy', async () => {
    stubFetch(async () => httpResponse({ body: jsonBody({ status: 'unknown' }) }))
    const snapshot = await pollMachine(httpMachine(), { sites, now: nowFixed })
    expect(snapshot.status.value).toBe('unknown')
    expect(snapshot.rpm).toBeNull()
    expect(snapshot.odometer).toBeNull()
    expect(snapshot.job).toBeNull()
    expect(snapshot.controller).toBeNull()
    expect(snapshot.needlePosition).toBeNull()
    expect(snapshot.events).toEqual([])
  })

  it('số poll về mang dấu "máy đo", không lẫn được với số gõ tay', async () => {
    // Cùng một chỗ trên dashboard hiện cả hai loại số, mà chỉ một loại dựng lại được khi có
    // tranh cãi lương sản phẩm. Mất dấu nguồn gốc là mất luôn khả năng phân xử.
    stubFetch(async () => httpResponse({ body: jsonBody({ status: 'running', rpm: 720 }) }))
    const snapshot = await pollMachine(httpMachine(), { sites, now: nowFixed })
    expect(snapshot.source).toBe('http-json')
    expect(snapshot.receivedAt).toBe(receivedAt)
    expect(snapshot.rpm).toMatchObject({ value: 720, quality: 'verified' })
    expect(snapshot.machineId).toBe('mch-hn-001')
  })

  it('controller trả 503 là lỗi tạm: máy được thử lại chứ không bị kết luận là cấu hình sai', async () => {
    stubFetch(async () => httpResponse({ ok: false, status: 503 }))
    const error = await reasonFor(pollMachine(httpMachine(), { sites, now: nowFixed }))
    expect(error.name).toBe('AdapterError')
    expect(error.retriable).toBe(true)
    expect(error.message).toMatch(/503/)
  })

  it('trỏ nhầm vào trang web của controller: HTML không thành telemetry, và thử lại cũng vô ích', async () => {
    stubFetch(async () => httpResponse({ body: '<!doctype html><html><body>BECS-528</body></html>' }))
    const error = await reasonFor(pollMachine(httpMachine(), { sites, now: nowFixed }))
    expect(error.name).toBe('AdapterError')
    expect(error.retriable).toBe(false)
    expect(error.message).toMatch(/JSON/)
  })

  it('phản hồi khai quá to bị bỏ trước khi bridge đọc lấy một byte thân', async () => {
    const response = httpResponse({ headers: { 'content-length': String(1024 * 1024) }, body: 'x' })
    stubFetch(async () => response)
    const error = await reasonFor(pollMachine(httpMachine(), { sites, now: nowFixed }))
    expect(error.retriable).toBe(false)
    expect(error.message).toMatch(/giới hạn/)
    expect(response.text).not.toHaveBeenCalled()
  })

  it('thân phản hồi vượt giới hạn thì bỏ cả gói, không cố cắt bớt rồi đoán', async () => {
    stubFetch(async () => httpResponse({ body: 'x'.repeat(600_000) }))
    const error = await reasonFor(pollMachine(httpMachine(), { sites, now: nowFixed }))
    expect(error.retriable).toBe(false)
    expect(error.message).toMatch(/giới hạn/)
  })

  it('máy im lặng: bỏ cuộc đúng theo thời gian chờ của chính máy đó, và là lỗi tạm', async () => {
    // Thời gian chờ riêng cho máy chậm phải thắng mặc định chung, nếu không một máy chậm sẽ
    // hoặc luôn báo lỗi, hoặc kéo dài vòng poll của cả xưởng.
    stubFetch((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const aborted = new Error('The operation was aborted.')
        aborted.name = 'AbortError'
        reject(aborted)
      })
    }))
    const machine = httpMachine({ adapterConfig: { port: 8080, path: '/telemetry', timeoutMs: 20 } })
    const error = await reasonFor(pollMachine(machine, { sites, now: nowFixed, timeoutMs: 5000 }))
    expect(error.name).toBe('AdapterError')
    expect(error.retriable).toBe(true)
    expect(error.message).toMatch(/20 ms/)
  })

  it('rút dây mạng: vẫn là lỗi adapter có lý do đọc được, không phải lỗi lạ làm sập vòng poll', async () => {
    stubFetch(async () => { throw new TypeError('fetch failed') })
    const error = await reasonFor(pollMachine(httpMachine(), { sites, now: nowFixed }))
    expect(error.name).toBe('AdapterError')
    expect(error.retriable).toBe(true)
    expect(error.message).toMatch(/fetch failed/)
  })

  it('máy trả lời được nhưng payload sai hợp đồng là lỗi dữ liệu, không phải lỗi đường truyền', async () => {
    // Bridge phân loại theo tên lỗi: ContractError nghĩa là máy vẫn liên lạc được, chỉ nói sai.
    // Nếu chỗ này bọc thành AdapterError thì máy đang sống sẽ bị vẽ là mất kết nối.
    stubFetch(async () => httpResponse({ body: jsonBody({ rpm: 900 }) }))
    const error = await reasonFor(pollMachine(httpMachine(), { sites, now: nowFixed }))
    expect(error.name).toBe('ContractError')
    expect(error.field).toBe('status')
  })
})

describe('tcp-json-line', () => {
  it('chờ đủ một dòng mới đọc: nửa dòng không bao giờ thành một con số', async () => {
    const { promise, socket } = await openTcpPoll()
    let settled = false
    promise.then(() => { settled = true }, () => { settled = true })

    socket.emit('data', Buffer.from('{"status":"running","rpm":7'))
    await tick()
    expect(settled).toBe(false)

    socket.emit('data', Buffer.from('00}\n'))
    const snapshot = await promise
    expect(snapshot.rpm.value).toBe(700)
    expect(snapshot.source).toBe('tcp-json-line')
  })

  it('chỉ lấy dòng đầu và đóng ngay: byte gửi dồn phía sau không ghi đè số vừa đọc', async () => {
    const { promise, socket } = await openTcpPoll()
    socket.emit('data', Buffer.from('{"status":"running"}\n{"status":"stopped"}\n'))
    const snapshot = await promise
    expect(snapshot.status.value).toBe('running')
    expect(socket.destroyed).toBe(true)
  })

  it('bridge chỉ viết xuống máy đúng câu lệnh được khai, không tự ý gõ cửa', async () => {
    const silent = await openTcpPoll()
    silent.socket.emit('data', Buffer.from('{"status":"running"}\n'))
    await silent.promise
    expect(silent.socket.written).toEqual([])

    const asked = await openTcpPoll(tcpMachine({ adapterConfig: { port: 5000, command: 'STATUS' } }))
    asked.socket.emit('data', Buffer.from('{"status":"running"}\n'))
    await asked.promise
    expect(asked.socket.written).toEqual(['STATUS\n'])
  })

  it('rác trên cổng là lỗi vĩnh viễn: thử lại một trăm lần cũng không thành JSON', async () => {
    const { promise, socket } = await openTcpPoll()
    socket.emit('data', Buffer.from('BECS-528 READY\n'))
    const error = await reasonFor(promise)
    expect(error.name).toBe('AdapterError')
    expect(error.retriable).toBe(false)
    expect(socket.destroyed).toBe(true)
  })

  it('máy tuôn byte không có xuống dòng thì bị cắt, bridge không phình bộ nhớ theo', async () => {
    const { promise, socket } = await openTcpPoll()
    socket.emit('data', Buffer.from('x'.repeat(600_000)))
    const error = await reasonFor(promise)
    expect(error.retriable).toBe(false)
    expect(error.message).toMatch(/giới hạn/)
    expect(socket.destroyed).toBe(true)
  })

  it('im lặng quá lâu thì bỏ cuộc theo đúng thời gian chờ của máy đó và không để lại kết nối treo', async () => {
    const { promise, socket } = await openTcpPoll(tcpMachine({ adapterConfig: { port: 5000, timeoutMs: 900 } }))
    expect(socket.timeoutMs).toBe(900)
    socket.onTimeout()
    const error = await reasonFor(promise)
    expect(error.name).toBe('AdapterError')
    expect(error.retriable).toBe(true)
    expect(error.message).toMatch(/900 ms/)
    expect(socket.destroyed).toBe(true)
  })

  it('máy tắt hoặc từ chối kết nối: lỗi tạm kèm lý do đọc được', async () => {
    const { promise, socket } = await openTcpPoll()
    socket.emit('error', new Error('connect ECONNREFUSED 192.168.10.22:5000'))
    const error = await reasonFor(promise)
    expect(error.name).toBe('AdapterError')
    expect(error.retriable).toBe(true)
    expect(error.message).toMatch(/ECONNREFUSED/)
  })
})

describe('adapter dial-in', () => {
  it('máy tự gọi vào bridge không bao giờ trở thành số qua đường poll', async () => {
    // `dial-in` đảo chiều kết nối: máy gọi bridge, bridge không gọi máy. Một lần poll thành công
    // ở đây nghĩa là bridge vừa gõ cửa một địa chỉ mà nó chỉ được dùng để nhận dạng người gọi.
    const error = await reasonFor(pollMachine(
      { id: 'mch-hn-003', siteId: 'hn-1', ipAddress: '192.168.10.23', adapter: 'dial-in', adapterConfig: {} },
      { sites, now: nowFixed },
    ))
    expect(error).toBeInstanceOf(Error)
  })
})

// ---------------------------------------------------------------- hồi quy: treo cả vòng poll

// Loopback bị chính sách mạng chặn mặc định (đúng), nên bài hồi quy phải xin phép rõ ràng.
const siteLocal = [{ id: 'site-1', name: 'Test', allowedCidrs: ['127.0.0.0/8'] }]
const choLoopback = { allowLoopback: true, allowPublicRanges: false }

describe('máy đóng kết nối giữa chừng', () => {
  it('trả lỗi thay vì treo mãi — một máy treo từng làm TOÀN XƯỞNG ngừng cập nhật', async () => {
    // pollOnce await trọn lượt, còn poll() chặn bằng `if (this.polling) return this.polling`.
    // Nên một promise không bao giờ settle không chỉ hỏng một máy: nó đóng băng mọi tick sau đó,
    // im lặng, không breaker, không lỗi trên thẻ máy. Đây là bằng chứng nó đã settle.
    const server = net.createServer((socket) => { socket.write('{"status":"run'); socket.end() })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const { port } = server.address()
    try {
      const may = {
        id: 'm-dut', siteId: 'site-1', ipAddress: '127.0.0.1',
        adapter: 'tcp-json-line', adapterConfig: { port },
      }
      // Hết giờ của test (5s) NGẮN HƠN mọi timeout mặc định, nên nếu promise treo thì bài này đỏ.
      await expect(pollMachine(may, { sites: siteLocal, safety: choLoopback, timeoutMs: 30_000 })).rejects.toThrow(/đóng trước khi nhận đủ/)
    } finally {
      await new Promise((r) => server.close(r))
    }
  }, 5000)
})

describe('máy dial-in', () => {
  it('không bị bridge gõ cửa: dial-in là máy TỰ GỌI VÀO', async () => {
    const may = { id: 'm-dial', siteId: 'site-1', ipAddress: '127.0.0.1', adapter: 'dial-in', adapterConfig: {} }
    await expect(pollMachine(may, { sites: siteLocal, safety: choLoopback, timeoutMs: 500 })).rejects.toThrow(/không nằm trong vòng poll/)
  })

  it('lỗi đó là AdapterError đọc được, không phải TypeError của socket', async () => {
    const may = { id: 'm-dial', siteId: 'site-1', ipAddress: '127.0.0.1', adapter: 'dial-in', adapterConfig: {} }
    // Trước bản vá: net.createConnection({ port: undefined }) ném ERR_MISSING_ARGS, và thợ ở
    // xưởng đọc được đúng dòng 'The "options" or "port" or "path" argument must be specified'.
    await expect(pollMachine(may, { sites: siteLocal, safety: choLoopback, timeoutMs: 500 })).rejects.toBeInstanceOf(AdapterError)
  })
})

describe('timeout trong bản ghi bị hỏng', () => {
  it('không phải số thì ngã về mặc định, không huỷ tức thì cũng không ném ngoài AdapterError', async () => {
    const may = {
      id: 'm-rac', siteId: 'site-1', ipAddress: '127.0.0.1',
      adapter: 'tcp-json-line', adapterConfig: { port: 1, timeoutMs: 'rác' },
    }
    await expect(pollMachine(may, { sites: siteLocal, safety: choLoopback, timeoutMs: 300 })).rejects.toBeInstanceOf(AdapterError)
  }, 5000)
})

// ---------------------------------------------------------------- hồi quy: trần byte của HTTP

describe('trần kích thước phản hồi HTTP', () => {
  it('đếm BYTE chứ không đếm ký tự — tiếng Việt từng làm trần lệch tới ~3 lần', async () => {
    // 'ộ' là 3 byte UTF-8 nhưng 1 ký tự UTF-16. Bản cũ so `body.length` nên một payload
    // 200k ký tự tiếng Việt (~600 KB thật) vẫn lọt qua trần 512 KB, trong khi thông điệp
    // lỗi lại ghi "byte".
    const nhieuDau = 'ộ'.repeat(200_000)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(nhieuDau, { status: 200 })))
    await expect(pollMachine(httpMachine(), { sites, timeoutMs: 500 }))
      .rejects.toThrow(/giới hạn/)
  })

  it('payload nhỏ có dấu tiếng Việt vẫn qua bình thường', async () => {
    const than = JSON.stringify({ observedAt: '2026-08-14T07:00:00.000Z', status: 'running', note: 'Máy đang chạy ổn định' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(than, { status: 200 })))
    const snap = await pollMachine(httpMachine(), { sites, timeoutMs: 500, now: nowFixed })
    expect(snap.status.value).toBe('running')
  })
})
