import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BridgeApi, BridgeApiError } from '../services/bridgeApi'
import { FleetSocket, applyMachineRemoval, applyMachineUpdate, fleetToMap } from '../services/machineSocket'
import type { SocketStatus } from '../services/machineSocket'
import type { BridgeHealth, MachineView, SessionSummary, Site } from '../types/fleet'

/**
 * Single source of truth for live fleet state in the browser.
 *
 * Machines are kept in a Map keyed by id and replaced one at a time, so a single machine
 * update never allocates a new object for the other 99 rows.
 */
export interface FleetData {
  api: BridgeApi
  machines: MachineView[]
  machineMap: Map<string, MachineView>
  sites: Site[]
  session: SessionSummary | null
  health: BridgeHealth | null
  socketStatus: SocketStatus
  socketDetail: string | null
  lastMessageAt: string | null
  loadError: string | null
  nowMs: number
  can: (permission: string) => boolean
  reload: () => Promise<void>
  applyMachine: (machine: MachineView) => void
  setToken: (token: string | null) => void
}

const ageTickMs = 5000

export function useFleetData(baseUrl = ''): FleetData {
  const api = useMemo(() => new BridgeApi(baseUrl), [baseUrl])
  const [machineMap, setMachineMap] = useState<Map<string, MachineView>>(() => new Map())
  const [sites, setSites] = useState<Site[]>([])
  const [session, setSession] = useState<SessionSummary | null>(null)
  const [health, setHealth] = useState<BridgeHealth | null>(null)
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('connecting')
  const [socketDetail, setSocketDetail] = useState<string | null>(null)
  const [lastMessageAt, setLastMessageAt] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [tokenVersion, setTokenVersion] = useState(0)
  const socketRef = useRef<FleetSocket | null>(null)

  // A wall clock the whole tree shares, so every "x giây trước" advances together.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), ageTickMs)
    return () => clearInterval(timer)
  }, [])

  const reload = useCallback(async () => {
    try {
      // Session first: it is the one endpoint an anonymous caller may read, and it says
      // whether this token is allowed to see the site list at all.
      const sessionResult = await api.session()
      setSession(sessionResult)
      if (!sessionResult.permissions.includes('fleet:read')) {
        setHealth(null)
        setSites([])
        setLoadError(null)
        return
      }
      const healthResult = await api.health()
      setHealth(healthResult)
      setSites(healthResult.sites)
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof BridgeApiError ? error.message : 'Không kết nối được bridge. Kiểm tra bridge có đang chạy trong LAN không.')
    }
  }, [api])

  useEffect(() => { void reload() }, [reload, tokenVersion])

  useEffect(() => {
    const socket = new FleetSocket(api.websocketUrl, api.socketProtocols, {
      onStatus: (status, detail) => { setSocketStatus(status); setSocketDetail(detail ?? null) },
      onHello: (helloSession) => setSession(helloSession),
      onFleet: (machines, fleetSites) => {
        setMachineMap(fleetToMap(machines))
        if (fleetSites.length) setSites(fleetSites)
        setLastMessageAt(new Date().toISOString())
      },
      onMachine: (machine) => {
        setMachineMap((current) => applyMachineUpdate(current, machine))
        setLastMessageAt(new Date().toISOString())
      },
      onRemoved: (machineId) => {
        setMachineMap((current) => applyMachineRemoval(current, machineId))
        setLastMessageAt(new Date().toISOString())
      },
    })
    socketRef.current = socket
    socket.connect()
    return () => { socket.close(); socketRef.current = null }
  }, [api, tokenVersion])

  const applyMachine = useCallback((machine: MachineView) => {
    setMachineMap((current) => applyMachineUpdate(current, machine))
  }, [])

  const setToken = useCallback((token: string | null) => {
    api.setToken(token)
    setMachineMap(new Map())
    setTokenVersion((version) => version + 1)
  }, [api])

  const machines = useMemo(() => [...machineMap.values()], [machineMap])
  const can = useCallback((permission: string) => Boolean(session?.permissions.includes(permission)), [session])

  return { api, machines, machineMap, sites, session, health, socketStatus, socketDetail, lastMessageAt, loadError, nowMs, can, reload, applyMachine, setToken }
}
