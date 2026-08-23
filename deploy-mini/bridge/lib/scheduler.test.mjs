import { describe, expect, it } from 'vitest'
import { PollScheduler } from './scheduler.mjs'
import { RateLimiter } from './rate-limit.mjs'

const pollConfig = {
  intervalMs: 30_000, concurrency: 8, jitterRatio: 0.2, timeoutMs: 2_500,
  backoffMs: 10_000, maxBackoffMs: 60_000, breakerFailures: 3, breakerCooldownMs: 120_000,
}

function makeScheduler(overrides = {}) {
  let clock = 1_000_000
  const scheduler = new PollScheduler({ ...pollConfig, ...overrides }, { random: () => 0.5, now: () => clock })
  return { scheduler, advance: (ms) => { clock += ms }, at: () => clock }
}

const fleet = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

describe('PollScheduler', () => {
  it('spreads the first poll of each machine across the interval', () => {
    let clock = 0
    const values = [0, 0.5, 0.99]
    let index = 0
    const scheduler = new PollScheduler(pollConfig, { random: () => values[index++], now: () => clock })
    for (const machine of fleet) scheduler.seed(machine.id)
    const dueTimes = fleet.map((machine) => scheduler.stateFor(machine.id).nextDueAt)
    expect(new Set(dueTimes).size).toBe(3)
    expect(Math.max(...dueTimes)).toBeLessThan(pollConfig.intervalMs)
  })

  it('does not poll every machine on the same beat', () => {
    const { scheduler, advance } = makeScheduler()
    for (const machine of fleet) scheduler.recordSuccess(machine.id)
    advance(pollConfig.intervalMs - 1)
    expect(scheduler.due(fleet)).toHaveLength(0)
    advance(2)
    expect(scheduler.due(fleet)).toHaveLength(3)
  })

  it('backs a failing machine off exponentially up to the cap', () => {
    // Breaker disabled here so the test measures backoff alone.
    const { scheduler, advance, at } = makeScheduler({ breakerFailures: 99 })
    const delays = []
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const state = scheduler.recordFailure('a', new Error('timeout'))
      delays.push(state.nextDueAt - at())
      advance(1)
    }
    expect(delays[0]).toBe(10_000)
    expect(delays[1]).toBeGreaterThan(delays[0])
    expect(Math.max(...delays)).toBeLessThanOrEqual(pollConfig.maxBackoffMs)
  })

  it('trips a circuit breaker so one dead controller cannot hog a poll slot', () => {
    const { scheduler, advance } = makeScheduler()
    for (let attempt = 0; attempt < pollConfig.breakerFailures; attempt += 1) scheduler.recordFailure('a', new Error('refused'))
    expect(scheduler.isBreakerOpen('a')).toBe(true)
    advance(pollConfig.breakerCooldownMs + 1)
    expect(scheduler.isBreakerOpen('a')).toBe(false)
  })

  it('isolates the failing machine: the rest of the fleet stays on schedule', () => {
    const { scheduler, advance } = makeScheduler()
    for (const machine of fleet) scheduler.recordSuccess(machine.id)
    for (let attempt = 0; attempt < pollConfig.breakerFailures; attempt += 1) scheduler.recordFailure('a', new Error('refused'))
    advance(pollConfig.intervalMs + 1)
    expect(scheduler.due(fleet).map((machine) => machine.id)).toEqual(['b', 'c'])
  })

  it('clears failures and the breaker after one good poll', () => {
    const { scheduler } = makeScheduler()
    for (let attempt = 0; attempt < pollConfig.breakerFailures; attempt += 1) scheduler.recordFailure('a', new Error('refused'))
    scheduler.recordSuccess('a')
    expect(scheduler.describe('a')).toMatchObject({ failures: 0, breakerOpen: false, lastError: null })
  })
})

describe('RateLimiter', () => {
  it('allows up to the limit inside one window then reports a retry delay', () => {
    let clock = 0
    const limiter = new RateLimiter({ windowMs: 60_000, now: () => clock })
    for (let attempt = 0; attempt < 3; attempt += 1) expect(limiter.take('scan:tech', 3).allowed).toBe(true)
    const blocked = limiter.take('scan:tech', 3)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBe(60_000)
    clock += 60_001
    expect(limiter.take('scan:tech', 3).allowed).toBe(true)
  })

  it('keys separately per caller', () => {
    const limiter = new RateLimiter({ windowMs: 60_000, now: () => 0 })
    expect(limiter.take('a', 1).allowed).toBe(true)
    expect(limiter.take('a', 1).allowed).toBe(false)
    expect(limiter.take('b', 1).allowed).toBe(true)
  })
})
