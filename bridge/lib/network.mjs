import { execFile } from 'node:child_process'
import { networkInterfaces, platform } from 'node:os'
import net from 'node:net'
import { promisify } from 'node:util'
import { assertScannableCidr, isIpv4, normalizeMac, parseCidr } from './net-policy.mjs'

const execFileAsync = promisify(execFile)

/** Opens and immediately closes a TCP connection. Nothing is written to the device. */
export function probePort(host, port, timeoutMs = 350) {
  return new Promise((resolve) => {
    if (!isIpv4(host)) { resolve(false); return }
    const socket = net.createConnection({ host, port })
    let settled = false
    const finish = (open) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

/** Best-effort MAC lookup from the local ARP cache. Absence is reported as null, never guessed. */
async function macFromArp(host) {
  if (!isIpv4(host)) return null
  const args = platform() === 'win32' ? ['-a', host] : ['-n', host]
  try {
    const { stdout } = await execFileAsync('arp', args, { timeout: 1500, windowsHide: true })
    const match = stdout.match(/(?:[a-f\d]{1,2}[:-]){5}[a-f\d]{1,2}/i)
    return normalizeMac(match?.[0]?.split(/[:-]/).map((part) => part.padStart(2, '0')).join(':'))
  } catch { return null }
}

/**
 * Bounded TCP sweep over a site-approved subnet.
 *
 * A result means only "this IPv4 answered a TCP connect". It is never labelled as a Dahao
 * machine; the caller must present it as an unverified device for a person to confirm.
 */
export async function scanSubnet({ cidr, ports, sites, siteId, timeoutMs = 350, concurrency = 12, maxHosts = 256, maxPorts = 12, safety = {}, signal = null }) {
  const requestedPorts = [...new Set((Array.isArray(ports) ? ports : []).map(Number))]
    .filter((port) => Number.isInteger(port) && port > 0 && port < 65536)
  if (!requestedPorts.length) throw new Error('Chọn ít nhất một cổng TCP hợp lệ để quét.')
  if (requestedPorts.length > maxPorts) throw new Error(`Mỗi lượt chỉ quét tối đa ${maxPorts} cổng TCP.`)

  const { site, hosts, cidr: normalizedCidr } = assertScannableCidr(cidr, { sites, siteId, maxHosts, safety })

  const results = []
  let cursor = 0
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(hosts.length, 1)) }, async () => {
    while (cursor < hosts.length) {
      if (signal?.aborted) return
      const host = hosts[cursor++]
      const checks = await Promise.all(requestedPorts.map(async (port) => ((await probePort(host, port, timeoutMs)) ? port : null)))
      const openPorts = checks.filter((port) => port !== null)
      if (openPorts.length) {
        results.push({
          ipAddress: host,
          openPorts,
          macAddress: await macFromArp(host),
          seenAt: new Date().toISOString(),
          siteId: site.id,
          // Explicit, so no consumer can mistake a TCP-open host for an identified machine.
          classification: 'unverified-device',
        })
      }
    }
  })
  await Promise.all(workers)
  const toInt = (value) => value.split('.').reduce((total, octet) => (total * 256) + Number(octet), 0)
  return { siteId: site.id, cidr: normalizedCidr, hostsScanned: hosts.length, portsScanned: requestedPorts, results: results.sort((a, b) => toInt(a.ipAddress) - toInt(b.ipAddress)) }
}

async function wifiName() {
  try {
    if (platform() === 'darwin') {
      const { stdout } = await execFileAsync('/usr/sbin/networksetup', ['-getairportnetwork', 'en0'], { timeout: 1200 })
      return stdout.match(/: (.+)$/m)?.[1]?.trim() ?? null
    }
    if (platform() === 'win32') {
      const { stdout } = await execFileAsync('netsh', ['wlan', 'show', 'interfaces'], { timeout: 1200, windowsHide: true })
      return stdout.match(/^\s*SSID\s*:\s*(.+)$/m)?.[1]?.trim() ?? null
    }
    const { stdout } = await execFileAsync('iwgetid', ['-r'], { timeout: 1200 })
    return stdout.trim() || null
  } catch { return null }
}

/** IPv4 identity of the bridge host itself. This says nothing about any controller's network. */
export async function localNetworkIdentity() {
  const interfaces = Object.entries(networkInterfaces()).flatMap(([name, entries]) => (entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => ({ name, address: entry.address, netmask: entry.netmask, cidr: safeCidr(entry.cidr), macAddress: normalizeMac(entry.mac) })))
  return { platform: platform(), wifiName: await wifiName(), interfaces }
}

function safeCidr(value) {
  try { return value ? parseCidr(value).cidr : null } catch { return null }
}
