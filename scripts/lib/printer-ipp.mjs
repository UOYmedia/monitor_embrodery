/**
 * Minimal IPP client + a mapping from what a printer really reports onto the telemetry
 * contract in bridge/lib/contract.mjs.
 *
 * Why a printer is in this repo at all: it is a real network device that can be plugged,
 * unplugged, jammed and emptied on a desk, which makes it the only honest way to exercise
 * the whole chain — poll loop, timeouts, circuit breaker, freshness transitions, WebSocket
 * deltas, alerts, audit — before an embroidery machine is physically available.
 *
 * What this is NOT:
 *  - not a Dahao adapter, and not a step towards one. It shares nothing with the Dahao wire
 *    format; the dial-in transport a real controller uses is not tested by this at all.
 *  - not a simulator. Every number here comes off the device. A field the printer does not
 *    report stays `null` and the dashboard says "Chưa đọc được từ controller" — the same
 *    rule the real adapters follow, exercised with real gaps instead of invented ones.
 *
 * IPP is HTTP POST with a binary body (RFC 8010/8011). No dependency needed: the encoder
 * below writes the handful of attribute types a Get-Printer-Attributes request uses, and
 * the decoder reads everything back generically.
 */

/** Delimiter tags. Anything ≤ 0x05 starts a new attribute group. */
const groupTags = { operation: 0x01, job: 0x02, end: 0x03, printer: 0x04, unsupported: 0x05 }

const valueTags = {
  integer: 0x21,
  boolean: 0x22,
  enum: 0x23,
  dateTime: 0x31,
  text: 0x41,
  name: 0x42,
  keyword: 0x44,
  uri: 0x45,
  charset: 0x47,
  language: 0x48,
}

export const operations = { getPrinterAttributes: 0x000b, getJobs: 0x000a }

function encodeAttribute(tag, name, value) {
  const nameBuffer = Buffer.from(name, 'utf8')
  const valueBuffer = typeof value === 'number'
    ? (() => { const buffer = Buffer.alloc(4); buffer.writeInt32BE(value); return buffer })()
    : Buffer.from(String(value), 'utf8')
  const header = Buffer.alloc(5)
  header.writeUInt8(tag, 0)
  header.writeUInt16BE(nameBuffer.length, 1)
  const middle = Buffer.alloc(2)
  middle.writeUInt16BE(valueBuffer.length, 0)
  return Buffer.concat([header.subarray(0, 3), nameBuffer, middle, valueBuffer])
}

/**
 * Builds one IPP request body.
 *
 * `requested` becomes a multi-valued `requested-attributes`: the second and later values
 * carry a zero-length name, which is how IPP says "another value for the attribute above".
 */
export function encodeRequest({ operation, requestId = 1, printerUri, requested = [], extra = [] }) {
  const parts = [
    Buffer.from([0x02, 0x00, (operation >> 8) & 0xff, operation & 0xff, 0, 0, (requestId >> 8) & 0xff, requestId & 0xff]),
    Buffer.from([groupTags.operation]),
    encodeAttribute(valueTags.charset, 'attributes-charset', 'utf-8'),
    encodeAttribute(valueTags.language, 'attributes-natural-language', 'en'),
    encodeAttribute(valueTags.uri, 'printer-uri', printerUri),
  ]
  for (const [index, entry] of extra.entries()) {
    parts.push(encodeAttribute(entry.tag, entry.name, entry.value))
    void index
  }
  for (const [index, attribute] of requested.entries()) {
    parts.push(encodeAttribute(valueTags.keyword, index === 0 ? 'requested-attributes' : '', attribute))
  }
  parts.push(Buffer.from([groupTags.end]))
  return Buffer.concat(parts)
}

