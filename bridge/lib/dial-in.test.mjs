import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { DialInListener, describeBytes, normalizeRemoteAddress } from './dial-in.mjs'

const machine = { id: 'mch-hn-001', ipAddress: '127.0.0.1' }

const listeners = []

function makeListener(overrides = {}, handlers = {}) {
  const accepted = []
  const undecoded = []
  const listener = new DialInListener(
    { enabled: true, host: '127.0.0.1', port: 0, capture: false, ...overrides },
    {
      identify: handlers.identify ?? (() => ({ machine })),
      accept: (target, payload, meta) => accepted.push({ target, payload, meta }),
      undecoded: (target, description) => undecoded.push({ target, description }),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      now: handlers.now,
    },
  )
  listeners.push(listener)
  return { listener, accepted, undecoded }
}

/**
 * Opens a client, sends bytes, and resolves with anything the bridge wrote back.
 * A reset is an expected outcome here — the listener drops senders it refuses — so socket
 * errors are recorded rather than thrown.
 */
function dial(port, chunks, { waitMs = 60 } = {}) {
  return new Promise((resolve) => {
    let received = Buffer.alloc(0)
    let error = null
    const socket = net.createConnection({ host: '127.0.0.1', port })
    socket.on('data', (chunk) => { received = Buffer.concat([received, chunk]) })
    socket.on('error', (cause) => { error = cause.code ?? cause.message })
    socket.once('connect', () => {
      for (const chunk of chunks) socket.write(chunk)
      setTimeout(() => {
        const closed = socket.destroyed
        socket.destroy()
        resolve({ received, closed, error })
      }, waitMs)
    })
  })
}

afterEach(async () => {
  while (listeners.length) await listeners.pop().close()
})

describe('normalizeRemoteAddress', () => {
  it('folds IPv4-mapped IPv6 onto the plain IPv4 form', () => {
    expect(normalizeRemoteAddress('::ffff:192.168.7.100')).toBe('192.168.7.100')
    expect(normalizeRemoteAddress('192.168.7.100')).toBe('192.168.7.100')
    expect(normalizeRemoteAddress(undefined)).toBeNull()
  })
})

describe('describeBytes', () => {
  it('previews undecodable bytes without pretending to understand them', () => {
    const description = describeBytes(Buffer.from([0x02, 0x41, 0x00, 0xff]))
    expect(description).toEqual({ bytes: 4, hex: '02 41 00 ff', ascii: '.A..', truncated: false })
  })

  it('marks a long frame as truncated so nobody reads the preview as the whole frame', () => {
    expect(describeBytes(Buffer.alloc(100), 8).truncated).toBe(true)
  })
})

