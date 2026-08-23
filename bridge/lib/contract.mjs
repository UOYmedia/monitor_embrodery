import { SCHEMA_VERSION } from './config.mjs'

/**
 * Versioned adapter -> bridge -> dashboard telemetry contract.
 *
 * Two rules drive every function here:
 *  1. A field the adapter did not read stays `null`. The bridge never substitutes a
 *     default, a cached value or an inference so the UI can honestly say
 *     "Chưa đọc được từ controller".
 *  2. A field the adapter sent with the wrong shape is a hard error for the whole
 *     payload. A malformed response must never be merged into the previous snapshot.
 */

export { SCHEMA_VERSION }

export const operationalStatuses = ['running', 'paused', 'stopped', 'fault', 'unknown']
export const eventSeverities = ['info', 'warning', 'critical']

/**
 * Who observed the event. An event is a claim about the machine, so it must carry who made it.
 *
 * `controller` = the machine reported it itself. `sensor` = an external node bolted onto the
 * machine reported it (firmware/esp32-stitch-node). The distinction is not cosmetic: the
 * controller knows *why* it stopped, an external sensor only knows *that* the spindle stopped
 * turning, and a workshop deciding whether to open the machine needs to know which it is
 * reading. Labelling a sensor's guess as `controller` would be the one thing this contract
 * exists to prevent — see rule 1 in the header.
 */
export const eventSources = ['controller', 'sensor']
export const adapterKinds = ['manual', 'http-json', 'tcp-json-line', 'dial-in']

/**
 * How a reading came to exist. Every reading in a snapshot carries one, and it is never inferred.
 *
 * `verified` = a machine produced the number, whether the bridge polled it or the controller
 * pushed it. `manual` = a person read the controller screen and typed it in.
 *
 * The distinction has to travel *with the value*, not sit in a separate log, because these two
 * kinds of number get used for the same thing — piece-rate pay — and only one of them can be
 * re-derived if it is ever disputed. A hand-typed reading is a claim about the past made by a
 * named person; a polled reading is a measurement. Presenting them identically is how a
 * dashboard starts laundering the first into the second.
 *
 * Consequences enforced elsewhere, listed here because this constant is where a reader will
 * look for them: a `manual` reading never marks a machine reachable (`bridge-service.mjs`),
 * never makes it read `online` (`freshness.mjs`), and never contributes machine run time
 * (`production.mjs`).
 */
export const readingQualities = ['verified', 'manual']

/** `manual` is a placeholder registration, not a protocol: it can never produce telemetry. */
export function adapterHasProtocol(adapter) {
  return adapter !== 'manual'
}

/**
 * `dial-in` machines are the ones that call the bridge, so the bridge must never call them.
 *
 * The Dahao manual (BECS-528 Appendix IV) has the controller open the connection to whatever
 * `C44 Server IP` / `C41 Server Port` point at. Polling such a machine would at best hit a
 * closed port and at worst poke an unrelated device that now owns that address.
 */
export function adapterIsPolled(adapter) {
  return adapter !== 'manual' && adapter !== 'dial-in'
}

export class ContractError extends Error {
  constructor(message, field) {
    super(message)
    this.name = 'ContractError'
    this.field = field
    this.status = 400
  }
}

function fail(message, field) { throw new ContractError(message, field) }
function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }

export function isIsoTimestamp(value) {
  if (typeof value !== 'string') return false
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(value)) return false
  return Number.isFinite(Date.parse(value))
}

function isoOr(value, fallback, field) {
  if (value === undefined || value === null) return fallback
  if (!isIsoTimestamp(value)) fail(`${field} phải là thời gian ISO 8601 (ví dụ 2026-08-14T07:00:00Z).`, field)
  return new Date(value).toISOString()
}