/** RFC 2579 DateAndTime: 11 bytes ending in a signed offset from UTC. */
function decodeDateTime(raw) {
  if (raw.length < 11) return null
  const year = raw.readUInt16BE(0)
  const pad = (value, width = 2) => String(value).padStart(width, '0')
  const sign = String.fromCharCode(raw[8]) === '-' ? '-' : '+'
  const stamp = `${pad(year, 4)}-${pad(raw[2])}-${pad(raw[3])}T${pad(raw[4])}:${pad(raw[5])}:${pad(raw[6])}`
  const offset = `${sign}${pad(raw[9])}:${pad(raw[10])}`
  const parsed = Date.parse(`${stamp}${offset}`)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function decodeValue(tag, raw) {
  if (tag === valueTags.integer || tag === valueTags.enum) return raw.length >= 4 ? raw.readInt32BE(0) : null
  if (tag === valueTags.boolean) return raw.length >= 1 && raw[0] === 1
  if (tag === valueTags.dateTime) return decodeDateTime(raw)
  return raw.toString('utf8')
}

/**
 * Parses a response into `{ statusCode, groups }`, each group a flat name→value map.
 *
 * A printer that answers something unparseable must fail loudly rather than half-decode:
 * a truncated body means the caller should report a read error, not a partial snapshot.
 */
export function decodeResponse(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) throw new Error('Phản hồi IPP ngắn hơn 8 byte header.')
  const statusCode = buffer.readUInt16BE(2)
  const groups = []
  let current = null
  let lastName = null
  let offset = 8

  while (offset < buffer.length) {
    const tag = buffer.readUInt8(offset)
    offset += 1
    if (tag === groupTags.end) break
    if (tag <= groupTags.unsupported) {
      current = { tag, attributes: {} }
      groups.push(current)
      lastName = null
      continue
    }
    if (offset + 2 > buffer.length) throw new Error('Phản hồi IPP cụt ở phần tên thuộc tính.')
    const nameLength = buffer.readUInt16BE(offset)
    offset += 2
    const name = buffer.toString('utf8', offset, offset + nameLength)
    offset += nameLength
    if (offset + 2 > buffer.length) throw new Error('Phản hồi IPP cụt ở phần độ dài giá trị.')
    const valueLength = buffer.readUInt16BE(offset)
    offset += 2
    if (offset + valueLength > buffer.length) throw new Error('Phản hồi IPP khai độ dài giá trị vượt quá thân gói.')
    const value = decodeValue(tag, buffer.subarray(offset, offset + valueLength))
    offset += valueLength
    if (!current) continue

    if (nameLength === 0) {
      if (lastName === null) continue
      const existing = current.attributes[lastName]
      current.attributes[lastName] = Array.isArray(existing) ? [...existing, value] : [existing, value]
      continue
    }
    current.attributes[name] = value
    lastName = name
  }
  return { statusCode, groups }
}

export function groupOf(decoded, tag) {
  return decoded.groups.find((group) => group.tag === tag)?.attributes ?? {}
}

/** IPP `printer-state`. 3/4/5 are the only values the spec defines. */
const printerStates = { 3: 'idle', 4: 'processing', 5: 'stopped' }
/** IPP `job-state`. 5 is the one that means "on paper right now". */
const jobStates = { 3: 'pending', 4: 'pending-held', 5: 'processing', 6: 'processing-stopped', 7: 'canceled', 8: 'aborted', 9: 'completed' }

/**
 * `printer-state-reasons` → an event the dashboard can rank.
 *
 * Keywords may carry a `-warning` / `-error` / `-report` suffix (RFC 8011 §5.4.12); the
 * suffix is the printer's own severity, so it wins over the table when present.
 */
