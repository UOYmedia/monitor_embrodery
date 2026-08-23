import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { normalizeTelemetry } from '../../bridge/lib/contract.mjs'
import {
  activeJob, curlTransport, decodeResponse, encodeRequest, fetchTransport, groupOf, groupTags,
  operations, readPrinter, reasonsToEvents, snapshotFromPrinter, valueTags,
} from './printer-ipp.mjs'

/** Builds a response body the way a printer would, so the decoder is tested against bytes. */
function buildResponse({ statusCode = 0, groups }) {
  const parts = [Buffer.from([0x02, 0x00, (statusCode >> 8) & 0xff, statusCode & 0xff, 0, 0, 0, 1])]
  for (const group of groups) {
    parts.push(Buffer.from([group.tag]))
    for (const [tag, name, value] of group.values) {
      const nameBuffer = Buffer.from(name, 'utf8')
      const valueBuffer = typeof value === 'number'
        ? (() => { const buffer = Buffer.alloc(4); buffer.writeInt32BE(value); return buffer })()
        : Buffer.from(value, 'utf8')
      const head = Buffer.alloc(3)
      head.writeUInt8(tag, 0)
      head.writeUInt16BE(nameBuffer.length, 1)
      const length = Buffer.alloc(2)
      length.writeUInt16BE(valueBuffer.length, 0)
      parts.push(head, nameBuffer, length, valueBuffer)
    }
  }
  parts.push(Buffer.from([groupTags.end]))
  return Buffer.concat(parts)
}

describe('encodeRequest', () => {
  it('gói được operation-id, request-id và printer-uri', () => {
    const body = encodeRequest({ operation: operations.getPrinterAttributes, requestId: 7, printerUri: 'ipp://x/p' })
    expect(body.readUInt16BE(0)).toBe(0x0200)
    expect(body.readUInt16BE(2)).toBe(operations.getPrinterAttributes)
    expect(body.readUInt32BE(4)).toBe(7)
    expect(body[8]).toBe(groupTags.operation)
    expect(body[body.length - 1]).toBe(groupTags.end)
    expect(body.includes(Buffer.from('ipp://x/p'))).toBe(true)
  })

  /**
   * Giá trị thứ hai trở đi của `requested-attributes` phải có tên rỗng — đó là cách IPP nói
   * "vẫn là thuộc tính bên trên". Ghi tên đầy đủ mỗi lần thì máy in chỉ nhận giá trị cuối.
   */
  it('giá trị thứ hai của requested-attributes mang tên rỗng', () => {
    const body = encodeRequest({ operation: operations.getPrinterAttributes, printerUri: 'ipp://x/p', requested: ['a-one', 'b-two'] })
    const decoded = decodeResponse(Buffer.concat([Buffer.alloc(8), body.subarray(8)]))
    expect(groupOf(decoded, groupTags.operation)['requested-attributes']).toEqual(['a-one', 'b-two'])
  })
})

describe('decodeResponse', () => {
  it('đọc được số nguyên, chuỗi và thuộc tính nhiều giá trị', () => {
    const decoded = decodeResponse(buildResponse({
      groups: [{
        tag: groupTags.printer,
        values: [
          [valueTags.enum, 'printer-state', 4],
          [valueTags.keyword, 'printer-state-reasons', 'media-low'],
          [valueTags.keyword, '', 'toner-low'],
          [valueTags.text, 'printer-state-message', 'dang in'],
        ],
      }],
    }))
    expect(decoded.statusCode).toBe(0)
    expect(groupOf(decoded, groupTags.printer)).toEqual({
      'printer-state': 4,
      'printer-state-reasons': ['media-low', 'toner-low'],
      'printer-state-message': 'dang in',
    })
  })

  /**
   * Gói cụt phải ném lỗi chứ không trả về nửa vời: probe báo lỗi đọc thì bridge ghi nhận
   * một lượt đọc hỏng, còn nửa snapshot sẽ trôi vào dashboard như dữ liệu thật.
   */
  it('gói cụt là lỗi, không phải snapshot một nửa', () => {
    const full = buildResponse({ groups: [{ tag: groupTags.printer, values: [[valueTags.enum, 'printer-state', 3]] }] })
    expect(() => decodeResponse(full.subarray(0, full.length - 3))).toThrow(/cụt|vượt quá/)
    expect(() => decodeResponse(Buffer.alloc(4))).toThrow(/8 byte/)
  })
})

