import { randomUUID } from 'node:crypto'

/** Keys whose values must never reach a log line or an audit entry. */
const secretKeys = /^(token|secret|password|passphrase|apikey|api_key|authorization|credential|psk|wifipassword)$/i

/** Recursively replaces secret-looking values so logs and audit diffs stay safe to keep. */
export function redact(value, depth = 0) {
  if (depth > 6) return '[depth]'
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKeys.test(key) ? '[redacted]' : redact(item, depth + 1)]))
  }
  return value
}

export function newCorrelationId() {
  return randomUUID()
}

/**
 * Newline-delimited JSON logger. Every line carries a correlation id so a dashboard
 * error, an HTTP request and the poll it triggered can be tied together after the fact.
 */
export class Logger {
  constructor({ level = 'info', sink = process.stdout } = {}) {
    this.levels = { debug: 10, info: 20, warn: 30, error: 40 }
    this.level = this.levels[level] ?? this.levels.info
    this.sink = sink
  }

  write(level, message, fields = {}) {
    if ((this.levels[level] ?? 0) < this.level) return
    const line = { at: new Date().toISOString(), level, message, ...redact(fields) }
    this.sink.write(`${JSON.stringify(line)}\n`)
  }

  debug(message, fields) { this.write('debug', message, fields) }
  info(message, fields) { this.write('info', message, fields) }
  warn(message, fields) { this.write('warn', message, fields) }
  error(message, fields) { this.write('error', message, fields) }

  /** Returns a logger that stamps every line with the same correlation id. */
  child(correlationId) {
    const parent = this
    return {
      correlationId,
      debug: (message, fields = {}) => parent.debug(message, { correlationId, ...fields }),
      info: (message, fields = {}) => parent.info(message, { correlationId, ...fields }),
      warn: (message, fields = {}) => parent.warn(message, { correlationId, ...fields }),
      error: (message, fields = {}) => parent.error(message, { correlationId, ...fields }),
      child: (id) => parent.child(id),
    }
  }
}

export const silentLogger = {
  correlationId: 'silent',
  debug() {}, info() {}, warn() {}, error() {},
  child() { return silentLogger },
}
