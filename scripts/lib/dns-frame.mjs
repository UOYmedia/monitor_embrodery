/**
 * DNS query wire format — parse a query, build an answer, and say what a queried name means.
 * This is the logic half of the `Z02 DNS Server` probe; the socket half is scripts/dns-log.mjs.
 *
 * Why this exists: the controller answers nothing. Every TCP port from 1 to 65535 replies with an
 * instant RST, it never dials out to `C44:C41`, and it emits no broadcast. The one thing left that
 * a machine with a working network stack cannot avoid is **asking for a name**. `Z02 DNS Server` is
 * a field we control, so pointing it at a listener we own turns the controller's own silence into
 * evidence:
 *
 *  - no query at all  → the network stack never came up. Stop probing, go ask the dealer.
 *  - `*.dahaoyun.net` → the cloud path is real, and we now know the exact hostname.
 *  - an NTP name      → the stack is alive and merely syncing the clock. Keep waiting.
 *  - a vendor name    → a lead worth more than Dahao's own, because it is the bolted-on IoT module.
 *
 * That is why the parser below is defensive rather than clever, and why the caller is expected to
 * record datagrams it cannot parse instead of dropping them: a non-DNS datagram arriving on port 53
 * would itself be a finding, and a finding thrown away is a finding that has to be bought twice.
 *
 * No dependency: a query is a 12-byte header plus length-prefixed labels (RFC 1035 §4).
 */

const HEADER_BYTES = 12
const MAX_NAME_BYTES = 255
const POINTER_MASK = 0xc0

/** Thrown for anything that is not a well-formed DNS message. Callers log the raw bytes instead. */
export class DnsFrameError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DnsFrameError'
  }
}

export const RCODES = {
  noError: 0,
  formatError: 1,
  serverFailure: 2,
  nameError: 3, /* NXDOMAIN */
  notImplemented: 4,
  refused: 5,
}

/** Only the types a controller or an IoT module plausibly asks for; the rest print as `TYPE<n>`. */
export const TYPES = {
  1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT',
  28: 'AAAA', 33: 'SRV', 35: 'NAPTR', 41: 'OPT', 43: 'DS', 64: 'SVCB', 65: 'HTTPS', 255: 'ANY',
}

export function typeName(type) {
  return TYPES[type] ?? `TYPE${type}`
}

/**
 * Reads one QNAME. Compression pointers do not belong in a question section, but a pointer loop is
 * a two-byte denial of service, so they are followed with a visited set and a cap either way.
 *
 * Returns the name in lower case without the trailing dot, plus the offset just past the name as it
 * was written at `start` (not past the pointer target).
 */
function readName(buffer, start) {
  const labels = []
  let offset = start
  let next = null
  let total = 0
  const seen = new Set()

  for (;;) {
    if (offset >= buffer.length) throw new DnsFrameError(`nhãn chạy quá cuối gói tại byte ${offset}`)
    const length = buffer[offset]

    if ((length & POINTER_MASK) === POINTER_MASK) {
      if (offset + 1 >= buffer.length) throw new DnsFrameError('con trỏ nén bị cắt mất byte thứ hai')
      const target = ((length & 0x3f) << 8) | buffer[offset + 1]
      if (seen.has(target)) throw new DnsFrameError(`con trỏ nén tạo vòng lặp tại byte ${target}`)
      if (target >= buffer.length) throw new DnsFrameError(`con trỏ nén trỏ ra ngoài gói: ${target}`)
      seen.add(target)
      if (next === null) next = offset + 2
      offset = target
      continue
    }
    if ((length & POINTER_MASK) !== 0) {
      throw new DnsFrameError(`byte độ dài nhãn không hợp lệ: 0x${length.toString(16)}`)
    }
    if (length === 0) {
      if (next === null) next = offset + 1
      break
    }

    total += length + 1
    if (total > MAX_NAME_BYTES) throw new DnsFrameError(`tên dài quá ${MAX_NAME_BYTES} byte`)
    if (offset + 1 + length > buffer.length) {
      throw new DnsFrameError(`nhãn dài ${length} byte nhưng gói chỉ còn ${buffer.length - offset - 1}`)
    }
    labels.push(buffer.toString('latin1', offset + 1, offset + 1 + length))
    offset += 1 + length
  }

  return { name: labels.join('.').toLowerCase(), next }
}

