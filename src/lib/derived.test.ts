import { describe, expect, it } from 'vitest'
import {
  effectivePrice, estimatedFinish, formatMinutes, formatMinutesShort, isLongStop, jobProgress, offlineReason,
  rpmRange, sparklinePoints, statusDurationText, threadBreakRate, threadBreakText,
} from './derived'
import { baseNow, makeMachine, makeTelemetry } from '../test/factories'
import type { MachineView, Site } from '../types/fleet'

const iso = (offsetMs: number) => new Date(baseNow + offsetMs).toISOString()

function stopped(minutesAgo: number, extra: Parameters<typeof makeMachine>[0] = {}): MachineView {
  const observedAt = iso(0)
  return makeMachine({
    telemetry: makeTelemetry({ observedAt, status: { value: 'stopped', observedAt, source: 'controller', quality: 'verified' } }),
    statusSince: { status: 'stopped', at: iso(-minutesAgo * 60_000), approximate: false },
    ...extra,
  })
}

describe('jobProgress', () => {
  it('does not clamp an overrunning counter: 100% would hide a broken counter', () => {
    const observedAt = iso(0)
    const machine = makeMachine({
      telemetry: makeTelemetry({
        observedAt,
        job: {
          value: { fileName: 'A.dst', product: null, needle: 1, threadColor: null, currentStitch: 52_100, totalStitches: 46_453, elapsedSeconds: 100 },
          observedAt, source: 'controller', quality: 'verified',
        },
      }),
    })
    const progress = jobProgress(machine)
    expect(progress?.percent).toBe(112)
    expect(progress?.overrun).toBe(true)
  })

  it('returns null when the controller never reported a total', () => {
    const observedAt = iso(0)
    const machine = makeMachine({
      telemetry: makeTelemetry({
        observedAt,
        job: {
          value: { fileName: 'A.dst', product: null, needle: null, threadColor: null, currentStitch: 10, totalStitches: null, elapsedSeconds: null },
          observedAt, source: 'controller', quality: 'verified',
        },
      }),
    })
    expect(jobProgress(machine)).toBeNull()
  })
})

describe('estimatedFinish', () => {
  it('estimates from the current speed and names itself an estimate', () => {
    const machine = makeMachine()
    const eta = estimatedFinish(machine, baseNow, 'Asia/Ho_Chi_Minh')
    expect(eta.unavailable).toBeNull()
    // (51.000 - 4.200) / 720 v/ph ≈ 65 phút.
    expect(Math.round(((eta.value as number) - baseNow) / 60_000)).toBe(65)
    expect(eta.text).toMatch(/^≈ xong /)
    expect(eta.note).toContain('Dashboard ước tính')
  })

  it('disappears rather than freezing when the data goes stale', () => {
    const machine = makeMachine()
    const stale: MachineView = { ...machine, connection: { ...machine.connection, state: 'stale' } }
    expect(estimatedFinish(stale, baseNow).value).toBeNull()
    expect(estimatedFinish(stale, baseNow).text).toBe('Không ước tính khi dữ liệu cũ')
  })

  it('says "không tính được" (missing input) rather than "chưa đọc được" (missing field)', () => {
    const observedAt = iso(0)
    const machine = makeMachine({ telemetry: makeTelemetry({ observedAt, rpm: null }) })
    expect(estimatedFinish(machine, baseNow).text).toBe('Không tính được (thiếu tốc độ máy)')
  })

  it('refuses to estimate off an overrunning counter', () => {
    const observedAt = iso(0)
    const machine = makeMachine({
      telemetry: makeTelemetry({
        observedAt,
        job: {
          value: { fileName: 'A.dst', product: null, needle: 1, threadColor: null, currentStitch: 60_000, totalStitches: 46_453, elapsedSeconds: 100 },
          observedAt, source: 'controller', quality: 'verified',
        },
      }),
    })
    expect(estimatedFinish(machine, baseNow).text).toBe('Không tính được (bộ đếm vượt tổng mũi)')
  })

  it('carries the oldest input timestamp, not the newest', () => {
    const observedAt = iso(0)
    const machine = makeMachine({
      telemetry: makeTelemetry({ observedAt, rpm: { value: 720, observedAt: iso(-20_000), source: 'controller', quality: 'verified' } }),
    })
    expect(estimatedFinish(machine, baseNow).basedOn).toBe(iso(-20_000))
  })
})

describe('statusDuration & isLongStop', () => {
  it('escalates a stop only past the site threshold', () => {
    expect(isLongStop(stopped(4), baseNow)).toBe(false)
    expect(isLongStop(stopped(6), baseNow)).toBe(true)
    expect(isLongStop(stopped(6, { stopEscalationMinutes: 15 }), baseNow)).toBe(false)
  })

  it('never escalates a running machine', () => {
    const machine = makeMachine({ statusSince: { status: 'running', at: iso(-120 * 60_000), approximate: false } })
    expect(isLongStop(machine, baseNow)).toBe(false)
  })

  it('hedges the wording when the bridge only knows since its own restart', () => {
    const machine = stopped(41, { statusSince: { status: 'stopped', at: iso(-41 * 60_000), approximate: true } })
    expect(statusDurationText(machine, baseNow, 'UTC')).toBe('ít nhất 41 phút (từ 07:19, chưa rõ mốc trước đó)')
    expect(statusDurationText(stopped(41), baseNow, 'UTC')).toBe('41 phút (từ 07:19)')
  })

  it('has no duration at all when the bridge never saw a change', () => {
    expect(statusDurationText(makeMachine(), baseNow)).toBeNull()
  })
})