const reasonCatalog = {
  'media-jam': { severity: 'critical', message: 'Kẹt giấy' },
  'media-empty': { severity: 'warning', message: 'Hết giấy trong khay' },
  'media-needed': { severity: 'warning', message: 'Cần nạp giấy' },
  'media-low': { severity: 'info', message: 'Giấy sắp hết' },
  'toner-empty': { severity: 'critical', message: 'Hết mực' },
  'toner-low': { severity: 'info', message: 'Mực sắp hết' },
  'marker-supply-empty': { severity: 'critical', message: 'Hết vật tư in' },
  'marker-supply-low': { severity: 'info', message: 'Vật tư in sắp hết' },
  'cover-open': { severity: 'warning', message: 'Đang mở nắp máy' },
  'door-open': { severity: 'warning', message: 'Đang mở cửa máy' },
  'input-tray-missing': { severity: 'warning', message: 'Thiếu khay giấy' },
  'output-area-full': { severity: 'warning', message: 'Khay ra đầy' },
  'offline': { severity: 'critical', message: 'Máy in báo offline' },
  'shutdown': { severity: 'critical', message: 'Máy in đã tắt' },
  'paused': { severity: 'info', message: 'Hàng đợi đang tạm dừng' },
  'moving-to-paused': { severity: 'info', message: 'Đang chuyển sang tạm dừng' },
  'connecting-to-device': { severity: 'info', message: 'Đang kết nối tới máy in' },
  'timed-out': { severity: 'critical', message: 'Máy in không phản hồi' },
  'spool-area-full': { severity: 'warning', message: 'Vùng spool đầy' },
}

function splitReasonSuffix(keyword) {
  for (const [suffix, severity] of [['-error', 'critical'], ['-warning', 'warning'], ['-report', 'info']]) {
    if (keyword.endsWith(suffix)) return { base: keyword.slice(0, -suffix.length), severity }
  }
  return { base: keyword, severity: null }
}

export function reasonsToEvents(reasons, occurredAt) {
  const list = (Array.isArray(reasons) ? reasons : [reasons])
    .filter((entry) => typeof entry === 'string' && entry && entry !== 'none')
  return list.map((keyword) => {
    const { base, severity: fromSuffix } = splitReasonSuffix(keyword)
    const known = reasonCatalog[base]
    return {
      // The keyword is the printer's own code, so it is also the stable id across polls.
      id: `ipp-${base}`.slice(0, 80),
      code: base.slice(0, 40),
      severity: fromSuffix ?? known?.severity ?? 'info',
      message: known?.message ?? `Máy in báo trạng thái: ${base}`,
      occurredAt,
    }
  })
}