describe('snapshotFromPrinter', () => {
  const observedAt = '2026-08-15T03:00:00.000Z'
  const snap = (printer, jobs = []) => snapshotFromPrinter({ printer, jobs, observedAt })

  it('máy in đang in là running, rảnh là stopped', () => {
    expect(snap({ 'printer-state': 4 }).status).toBe('running')
    expect(snap({ 'printer-state': 3 }).status).toBe('stopped')
    expect(snap({}).status).toBe('unknown')
  })

  /**
   * IPP gộp "người ta bấm tạm dừng" và "máy hỏng" vào cùng một `printer-state = stopped`.
   * Tách nhầm là hỏng đúng thứ dashboard tồn tại để làm: fault đứng đầu bảng ưu tiên, còn
   * paused thì không gọi ai dậy lúc nửa đêm.
   */
  it('stopped tách được tạm dừng với hỏng máy', () => {
    expect(snap({ 'printer-state': 5, 'printer-state-reasons': 'paused' }).status).toBe('paused')
    expect(snap({ 'printer-state': 5, 'printer-state-reasons': 'media-jam' }).status).toBe('fault')
    expect(snap({ 'printer-state': 5, 'printer-state-reasons': 'none' }).status).toBe('fault')
  })

  it('không bao giờ bịa RPM', () => {
    expect(snap({ 'printer-state': 4, 'pages-per-minute': 30 }).rpm).toBeNull()
  })

  /**
   * Không có bộ đếm thì không có tiến độ. Vẽ thanh tiến độ từ một con số tự nghĩ ra là
   * đúng thứ PRD cấm, và ở đây nó dễ xảy ra vì `job-media-progress` có sẵn dạng phần trăm.
   */
  it('chỉ có tiến độ khi máy in tự đếm trang', () => {
    expect(snap({ 'printer-state': 4 }, [{ 'job-state': 5, 'job-name': 'Bao cao.pdf', 'job-media-progress': 40 }]).job)
      .toEqual({ product: 'Bao cao.pdf', fileName: 'Bao cao.pdf', currentStitch: null, totalStitches: null, elapsedSeconds: null })

    expect(snap({ 'printer-state': 4 }, [{
      'job-state': 5, 'job-name': 'Bao cao.pdf', 'job-media-sheets': 12, 'job-media-sheets-completed': 5,
      'job-printer-up-time': 1000, 'time-at-processing': 940,
    }]).job).toEqual({ product: 'Bao cao.pdf', fileName: 'Bao cao.pdf', currentStitch: 5, totalStitches: 12, elapsedSeconds: 60 })
  })

  it('chỉ lấy việc đang chạy, không lấy việc còn xếp hàng', () => {
    const jobs = [{ 'job-state': 3, 'job-name': 'Xep hang.pdf' }, { 'job-state': 5, 'job-name': 'Dang in.pdf' }]
    expect(activeJob(jobs)?.['job-name']).toBe('Dang in.pdf')
    expect(snap({ 'printer-state': 4 }, jobs).job.product).toBe('Dang in.pdf')
  })

  it('không có việc nào thì job là null, không phải một job rỗng', () => {
    expect(snap({ 'printer-state': 3 }, []).job).toBeNull()
  })
})

describe('reasonsToEvents', () => {
  const at = '2026-08-15T03:00:00.000Z'

  it('bỏ qua "none" và mảng rỗng', () => {
    expect(reasonsToEvents('none', at)).toEqual([])
    expect(reasonsToEvents([], at)).toEqual([])
  })

  it('dịch mã máy in sang mức nghiêm trọng của dashboard', () => {
    expect(reasonsToEvents(['media-jam', 'toner-low'], at).map((event) => [event.code, event.severity]))
      .toEqual([['media-jam', 'critical'], ['toner-low', 'info']])
  })

  /** Hậu tố là mức do chính máy in gắn, nên nó thắng bảng tra cứu viết sẵn ở đây. */
  it('hậu tố -error/-warning/-report thắng bảng tra cứu', () => {
    const [event] = reasonsToEvents(['toner-low-error'], at)
    expect(event).toMatchObject({ code: 'toner-low', severity: 'critical' })
  })

  it('mã lạ vẫn thành sự kiện chứ không bị nuốt', () => {
    const [event] = reasonsToEvents(['hang-nay-chua-tung-gap'], at)
    expect(event).toMatchObject({ code: 'hang-nay-chua-tung-gap', severity: 'info' })
    expect(event.message).toContain('hang-nay-chua-tung-gap')
  })
})

/**
 * Chốt lại bằng chính bộ kiểm của bridge: rig này chỉ có giá trị nếu thứ nó phát ra đi qua
 * được contract thật. Nếu contract siết thêm luật, test này vỡ ở đây chứ không vỡ ở xưởng.
 */