/**
 * Parses a query. `questions` may legitimately be empty (QDCOUNT 0), which is itself worth logging;
 * anything structurally broken throws, because a half-read name would put an invented hostname in
 * the evidence file and the whole point of the probe is that the hostname is the evidence.
 */
export function parseQuery(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new DnsFrameError('không phải Buffer')
  if (buffer.length < HEADER_BYTES) {
    throw new DnsFrameError(`gói dài ${buffer.length} byte, header DNS cần ${HEADER_BYTES}`)
  }

  const id = buffer.readUInt16BE(0)
  const flags = buffer.readUInt16BE(2)
  const counts = {
    questions: buffer.readUInt16BE(4),
    answers: buffer.readUInt16BE(6),
    authority: buffer.readUInt16BE(8),
    additional: buffer.readUInt16BE(10),
  }

  const questions = []
  let offset = HEADER_BYTES
  for (let index = 0; index < counts.questions; index += 1) {
    const { name, next } = readName(buffer, offset)
    if (next + 4 > buffer.length) throw new DnsFrameError(`thiếu QTYPE/QCLASS cho câu hỏi ${index + 1}`)
    questions.push({ name, type: buffer.readUInt16BE(next), class: buffer.readUInt16BE(next + 2) })
    offset = next + 4
  }

  return {
    id,
    header: {
      isResponse: (flags & 0x8000) !== 0,
      opcode: (flags >> 11) & 0x0f,
      truncated: (flags & 0x0200) !== 0,
      recursionDesired: (flags & 0x0100) !== 0,
      rcode: flags & 0x0f,
    },
    counts,
    questions,
    /** Where the question section ends — the byte range a response has to copy verbatim. */
    questionEnd: offset,
  }
}

/**
 * Builds a reply that echoes the question and carries no answer record.
 *
 * Default `NXDOMAIN` on purpose. `SERVFAIL` makes a resolver retry the same name and look for
 * another server — and `Z02` is a single field, so there is nowhere else to look, meaning the log
 * fills with one name repeated. `NXDOMAIN` is taken as final, so the client moves on to the next
 * name it wanted, and the log ends up holding the controller's whole hostname list. Enumerating
 * that list is the entire purpose.
 */
export function buildResponse(query, buffer, { rcode = RCODES.nameError } = {}) {
  const questionBytes = buffer.subarray(HEADER_BYTES, query.questionEnd)
  const header = Buffer.alloc(HEADER_BYTES)
  header.writeUInt16BE(query.id, 0)
  /* QR=1, OPCODE echoed, RD echoed, RA=0 (we never recurse in this mode), RCODE as asked. */
  const flags = 0x8000
    | ((query.header.opcode & 0x0f) << 11)
    | (query.header.recursionDesired ? 0x0100 : 0)
    | (rcode & 0x0f)
  header.writeUInt16BE(flags, 2)
  header.writeUInt16BE(query.questions.length, 4)
  return Buffer.concat([header, questionBytes])
}

/**
 * What a queried name tells us, mirroring the decision table in PRD_LAN_MA_NGUON_MO.md §4.3.
 *
 * `verdict` is a stable slug for tests and for the JSONL evidence file; `meaning` and `next` are the
 * lines the operator reads. Order matters: a Dahao name wins over a generic vendor match.
 */
