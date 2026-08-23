import { describe, expect, it } from 'vitest'
import { ValidationError, assertNoDuplicates, machineIdFromAssetTag, normalizeAssetTag, validateMachineInput } from './machine-record.mjs'

const sites = [{ id: 'hn-1', name: 'Xưởng Hà Nội', allowedCidrs: ['192.168.10.0/24'] }]
const base = { assetTag: 'HN-001', name: 'Máy thêu 01', siteId: 'hn-1', zone: 'Chuyền A', ipAddress: '192.168.10.21' }
const validate = (input) => validateMachineInput(input, { sites, actor: 'ky-thuat-b', now: '2026-08-14T07:00:00.000Z' })

describe('normalizeAssetTag', () => {
  it('upper-cases and restricts to safe characters', () => {
    expect(normalizeAssetTag('hn-001')).toBe('HN-001')
    expect(() => normalizeAssetTag('-hn')).toThrow(ValidationError)
    expect(() => normalizeAssetTag('hn 001')).toThrow(/chỉ được dùng/)
    expect(machineIdFromAssetTag('HN-001')).toBe('mch-hn-001')
  })
})

describe('validateMachineInput', () => {
  it('accepts a complete record and keeps operator text intact', () => {
    const record = validate({ ...base, model: 'Dahao E-series', serial: 'SN-9931' })
    expect(record).toMatchObject({ id: 'mch-hn-001', assetTag: 'HN-001', name: 'Máy thêu 01', adapter: 'manual' })
    expect(record.createdBy).toBe('ky-thuat-b')
  })

  it('allows spaces and Vietnamese diacritics but rejects control characters', () => {
    expect(validate({ ...base, name: 'Máy thêu số 12 – chuyền A' }).name).toBe('Máy thêu số 12 – chuyền A')
    expect(() => validate({ ...base, name: 'May\u0007theu' })).toThrow(/ký tự điều khiển/)
  })

  it('rejects a site the bridge was never granted', () => {
    expect(() => validate({ ...base, siteId: 'khong-ton-tai' })).toThrow(/chưa được cấu hình/)
  })

  it('rejects a malformed IP or MAC before anything touches the network', () => {
    expect(() => validate({ ...base, ipAddress: '192.168.10.999' })).toThrow(/IPv4/)
    expect(() => validate({ ...base, macAddress: 'khong-phai-mac' })).toThrow(/macAddress/)
  })

  it('defaults to unverified: a technician must actively confirm at the machine', () => {
    expect(validate(base).verification).toEqual({ status: 'unverified', verifiedAt: null, verifiedBy: null, evidence: null })
    expect(validate({ ...base, verification: { confirmed: false, evidence: 'mac' } }).verification.status).toBe('unverified')
  })

  it('requires the claimed evidence to actually exist on the record', () => {
    expect(() => validate({ ...base, verification: { confirmed: true, evidence: 'mac' } })).toThrow(/chứng cứ MAC/)
    expect(() => validate({ ...base, verification: { confirmed: true, evidence: 'serial' } })).toThrow(/serial in trên máy/)
    const verified = validate({ ...base, macAddress: '8C:1F:64:AB:CD:EF', verification: { confirmed: true, evidence: 'mac' } })
    expect(verified.verification).toEqual({ status: 'verified', verifiedAt: '2026-08-14T07:00:00.000Z', verifiedBy: 'ky-thuat-b', evidence: 'mac' })
  })

  it('keeps a stored verification through a reload instead of demoting it', () => {
    const stored = { status: 'verified', verifiedAt: '2026-08-01T02:00:00.000Z', verifiedBy: 'ktv.an', evidence: 'serial' }
    const reloaded = validate({ ...base, serial: 'SN-9931', verification: stored })
    // The original verifier and moment survive: re-reading the file is not a new verification.
    expect(reloaded.verification).toEqual(stored)
  })

  it('refuses a stored verification whose evidence is no longer on the record', () => {
    const stored = { status: 'verified', verifiedAt: '2026-08-01T02:00:00.000Z', verifiedBy: 'ktv.an', evidence: 'mac' }
    expect(() => validate({ ...base, verification: stored })).toThrow(/chứng cứ MAC/)
    expect(() => validate({ ...base, serial: 'SN-1', verification: { status: 'verified', evidence: 'serial', verifiedBy: 'ktv.an', verifiedAt: 'hom-qua-luc-chieu-toi' } }))
      .toThrow(/ISO 8601/)
    expect(() => validate({ ...base, verification: { status: 'da-xac-minh' } })).toThrow(/verification.status/)
  })

  it('validates adapter config per adapter kind', () => {
    expect(() => validate({ ...base, adapter: 'tcp-json-line' })).toThrow(/port là bắt buộc/)
    expect(() => validate({ ...base, adapter: 'http-json', adapterConfig: { path: 'status' } })).toThrow(/phải bắt đầu bằng "\/"/)
    expect(() => validate({ ...base, adapter: 'tcp-json-line', adapterConfig: { port: 9000, command: 'STATUS\nQUIT' } })).toThrow(/xuống dòng/)
    expect(validate({ ...base, adapter: 'http-json' }).adapterConfig).toEqual({ port: 80, path: '/', tls: false })
  })

  it('preserves identity, history and acknowledgements when editing an existing machine', () => {
    const existing = { ...validate(base), acknowledgements: { 'event:e1': { at: 'x', by: 'y', note: null } }, createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'ai-do' }
    const updated = validateMachineInput({ ...base, name: 'Máy thêu 01B' }, { sites, actor: 'admin-c', now: '2026-08-14T08:00:00.000Z', existing })
    expect(updated.id).toBe(existing.id)
    expect(updated.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(updated.createdBy).toBe('ai-do')
    expect(updated.acknowledgements).toEqual(existing.acknowledgements)
    expect(updated.updatedBy).toBe('admin-c')
  })
})

describe('assertNoDuplicates', () => {
  const first = (overrides) => validate({ ...base, id: 'mch-a', ...overrides })
  const second = (overrides) => validate({ ...base, id: 'mch-b', assetTag: 'HN-002', ipAddress: '192.168.10.22', ...overrides })

  it('accepts a fleet with distinct identifiers', () => {
    expect(() => assertNoDuplicates([first({}), second({})])).not.toThrow()
  })

  it('blocks two entries claiming the same machine id in one batch', () => {
    expect(() => assertNoDuplicates([first({}), first({ assetTag: 'HN-002', ipAddress: '192.168.10.22' })])).toThrow(/xuất hiện hai lần/)
  })

  it('blocks duplicate asset tag, IP and MAC across the whole prospective fleet', () => {
    expect(() => assertNoDuplicates([first({}), second({ assetTag: 'HN-001' })])).toThrow(/Mã tài sản HN-001/)
    expect(() => assertNoDuplicates([first({}), second({ ipAddress: '192.168.10.21' })])).toThrow(/IP 192.168.10.21/)
    expect(() => assertNoDuplicates([
      first({ macAddress: '8C:1F:64:AB:CD:EF' }),
      second({ macAddress: '8c-1f-64-ab-cd-ef' }),
    ])).toThrow(/MAC 8C:1F:64:AB:CD:EF/)
  })

  it('scopes serial uniqueness to a site and reports the plain serial', () => {
    try {
      assertNoDuplicates([first({ serial: 'SN-1' }), second({ serial: 'sn-1' })])
      throw new Error('should have thrown')
    } catch (error) {
      expect(error.message).toContain('Serial sn-1')
      expect(error.message).not.toContain('hn-1:')
    }
  })
})
