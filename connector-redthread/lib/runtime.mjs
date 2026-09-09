import WebSocket from 'ws'

function socketUrl(baseUrl) {
  const url = new URL(baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/ws'
  url.search = ''
  return url.toString()
}

function fleetUrl(baseUrl) {
  return `${baseUrl.replace(/\/$/, '')}/api/v2/fleet`
}

export class Runtime {
  constructor({ connector, repairTailer = null, bridgeUrl, bridgeToken, heartbeatMs = 30_000, fetchImpl = fetch, WebSocketImpl = WebSocket, logger = console }) {
    this.connector = connector
    this.repairTailer = repairTailer
    this.bridgeUrl = bridgeUrl
    this.bridgeToken = bridgeToken
    this.heartbeatMs = heartbeatMs
    this.fetch = fetchImpl
    this.WebSocket = WebSocketImpl
    this.logger = logger
    this.retryMs = 1_000
    this.timers = new Set()
    this.stopped = false
    this.operationChain = Promise.resolve()
  }

  async start() {
    await this.connector.init()
    this.#repeat(() => this.#run(() => this.connector.heartbeat(), 'Heartbeat'), this.heartbeatMs)
    this.#repeat(() => this.#run(() => this.connector.replayQueue(), 'Replay queue'), 5_000)
    if (this.repairTailer) {
      this.#repeat(() => this.#run(() => this.repairTailer.tick(), 'Repair tailer'), this.heartbeatMs)
      this.#repeat(() => this.#run(() => this.repairTailer.replayQueue(), 'Replay repair queue'), 5_000)
    }
    this.#repeat(() => this.connector.summary(), 60_000)
    this.#connect()
  }

  stop() {
    this.stopped = true
    for (const timer of this.timers) clearInterval(timer)
    this.timers.clear()
    clearTimeout(this.reconnectTimer)
    this.#stopPolling()
    this.socket?.close()
  }

  #repeat(operation, milliseconds) {
    const timer = setInterval(operation, milliseconds)
    timer.unref?.()
    this.timers.add(timer)
  }

  #run(operation, label) {
    this.operationChain = this.operationChain
      .then(operation)
      .catch((error) => this.logger.error(`${label} lỗi: ${error.message}`))
    return this.operationChain
  }

  #connect() {
    if (this.stopped) return
    const socket = new this.WebSocket(socketUrl(this.bridgeUrl), ['bearer', this.bridgeToken], { handshakeTimeout: 10_000 })
    this.socket = socket
    socket.on('open', () => {
      this.retryMs = 1_000
      this.#stopPolling()
      this.logger.info('Đã nối WebSocket bridge')
    })
    socket.on('message', (raw) => {
      this.#run(async () => {
        const message = JSON.parse(raw.toString())
        await this.connector.ingestMessage(message)
        if (message.type === 'fleet_state') await this.connector.heartbeat()
      }, 'WS message')
    })
    socket.on('error', (error) => this.logger.error(`WebSocket lỗi: ${error.message}`))
    socket.on('close', () => {
      if (this.stopped) return
      this.#startPolling()
      this.reconnectTimer = setTimeout(() => this.#connect(), this.retryMs)
      this.reconnectTimer.unref?.()
      this.retryMs = Math.min(this.retryMs * 2, 60_000)
    })
  }

  #startPolling() {
    if (this.pollTimer) return
    const poll = async () => {
      try {
        const response = await this.fetch(fleetUrl(this.bridgeUrl), {
          headers: { authorization: `Bearer ${this.bridgeToken}` },
          signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const fleet = await response.json()
        await this.#run(() => this.connector.ingestFleet(fleet.machines), 'Fallback poll ingest')
      } catch (error) {
        this.logger.error(`Fallback poll lỗi: ${error.message}`)
      }
    }
    poll()
    this.pollTimer = setInterval(poll, 30_000)
    this.pollTimer.unref?.()
  }

  #stopPolling() {
    if (!this.pollTimer) return
    clearInterval(this.pollTimer)
    this.pollTimer = null
  }
}
