import { adapterKinds } from './contract.mjs'
import { isIpv4, normalizeMac } from './net-policy.mjs'

/**
 * Enterprise metadata for a machine: everything a person types or confirms.
 * Kept strictly separate from controller telemetry so the dashboard can never
 * make an operator's note look like something the machine reported.
 */

export const verificationEvidences = ['mac', 'serial', 'assetTag']
export const verificationStatuses = ['unverified', 'verified']

export class ValidationError extends Error {
  constructor(message, field) {
    super(message)
    this.name = 'ValidationError'
    this.field = field
    // Bad input from a caller, never a bridge fault: the HTTP layer answers 400.
    this.status = 400
  }
}

function fail(message, field) { throw new ValidationError(message, field) }
function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }

// Control characters would corrupt logs and CSV exports, so they are rejected at the edge.
// oxlint-disable-next-line no-control-regex -- matching control characters is the point of this pattern.
const controlChars = /[\u0000-\u001f\u007f]/

function text(value, field, { min = 1, max = 80, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail(`${field} là bắt buộc.`, field)
    return null
  }
  if (typeof value !== 'string') fail(`${field} phải là chuỗi.`, field)
  const trimmed = value.trim()
  if (controlChars.test(trimmed)) fail(`${field} chứa ký tự điều khiển không hợp lệ.`, field)
  if (trimmed.length < min) fail(`${field} cần tối thiểu ${min} ký tự.`, field)
  if (trimmed.length > max) fail(`${field} vượt quá ${max} ký tự.`, field)
  return trimmed
}

export function normalizeAssetTag(value, field = 'assetTag') {
  const tag = text(value, field, { min: 2, max: 40 })
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(tag)) fail(`${field} chỉ được dùng chữ, số và . _ - / (bắt đầu bằng chữ hoặc số).`, field)
  return tag.toUpperCase()
}

export function machineIdFromAssetTag(assetTag) {
  const slug = assetTag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `mch-${slug}`
}