describe('DialInListener', () => {
  it('accepts a newline-delimited JSON frame from a known machine', async () => {
    const { listener, accepted } = makeListener()
    const { port } = await listener.listen()
    await dial(port, ['{"status":"running","rpm":720}\n'])
    expect(accepted).toHaveLength(1)
    expect(accepted[0].payload).toEqual({ status: 'running', rpm: 720 })
    expect(accepted[0].target.id).toBe('mch-hn-001')
  })

  it('never writes a byte back — a writable socket would be a command channel', async () => {
    const { listener } = makeListener()
    const { port } = await listener.listen()
    const { received } = await dial(port, ['{"status":"running"}\n'])
    expect(received).toHaveLength(0)
  })

  it('drops a connection from an address no machine is paired at', async () => {
    const { listener, accepted } = makeListener({}, { identify: () => ({ reason: 'unknown_source' }) })
    const { port } = await listener.listen()
    await dial(port, ['{"status":"running"}\n'])
    expect(accepted).toHaveLength(0)
    expect(listener.describe().rejections.unknown_source).toBe(1)
  })

  it('refuses a frame that claims to be a different machine', async () => {
    const { listener, accepted } = makeListener()
    const { port } = await listener.listen()
    await dial(port, ['{"machineId":"mch-hn-999","status":"running"}\n'])
    expect(accepted).toHaveLength(0)
    expect(listener.describe().rejections.machine_id_mismatch).toBe(1)
  })

  it('accepts a frame whose machineId matches the address it came from', async () => {
    const { listener, accepted } = makeListener()
    const { port } = await listener.listen()
    await dial(port, ['{"machineId":"mch-hn-001","status":"running"}\n'])
    expect(accepted).toHaveLength(1)
  })

  it('reports unparseable bytes as undecoded instead of inventing telemetry', async () => {
    const { listener, accepted, undecoded } = makeListener()
    const { port } = await listener.listen()
    await dial(port, [Buffer.from([0x02, 0x31, 0x30, 0x0a])])
    expect(accepted).toHaveLength(0)
    expect(undecoded).toHaveLength(1)
    expect(undecoded[0].description.reason).toBe('not_json')
    expect(undecoded[0].description.hex).toBe('02 31 30')
  })

  it('flushes a binary stream with no newline as one undecoded chunk', async () => {
    const { listener, undecoded } = makeListener({ maxFrameBytes: 64 })
    const { port } = await listener.listen()
    await dial(port, [Buffer.alloc(200, 0x7f)])
    expect(undecoded).toHaveLength(1)
    expect(undecoded[0].description.reason).toBe('no_newline')
    expect(undecoded[0].description.bytes).toBeGreaterThan(64)
  })

  it('treats a JSON array or scalar as undecoded, not as a snapshot', async () => {
    const { listener, accepted, undecoded } = makeListener()
    const { port } = await listener.listen()
    await dial(port, ['[1,2,3]\n', '"running"\n'])
    expect(accepted).toHaveLength(0)
    expect(undecoded.map((entry) => entry.description.reason)).toEqual(['not_object', 'not_object'])
  })

  it('cuts off a machine that exceeds its frame budget for the minute', async () => {
    let clock = 1_000_000
    const { listener, accepted } = makeListener({ maxFramesPerMinute: 3 }, { now: () => clock })
    const { port } = await listener.listen()
    await dial(port, ['{"a":1}\n{"a":2}\n{"a":3}\n{"a":4}\n{"a":5}\n'])
    expect(accepted).toHaveLength(3)
    expect(listener.describe().rejections.rate_limited).toBe(1)
  })

  it('lets the budget refill once the minute has passed', async () => {
    let clock = 1_000_000
    const { listener, accepted } = makeListener({ maxFramesPerMinute: 2 }, { now: () => clock })
    const { port } = await listener.listen()
    await dial(port, ['{"a":1}\n{"a":2}\n'])
    clock += 61_000
    await dial(port, ['{"a":3}\n'])
    expect(accepted).toHaveLength(3)
  })

  it('holds a rate-limited address in cooldown so it cannot reconnect immediately', async () => {
    let clock = 1_000_000
    const { listener } = makeListener({ maxFramesPerMinute: 1 }, { now: () => clock })
    const { port } = await listener.listen()
    await dial(port, ['{"a":1}\n{"a":2}\n'])
    await dial(port, ['{"a":3}\n'])
    expect(listener.describe().rejections.cooldown).toBe(1)
  })

  it('stays closed when ingest is disabled', async () => {
    const { listener } = makeListener({ enabled: false })
    expect(await listener.listen()).toBeNull()
    expect(listener.describe().enabled).toBe(false)
    expect(listener.describe().address).toBeNull()
  })

  it('counts frames for the health endpoint', async () => {
    const { listener } = makeListener()
    const { port } = await listener.listen()
    await dial(port, ['{"status":"running"}\n', 'khong-phai-json\n'])
    const described = listener.describe()
    expect(described.framesAccepted).toBe(1)
    expect(described.framesUndecoded).toBe(1)
    expect(described.connections).toBe(1)
    expect(described.lastFrameAt).not.toBeNull()
  })
})

/**
 * Bảng "máy đang gọi vào".
 *
 * Đây là thứ quyết định một buổi đấu nối tại xưởng thành hay bại: nếu địa chỉ bị từ chối
 * không hiện ra ở đâu cả thì người đứng máy không phân biệt được "chưa khai máy" với "sai
 * dây, sai IP, chặn firewall", và sẽ đi sửa nhầm chỗ.
 */
