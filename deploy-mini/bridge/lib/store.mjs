import { copyFile, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, basename, join } from 'node:path'
import { SCHEMA_VERSION } from './config.mjs'
import { cidrContainsAddress } from './net-policy.mjs'
import { machineIdFromAssetTag, validateMachineInput } from './machine-record.mjs'

/**
 * Durable fleet registry.
 *
 * Writes are atomic (temp file -> fsync -> rename) and the previous good document is
 * kept as `.bak`, so a power cut in the middle of a batch pairing can never leave the
 * workshop with a half-written or empty machine list.
 */
export class FleetStore {
  constructor(filePath, { logger } = {}) {
    this.filePath = filePath
    this.backupPath = `${filePath}.bak`
    this.logger = logger
    this.document = { schemaVersion: SCHEMA_VERSION, updatedAt: null, machines: [] }
    this.migrationWarnings = []
  }

  async readDocument(path) {
    try {
      return { ok: true, value: JSON.parse(await readFile(path, 'utf8')) }
    } catch (error) {
      if (error?.code === 'ENOENT') return { ok: false, missing: true }
      return { ok: false, error }
    }
  }

  /**
   * Loads, migrates and validates the registry. A corrupt primary file falls back to the
   * backup; if both are unreadable the bridge refuses to start rather than silently
   * presenting an empty fleet as the truth.
   */
  async load({ sites }) {
    const primary = await this.readDocument(this.filePath)
    let source = 'primary'
    let raw = primary.value

    if (!primary.ok && !primary.missing) {
      this.logger?.error('Không đọc được fleet-store, thử bản backup.', { path: this.filePath, reason: primary.error?.message })
      const backup = await this.readDocument(this.backupPath)
      if (!backup.ok) throw new Error(`Không đọc được ${this.filePath} lẫn bản backup ${this.backupPath}. Khôi phục từ bản sao lưu trước khi chạy lại bridge.`)
      raw = backup.value
      source = 'backup'
    }

    if (primary.missing) {
      const legacy = await this.readLegacyFile()
      if (legacy) { raw = legacy.value; source = legacy.source }
    }

    const { document, warnings } = migrateDocument(raw, { sites })
    this.document = document
    this.migrationWarnings = warnings
    if (warnings.length) this.logger?.warn('Migration fleet-store có cảnh báo.', { warnings })
    this.logger?.info('Đã nạp fleet-store.', { source, machines: document.machines.length, schemaVersion: document.schemaVersion })
    return document
  }

  /** v1 stored the registry as a bare array in bridge-data/paired-machines.json. */
  async readLegacyFile() {
    const legacyPath = join(dirname(this.filePath), 'paired-machines.json')
    if (legacyPath === this.filePath) return null
    const legacy = await this.readDocument(legacyPath)
    if (!legacy.ok || !Array.isArray(legacy.value) || !legacy.value.length) return null
    this.logger?.warn('Phát hiện dữ liệu ghép máy v1, sẽ migrate sang schema v2.', { legacyPath, count: legacy.value.length })
    return { value: legacy.value, source: `legacy:${basename(legacyPath)}` }
  }

  get machines() { return this.document.machines }

  async save(machines) {
    const document = { schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(), machines }
    const serialized = `${JSON.stringify(document, null, 2)}\n`
    await mkdir(dirname(this.filePath), { recursive: true })
    // Keep the last good document before overwriting it.
    await copyFile(this.filePath, this.backupPath).catch((error) => { if (error?.code !== 'ENOENT') throw error })
    const temporaryPath = `${this.filePath}.tmp`
    const handle = await open(temporaryPath, 'w')
    try {
      await handle.writeFile(serialized, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporaryPath, this.filePath)
    this.document = document
    return document
  }

  async removeTemporary() {
    await rm(`${this.filePath}.tmp`, { force: true })
  }
}

function safeAssetTag(value, fallback) {
  const candidate = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9._/-]+/g, '-').replace(/^-+|-+$/g, '')
  return candidate.length >= 2 ? candidate.slice(0, 40) : fallback
}

/**
 * Brings any previously stored shape up to the current schema.
 * Every paired machine is preserved; anything that can no longer be validated is
 * reported as a warning instead of being dropped.
 */