describe('đi qua được contract của bridge', () => {
  const machine = { id: 'may-in-test', adapter: 'http-json' }

  it('máy in đang in với đủ sự kiện', () => {
    const snapshot = snapshotFromPrinter({
      printer: { 'printer-state': 4, 'printer-state-reasons': ['media-low', 'toner-low'], 'printer-impressions-completed': 24680 },
      jobs: [{ 'job-state': 5, 'job-name': 'Phieu giao hang.pdf', 'job-media-sheets': 8, 'job-media-sheets-completed': 3 }],
      observedAt: '2026-08-15T03:00:00.000Z',
    })
    const telemetry = normalizeTelemetry(snapshot, { machine, source: 'http-json' })
    expect(telemetry.status.value).toBe('running')
    expect(telemetry.job.value).toMatchObject({ product: 'Phieu giao hang.pdf', currentStitch: 3, totalStitches: 8 })
    expect(telemetry.odometer.value).toBe(24680)
    expect(telemetry.rpm).toBeNull()
    expect(telemetry.events.map((event) => event.severity)).toEqual(['info', 'info'])
  })

  it('máy in rảnh, không đọc được gì thêm', () => {
    const snapshot = snapshotFromPrinter({ printer: { 'printer-state': 3, 'printer-state-reasons': 'none' }, jobs: [], observedAt: '2026-08-15T03:00:00.000Z' })
    const telemetry = normalizeTelemetry(snapshot, { machine, source: 'http-json' })
    expect(telemetry.status.value).toBe('stopped')
    expect(telemetry.job).toBeNull()
    expect(telemetry.rpm).toBeNull()
    expect(telemetry.odometer).toBeNull()
  })
})

/**
 * Hai transport phải cho cùng một kết quả, và phải đo bằng byte thật qua một socket thật.
 * `curlTransport` sinh ra vì macOS chặn Node ra LAN (xem `local-network.mjs`); nếu nó lệch với
 * `fetchTransport` một byte thì cái rig sẽ nói dối đúng vào lúc ta cần nó nói thật nhất.
 */
describe('transport', () => {
  const body = buildResponse({
    groups: [{ tag: groupTags.printer, values: [[valueTags.enum, 'printer-state', 3], [valueTags.keyword, 'printer-state-reasons', 'none']] }],
  })

  async function serve(handler) {
    const server = createServer(handler)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${server.address().port}/printers/x`
    return { url, close: () => new Promise((resolve) => server.close(resolve)) }
  }

  it('fetch và curl đọc ra cùng một chuỗi byte', async () => {
    const seen = []
    const { url, close } = await serve((request, response) => {
      const chunks = []
      request.on('data', (chunk) => chunks.push(chunk))
      request.on('end', () => {
        seen.push({ method: request.method, type: request.headers['content-type'], body: Buffer.concat(chunks) })
        response.writeHead(200, { 'content-type': 'application/ipp' })
        response.end(body)
      })
    })
    try {
      const request = encodeRequest({ operation: operations.getPrinterAttributes, printerUri: 'ipp://x/p' })
      const viaFetch = await fetchTransport(url, request, { timeoutMs: 4000 })
      const viaCurl = await curlTransport(url, request, { timeoutMs: 4000 })
      expect(viaCurl.equals(viaFetch)).toBe(true)
      expect(decodeResponse(viaCurl)).toEqual(decodeResponse(viaFetch))
      // curl phải POST đúng thân nhị phân và đúng content-type, không được đổi một byte nào.
      expect(seen).toHaveLength(2)
      expect(seen[1]).toMatchObject({ method: 'POST', type: 'application/ipp' })
      expect(seen[1].body.equals(request)).toBe(true)
    } finally {
      await close()
    }
  })

  it('curl báo đúng mã HTTP khi máy in từ chối', async () => {
    const { url, close } = await serve((_request, response) => { response.writeHead(503); response.end('busy') })
    try {
      await expect(curlTransport(url, Buffer.alloc(0), { timeoutMs: 4000 })).rejects.toThrow('HTTP 503')
    } finally {
      await close()
    }
  })

  it('không có curl thì nói là không chạy được curl, không giả vờ là lỗi máy in', async () => {
    await expect(curlTransport('http://127.0.0.1:1/x', Buffer.alloc(0), { timeoutMs: 1000, curlPath: '/khong/co/curl' }))
      .rejects.toThrow('/khong/co/curl')
  })

  it('readPrinter dùng transport được truyền vào', async () => {
    const calls = []
    const transport = (endpoint, request, options) => {
      calls.push({ endpoint, options })
      return Promise.resolve(body)
    }
    const { snapshot } = await readPrinter({ endpoint: 'http://10.0.0.1:631/p', transport, now: () => '2026-08-17T00:00:00.000Z' })
    expect(calls).toHaveLength(2)
    expect(calls[0].endpoint).toBe('http://10.0.0.1:631/p')
    expect(snapshot.status).toBe('stopped')
  })
})