describe('DialInListener callers', () => {
  it('remembers an address that was refused for not being paired', async () => {
    const { listener } = makeListener({}, { identify: () => ({ reason: 'unknown_source' }) })
    const { port } = await listener.listen()
    await dial(port, ['{"status":"running"}\n'])
    const [caller] = listener.describeIngest().callers
    expect(caller.remote).toBe('127.0.0.1')
    expect(caller.accepted).toBe(false)
    expect(caller.lastReason).toBe('unknown_source')
    expect(caller.machineId).toBeNull()
    expect(caller.firstSeenAt).not.toBeNull()
  })

  it('records the machine, connection and frame counts of an accepted address', async () => {
    const { listener } = makeListener()
    const { port } = await listener.listen()
    await dial(port, ['{"a":1}\n{"a":2}\n'])
    await dial(port, ['{"a":3}\n'])
    const [caller] = listener.describeIngest().callers
    expect(caller.accepted).toBe(true)
    expect(caller.machineId).toBe('mch-hn-001')
    expect(caller.connections).toBe(2)
    expect(caller.framesAccepted).toBe(3)
  })

  /** Byte đầu tiên là bằng chứng "máy có nói", chỉ là chưa ai giải mã được nó. */
  it('keeps the first bytes of traffic nobody could decode', async () => {
    const { listener } = makeListener()
    const { port } = await listener.listen()
    await dial(port, [Buffer.from([0x02, 0x41, 0xff]), '\n'])
    const [caller] = listener.describeIngest().callers
    expect(caller.framesUndecoded).toBe(1)
    expect(caller.lastReason).toBe('not_json')
    expect(caller.lastBytes).toMatchObject({ bytes: 3, hex: '02 41 ff' })
  })

  it('does not leak the caller table into health, which every viewer can read', async () => {
    const { listener } = makeListener()
    const { port } = await listener.listen()
    await dial(port, ['{"a":1}\n'])
    expect(listener.describe().callers).toBeUndefined()
    expect(listener.describeIngest().callers).toHaveLength(1)
  })

  it('keeps the table bounded, newest first, so it cannot grow into a second log', () => {
    const { listener } = makeListener()
    for (let index = 0; index < 30; index += 1) listener.touchCaller(`192.168.7.${index}`, { lastReason: 'unknown_source' })
    const { callers, maxCallers } = listener.describeIngest()
    expect(callers).toHaveLength(maxCallers)
    expect(callers[0].remote).toBe('192.168.7.29')
    expect(callers.some((caller) => caller.remote === '192.168.7.0')).toBe(false)
  })

  it('moves an address that dials again back to the top without duplicating it', () => {
    const { listener } = makeListener()
    listener.touchCaller('192.168.7.10', { lastReason: 'unknown_source' })
    listener.touchCaller('192.168.7.11', { lastReason: 'unknown_source' })
    listener.touchCaller('192.168.7.10', { lastReason: 'unknown_source' })
    const { callers } = listener.describeIngest()
    expect(callers.map((caller) => caller.remote)).toEqual(['192.168.7.10', '192.168.7.11'])
  })
})

/**
 * Cổng tin cậy: nhiều máy đi chung MỘT kết nối.
 *
 * Đây là ca sinh ra cả tính năng này. Trước bản vá, hai máy thêu đẩy telemetry qua chung
 * một socket từ 127.0.0.1 sẽ được bridge — vốn định danh theo địa chỉ nguồn — gộp vào một
 * bản ghi máy. Không lỗi, không cảnh báo, chỉ có số mũi của hai máy nhảy qua lại trong cùng
 * một ô. Hỏng kiểu im lặng là hỏng khó thấy nhất, nên nó phải có test riêng.
 */