function firstNumber(...values) {
  for (const value of values) if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

/** The job actually on paper, if any. Held and pending jobs are queue, not production. */
export function activeJob(jobGroups) {
  return jobGroups.find((attributes) => jobStates[attributes['job-state']] === 'processing') ?? null
}

/**
 * Maps one poll onto the telemetry contract.
 *
 * The mapping table lives in docs/test-may-in.md; the two rules it follows are worth
 * repeating here, because they are the whole reason this file is allowed to exist:
 *
 *  - `rpm` is always null. `pages-per-minute` is a printed spec sheet number, not a live
 *    reading, and passing it off as speed is exactly the invented telemetry the product
 *    forbids. The dashboard showing "RPM chưa đọc" on this machine is correct.
 *  - progress is emitted only when the printer counts sheets itself. Many drivers (brlaser
 *    among them) do not, and then the card correctly says it has no number to draw a bar
 *    from — rather than a bar built out of a percentage invented here.
 */
export function snapshotFromPrinter({ printer, jobs = [], observedAt }) {
  const state = printerStates[printer['printer-state']] ?? null
  const reasons = (Array.isArray(printer['printer-state-reasons']) ? printer['printer-state-reasons'] : [printer['printer-state-reasons']])
    .filter((entry) => typeof entry === 'string' && entry && entry !== 'none')
  const job = activeJob(jobs)

  // `stopped` in IPP covers both "someone paused the queue" and "the thing is broken"; the
  // reasons are what tells them apart, and the dashboard ranks fault far above paused.
  const paused = reasons.some((reason) => reason.startsWith('paused') || reason.startsWith('moving-to-paused'))
  const status = state === 'processing' ? 'running'
    : state === 'stopped' ? (paused ? 'paused' : 'fault')
      : state === 'idle' ? 'stopped'
        : 'unknown'

  const done = firstNumber(job?.['job-media-sheets-completed'], job?.['job-impressions-completed'])
  const total = firstNumber(job?.['job-media-sheets'], job?.['job-impressions'])
  const upTime = firstNumber(job?.['job-printer-up-time'], printer['printer-up-time'])
  const startedAt = firstNumber(job?.['time-at-processing'])
  const elapsed = upTime !== null && startedAt !== null && upTime >= startedAt ? upTime - startedAt : null
  const name = typeof job?.['job-name'] === 'string' ? job['job-name'].slice(0, 120) : null

  const stateChangedAt = typeof printer['printer-state-change-date-time'] === 'string'
    ? printer['printer-state-change-date-time']
    : observedAt

  return {
    schemaVersion: 2,
    observedAt,
    status,
    rpm: null,
    // Only when the printer keeps a lifetime counter of its own. Summing the job history
    // would look like an odometer and then fall backwards the moment CUPS prunes it.
    odometer: firstNumber(printer['printer-impressions-completed'], printer['printer-pages-completed']),
    job: name === null && done === null ? null : {
      product: name,
      fileName: name,
      currentStitch: done !== null && total !== null ? Math.min(done, total) : done,
      totalStitches: total,
      elapsedSeconds: elapsed,
    },
    controller: {
      observedAt,
      firmware: typeof printer['printer-firmware-string-version'] === 'string'
        ? printer['printer-firmware-string-version'].slice(0, 80)
        : null,
    },
    events: reasonsToEvents(reasons, stateChangedAt),
  }
}

/** Attributes worth asking for. A short list keeps the response small on a weak LAN. */
export const printerAttributes = [
  'printer-state', 'printer-state-reasons', 'printer-state-message', 'printer-state-change-date-time',
  'printer-is-accepting-jobs', 'queued-job-count', 'printer-up-time', 'printer-make-and-model',
  'printer-firmware-string-version', 'printer-impressions-completed', 'printer-pages-completed',
]

export const jobAttributes = [
  'job-id', 'job-name', 'job-state', 'job-state-reasons', 'job-impressions', 'job-impressions-completed',
  'job-media-sheets', 'job-media-sheets-completed', 'job-printer-up-time', 'time-at-processing',
]

/**
 * One IPP round trip. `fetch` gives the timeout and body-size handling for free, and the
 * printer is a device on the LAN, so a redirect is never something to follow.
 */
async function ippRequest(endpoint, body, { timeoutMs }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/ipp' },
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Máy in trả về HTTP ${response.status}.`)
    const decoded = decodeResponse(Buffer.from(await response.arrayBuffer()))
    // 0x0000–0x00ff is the successful range; anything above is a real refusal.
    if (decoded.statusCode > 0x00ff) throw new Error(`Máy in từ chối yêu cầu IPP, status 0x${decoded.statusCode.toString(16)}.`)
    return decoded
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`Hết ${timeoutMs} ms chờ máy in trả lời IPP.`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** Reads the printer once and returns a contract-shaped snapshot. */
export async function readPrinter({ endpoint, printerUri = endpoint, timeoutMs = 4000, now = () => new Date().toISOString() }) {
  const printerResponse = await ippRequest(endpoint, encodeRequest({
    operation: operations.getPrinterAttributes,
    requestId: 1,
    printerUri,
    requested: printerAttributes,
  }), { timeoutMs })

  const jobsResponse = await ippRequest(endpoint, encodeRequest({
    operation: operations.getJobs,
    requestId: 2,
    printerUri,
    requested: jobAttributes,
    extra: [{ tag: valueTags.keyword, name: 'which-jobs', value: 'not-completed' }],
  }), { timeoutMs })

  const printer = groupOf(printerResponse, groupTags.printer)
  const jobs = jobsResponse.groups.filter((group) => group.tag === groupTags.job).map((group) => group.attributes)
  return { snapshot: snapshotFromPrinter({ printer, jobs, observedAt: now() }), printer, jobs }
}

export { groupTags, valueTags }
