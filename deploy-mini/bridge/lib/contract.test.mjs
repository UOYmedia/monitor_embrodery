import { readFile } from 'node:fs/promises'
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

  it('lets an external sensor node own its event instead of speaking for the controller', () => {
    const snapshot = normalize({
      status: 'stopped',
      events: [{ id: 's1', code: 'SPINDLE-STOP', severity: 'warning', source: 'sensor', occurredAt: '2026-08-14T06:58:00Z' }],
    })
    expect(snapshot.events[0]).toMatchObject({ id: 's1', source: 'sensor' })
  })

  it('rejects an unknown event source instead of quietly filing it under controller', () => {
    // Quy về `controller` là cách dashboard biến một phán đoán của cảm biến thành lời khai của máy.
    expect(() => normalize({
      status: 'stopped',
      events: [{ code: 'X', severity: 'info', source: 'guess', occurredAt: '2026-08-14T06:58:00Z' }],
    })).toThrow(/events\[0\]\.source/)
  })

  it('validates controller network fields instead of guessing the band', () => {
    expect(() => normalize({ status: 'running', controller: { network: { transport: 'ethernet', band: '5 GHz' } } }))
      .toThrow(/band chỉ hợp lệ khi transport là wifi/)
    const snapshot = normalize({ status: 'running', controller: { network: { transport: 'wifi', band: '2.4 GHz', signalPercent: 62 } } })
    expect(snapshot.controller.network).toEqual({ transport: 'wifi', band: '2.4 GHz', signalPercent: 62, ssid: null })
  })
})

/**
 * The node cảm biến ngoài (firmware/esp32-stitch-node) is the first adapter written in this repo,
 * so the contract is tested against the bytes it actually emits. Both strings below are copied
 * verbatim from EXPECTED_*_PAYLOAD in firmware/esp32-stitch-node/test/stitch_logic_test.c, which
 * asserts the C serialiser produces exactly them. If the firmware output changes, that test fails
 * first and these strings have to be updated with it.
 */
describe('node cảm biến ngoài (L1)', () => {
  const runningBody = '{"schemaVersion":2,"observedAt":"2026-08-17T09:12:30Z","status":"running",'
    + '"rpm":712,"rpmHistory":[680,700,712],"odometer":48210,'
    + '"threadBreakWindow":{"breaks":1,"stitches":5000}}'
  const unknownBody = '{"schemaVersion":2,"status":"unknown"}'

  it('chấp nhận gói hợp lệ của node và giữ trống đúng những gì cảm biến không đo được', () => {
    const snapshot = normalize(JSON.parse(runningBody))
    expect(snapshot.status.value).toBe('running')
    expect(snapshot.rpm.value).toBe(712)
    expect(snapshot.rpmHistory.value).toEqual([680, 700, 712])
    expect(snapshot.odometer.value).toBe(48_210)
    expect(snapshot.threadBreakWindow.value).toEqual({ needle: null, breaks: 1, stitches: 5000 })
    expect(snapshot.observedAt).toBe('2026-08-17T09:12:30.000Z')
    // A sensor clamped to the outside of the machine knows none of these, so it sends none.
    expect(snapshot.job).toBeNull()
    expect(snapshot.needlePosition).toBeNull()
    expect(snapshot.controller).toBeNull()
    expect(snapshot.events).toEqual([])
  })

  it('chấp nhận gói thiếu trường khi node chưa nhận được xung nào', () => {
    const snapshot = normalize(JSON.parse(unknownBody))
    expect(snapshot.status.value).toBe('unknown')
    expect(snapshot.rpm).toBeNull()
    expect(snapshot.odometer).toBeNull()
    expect(snapshot.threadBreakWindow).toBeNull()
    // No observedAt from a node whose clock never synced: the bridge dates the packet itself.
    expect(snapshot.observedAt).toBe(at)
  })

  it('từ chối cửa sổ đứt chỉ thiếu hoặc rỗng thay vì coi 0 mũi là một cửa sổ', () => {
    expect(() => normalize({ status: 'running', threadBreakWindow: { needle: 3, breaks: 1 } }))
      .toThrow(/threadBreakWindow cần breaks và stitches/)
    expect(() => normalize({ status: 'running', threadBreakWindow: { breaks: 0, stitches: 0 } }))
      .toThrow(/threadBreakWindow.stitches phải nằm trong khoảng/)
  })

  it('từ chối cả gói khi node gửi sai kiểu', () => {
    expect(() => normalize({ status: 'running', odometer: '48210' })).toThrow(/odometer phải là số/)
    expect(() => normalize({ status: 'running', rpmHistory: [680, null, 712] })).toThrow(/rpmHistory/)
  })

  it('fixture của node đi qua chuẩn hoá y như gói thật', async () => {
    const fixture = await readFile(new URL('../../docs/fixtures/telemetry-node-cam-bien.json', import.meta.url), 'utf8')
    expect(JSON.parse(fixture)).toEqual(JSON.parse(runningBody))
    expect(normalize(JSON.parse(fixture)).status.value).toBe('running')
  })
})

describe('adapterHasProtocol', () => {
  it('treats manual as having no protocol at all', () => {
    expect(adapterHasProtocol('manual')).toBe(false)
    expect(adapterHasProtocol('http-json')).toBe(true)
  })
})

describe('id dự phòng của sự kiện', () => {
  it('theo NỘI DUNG chứ không theo vị trí — đổi thứ tự không được làm lệch dấu "đã xem"', () => {
    // `${code}-${index}` nghĩa là acknowledgement lưu dưới 'event:E12-0' dính sang sự kiện khác
    // ngay khi danh sách đổi thứ tự: thợ bấm "đã xem" cho lỗi này, dấu lại nằm trên lỗi kia.
    const su = (code, at) => ({ code, severity: 'warning', source: 'controller', occurredAt: at })
    const a = su('E12', '2026-08-23T01:00:00Z')
    const b = su('E07', '2026-08-23T02:00:00Z')
    const xuoi = normalize({ observedAt: "2026-08-23T03:00:00Z", status: "running", events: [a, b] }).events
    const nguoc = normalize({ observedAt: "2026-08-23T03:00:00Z", status: "running", events: [b, a] }).events
    const idCua = (list, code) => list.find((e) => e.code === code).id
    expect(idCua(xuoi, 'E12')).toBe(idCua(nguoc, 'E12'))
    expect(idCua(xuoi, 'E07')).toBe(idCua(nguoc, 'E07'))
    expect(idCua(xuoi, 'E12')).not.toBe(idCua(xuoi, 'E07'))
  })
})
