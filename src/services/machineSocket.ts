import type { MachineView, SessionSummary, Site, SocketMessage } from '../types/fleet'

/**
 * WebSocket feed from the bridge.
 *
 * The socket is one-way by design: the dashboard listens and never sends a command, because
 * this product has no command channel to a controller. Updates arrive as per-machine deltas
 * so one machine changing does not re-send the whole fleet.
 */

export type SocketStatus = 'connecting' | 'connected' | 'disconnected' | 'unauthorized'

export interface FleetSocketHandlers {
  onStatus: (status: SocketStatus, detail?: string) => void
  onHello: (session: SessionSummary, serverTime: string) => void
  onFleet: (machines: MachineView[], sites: Site[], revision: number) => void
  onMachine: (machine: MachineView, revision: number) => void
  onRemoved: (machineId: string, revision: number) => void
}

const maxBackoffMs = 20_000

export class FleetSocket {
  private socket: WebSocket | null = null
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private readonly url: string
  private readonly protocols: string[] | undefined
  private readonly handlers: FleetSocketHandlers

  constructor(url: string, protocols: string[] | undefined, handlers: FleetSocketHandlers) {
    this.url = url
    this.protocols = protocols
    this.handlers = handlers
  }

  connect() {
    this.closed = false
    this.handlers.onStatus('connecting')
    try {
      this.socket = this.protocols ? new WebSocket(this.url, this.protocols) : new WebSocket(this.url)
    } catch (error) {
      this.handlers.onStatus('disconnected', error instanceof Error ? error.message : 'Không mở được WebSocket.')
      this.scheduleReconnect()
      return
    }

    this.socket.onopen = () => {
      this.attempt = 0
      this.handlers.onStatus('connected')
    }
    this.socket.onmessage = (event) => {
      let message: SocketMessage
      try { message = JSON.parse(String(event.data)) as SocketMessage } catch { return }
      this.dispatch(message)
    }
    this.socket.onerror = () => {
      // The browser hides the reason; the close handler reports the visible outcome.
    }
    this.socket.onclose = (event) => {
      this.socket = null
      if (this.closed) return
      // 1008/4401-style rejections mean the token was refused: reconnecting would loop.
      if (event.code === 1008 || event.code === 4401) {
        this.handlers.onStatus('unauthorized', 'Bridge từ chối token của phiên này.')
        return
      }
      this.handlers.onStatus('disconnected', `Mất kết nối WebSocket (mã ${event.code}).`)
      this.scheduleReconnect()
    }
  }

  private dispatch(message: SocketMessage) {
    switch (message.type) {
      case 'hello': this.handlers.onHello(message.session, message.serverTime); break
      case 'fleet_state': this.handlers.onFleet(message.machines, message.sites, message.revision); break
      case 'machine_update': this.handlers.onMachine(message.machine, message.revision); break
      case 'machine_removed': this.handlers.onRemoved(message.machineId, message.revision); break
      default: break
    }
  }

  private scheduleReconnect() {
    if (this.closed) return
    this.attempt += 1
    const delay = Math.min(maxBackoffMs, 1000 * (2 ** Math.min(this.attempt, 4)))
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.connect(), delay)
  }

  close() {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.socket?.close()
    this.socket = null
  }
}

/**
 * Applies one delta to the fleet map. Returning the same object reference for unchanged
 * machines is what lets memoised rows skip re-rendering.
 */
export function applyMachineUpdate(current: Map<string, MachineView>, machine: MachineView): Map<string, MachineView> {
  const next = new Map(current)
  next.set(machine.identity.id, machine)
  return next
}

export function applyMachineRemoval(current: Map<string, MachineView>, machineId: string): Map<string, MachineView> {
  if (!current.has(machineId)) return current
  const next = new Map(current)
  next.delete(machineId)
  return next
}

export function fleetToMap(machines: MachineView[]): Map<string, MachineView> {
  return new Map(machines.map((machine) => [machine.identity.id, machine]))
}