export function migrateDocument(raw, { sites, now = new Date().toISOString() }) {
  const warnings = []
  const defaultSite = sites[0]
  if (!defaultSite) throw new Error('Không thể migrate khi bridge chưa cấu hình site nào.')

  const legacyArray = Array.isArray(raw) ? raw : null
  const document = legacyArray ? { schemaVersion: 1, machines: legacyArray } : (raw ?? { schemaVersion: SCHEMA_VERSION, machines: [] })
  if (!document || typeof document !== 'object') throw new Error('fleet-store không phải JSON object hợp lệ.')

  const version = Number(document.schemaVersion ?? (legacyArray ? 1 : SCHEMA_VERSION))
  if (!Number.isInteger(version) || version < 1) throw new Error('fleet-store có schemaVersion không hợp lệ.')
  if (version > SCHEMA_VERSION) throw new Error(`fleet-store dùng schemaVersion ${version}, bridge chỉ hỗ trợ tới ${SCHEMA_VERSION}. Cập nhật bridge trước khi chạy.`)

  const sourceMachines = Array.isArray(document.machines) ? document.machines : []
  const machines = []
  const usedIds = new Set()

  for (const [index, entry] of sourceMachines.entries()) {
    if (!entry || typeof entry !== 'object') { warnings.push(`Bỏ qua bản ghi ${index + 1}: không phải object.`); continue }
    const legacyId = String(entry.id ?? '').trim()
    const assetTag = safeAssetTag(entry.assetTag ?? legacyId, `MIGRATED-${index + 1}`)
    const id = legacyId || machineIdFromAssetTag(assetTag)
    if (usedIds.has(id)) { warnings.push(`Bỏ qua bản ghi trùng mã máy ${id}.`); continue }

    const candidate = {
      ...entry,
      id,
      assetTag,
      name: String(entry.name ?? id).slice(0, 80) || id,
      siteId: entry.siteId && sites.some((site) => site.id === entry.siteId) ? entry.siteId : defaultSite.id,
      zone: String(entry.zone ?? 'Chưa phân khu').slice(0, 60) || 'Chưa phân khu',
      // v1 had no verification concept, so a migrated machine must be re-checked at the
      // real machine before it can count toward production KPIs.
      verification: entry.verification ?? undefined,
    }

    try {
      const record = validateMachineInput(candidate, {
        sites,
        actor: entry.updatedBy ?? 'migration',
        now,
        existing: version >= SCHEMA_VERSION ? entry : null,
      })
      if (version < SCHEMA_VERSION) {
        record.createdAt = entry.createdAt ?? now
        record.createdBy = entry.createdBy ?? 'migration'
        record.migratedFrom = `v${version}`
        warnings.push(`Máy ${record.id} migrate từ v${version}: cần xác minh lại tại máy trước khi tính vào KPI sản xuất.`)
      }
      if (entry.siteId && record.siteId !== entry.siteId) warnings.push(`Máy ${record.id}: site "${entry.siteId}" không còn tồn tại, đã gán tạm về ${defaultSite.id}.`)
      const inScope = defaultSiteAllows(sites, record)
      if (!inScope) warnings.push(`Máy ${record.id} (${record.ipAddress}) nằm ngoài allowedCidrs của site ${record.siteId}. Bridge sẽ không poll cho tới khi sửa cấu hình site hoặc IP máy.`)
      usedIds.add(record.id)
      machines.push(record)
    } catch (error) {
      warnings.push(`Không migrate được bản ghi ${index + 1} (${id}): ${error.message}. Bản ghi được giữ ở trạng thái tắt để không mất dữ liệu ghép.`)
      usedIds.add(id)
      machines.push(quarantineRecord(candidate, defaultSite, now, error.message))
    }
  }

  return { document: { schemaVersion: SCHEMA_VERSION, updatedAt: document.updatedAt ?? now, machines }, warnings }
}

function defaultSiteAllows(sites, record) {
  const site = sites.find((entry) => entry.id === record.siteId)
  return Boolean(site) && site.allowedCidrs.some((cidr) => cidrContainsAddress(cidr, record.ipAddress))
}

/** Keeps an unmigratable record visible and disabled instead of deleting a real pairing. */
function quarantineRecord(candidate, defaultSite, now, reason) {
  return {
    id: candidate.id,
    assetTag: safeAssetTag(candidate.assetTag, `MIGRATED-${candidate.id}`),
    name: String(candidate.name ?? candidate.id).slice(0, 80),
    siteId: defaultSite.id,
    zone: String(candidate.zone ?? 'Chưa phân khu').slice(0, 60),
    model: null,
    serial: null,
    ipAddress: typeof candidate.ipAddress === 'string' ? candidate.ipAddress : '0.0.0.0',
    macAddress: null,
    adapter: 'manual',
    adapterConfig: {},
    verification: { status: 'unverified', verifiedAt: null, verifiedBy: null, evidence: null },
    maintenance: [],
    acknowledgements: {},
    enabled: false,
    archived: false,
    archivedAt: null,
    archivedBy: null,
    note: `Cần sửa thủ công sau migration: ${reason}`.slice(0, 300),
    createdAt: candidate.createdAt ?? now,
    createdBy: candidate.createdBy ?? 'migration',
    updatedAt: now,
    updatedBy: 'migration',
    migrationError: reason,
  }
}
