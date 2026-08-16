import net from 'node:net'
import { appendFile } from 'node:fs/promises'

/**
 * Listener for controllers that dial the bridge instead of waiting to be polled.
 *
 * The Dahao manual (BECS-528 Appendix IV, "Network Connection of Embroidery Machines") has
 * the controller open the connection itself: `C44 Server IP` is "the IP address of the PC
 * installed with the server software" and `C41 Server Port` is that server's port, default
 * 1600. So the machine is the client and this bridge is the server — the exact opposite of
 * the http-json / tcp-json-line adapters.
 *
 * What this listener does NOT do, deliberately:
 *
 *  - It does not implement the Dahao wire format. That specification is not public and this
 *    repository refuses to guess at it. Frames are accepted only if they are newline-
 *    delimited JSON matching docs/adapter-contract.md — which is what a controller-side
 *    agent, or a future decoder, would emit.
 *  - It never writes a single byte back. Not an ack, not a keepalive, not a handshake. A
 *    socket the bridge can write to is a command channel waiting to be discovered, and this
 *    product has no commands.
 *  - It never invents telemetry from bytes it cannot parse. Undecodable traffic is counted,
 *    optionally captured to a file for later protocol work, and surfaced as an error on the
 *    machine. It is never merged into a snapshot.
 *
 * Identification is by source IP only. A frame may carry `machineId`, but it is checked
 * against the machine paired at that address rather than trusted: whoever can open a TCP
 * connection must not be able to claim to be another machine.
 */

const cooldownMs = 30_000

/** `::ffff:192.168.7.100` is the same host as `192.168.7.100`; store one form. */
export function normalizeRemoteAddress(address) {
  if (typeof address !== 'string' || address === '') return null
  return address.startsWith('::ffff:') ? address.slice(7) : address
}

