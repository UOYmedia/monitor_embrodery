import { describe, expect, it } from 'vitest'
import {
  DnsFrameError, RCODES, buildResponse, classifyQuery, parseQuery, summarize, typeName,
} from './dns-frame.mjs'

/** Writes a QNAME the way a resolver does, so the parser is tested against bytes, not against a mock. */
function encodeName(name) {
  const labels = name === '' ? [] : name.split('.')
  return Buffer.concat([
    ...labels.map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label, 'latin1')])),
    Buffer.from([0]),
  ])
}

function buildQuery({ id = 0x1234, questions = [{ name: 'main.iot.dahaoyun.net', type: 1, class: 1 }], flags = 0x0100, qdcount } = {}) {
  const header = Buffer.alloc(12)
  header.writeUInt16BE(id, 0)
  header.writeUInt16BE(flags, 2)
  header.writeUInt16BE(qdcount ?? questions.length, 4)
  const body = questions.map((question) => {
    const tail = Buffer.alloc(4)
    tail.writeUInt16BE(question.type, 0)
    tail.writeUInt16BE(question.class, 2)
    return Buffer.concat([encodeName(question.name), tail])
  })
  return Buffer.concat([header, ...body])
}

describe('parseQuery', () => {
  it('đọc được id, tên miền, kiểu và lớp của một truy vấn A', () => {
    const query = parseQuery(buildQuery())
    expect(query.id).toBe(0x1234)
    expect(query.header.isResponse).toBe(false)
    expect(query.header.recursionDesired).toBe(true)
    expect(query.header.rcode).toBe(RCODES.noError)
    expect(query.counts.questions).toBe(1)
    expect(query.questions).toEqual([{ name: 'main.iot.dahaoyun.net', type: 1, class: 1 }])
    expect(query.questionEnd).toBe(12 + 'main.iot.dahaoyun.net'.length + 2 + 4)
  })

  it('hạ tên miền về chữ thường để hai lần hỏi cùng một tên không đếm thành hai', () => {
    expect(parseQuery(buildQuery({ questions: [{ name: 'MAIN.IoT.DahaoYun.NET', type: 28, class: 1 }] })).questions[0].name)
      .toBe('main.iot.dahaoyun.net')
  })

  it('đọc được nhiều câu hỏi trong một gói', () => {
    const query = parseQuery(buildQuery({
      questions: [
        { name: 'pool.ntp.org', type: 1, class: 1 },
        { name: 'a.b', type: 28, class: 1 },
      ],
    }))
    expect(query.questions.map((question) => question.name)).toEqual(['pool.ntp.org', 'a.b'])
    expect(query.questions[1].type).toBe(28)
  })

  it('chấp nhận QDCOUNT = 0 — gói lạ vẫn phải ghi được, không được ném đi', () => {
    const query = parseQuery(buildQuery({ questions: [], qdcount: 0 }))
    expect(query.questions).toEqual([])
    expect(query.counts.questions).toBe(0)
  })

  it('từ chối gói ngắn hơn header', () => {
    expect(() => parseQuery(Buffer.alloc(11))).toThrow(DnsFrameError)
  })

  it('từ chối thứ không phải Buffer', () => {
    expect(() => parseQuery('main.iot.dahaoyun.net')).toThrow(DnsFrameError)
  })

  it('từ chối nhãn khai dài hơn phần còn lại của gói', () => {
    const buffer = Buffer.concat([buildQuery({ questions: [], qdcount: 1 }), Buffer.from([0x05, 0x61, 0x62])])
    expect(() => parseQuery(buffer)).toThrow(/nhãn dài 5 byte/)
  })

  it('từ chối con trỏ nén tạo vòng lặp thay vì treo máy', () => {
    const buffer = Buffer.concat([buildQuery({ questions: [], qdcount: 1 }), Buffer.from([0xc0, 0x0c])])
    expect(() => parseQuery(buffer)).toThrow(/vòng lặp/)
  })

  it('từ chối con trỏ nén trỏ ra ngoài gói', () => {
    const buffer = Buffer.concat([buildQuery({ questions: [], qdcount: 1 }), Buffer.from([0xc0, 0xff])])
    expect(() => parseQuery(buffer)).toThrow(/ra ngoài gói/)
  })

  it('từ chối byte độ dài nhãn không hợp lệ', () => {
    const buffer = Buffer.concat([buildQuery({ questions: [], qdcount: 1 }), Buffer.from([0x40, 0x61, 0x00])])
    expect(() => parseQuery(buffer)).toThrow(/không hợp lệ/)
  })

  it('từ chối tên dài quá 255 byte', () => {
    const long = Array.from({ length: 60 }, () => 'aaaa').join('.')
    const buffer = Buffer.concat([buildQuery({ questions: [], qdcount: 1 }), encodeName(long), Buffer.from([0, 1, 0, 1])])
    expect(() => parseQuery(buffer)).toThrow(/255 byte/)
  })

  it('từ chối gói thiếu QTYPE/QCLASS sau tên', () => {
    const buffer = Buffer.concat([buildQuery({ questions: [], qdcount: 1 }), encodeName('a.b'), Buffer.from([0, 1])])
    expect(() => parseQuery(buffer)).toThrow(/thiếu QTYPE/)
  })
})

