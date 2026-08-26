import { describe, expect, it } from 'vitest'
import { callerAgeSeconds, describeCaller, describeIngest, formatCallerBytes, ingestReasonLabel } from './ingest'
import type { DialInCaller, IngestStatus } from '../types/fleet'

function caller(overrides: Partial<DialInCaller> = {}): DialInCaller {
  return {
    remote: '192.168.7.31',
    firstSeenAt: '2026-08-16T02:00:00.000Z',
    lastSeenAt: '2026-08-16T02:00:30.000Z',
    connections: 1,
    framesAccepted: 0,
    framesUndecoded: 0,
    machineId: null,
    accepted: false,
    lastReason: 'unknown_source',
    lastBytes: null,
    pairedMachineId: null,
    pairedMachineName: null,
    pairedCount: 0,
    ...overrides,
  }
}

function status(overrides: Partial<IngestStatus> = {}): IngestStatus {
  return {
    enabled: true,
    address: { host: '192.168.7.5', port: 1600 },
    capture: false,
    connections: 0,
    openConnections: 0,
    framesAccepted: 0,
    framesUndecoded: 0,
    rejections: {},
    lastFrameAt: null,
    lastUndecodedAt: null,
    maxCallers: 24,
    callers: [],
    ...overrides,
  }
}

describe('describeIngest', () => {
  it('says the port is off instead of pretending nothing has called', () => {
    expect(describeIngest(status({ enabled: false })).tone).toBe('off')
    expect(describeIngest(null).tone).toBe('off')
  })

  it('names the address it is listening on, so C44/C41 can be checked against it', () => {
    expect(describeIngest(status()).headline).toContain('192.168.7.5:1600')
  })

  /**
   * Đây là phân biệt quan trọng nhất của cả màn hình: "chưa ai gọi" nghĩa là đi sửa mạng,
   * "gọi rồi nhưng bị từ chối" nghĩa là mạng đã thông và chỉ còn thiếu ghép máy. Trộn hai
   * cái này lại là để người ta đi kéo lại dây trong khi mọi thứ đã chạy.
   */
  it('separates "nobody called" from "called and was refused"', () => {
    expect(describeIngest(status()).tone).toBe('waiting')
    expect(describeIngest(status({ callers: [caller()], connections: 1 })).tone).toBe('rejected')
  })

  it('treats undecodable bytes as a protocol problem, not a wiring problem', () => {
    const verdict = describeIngest(status({ callers: [caller({ lastReason: 'not_json', framesUndecoded: 3 })] }))
    expect(verdict.tone).toBe('undecoded')
    expect(verdict.detail).toContain('giao thức')
  })

  it('reports success once a frame has actually been read', () => {
    expect(describeIngest(status({ callers: [caller({ lastReason: null, framesAccepted: 12 })] })).tone).toBe('ok')
  })

  /** Câu tổng kết dựng từ chính các dòng bên dưới, nên không thể nói ngược với bảng. */
  it('does not claim the port is receiving when every address is now refused', () => {
    const dead = caller({ framesAccepted: 40, lastReason: 'unknown_source' })
    expect(describeIngest(status({ framesAccepted: 40, callers: [dead] })).tone).toBe('rejected')
  })

  it('says "waiting for the machine to dial back" when the only address is freshly paired', () => {
    const paired = caller({ pairedMachineId: 'mch-1', pairedMachineName: 'Máy 01', pairedCount: 1 })
    expect(describeIngest(status({ callers: [paired] })).headline).toContain('chờ máy gọi lại')
  })
})