describe('DialInListener qua cổng tin cậy', () => {
  const mayA = { id: 'mch-a15-01', ipAddress: '127.0.0.1' }
  const mayB = { id: 'mch-a15-02', ipAddress: '127.0.0.1' }
  const cong = {
    gateway: {
      address: '127.0.0.1',
      resolve: (id) => [mayA, mayB].find((m) => m.id === id) ?? null,
    },
  }

  it('tách đúng hai máy khai tên khác nhau trên cùng một kết nối', async () => {
    const { listener, accepted } = makeListener({}, { identify: () => cong })
    const { port } = await listener.listen()

    await dial(port, [
      `${JSON.stringify({ machineId: 'mch-a15-01', status: 'running', job: { currentStitch: 11 } })}\n`,
      `${JSON.stringify({ machineId: 'mch-a15-02', status: 'stopped', job: { currentStitch: 22 } })}\n`,
      `${JSON.stringify({ machineId: 'mch-a15-01', status: 'running', job: { currentStitch: 12 } })}\n`,
    ])

    expect(accepted.map((f) => f.target.id)).toEqual(['mch-a15-01', 'mch-a15-02', 'mch-a15-01'])
    // Số của máy nào phải ở lại với máy đó — đây chính là chỗ bản cũ trộn lẫn.
    expect(accepted.map((f) => f.payload.job.currentStitch)).toEqual([11, 22, 12])
    expect(listener.stats.framesAccepted).toBe(3)
  })

  it('từ chối khung không khai machineId thay vì gán bừa cho một máy', async () => {
    const { listener, accepted } = makeListener({}, { identify: () => cong })
    const { port } = await listener.listen()

    await dial(port, [`${JSON.stringify({ status: 'running' })}\n`])

    expect(accepted).toHaveLength(0)
    expect(listener.stats.rejections.machine_id_missing).toBe(1)
    expect(listener.stats.framesAccepted).toBe(0)
  })

  it('từ chối machineId chưa ghép máy nào tại cổng đó', async () => {
    const { listener, accepted } = makeListener({}, { identify: () => cong })
    const { port } = await listener.listen()

    await dial(port, [`${JSON.stringify({ machineId: 'mch-may-la', status: 'running' })}\n`])

    expect(accepted).toHaveLength(0)
    expect(listener.stats.rejections.unknown_machine_id).toBe(1)
  })

  it('không dựng byte chưa giải mã được thành lỗi của một máy được chọn đại', async () => {
    const { listener, undecoded } = makeListener({}, { identify: () => cong })
    const { port } = await listener.listen()

    await dial(port, [Buffer.from([0x02, 0x41, 0xff]), Buffer.from('\n')])

    // Vẫn ĐẾM, vẫn hiện trên bảng địa chỉ gọi vào — nhưng không quy cho máy nào, vì lúc
    // chưa đọc ra machineId thì thật sự không biết là của máy nào.
    expect(listener.stats.framesUndecoded).toBe(1)
    expect(undecoded).toHaveLength(0)
    expect([...listener.callers.values()][0].machineId).toBeNull()
  })

  it('một máy vượt nhịp không làm rụng telemetry của máy đi chung cổng', async () => {
    const { listener, accepted } = makeListener({ maxFramesPerMinute: 2 }, { identify: () => cong })
    const { port } = await listener.listen()

    await dial(port, [
      `${JSON.stringify({ machineId: 'mch-a15-01', status: 'running' })}\n`,
      `${JSON.stringify({ machineId: 'mch-a15-01', status: 'running' })}\n`,
      `${JSON.stringify({ machineId: 'mch-a15-01', status: 'running' })}\n`, // máy 01 hết ngân sách
      `${JSON.stringify({ machineId: 'mch-a15-02', status: 'running' })}\n`, // máy 02 vẫn phải qua
    ])

    expect(accepted.map((f) => f.target.id)).toEqual(['mch-a15-01', 'mch-a15-01', 'mch-a15-02'])
    expect(listener.stats.rejections.rate_limited).toBe(1)
  })

  it('vẫn cắt kết nối khi chính cổng bơm rác không gán được máy nào', async () => {
    const { listener } = makeListener({ maxFramesPerMinute: 2 }, { identify: () => cong })
    const { port } = await listener.listen()

    const result = await dial(port, [
      `${JSON.stringify({ status: 'running' })}\n`,
      `${JSON.stringify({ status: 'running' })}\n`,
      `${JSON.stringify({ status: 'running' })}\n`,
    ])

    expect(result.closed).toBe(true)
    expect(listener.stats.rejections.rate_limited).toBe(1)
  })
})

/**
 * Đường trực tiếp KHÔNG được đổi. Cổng tin cậy là ngoại lệ hẹp và phải khai đích danh;
 * một địa chỉ không khai vẫn định danh theo IP nguồn, và vẫn không được tự xưng máy khác.
 */
describe('DialInListener đường trực tiếp sau khi thêm cổng tin cậy', () => {
  it('vẫn từ chối khung khai machineId khác với máy đã ghép ở địa chỉ đó', async () => {
    const { listener, accepted } = makeListener()
    const { port } = await listener.listen()

    await dial(port, [`${JSON.stringify({ machineId: 'mch-may-khac', status: 'running' })}\n`])

    expect(accepted).toHaveLength(0)
    expect(listener.stats.rejections.machine_id_mismatch).toBe(1)
  })

  it('vẫn nhận khung không khai machineId, vì địa chỉ nguồn đã quyết định danh tính', async () => {
    const { listener, accepted } = makeListener()
    const { port } = await listener.listen()

    await dial(port, [`${JSON.stringify({ status: 'running' })}\n`])

    expect(accepted).toHaveLength(1)
    expect(accepted[0].target.id).toBe('mch-hn-001')
  })
})