function validateAdapterConfig(adapter, raw, field = 'adapterConfig') {
  const config = raw === undefined || raw === null ? {} : raw
  if (!isObject(config)) fail(`${field} phải là object.`, field)
  const port = config.port === undefined || config.port === null ? null : Number(config.port)
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) fail(`${field}.port phải là cổng TCP 1–65535.`, `${field}.port`)
  const timeoutMs = config.timeoutMs === undefined ? null : Number(config.timeoutMs)
  if (timeoutMs !== null && (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000)) fail(`${field}.timeoutMs phải từ 100 đến 30000 ms.`, `${field}.timeoutMs`)

  if (adapter === 'manual') {
    // A manual record is only an inventory entry; a port is kept purely for LAN reachability checks.
    return { ...(port === null ? {} : { port }) }
  }
  if (adapter === 'dial-in') {
    // The controller dials the bridge, so there is no destination port to configure here.
    // The machine is recognised by its source IP, which is why ipAddress stays mandatory.
    if (port !== null) fail(`${field}.port không dùng cho adapter dial-in: máy tự gọi vào bridge, bridge không gọi máy.`, `${field}.port`)
    return {}
  }
  if (adapter === 'http-json') {
    const path = config.path === undefined || config.path === null ? '/' : String(config.path)
    if (!path.startsWith('/')) fail(`${field}.path phải bắt đầu bằng "/".`, `${field}.path`)
    if (path.length > 200) fail(`${field}.path vượt quá 200 ký tự.`, `${field}.path`)
    if (/[\s<>"']/.test(path)) fail(`${field}.path chứa ký tự không hợp lệ.`, `${field}.path`)
    return { port: port ?? 80, path, tls: Boolean(config.tls), ...(timeoutMs === null ? {} : { timeoutMs }) }
  }
  if (port === null) fail(`${field}.port là bắt buộc cho adapter tcp-json-line.`, `${field}.port`)
  const command = config.command === undefined || config.command === null ? '' : String(config.command)
  if (command.length > 200) fail(`${field}.command vượt quá 200 ký tự.`, `${field}.command`)
  if (/[\r\n]/.test(command)) fail(`${field}.command không được chứa xuống dòng.`, `${field}.command`)
  return { port, command, ...(timeoutMs === null ? {} : { timeoutMs }) }
}

function assertEvidenceBacked(evidence, { assetTag, macAddress, serial }) {
  if (!verificationEvidences.includes(evidence)) fail(`verification.evidence phải là một trong: ${verificationEvidences.join(', ')}.`, 'verification.evidence')
  if (evidence === 'mac' && !macAddress) fail('Chọn chứng cứ MAC thì phải nhập MAC đọc được tại máy.', 'macAddress')
  if (evidence === 'serial' && !serial) fail('Chọn chứng cứ serial thì phải nhập serial in trên máy.', 'serial')
  if (evidence === 'assetTag' && !assetTag) fail('Chọn chứng cứ mã tài sản thì phải nhập mã tài sản dán trên máy.', 'assetTag')
}

/**
 * A verification already on disk, re-read at startup.
 *
 * It must not go back through the confirmation path: a stored record has no `confirmed`
 * flag, so that path would read it as "not confirmed" and silently demote every verified
 * machine on every restart. Verification is the field that decides which machines enter
 * production KPIs, so it is parsed and re-checked, never re-derived.
 */
function parseStoredVerification(raw, { assetTag, macAddress, serial }) {
  const status = text(raw.status, 'verification.status', { min: 3, max: 20 })
  if (!verificationStatuses.includes(status)) fail(`verification.status phải là một trong: ${verificationStatuses.join(', ')}.`, 'verification.status')
  if (status === 'unverified') return { status: 'unverified', verifiedAt: null, verifiedBy: null, evidence: null }

  const evidence = text(raw.evidence, 'verification.evidence', { min: 3, max: 20 })
  assertEvidenceBacked(evidence, { assetTag, macAddress, serial })
  const verifiedBy = text(raw.verifiedBy, 'verification.verifiedBy', { min: 1, max: 80 })
  const verifiedAt = text(raw.verifiedAt, 'verification.verifiedAt', { min: 16, max: 40 })
  if (Number.isNaN(Date.parse(verifiedAt))) fail('verification.verifiedAt phải là thời gian ISO 8601.', 'verification.verifiedAt')
  return { status: 'verified', verifiedAt, verifiedBy, evidence }
}

function validateVerification(raw, { assetTag, macAddress, serial, actor, now }) {
  // Persisted shape (`status`) versus an operator confirming at the machine (`confirmed`).
  if (isObject(raw) && raw.confirmed === undefined && raw.status !== undefined) {
    return parseStoredVerification(raw, { assetTag, macAddress, serial })
  }
  if (raw === undefined || raw === null || raw.confirmed !== true) {
    return { status: 'unverified', verifiedAt: null, verifiedBy: null, evidence: null }
  }
  const evidence = text(raw.evidence, 'verification.evidence', { min: 3, max: 20 })
  assertEvidenceBacked(evidence, { assetTag, macAddress, serial })
  return { status: 'verified', verifiedAt: now, verifiedBy: actor, evidence }
}

/**
 * Đơn giá khoán theo mũi (VND / 1.000 mũi).
 *
 * Business metadata typed by a person, never read from the controller. It is optional on
 * purpose: a machine with no rate shows stitches and a blank amount rather than an invented
 * one. The cap is deliberately generous — it exists to catch a stray keystroke, not to judge
 * what a workshop charges.
 */
export function validatePiecePrice(value, field = 'pricePer1000Stitches') {
  if (value === undefined || value === null || value === '') return null
  const price = Number(value)
  if (!Number.isFinite(price)) fail(`${field} phải là số tiền VND cho 1.000 mũi.`, field)
  if (price < 0) fail(`${field} không được âm.`, field)
  if (price > 10_000_000) fail(`${field} vượt quá 10.000.000 đ/1.000 mũi — kiểm tra lại số đã nhập.`, field)
  // Whole đồng: VND has no sub-unit in practice and a fractional rate only creates rounding arguments.
  return Math.round(price)
}

export function validateMaintenancePlan(raw, index = 0) {
  const field = `maintenance[${index}]`
  if (!isObject(raw)) fail(`${field} phải là object.`, field)
  const intervalStitches = Number(raw.intervalStitches)
  if (!Number.isInteger(intervalStitches) || intervalStitches < 1000 || intervalStitches > 100_000_000) {
    fail(`${field}.intervalStitches phải là số nguyên từ 1.000 đến 100.000.000 mũi.`, `${field}.intervalStitches`)
  }
  const lastServiceOdometer = raw.lastServiceOdometer === undefined || raw.lastServiceOdometer === null ? null : Number(raw.lastServiceOdometer)
  if (lastServiceOdometer !== null && (!Number.isInteger(lastServiceOdometer) || lastServiceOdometer < 0)) {
    fail(`${field}.lastServiceOdometer phải là số nguyên không âm.`, `${field}.lastServiceOdometer`)
  }
  return {
    id: text(raw.id, `${field}.id`, { min: 2, max: 40 }),
    title: text(raw.title, `${field}.title`, { min: 2, max: 80 }),
    intervalStitches,
    lastServiceOdometer,
    lastServiceAt: raw.lastServiceAt ?? null,
    lastServiceBy: raw.lastServiceBy ?? null,
    history: Array.isArray(raw.history) ? raw.history.slice(-50) : [],
  }
}

/**
 * Validates one pairing/edit request. `sites` is required so an operator can never
 * register a machine outside the network their site was granted.
 */
export function validateMachineInput(raw, { sites, actor, now = new Date().toISOString(), existing = null }) {
  if (!isObject(raw)) fail('Dữ liệu máy không hợp lệ.', 'machine')

  const siteId = text(raw.siteId, 'siteId', { min: 1, max: 50 })
  const site = sites.find((entry) => entry.id === siteId)
  if (!site) fail(`Site "${siteId}" chưa được cấu hình trên bridge.`, 'siteId')

  const ipAddress = text(raw.ipAddress, 'ipAddress', { min: 7, max: 15 })
  if (!isIpv4(ipAddress)) fail('ipAddress phải là IPv4 hợp lệ.', 'ipAddress')

  const assetTag = normalizeAssetTag(raw.assetTag ?? existing?.assetTag)
  const macInput = raw.macAddress ?? null
  const macAddress = macInput ? normalizeMac(macInput) : null
  if (macInput && !macAddress) fail('macAddress không đúng định dạng (ví dụ 8C:1F:64:AB:CD:EF).', 'macAddress')

  const adapter = text(raw.adapter ?? existing?.adapter ?? 'manual', 'adapter', { min: 3, max: 20 })
  if (!adapterKinds.includes(adapter)) fail(`adapter phải là một trong: ${adapterKinds.join(', ')}.`, 'adapter')

  const serial = text(raw.serial, 'serial', { max: 60, required: false })
  const maintenance = Array.isArray(raw.maintenance) ? raw.maintenance.map(validateMaintenancePlan) : (existing?.maintenance ?? [])
  const maintenanceIds = new Set()
  for (const plan of maintenance) {
    if (maintenanceIds.has(plan.id)) fail(`Mốc bảo trì trùng mã: ${plan.id}.`, 'maintenance')
    maintenanceIds.add(plan.id)
  }

  const verification = raw.verification === undefined && existing
    ? existing.verification
    : validateVerification(raw.verification, { assetTag, macAddress, serial, actor, now })

  return {
    id: existing?.id ?? text(raw.id, 'id', { min: 3, max: 80, required: false }) ?? machineIdFromAssetTag(assetTag),
    assetTag,
    name: text(raw.name, 'name', { min: 2, max: 80 }),
    siteId: site.id,
    zone: text(raw.zone, 'zone', { min: 1, max: 60 }),
    model: text(raw.model, 'model', { max: 60, required: false }),
    serial,
    ipAddress,
    macAddress,
    adapter,
    adapterConfig: validateAdapterConfig(adapter, raw.adapterConfig ?? existing?.adapterConfig),
    pricePer1000Stitches: raw.pricePer1000Stitches === undefined
      ? (existing?.pricePer1000Stitches ?? null)
      : validatePiecePrice(raw.pricePer1000Stitches),
    verification,
    maintenance,
    acknowledgements: existing?.acknowledgements ?? {},
    enabled: raw.enabled === undefined ? (existing?.enabled ?? true) : raw.enabled !== false,
    archived: existing?.archived ?? false,
    archivedAt: existing?.archivedAt ?? null,
    archivedBy: existing?.archivedBy ?? null,
    note: text(raw.note, 'note', { max: 300, required: false }),
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? actor,
    updatedAt: now,
    updatedBy: actor,
  }
}

/**
 * Cross-record duplicate detection. Runs over the whole prospective fleet so a batch
 * is rejected before anything is written, rather than half-applied.
 */
export function assertNoDuplicates(records) {
  const ids = new Set()
  for (const record of records) {
    if (ids.has(record.id)) fail(`Mã máy ${record.id} xuất hiện hai lần trong cùng một lô.`, 'id')
    ids.add(record.id)
  }
  const keys = [
    { field: 'assetTag', label: 'Mã tài sản', pick: (record) => record.assetTag, show: (record) => record.assetTag },
    { field: 'ipAddress', label: 'IP', pick: (record) => record.ipAddress, show: (record) => record.ipAddress },
    { field: 'macAddress', label: 'MAC', pick: (record) => record.macAddress, show: (record) => record.macAddress },
    // Serial numbers are only guaranteed unique inside one site's asset register.
    { field: 'serial', label: 'Serial', pick: (record) => (record.serial ? `${record.siteId}:${record.serial.toUpperCase()}` : null), show: (record) => record.serial },
  ]
  for (const key of keys) {
    const seen = new Map()
    for (const record of records) {
      const value = key.pick(record)
      if (!value) continue
      const previous = seen.get(value)
      if (previous && previous !== record.id) fail(`${key.label} ${key.show(record)} đã thuộc về máy ${previous}.`, key.field)
      seen.set(value, record.id)
    }
  }
}
