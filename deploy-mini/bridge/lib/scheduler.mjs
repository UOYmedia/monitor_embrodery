/**
 * Per-machine poll scheduling.
 *
 * Workshop Wi-Fi is the scarce resource, so the scheduler never polls the whole fleet on
 * the same beat: each machine gets a jittered due time, a failing machine backs off
 * exponentially, and a machine that keeps failing trips a short circuit breaker so one
 * dead controller cannot occupy a poll slot every cycle.
 */
export class PollScheduler {
  constructor(config, { random = Math.random, now = () => Date.now() } = {}) {
    this.config = config
    this.random = random
    this.now = now
    this.states = new Map()
  }

  stateFor(machineId) {
    if (!this.states.has(machineId)) {
      this.states.set(machineId, { nextDueAt: 0, failures: 0, breakerOpenUntil: 0, lastAttemptAt: null, lastError: null })
    }
    return this.states.get(machineId)
  }

  forget(machineId) { this.states.delete(machineId) }

  /** Spreads the first poll of each machine across the interval instead of bursting. */
  seed(machineId) {
    const state = this.stateFor(machineId)
    if (state.nextDueAt === 0) state.nextDueAt = this.now() + Math.floor(this.random() * this.config.intervalMs)
    return state
  }

  jitter(baseMs) {
    const ratio = this.config.jitterRatio ?? 0
    const spread = baseMs * ratio
    return Math.max(1000, Math.round(baseMs - spread + (this.random() * spread * 2)))
  }

  isBreakerOpen(machineId) {
    return this.stateFor(machineId).breakerOpenUntil > this.now()
  }

  /** Machines whose due time has passed and whose breaker is closed, oldest first. */
  due(machines) {
    const at = this.now()
    return machines
      .filter((machine) => {
        const state = this.stateFor(machine.id)
        return state.nextDueAt <= at && state.breakerOpenUntil <= at
      })
      .sort((a, b) => this.stateFor(a.id).nextDueAt - this.stateFor(b.id).nextDueAt)
  }

  recordSuccess(machineId) {
    const state = this.stateFor(machineId)
    state.failures = 0
    state.breakerOpenUntil = 0
    state.lastError = null
    state.lastAttemptAt = this.now()
    state.nextDueAt = state.lastAttemptAt + this.jitter(this.config.intervalMs)
    return state
  }

  recordFailure(machineId, error) {
    const state = this.stateFor(machineId)
    state.failures += 1
    state.lastError = error?.message ?? String(error)
    state.lastAttemptAt = this.now()
    const backoff = Math.min(this.config.backoffMs * (2 ** (state.failures - 1)), this.config.maxBackoffMs)
    state.nextDueAt = state.lastAttemptAt + this.jitter(backoff)
    if (state.failures >= this.config.breakerFailures) {
      state.breakerOpenUntil = state.lastAttemptAt + this.config.breakerCooldownMs
      state.nextDueAt = Math.max(state.nextDueAt, state.breakerOpenUntil)
    }
    return state
  }

  /** Snapshot for /api/v2/health so slow machines are visible without reading logs. */
  describe(machineId) {
    const state = this.stateFor(machineId)
    const at = this.now()
    return {
      failures: state.failures,
      breakerOpen: state.breakerOpenUntil > at,
      breakerOpensForMs: Math.max(0, state.breakerOpenUntil - at),
      nextPollInMs: Math.max(0, state.nextDueAt - at),
      lastError: state.lastError,
    }
  }
}
