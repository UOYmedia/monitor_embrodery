import { describe, expect, it } from 'vitest'
import { ContractError, SCHEMA_VERSION, adapterHasProtocol, isIsoTimestamp, normalizeTelemetry } from './contract.mjs'

const machine = { id: 'mch-a1', adapter: 'http-json' }
const at = '2026-08-14T07:00:00.000Z'
const normalize = (payload) => normalizeTelemetry(payload, { machine, receivedAt: at, source: 'http-json' })

describe('isIsoTimestamp', () => {
  it('accepts ISO 8601 with zone and rejects ambiguous local strings', () => {
    expect(isIsoTimestamp('2026-08-14T07:00:00Z')).toBe(true)
    expect(isIsoTimestamp('2026-08-14T07:00:00+07:00')).toBe(true)
    expect(isIsoTimestamp('2026-08-14 07:00:00')).toBe(false)
    expect(isIsoTimestamp('14/08/2026 07:00')).toBe(false)
    expect(isIsoTimestamp(Date.now())).toBe(false)
  })
})

describe('normalizeTelemetry', () => {
  it('keeps unread fields null instead of inventing defaults', () => {
    const snapshot = normalize({ status: 'unknown' })
    expect(snapshot.rpm).toBeNull()
    expect(snapshot.job).toBeNull()
    expect(snapshot.odometer).toBeNull()
    expect(snapshot.controller).toBeNull()
    expect(snapshot.events).toEqual([])
    expect(snapshot.status).toEqual({ value: 'unknown', observedAt: at, source: 'http-json', quality: 'verified' })
    expect(snapshot.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('requires status so an adapter cannot omit the one essential field', () => {
    expect(() => normalize({ rpm: 700 })).toThrow(ContractError)
    expect(() => normalize({ status: 'khong-biet' })).toThrow(/status phải thuộc/)
  })

  it('rejects the whole payload when a field has the wrong type', () => {
    expect(() => normalize({ status: 'running', rpm: 'nhanh' })).toThrow(/rpm phải là số/)
    expect(() => normalize({ status: 'running', events: { code: 'E1' } })).toThrow(/events phải là mảng/)
    expect(() => normalize({ status: 'running', job: { currentStitch: 900, totalStitches: 100 } })).toThrow(/currentStitch/)
  })

  it('refuses any controller.transfer field: this product has no file transfer path', () => {
    expect(() => normalize({ status: 'running', controller: { transfer: { progress: 50 } } }))
      .toThrow(/không có luồng truyền file/)
  })

  it('rejects a future schemaVersion rather than guessing the newer shape', () => {
    expect(() => normalize({ schemaVersion: SCHEMA_VERSION + 1, status: 'running' })).toThrow(/schemaVersion/)
  })

  it('stamps provenance on every reading it does decode', () => {
    const snapshot = normalize({
      status: 'running',
      rpm: { value: 820, observedAt: '2026-08-14T06:59:50Z' },
      odometer: 1_250_000,
      job: { fileName: 'LOGO-A.dst', currentStitch: 4200, totalStitches: 51_000, needle: 3 },
    })
    expect(snapshot.rpm).toEqual({ value: 820, observedAt: '2026-08-14T06:59:50.000Z', source: 'http-json', quality: 'verified' })
    expect(snapshot.odometer.value).toBe(1_250_000)
    // job.fileName is telemetry read from the controller, not a local file the dashboard owns.
    expect(snapshot.job.value.fileName).toBe('LOGO-A.dst')
    expect(snapshot.job.observedAt).toBe(at)
  })

  it('marks controller events as controller-sourced and orders them by the adapter', () => {
    const snapshot = normalize({
      status: 'fault',
      events: [{ id: 'e1', code: 'E12', severity: 'critical', occurredAt: '2026-08-14T06:58:00Z', message: 'Đứt chỉ kim 5', needle: 5 }],
    })
    expect(snapshot.events[0]).toMatchObject({ id: 'e1', severity: 'critical', source: 'controller', needle: 5 })
  })

  it('validates controller network fields instead of guessing the band', () => {
    expect(() => normalize({ status: 'running', controller: { network: { transport: 'ethernet', band: '5 GHz' } } }))
      .toThrow(/band chỉ hợp lệ khi transport là wifi/)
    const snapshot = normalize({ status: 'running', controller: { network: { transport: 'wifi', band: '2.4 GHz', signalPercent: 62 } } })
    expect(snapshot.controller.network).toEqual({ transport: 'wifi', band: '2.4 GHz', signalPercent: 62, ssid: null })
  })
})

describe('adapterHasProtocol', () => {
  it('treats manual as having no protocol at all', () => {
    expect(adapterHasProtocol('manual')).toBe(false)
    expect(adapterHasProtocol('http-json')).toBe(true)
  })
})