export function classifyQuery(name) {
  const lower = String(name ?? '').toLowerCase()

  if (/(^|\.)dahaoyun\.net$|(^|\.)dahaobj\.com$|dahao/.test(lower)) {
    return {
      verdict: 'dahao-cloud',
      meaning: 'Máy đang gọi đám mây Dahao. Ngăn xếp mạng SỐNG và đường cloud là thật.',
      next: 'Ghi lại đúng tên miền này, rồi sang PRD §4.4. Gặp TLS thì dừng, đi hỏi hãng.',
    }
  }
  if (/(^|\.)(ntp|time)\b|ntp\.org$|(^|\.)time\./.test(lower)) {
    return {
      verdict: 'time-sync',
      meaning: 'Máy đang đồng bộ giờ. Ngăn xếp mạng SỐNG — đây là tin tốt.',
      next: 'Chờ thêm để bắt tên miền chính; máy thường hỏi giờ trước khi gọi server của nó.',
    }
  }
  if (/hilcom|lierda/.test(lower)) {
    return {
      verdict: 'iot-module',
      meaning: 'Tên của module IoT gắn thêm (tem HILCOM / MAC Lierda ec:30:8e), không phải của Dahao.',
      next: 'Đầu mối quan trọng hơn cả Dahao: tra tên miền, rồi hỏi HILCOM xin API.',
    }
  }
  if (lower === '') {
    return {
      verdict: 'empty',
      meaning: 'Gói DNS không có câu hỏi nào (QDCOUNT 0).',
      next: 'Ghi lại nguyên hex. Đây là hành vi lạ, không phải tra tên bình thường.',
    }
  }
  return {
    verdict: 'unknown',
    meaning: 'Tên miền lạ — chưa biết của ai.',
    next: 'Tra WHOIS tên miền này trước khi kết luận. Có thể là nhà tích hợp, có thể là bên thứ ba.',
  }
}

/** Verdicts that do not come from a hostname, so `classifyQuery` cannot describe them. */
const VERDICTS_WITHOUT_NAME = {
  'no-query': {
    meaning: 'Không một truy vấn nào. Ngăn xếp mạng của máy chưa hề bật.',
    next: 'Trước khi kết luận: máy có bật, có đúng Z02 = IP máy này, đã tắt/bật nguồn chưa? '
      + 'Đủ ba cái đó mà vẫn trắng thì hết đường tự làm — đi hỏi đại lý và HILCOM.',
  },
  'not-dns': {
    meaning: 'Có gói tới cổng 53 nhưng không phải DNS. Tự nó đã là một phát hiện.',
    next: 'Đọc hex trong file log. Đừng đoán giao thức — đối chiếu với máy thật rồi mới kết luận.',
  },
}

/**
 * The verdict for a whole run, including the one the operator is most likely to mis-read: a session
 * that logged nothing. Zero queries is a real result, not a failed test — but only if the machine
 * was actually powered and pointed at this listener, which no software here can check.
 *
 * Entries with `name: null` are datagrams that were not DNS at all; they are counted separately from
 * `name: ''` (a real DNS packet carrying no question), because conflating the two would hide the
 * more interesting of the two findings.
 */
export function summarize(entries) {
  const byName = new Map()
  for (const entry of entries) {
    const key = entry.name ?? null
    const seen = byName.get(key) ?? { name: key, count: 0, types: new Set(), verdict: entry.verdict }
    seen.count += 1
    if (entry.type != null) seen.types.add(typeName(entry.type))
    byName.set(key, seen)
  }

  const names = [...byName.values()]
    .map((seen) => ({ ...seen, types: [...seen.types].sort() }))
    .sort((a, b) => b.count - a.count || (a.name ?? '').localeCompare(b.name ?? ''))

  if (entries.length === 0) return { names, verdict: 'no-query', ...VERDICTS_WITHOUT_NAME['no-query'] }

  const priority = ['dahao-cloud', 'iot-module', 'unknown', 'not-dns', 'time-sync', 'empty']
  const found = new Set(names.map((seen) => seen.verdict))
  const verdict = priority.find((slug) => found.has(slug)) ?? 'unknown'
  if (VERDICTS_WITHOUT_NAME[verdict]) return { names, verdict, ...VERDICTS_WITHOUT_NAME[verdict] }
  const { meaning, next } = classifyQuery(names.find((seen) => seen.verdict === verdict)?.name ?? '')
  return { names, verdict, meaning, next }
}