/** A short, log-safe preview of bytes nobody has decoded yet. */
export function describeBytes(buffer, maxBytes = 32) {
  const slice = buffer.subarray(0, maxBytes)
  const hex = slice.toString('hex').replace(/(..)/g, '$1 ').trim()
  const ascii = [...slice].map((byte) => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.')).join('')
  return { bytes: buffer.length, hex, ascii, truncated: buffer.length > maxBytes }
}

export const defaultIngestConfig = {
  // Opening a listening socket for machines to dial into must be a deliberate act.
  enabled: false,
  host: '127.0.0.1',
  // Dahao's documented default for C41, so a workshop only has to set C44 to the bridge IP.
  port: 1600,
  maxConnections: 64,
  maxFrameBytes: 65_536,
  idleTimeoutMs: 120_000,
  maxFramesPerMinute: 240,
  // Capture is for decoding an unknown protocol, so it is off until someone asks for it.
  capture: false,
  captureMaxBytes: 262_144,
}

export class DialInListener {
  /**
   * @param handlers.identify (ip) => { machine } | { reason }  — resolves a source address to
   *   exactly one paired machine. Ambiguity must be an error, never a guess.
   * @param handlers.accept (machine, payload, meta) => void — a decoded JSON frame.
   * @param handlers.undecoded (machine, description, meta) => void — bytes nobody could parse.
   */
  constructor(config, { identify, accept, undecoded, logger, now = () => Date.now() }) {
    this.config = { ...defaultIngestConfig, ...(config ?? {}) }
    this.identify = identify
    this.accept = accept
    this.undecoded = undecoded ?? (() => {})
    this.logger = logger
    this.now = now
    this.server = null
    this.sockets = new Set()
    this.rates = new Map()
    this.cooldowns = new Map()
    this.capturedBytes = 0
    this.stats = {
      connections: 0,
      openConnections: 0,
      framesAccepted: 0,
      framesUndecoded: 0,
      rejections: {},
      lastFrameAt: null,
      lastUndecodedAt: null,
    }
  }

  countRejection(reason) {
    this.stats.rejections[reason] = (this.stats.rejections[reason] ?? 0) + 1
  }

  /** Sliding one-minute budget per machine, so one chatty controller cannot flood the fleet. */
  withinRate(machineId) {
    const at = this.now()
    const window = (this.rates.get(machineId) ?? []).filter((stamp) => at - stamp < 60_000)
    if (window.length >= this.config.maxFramesPerMinute) {
      this.rates.set(machineId, window)
      return false
    }
    window.push(at)
    this.rates.set(machineId, window)
    return true
  }

  /** Always returns a promise so callers can `await`/`catch` uniformly; `null` when disabled. */
  async listen() {
    if (!this.config.enabled) return null
    this.server = net.createServer((socket) => this.onConnection(socket))
    this.server.maxConnections = this.config.maxConnections
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.config.port, this.config.host, () => {
        this.server.removeListener('error', reject)
        this.server.on('error', (error) => this.logger?.error?.('Cổng dial-in lỗi.', { reason: error.message }))
        resolve(this.address())
      })
    })
  }

  address() {
    const info = this.server?.address()
    return info && typeof info === 'object' ? { host: info.address, port: info.port } : null
  }

  onConnection(socket) {
    const remote = normalizeRemoteAddress(socket.remoteAddress)
    const close = (reason) => {
      this.countRejection(reason)
      this.logger?.warn?.('Từ chối kết nối dial-in.', { remote, reason })
      socket.destroy()
    }

    const cooldownUntil = this.cooldowns.get(remote) ?? 0
    if (cooldownUntil > this.now()) { close('cooldown'); return }

    const resolved = this.identify(remote)
    if (!resolved?.machine) { close(resolved?.reason ?? 'unknown_source'); return }
    const machine = resolved.machine

    this.stats.connections += 1
    this.stats.openConnections += 1
    this.sockets.add(socket)
    this.logger?.info?.('Máy gọi vào bridge.', { machineId: machine.id, remote })

    let buffer = Buffer.alloc(0)
    socket.setTimeout(this.config.idleTimeoutMs, () => {
      this.countRejection('idle_timeout')
      socket.destroy()
    })

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])

      let newline = buffer.indexOf(0x0a)
      while (newline >= 0) {
        const frame = buffer.subarray(0, newline)
        buffer = buffer.subarray(newline + 1)
        this.handleFrame(machine, frame, remote, socket)
        // handleFrame may have dropped the connection. destroy() does not interrupt this
        // synchronous loop, so the rest of the chunk has to be abandoned explicitly —
        // otherwise a single burst keeps being processed after its sender was cut off.
        if (socket.destroyed) { buffer = Buffer.alloc(0); return }
        newline = buffer.indexOf(0x0a)
      }

      // No newline in sight and the buffer is full: this is very likely a binary protocol,
      // which is precisely the traffic capture mode exists for. Flush it as one undecoded
      // chunk rather than growing memory or pretending it was telemetry.
      if (buffer.length > this.config.maxFrameBytes) {
        this.handleUndecoded(machine, buffer, remote, 'no_newline')
        buffer = Buffer.alloc(0)
      }
    })

    socket.on('close', () => {
      this.sockets.delete(socket)
      this.stats.openConnections -= 1
      if (buffer.length > 0) this.handleUndecoded(machine, buffer, remote, 'partial_frame')
    })
    socket.on('error', (error) => this.logger?.warn?.('Socket dial-in lỗi.', { machineId: machine.id, remote, reason: error.message }))
  }

  handleFrame(machine, frame, remote, socket) {
    if (frame.length === 0) return
    if (frame.length > this.config.maxFrameBytes) {
      this.countRejection('frame_too_large')
      this.cooldowns.set(remote, this.now() + cooldownMs)
      socket.destroy()
      return
    }
    if (!this.withinRate(machine.id)) {
      this.countRejection('rate_limited')
      this.cooldowns.set(remote, this.now() + cooldownMs)
      socket.destroy()
      return
    }

    let payload
    try {
      payload = JSON.parse(frame.toString('utf8'))
    } catch {
      this.handleUndecoded(machine, frame, remote, 'not_json')
      return
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      this.handleUndecoded(machine, frame, remote, 'not_object')
      return
    }
    // A claimed id is checked, never trusted: the source address already decided who this is.
    if (payload.machineId !== undefined && payload.machineId !== machine.id) {
      this.countRejection('machine_id_mismatch')
      this.logger?.warn?.('Khung dial-in khai sai machineId.', { machineId: machine.id, claimed: String(payload.machineId).slice(0, 64), remote })
      return
    }

    this.stats.framesAccepted += 1
    this.stats.lastFrameAt = new Date().toISOString()
    this.accept(machine, payload, { remote })
  }

  handleUndecoded(machine, bytes, remote, reason) {
    const description = { ...describeBytes(bytes), reason }
    this.stats.framesUndecoded += 1
    this.stats.lastUndecodedAt = new Date().toISOString()
    this.countRejection(reason)
    this.undecoded(machine, description, { remote })
    void this.capture(machine, bytes, description, remote)
  }

  async capture(machine, bytes, description, remote) {
    if (!this.config.capture || !this.config.capturePath) return
    if (this.capturedBytes >= this.config.captureMaxBytes) return
    this.capturedBytes += bytes.length
    const line = JSON.stringify({
      at: new Date().toISOString(),
      machineId: machine.id,
      remote,
      reason: description.reason,
      bytes: description.bytes,
      // Full hex, not the truncated preview: the point of capture is to decode this later.
      hex: bytes.subarray(0, this.config.maxFrameBytes).toString('hex'),
    })
    try {
      await appendFile(this.config.capturePath, `${line}\n`, 'utf8')
    } catch (error) {
      this.logger?.warn?.('Không ghi được file bắt gói dial-in.', { reason: error.message })
    }
  }

  describe() {
    return {
      enabled: Boolean(this.config.enabled),
      address: this.address(),
      capture: Boolean(this.config.capture),
      ...this.stats,
    }
  }

  async close() {
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    if (!this.server) return
    await new Promise((resolve) => this.server.close(resolve))
    this.server = null
  }
}