function optionalNumber(value, field, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field} phải là số hợp lệ.`, field)
  if (integer && !Number.isInteger(value)) fail(`${field} phải là số nguyên.`, field)
  if (value < min || value > max) fail(`${field} phải nằm trong khoảng ${min}–${max}.`, field)
  return value
}

function optionalString(value, field, { maxLength = 200 } = {}) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') fail(`${field} phải là chuỗi.`, field)
  const trimmed = value.trim()
  if (trimmed.length > maxLength) fail(`${field} vượt quá ${maxLength} ký tự.`, field)
  return trimmed || null
}

/**
 * Wraps a decoded value with the provenance the dashboard needs to explain it.
 * Returns null when the adapter did not supply the field at all.
 */
export function reading(value, { observedAt, source, quality = 'verified' }) {
  return value === null || value === undefined ? null : { value, observedAt, source, quality }
}

/** Accepts either a bare value or `{ value, observedAt }` so adapters can date individual fields. */
function unwrapField(raw, field) {
  if (isObject(raw) && 'value' in raw) {
    return { value: raw.value, observedAt: raw.observedAt === undefined ? null : isoOr(raw.observedAt, null, `${field}.observedAt`) }
  }
  return { value: raw, observedAt: null }
}

function readNumberField(raw, field, options, context) {
  const { value, observedAt } = unwrapField(raw, field)
  return reading(optionalNumber(value, field, options), { ...context, observedAt: observedAt ?? context.observedAt })
}

function normalizeBounds(raw, field) {
  if (raw === undefined || raw === null) return null
  if (!isObject(raw)) fail(`${field} phải là object minX/maxX/minY/maxY.`, field)
  const bounds = {
    minX: optionalNumber(raw.minX, `${field}.minX`),
    maxX: optionalNumber(raw.maxX, `${field}.maxX`),
    minY: optionalNumber(raw.minY, `${field}.minY`),
    maxY: optionalNumber(raw.maxY, `${field}.maxY`),
  }
  if (Object.values(bounds).some((value) => value === null)) fail(`${field} cần đủ minX, maxX, minY và maxY.`, field)
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) fail(`${field} có giá trị nhỏ nhất lớn hơn lớn nhất.`, field)
  return bounds
}

function normalizeControllerDesign(raw, index) {
  const field = `controller.designs[${index}]`
  if (!isObject(raw)) fail(`${field} phải là object.`, field)
  const name = optionalString(raw.name ?? raw.fileName, `${field}.name`)
  if (!name) fail(`${field} cần tên mẫu do controller báo cáo.`, field)
  return {
    id: optionalString(raw.id, `${field}.id`) ?? `design-${index}`,
    name,
    slot: optionalNumber(raw.slot, `${field}.slot`, { min: 0, integer: true }),
    totalStitches: optionalNumber(raw.totalStitches ?? raw.stitchCount, `${field}.totalStitches`, { min: 0, integer: true }),
    colorChanges: optionalNumber(raw.colorChanges, `${field}.colorChanges`, { min: 0, integer: true }),
    bounds: normalizeBounds(raw.bounds, `${field}.bounds`),
  }
}

function normalizeControllerNetwork(raw) {
  if (raw === undefined || raw === null) return null
  if (!isObject(raw)) fail('controller.network phải là object.', 'controller.network')
  const transport = optionalString(raw.transport, 'controller.network.transport')
  if (!transport) fail('controller.network cần transport là wifi hoặc ethernet.', 'controller.network.transport')
  if (!['wifi', 'ethernet'].includes(transport)) fail('controller.network.transport chỉ nhận wifi hoặc ethernet.', 'controller.network.transport')
  const band = optionalString(raw.band, 'controller.network.band')
  if (band && !['2.4 GHz', '5 GHz'].includes(band)) fail('controller.network.band chỉ nhận "2.4 GHz" hoặc "5 GHz".', 'controller.network.band')
  if (band && transport !== 'wifi') fail('controller.network.band chỉ hợp lệ khi transport là wifi.', 'controller.network.band')
  return {
    transport,
    band: band ?? null,
    signalPercent: optionalNumber(raw.signalPercent, 'controller.network.signalPercent', { min: 0, max: 100 }),
    ssid: optionalString(raw.ssid, 'controller.network.ssid', { maxLength: 64 }),
  }
}

/**
 * Read-only mirror of what the controller screen reports. There is deliberately no
 * transfer state, no upload target and no design-selection command in this contract.
 */
function normalizeController(raw, context) {
  if (raw === undefined || raw === null) return null
  if (!isObject(raw)) fail('controller phải là object.', 'controller')
  if ('transfer' in raw) fail('controller.transfer đã bị loại khỏi contract: sản phẩm này không có luồng truyền file.', 'controller.transfer')
  const frame = raw.frame === undefined || raw.frame === null ? null : (() => {
    if (!isObject(raw.frame)) fail('controller.frame phải là object width/height.', 'controller.frame')
    const width = optionalNumber(raw.frame.width, 'controller.frame.width', { min: 0 })
    const height = optionalNumber(raw.frame.height, 'controller.frame.height', { min: 0 })
    if (width === null || height === null) fail('controller.frame cần cả width và height.', 'controller.frame')
    return { width, height }
  })()

  const selected = raw.selectedDesign === undefined || raw.selectedDesign === null ? null : (() => {
    if (!isObject(raw.selectedDesign)) fail('controller.selectedDesign phải là object.', 'controller.selectedDesign')
    return {
      id: optionalString(raw.selectedDesign.id, 'controller.selectedDesign.id'),
      name: optionalString(raw.selectedDesign.name ?? raw.selectedDesign.fileName, 'controller.selectedDesign.name'),
      slot: optionalNumber(raw.selectedDesign.slot, 'controller.selectedDesign.slot', { min: 0, integer: true }),
      totalStitches: optionalNumber(raw.selectedDesign.totalStitches, 'controller.selectedDesign.totalStitches', { min: 0, integer: true }),
      colorChanges: optionalNumber(raw.selectedDesign.colorChanges, 'controller.selectedDesign.colorChanges', { min: 0, integer: true }),
      bounds: normalizeBounds(raw.selectedDesign.bounds, 'controller.selectedDesign.bounds'),
    }
  })()

  if (raw.designs !== undefined && raw.designs !== null && !Array.isArray(raw.designs)) fail('controller.designs phải là mảng.', 'controller.designs')
  const designs = Array.isArray(raw.designs) ? raw.designs.map(normalizeControllerDesign) : null
  if (designs && designs.length > 200) fail('controller.designs vượt 200 mục; adapter cần phân trang.', 'controller.designs')

  return {
    observedAt: isoOr(raw.observedAt, context.observedAt, 'controller.observedAt'),
    source: context.source,
    quality: context.quality,
    selectedDesign: selected,
    designCount: optionalNumber(raw.designCount, 'controller.designCount', { min: 0, integer: true }),
    designs,
    frame,
    network: normalizeControllerNetwork(raw.network),
    firmware: optionalString(raw.firmware, 'controller.firmware', { maxLength: 80 }),
    hoopName: optionalString(raw.hoopName, 'controller.hoopName', { maxLength: 80 }),
  }
}

function normalizeEvent(raw, index, context) {
  const field = `events[${index}]`
  if (!isObject(raw)) fail(`${field} phải là object.`, field)
  const severity = optionalString(raw.severity, `${field}.severity`)
  if (!severity || !eventSeverities.includes(severity)) fail(`${field}.severity phải là info, warning hoặc critical.`, `${field}.severity`)
  const code = optionalString(raw.code, `${field}.code`, { maxLength: 40 })
  if (!code) fail(`${field}.code là bắt buộc.`, `${field}.code`)
  const occurredAt = raw.occurredAt ?? raw.at
  if (occurredAt === undefined || occurredAt === null) fail(`${field}.occurredAt là bắt buộc và phải là ISO 8601 UTC.`, `${field}.occurredAt`)
  // Vắng `source` thì mặc định `controller`: mọi adapter viết trước khi có node cảm biến đều
  // đang nói thay controller, nên mặc định đó giữ đúng nghĩa cũ của những gói cũ. Nhưng gửi một
  // giá trị lạ thì phải hỏng cả gói, không được im lặng quy về `controller` — đúng lúc đó là lúc
  // dashboard bắt đầu ghi một suy đoán của cảm biến thành lời khai của máy.
  const source = optionalString(raw.source, `${field}.source`) ?? 'controller'
  if (!eventSources.includes(source)) fail(`${field}.source phải là controller hoặc sensor.`, `${field}.source`)
  return {
    // Id dự phòng phải theo NỘI DUNG, không theo vị trí trong mảng. `${code}-${index}` nghĩa là
    // một acknowledgement lưu dưới 'event:E12-0' dính sang sự kiện khác ngay khi danh sách đổi
    // thứ tự — thợ bấm "đã xem" cho lỗi này, dấu đã-xem lại nằm trên lỗi kia. Trước đây lỗi này
    // ngủ vì không adapter nào sinh events; từ khi broker.py chuyển lời máy sang `events[]` thì
    // nó hết ngủ.
    id: optionalString(raw.id, `${field}.id`, { maxLength: 80 }) ?? `${code}-${isoOr(occurredAt, null, `${field}.occurredAt`)}`.slice(0, 80),
    occurredAt: isoOr(occurredAt, null, `${field}.occurredAt`),
    code,
    severity,
    message: optionalString(raw.message, `${field}.message`, { maxLength: 400 }),
    needle: optionalNumber(raw.needle, `${field}.needle`, { min: 0, max: 64, integer: true }),
    source,
    observedAt: context.observedAt,
  }
}

function normalizeJob(raw, context) {
  if (raw === undefined || raw === null) return null
  if (!isObject(raw)) fail('job phải là object.', 'job')
  const value = {
    fileName: optionalString(raw.fileName, 'job.fileName', { maxLength: 120 }),
    product: optionalString(raw.product, 'job.product', { maxLength: 120 }),
    needle: optionalNumber(raw.needle, 'job.needle', { min: 0, max: 64, integer: true }),
    threadColor: optionalString(raw.threadColor, 'job.threadColor', { maxLength: 60 }),
    currentStitch: optionalNumber(raw.currentStitch, 'job.currentStitch', { min: 0, integer: true }),
    totalStitches: optionalNumber(raw.totalStitches, 'job.totalStitches', { min: 0, integer: true }),
    elapsedSeconds: optionalNumber(raw.elapsedSeconds, 'job.elapsedSeconds', { min: 0 }),
  }
  if (value.currentStitch !== null && value.totalStitches !== null && value.currentStitch > value.totalStitches) {
    fail('job.currentStitch không thể lớn hơn job.totalStitches.', 'job.currentStitch')
  }
  return Object.values(value).every((entry) => entry === null) ? null : reading(value, context)
}

/**
 * Converts one adapter response into the snapshot broadcast to dashboards.
 * `machine` supplies identity only — nothing about a paired record may leak into telemetry.
 */
export function normalizeTelemetry(raw, { machine, receivedAt = new Date().toISOString(), source, quality = 'verified' }) {
  if (!readingQualities.includes(quality)) fail(`quality phải thuộc: ${readingQualities.join(', ')}.`, 'quality')
  const payload = isObject(raw?.payload) ? raw.payload : raw
  if (!isObject(payload)) fail('Adapter không trả về JSON object.', 'payload')

  const adapterSchema = payload.schemaVersion === undefined ? SCHEMA_VERSION : payload.schemaVersion
  if (!Number.isInteger(adapterSchema) || adapterSchema < 1) fail('schemaVersion phải là số nguyên dương.', 'schemaVersion')
  if (adapterSchema > SCHEMA_VERSION) fail(`Adapter dùng schemaVersion ${adapterSchema}, bridge chỉ hỗ trợ tới ${SCHEMA_VERSION}.`, 'schemaVersion')

  const observedAt = isoOr(payload.observedAt, receivedAt, 'observedAt')
  const context = { observedAt, source: source ?? machine.adapter, quality }

  const status = optionalString(payload.status, 'status')
  if (!status) fail('status là trường bắt buộc. Adapter chưa đọc được thì phải gửi "unknown".', 'status')
  if (!operationalStatuses.includes(status)) fail(`status phải thuộc: ${operationalStatuses.join(', ')}.`, 'status')

  if (payload.events !== undefined && payload.events !== null && !Array.isArray(payload.events)) fail('events phải là mảng.', 'events')
  const events = Array.isArray(payload.events) ? payload.events.map((event, index) => normalizeEvent(event, index, context)) : []
  if (events.length > 200) fail('events vượt 200 mục trong một lần poll.', 'events')

  const position = payload.needlePosition === undefined || payload.needlePosition === null ? null : (() => {
    if (!isObject(payload.needlePosition)) fail('needlePosition phải là object x/y.', 'needlePosition')
    const x = optionalNumber(payload.needlePosition.x, 'needlePosition.x')
    const y = optionalNumber(payload.needlePosition.y, 'needlePosition.y')
    if (x === null || y === null) fail('needlePosition cần cả x và y.', 'needlePosition')
    return { x, y }
  })()

  const threadBreakWindow = payload.threadBreakWindow === undefined || payload.threadBreakWindow === null ? null : (() => {
    if (!isObject(payload.threadBreakWindow)) fail('threadBreakWindow phải là object.', 'threadBreakWindow')
    const needle = optionalNumber(payload.threadBreakWindow.needle, 'threadBreakWindow.needle', { min: 0, max: 64, integer: true })
    const breaks = optionalNumber(payload.threadBreakWindow.breaks, 'threadBreakWindow.breaks', { min: 0, integer: true })
    const stitches = optionalNumber(payload.threadBreakWindow.stitches, 'threadBreakWindow.stitches', { min: 1, integer: true })
    if (breaks === null || stitches === null) fail('threadBreakWindow cần breaks và stitches.', 'threadBreakWindow')
    return { needle, breaks, stitches }
  })()

  if (payload.rpmHistory !== undefined && payload.rpmHistory !== null && !Array.isArray(payload.rpmHistory)) fail('rpmHistory phải là mảng số.', 'rpmHistory')
  const rpmHistory = Array.isArray(payload.rpmHistory)
    ? payload.rpmHistory.slice(-24).map((entry, index) => optionalNumber(entry, `rpmHistory[${index}]`, { min: 0, max: 5000 }))
    : null
  if (rpmHistory?.some((entry) => entry === null)) fail('rpmHistory không được chứa giá trị rỗng.', 'rpmHistory')

  return {
    schemaVersion: SCHEMA_VERSION,
    machineId: machine.id,
    observedAt,
    receivedAt,
    source: context.source,
    status: reading(status, context),
    rpm: readNumberField(payload.rpm, 'rpm', { min: 0, max: 5000 }, context),
    rpmHistory: rpmHistory ? reading(rpmHistory, context) : null,
    job: normalizeJob(payload.job, context),
    needlePosition: reading(position, context),
    odometer: readNumberField(payload.odometer, 'odometer', { min: 0, integer: true }, context),
    threadBreakWindow: reading(threadBreakWindow, context),
    controller: normalizeController(payload.controller, context),
    events,
  }
}