describe('buildResponse', () => {
  it('trả lời NXDOMAIN, giữ nguyên id và copy y nguyên phần câu hỏi', () => {
    const buffer = buildQuery()
    const query = parseQuery(buffer)
    const response = buildResponse(query, buffer)

    expect(response.readUInt16BE(0)).toBe(0x1234)
    expect(response.readUInt16BE(4)).toBe(1) /* QDCOUNT */
    expect(response.readUInt16BE(6)).toBe(0) /* ANCOUNT — không bao giờ bịa bản ghi trả lời */
    expect(response.subarray(12)).toEqual(buffer.subarray(12))

    const parsed = parseQuery(response)
    expect(parsed.header.isResponse).toBe(true)
    expect(parsed.header.rcode).toBe(RCODES.nameError)
    expect(parsed.header.recursionDesired).toBe(true)
    expect(parsed.questions[0].name).toBe('main.iot.dahaoyun.net')
  })

  it('nhận rcode khác khi cần', () => {
    const buffer = buildQuery()
    const response = buildResponse(parseQuery(buffer), buffer, { rcode: RCODES.refused })
    expect(parseQuery(response).header.rcode).toBe(RCODES.refused)
  })
})

describe('classifyQuery', () => {
  it('nhận ra đám mây Dahao', () => {
    expect(classifyQuery('main.iot.dahaoyun.net').verdict).toBe('dahao-cloud')
    expect(classifyQuery('www.dahaobj.com').verdict).toBe('dahao-cloud')
  })

  it('nhận ra đồng bộ giờ là tin tốt, không phải tên miền chính', () => {
    expect(classifyQuery('pool.ntp.org').verdict).toBe('time-sync')
    expect(classifyQuery('time.windows.com').verdict).toBe('time-sync')
  })

  it('nhận ra module IoT gắn thêm', () => {
    expect(classifyQuery('api.hilcom.cn').verdict).toBe('iot-module')
    expect(classifyQuery('iot.lierda.com').verdict).toBe('iot-module')
  })

  it('tên lạ thì nói thẳng là chưa biết, không đoán', () => {
    const verdict = classifyQuery('abc.example.net')
    expect(verdict.verdict).toBe('unknown')
    expect(verdict.next).toMatch(/WHOIS/)
  })

  it('gói không có câu hỏi', () => {
    expect(classifyQuery('').verdict).toBe('empty')
  })
})

describe('summarize', () => {
  it('không có truy vấn nào là một kết luận thật, kèm ba điều kiện phải tự kiểm', () => {
    const summary = summarize([])
    expect(summary.verdict).toBe('no-query')
    expect(summary.next).toMatch(/tắt\/bật nguồn/)
    expect(summary.names).toEqual([])
  })

  it('gộp theo tên, đếm số lần và liệt kê các kiểu đã hỏi', () => {
    const summary = summarize([
      { name: 'pool.ntp.org', type: 1, verdict: 'time-sync' },
      { name: 'pool.ntp.org', type: 28, verdict: 'time-sync' },
      { name: 'pool.ntp.org', type: 1, verdict: 'time-sync' },
    ])
    expect(summary.names).toEqual([{ name: 'pool.ntp.org', count: 3, types: ['A', 'AAAA'], verdict: 'time-sync' }])
    expect(summary.verdict).toBe('time-sync')
  })

  it('gói không phải DNS (name null) không bị gộp với gói DNS rỗng câu hỏi (name rỗng)', () => {
    const summary = summarize([
      { name: null, type: null, verdict: 'not-dns' },
      { name: '', type: null, verdict: 'empty' },
    ])
    expect(summary.names.map((seen) => seen.verdict).sort()).toEqual(['empty', 'not-dns'])
    expect(summary.names).toHaveLength(2)
  })

  it('chỉ có gói không phải DNS thì kết luận nói đúng chuyện đó, không nói "tên miền lạ"', () => {
    const summary = summarize([{ name: null, type: null, verdict: 'not-dns' }])
    expect(summary.verdict).toBe('not-dns')
    expect(summary.meaning).toMatch(/không phải DNS/)
    expect(summary.next).toMatch(/hex/)
  })

  it('tên Dahao thắng tên đồng bộ giờ khi cùng xuất hiện', () => {
    const summary = summarize([
      { name: 'pool.ntp.org', type: 1, verdict: 'time-sync' },
      { name: 'pool.ntp.org', type: 1, verdict: 'time-sync' },
      { name: 'main.iot.dahaoyun.net', type: 1, verdict: 'dahao-cloud' },
    ])
    expect(summary.verdict).toBe('dahao-cloud')
    expect(summary.next).toMatch(/§4\.4/)
    expect(summary.names[0].name).toBe('pool.ntp.org') /* xếp theo số lần, không theo mức quan trọng */
  })
})

describe('typeName', () => {
  it('dịch kiểu đã biết và không bịa kiểu chưa biết', () => {
    expect(typeName(1)).toBe('A')
    expect(typeName(65)).toBe('HTTPS')
    expect(typeName(99)).toBe('TYPE99')
  })
})
