import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FleetStore, migrateDocument } from './store.mjs'

const sites = [
  { id: 'hn-1', name: 'Xưởng Hà Nội', allowedCidrs: ['192.168.10.0/24'], freshSeconds: 30, staleSeconds: 90 },
  { id: 'hcm-1', name: 'Xưởng HCM', allowedCidrs: ['10.20.0.0/24'], freshSeconds: 30, staleSeconds: 90 },
]

let dir
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'fleet-store-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const storePath = () => join(dir, 'fleet-store.json')
const machine = (overrides = {}) => ({
  id: 'mch-hn-001', assetTag: 'HN-001', name: 'Máy thêu 01', siteId: 'hn-1', zone: 'Chuyền A',
  ipAddress: '192.168.10.21', adapter: 'manual', ...overrides,
})

describe('migrateDocument', () => {
  it('migrates the v1 bare array and preserves every pairing', () => {
    const legacy = [
      { id: 'mch-01', name: 'Máy 1', ipAddress: '192.168.10.21', adapter: 'manual' },
      { id: 'mch-02', name: 'Máy 2', ipAddress: '192.168.10.22', adapter: 'http-json', adapterConfig: { port: 8080, path: '/status' } },
    ]
    const { document, warnings } = migrateDocument(legacy, { sites, now: '2026-08-14T07:00:00.000Z' })
    expect(document.schemaVersion).toBe(2)
    expect(document.machines.map((entry) => entry.id)).toEqual(['mch-01', 'mch-02'])
    expect(document.machines[1].adapterConfig).toMatchObject({ port: 8080, path: '/status' })
    // A v1 machine was never verified at the machine, so it must not count as verified now.
    expect(document.machines.every((entry) => entry.verification.status === 'unverified')).toBe(true)
    expect(warnings.some((warning) => warning.includes('cần xác minh lại'))).toBe(true)
  })

  it('assigns a displayable asset tag and zone when v1 had none', () => {
    const { document } = migrateDocument([{ id: 'mch-01', name: 'Máy 1', ipAddress: '192.168.10.21' }], { sites })
    expect(document.machines[0].assetTag).toBe('MCH-01')
    expect(document.machines[0].zone).toBe('Chưa phân khu')
  })

  it('reassigns a machine whose site no longer exists and says so', () => {
    const { document, warnings } = migrateDocument([{ id: 'mch-01', name: 'Máy 1', siteId: 'da-nang', ipAddress: '192.168.10.21' }], { sites })
    expect(document.machines[0].siteId).toBe('hn-1')
    expect(warnings.some((warning) => warning.includes('da-nang'))).toBe(true)
  })

  it('warns when a stored IP falls outside the site allowlist instead of silently polling it', () => {
    const { warnings } = migrateDocument([{ id: 'mch-01', name: 'Máy 1', siteId: 'hn-1', ipAddress: '172.30.9.9' }], { sites })
    expect(warnings.some((warning) => warning.includes('allowedCidrs'))).toBe(true)
  })

  it('quarantines an unmigratable record rather than deleting a real pairing', () => {
    const { document, warnings } = migrateDocument([{ id: 'mch-broken', name: 'Máy hỏng', ipAddress: 'khong-phai-ip' }], { sites })
    expect(document.machines).toHaveLength(1)
    expect(document.machines[0]).toMatchObject({ id: 'mch-broken', enabled: false })
    expect(document.machines[0].migrationError).toMatch(/IPv4/)
    expect(warnings[0]).toMatch(/giữ ở trạng thái tắt/)
  })

  it('refuses a document from a newer bridge instead of downgrading it', () => {
    expect(() => migrateDocument({ schemaVersion: 99, machines: [] }, { sites })).toThrow(/schemaVersion 99/)
  })

  it('is idempotent: migrating an already-v2 document changes nothing material', () => {
    const once = migrateDocument([machine()], { sites, now: '2026-08-14T07:00:00.000Z' }).document
    const twice = migrateDocument(once, { sites, now: '2026-08-14T09:00:00.000Z' }).document
    expect(twice.machines[0].id).toBe(once.machines[0].id)
    expect(twice.machines[0].createdAt).toBe(once.machines[0].createdAt)
    expect(twice.machines[0].verification).toEqual(once.machines[0].verification)
  })

  it('carries a verified machine across a restart', () => {
    // Re-reading the store is not a re-verification, but it must not be a de-verification
    // either: a demoted machine would silently drop out of the production KPIs.
    const verified = machine({ serial: 'SN-9931', verification: { status: 'verified', verifiedAt: '2026-08-01T02:00:00.000Z', verifiedBy: 'ktv.an', evidence: 'serial' } })
    const { document } = migrateDocument({ schemaVersion: 2, machines: [verified] }, { sites, now: '2026-08-14T09:00:00.000Z' })
    expect(document.machines[0].verification).toEqual(verified.verification)
  })
})

describe('FleetStore', () => {
  it('starts empty when there is nothing to load', async () => {
    const store = new FleetStore(storePath())
    await store.load({ sites })
    expect(store.machines).toEqual([])
  })

  it('picks up the v1 paired-machines.json file automatically', async () => {
    await writeFile(join(dir, 'paired-machines.json'), JSON.stringify([{ id: 'mch-01', name: 'Máy 1', ipAddress: '192.168.10.21' }]))
    const store = new FleetStore(storePath())
    await store.load({ sites })
    expect(store.machines).toHaveLength(1)
    expect(store.migrationWarnings.length).toBeGreaterThan(0)
  })

  it('writes atomically, keeps a backup and leaves no temp file behind', async () => {
    const store = new FleetStore(storePath())
    await store.load({ sites })
    await store.save([machine()])
    await store.save([machine(), machine({ id: 'mch-hn-002', assetTag: 'HN-002', ipAddress: '192.168.10.22' })])

    const primary = JSON.parse(await readFile(storePath(), 'utf8'))
    const backup = JSON.parse(await readFile(`${storePath()}.bak`, 'utf8'))
    expect(primary.machines).toHaveLength(2)
    expect(backup.machines).toHaveLength(1)
    await expect(readFile(`${storePath()}.tmp`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('falls back to the backup when the primary file is corrupt', async () => {
    const store = new FleetStore(storePath())
    await store.load({ sites })
    await store.save([machine()])
    await store.save([machine()])
    await writeFile(storePath(), '{ this is not json')

    const reopened = new FleetStore(storePath())
    await reopened.load({ sites })
    expect(reopened.machines).toHaveLength(1)
  })

  it('refuses to start with an empty fleet when both copies are unreadable', async () => {
    await writeFile(storePath(), 'broken')
    await writeFile(`${storePath()}.bak`, 'also broken')
    await expect(new FleetStore(storePath()).load({ sites })).rejects.toThrow(/Khôi phục từ bản sao lưu/)
  })
})