describe('describeCaller', () => {
  it('offers pairing exactly for an address no machine claims yet', () => {
    expect(describeCaller(caller()).pairable).toBe(true)
    expect(describeCaller(caller({ lastReason: 'cooldown' })).pairable).toBe(false)
  })

  /** Ghép xong mà dòng vẫn ghi "chưa ghép máy nào" thì người ta sẽ đi ghép lần thứ hai. */
  it('switches to "already paired, waiting" the moment the address is claimed', () => {
    const verdict = describeCaller(caller({ pairedMachineId: 'mch-1', pairedMachineName: 'Máy 01', pairedCount: 1 }))
    expect(verdict.tone).toBe('pending')
    expect(verdict.label).toContain('Đã ghép')
    expect(verdict.hint).toContain('Máy 01')
    expect(verdict.pairable).toBe(false)
  })

  it('refuses to suggest pairing when two machines already claim the address', () => {
    const verdict = describeCaller(caller({ pairedCount: 2, pairedMachineId: null }))
    expect(verdict.tone).toBe('blocked')
    expect(verdict.label).toBe('Trùng khai báo')
    expect(verdict.pairable).toBe(false)
  })

  it('reports a receiving address as receiving', () => {
    expect(describeCaller(caller({ framesAccepted: 5, accepted: true, machineId: 'mch-1', lastReason: null })).tone).toBe('ok')
  })

  it('keeps undecoded traffic visible instead of reading it as silence', () => {
    expect(describeCaller(caller({ framesUndecoded: 2, lastReason: 'not_json' })).tone).toBe('undecoded')
  })

  /**
   * Lỗi phát hiện khi chạy thử: máy đang chạy tốt rồi bị lưu kho, controller vẫn gọi vào và
   * vẫn bị từ chối — nhưng dòng đó vẫn ghi "đang nhận dữ liệu" vì bộ đếm cộng dồn không bao
   * giờ giảm. Trạng thái phải theo lần gọi gần nhất.
   */
  it('stops calling an address "receiving" once its latest call was refused', () => {
    const verdict = describeCaller(caller({ framesAccepted: 40, accepted: true, machineId: 'mch-1', lastReason: 'unknown_source' }))
    expect(verdict.tone).toBe('blocked')
    expect(verdict.pairable).toBe(true)
  })

  it('separates a bad frame from a refused connection', () => {
    const verdict = describeCaller(caller({ framesAccepted: 3, lastReason: 'machine_id_mismatch', pairedMachineId: 'mch-1', pairedCount: 1 }))
    expect(verdict.tone).toBe('blocked')
    expect(verdict.label).toBe('Khung khai machineId của máy khác')
    expect(verdict.pairable).toBe(false)
  })

  it('says a connected-but-silent address is silent rather than fine', () => {
    const verdict = describeCaller(caller({ accepted: true, machineId: 'mch-1', lastReason: null, pairedMachineId: 'mch-1', pairedCount: 1 }))
    expect(verdict.tone).toBe('pending')
    expect(verdict.label).toContain('chưa gửi khung nào')
  })
})

describe('ingestReasonLabel', () => {
  it('translates a bridge reason into workshop words', () => {
    expect(ingestReasonLabel('unknown_source')).toBe('Địa chỉ chưa ghép máy nào')
  })

  it('passes an unknown reason through rather than hiding it', () => {
    expect(ingestReasonLabel('ly_do_moi')).toBe('ly_do_moi')
    expect(ingestReasonLabel(null)).toBe('—')
  })
})

describe('formatCallerBytes', () => {
  it('shows the first bytes and says how many there were in total', () => {
    const text = formatCallerBytes(caller({ lastBytes: { bytes: 20, hex: '02 41 ff 00 10 11 12 13 14 15', ascii: '.A........', truncated: false, reason: 'not_json' } }), 4)
    expect(text).toBe('02 41 ff 00… (20 byte)')
  })

  it('says nothing rather than an empty cell when no bytes were seen', () => {
    expect(formatCallerBytes(caller())).toBe('—')
  })
})

describe('callerAgeSeconds', () => {
  it('measures from the last call, not the first', () => {
    expect(callerAgeSeconds(caller(), Date.parse('2026-08-16T02:01:00.000Z'))).toBe(30)
    expect(callerAgeSeconds(caller({ lastSeenAt: 'khong-phai-ngay' }), 0)).toBeNull()
  })
})