describe('formatMinutes', () => {
  it('reads as a person would say it', () => {
    // "≥ 0 phút" trên bảng andon đọc như không có thời lượng, nên nói thẳng là chưa tới một phút.
    expect(formatMinutes(0)).toBe('dưới 1 phút')
    expect(formatMinutes(0.6)).toBe('dưới 1 phút')
    expect(formatMinutes(41.7)).toBe('41 phút')
    expect(formatMinutes(60)).toBe('1 giờ')
    expect(formatMinutes(135)).toBe('2 giờ 15 phút')
  })
})

describe('formatMinutesShort', () => {
  it('rút gọn đúng chỗ cột bảng hết chỗ', () => {
    expect(formatMinutesShort(0)).toBe('dưới 1p')
    expect(formatMinutesShort(41.7)).toBe('41p')
    expect(formatMinutesShort(60)).toBe('1g')
    expect(formatMinutesShort(752)).toBe('12g 32p')
  })

  it('không bao giờ dài hơn bản đầy đủ', () => {
    for (const minutes of [0, 1, 59, 60, 61, 135, 752, 5000]) {
      expect(formatMinutesShort(minutes).length).toBeLessThanOrEqual(formatMinutes(minutes).length)
    }
  })
})

describe('threadBreakRate', () => {
  const withWindow = (breaks: number, threshold: number | null) => {
    const observedAt = iso(0)
    return makeMachine({
      threadBreakWarnPer1000: threshold,
      telemetry: makeTelemetry({
        observedAt,
        threadBreakWindow: { value: { needle: 7, breaks, stitches: 5000 }, observedAt, source: 'controller', quality: 'verified' },
      }),
    })
  }

  it('prints the raw fraction next to the rate so it can be checked', () => {
    const rate = threadBreakRate(withWindow(2, null))
    expect(rate?.ratePer1000).toBeCloseTo(0.4)
    expect(threadBreakText(rate!)).toBe('0,4 lần/1.000 mũi (2 lần trong 5.000 mũi gần nhất, kim 7)')
  })

  it('withholds judgement when the site set no threshold', () => {
    expect(threadBreakRate(withWindow(50, null))?.overThreshold).toBeNull()
    expect(threadBreakRate(withWindow(50, 5))?.overThreshold).toBe(true)
    expect(threadBreakRate(withWindow(2, 5))?.overThreshold).toBe(false)
  })
})

describe('effectivePrice', () => {
  const site = { id: 'hn', pricePer1000Stitches: 38_000 } as Site

  it('lets a machine price override the site price, and says which is in use', () => {
    const machine = makeMachine()
    expect(effectivePrice(machine, site)).toEqual({ value: 38_000, source: 'site', siteValue: 38_000 })

    const own: MachineView = { ...machine, identity: { ...machine.identity, pricePer1000Stitches: 40_000 } }
    expect(effectivePrice(own, site)).toEqual({ value: 40_000, source: 'machine', siteValue: 38_000 })
    expect(effectivePrice(machine, null)).toEqual({ value: null, source: 'none', siteValue: null })
  })
})

describe('offlineReason', () => {
  const offline = (extra: Partial<MachineView['connection']>): MachineView => {
    const machine = makeMachine()
    return { ...machine, connection: { ...machine.connection, state: 'offline', ...extra } }
  }

  it('separates a dead machine from a dead adapter', () => {
    expect(offlineReason(offline({ reachable: true, poll: { failures: 2, breakerOpen: false, breakerOpensForMs: 0, nextPollInMs: 0, lastError: 'ECONNREFUSED' } })))
      .toBe('Còn ping được nhưng adapter không đọc được — lỗi gần nhất: "ECONNREFUSED"')
    expect(offlineReason(offline({ reachable: false, lastReachableAt: iso(-60_000) }), 'UTC'))
      .toBe('Không liên lạc được — có thể máy tắt nguồn hoặc mất mạng. Lần ping được gần nhất: 07:59')
    expect(offlineReason(offline({ reachable: false, lastReachableAt: null }))).toBe('Chưa từng liên lạc được với máy này')
  })

  it('stays silent for a machine that is not offline', () => {
    expect(offlineReason(makeMachine())).toBeNull()
  })
})

describe('rpm history', () => {
  it('summarises the range only with at least two samples', () => {
    const observedAt = iso(0)
    const history = (values: number[]) => makeMachine({
      telemetry: makeTelemetry({ observedAt, rpmHistory: { value: values, observedAt, source: 'controller', quality: 'verified' } }),
    })
    expect(rpmRange(history([650]))).toBeNull()
    expect(rpmRange(history([600, 650, 620]))).toEqual({ min: 600, max: 650, samples: 3 })
  })

  it('draws nothing from a single point rather than a flat lie', () => {
    expect(sparklinePoints([650], 100, 20)).toBeNull()
    expect(sparklinePoints([0, 100], 100, 20)).toBe('0.0,20.0 100.0,0.0')
  })
})
