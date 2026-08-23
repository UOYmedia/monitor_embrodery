/**
 * Tells you whether this Node process is allowed to touch the LAN at all, before any tool here
 * blames a device for being silent.
 *
 * Measured on this Mac (Darwin 27, 17/08/2026): `/usr/bin/curl` and `/usr/bin/nc` reach
 * `10.88.88.28:631` and get a real CUPS page back, while `node` and `python3` get `EHOSTUNREACH`
 * on the same address, in the same shell, one second apart — TCP and UDP alike, and forcing the
 * source address with `localAddress` changes nothing. A per-binary difference cannot be routing:
 * it is macOS's Local Network permission, which a headless spawn can never prompt for and which
 * therefore defaults to denied.
 *
 * Why this file exists rather than a comment somewhere: two of this repo's tools read as a
 * finding about the *machine* when they are really reporting this permission.
 *
 *  - `scripts/printer-probe.mjs` says "đọc máy in thất bại: fetch failed" while the printer is up.
 *  - `scripts/dns-log.mjs` would report zero queries, and a zero-query run is documented to mean
 *    "the controller's network stack never came up — stop probing, go ask the dealer". Reaching
 *    that conclusion from a blocked socket, after a trip to the factory, is the single most
 *    expensive mistake this project can make.
 *
 * The probe is one UDP datagram to an address inside our own subnet, port 9 (discard). Nothing has
 * to be listening: a permitted stack accepts the datagram for delivery, a blocked one fails the
 * send immediately. So the check never depends on some other device being switched on.
 */

import { createSocket } from 'node:dgram'
import { intToIpv4, ipv4ToInt } from '../../bridge/lib/net-policy.mjs'

/** Error codes that mean the socket never left this host. `EACCES`/`EPERM` are the sandbox flavours. */
export const BLOCKED_CODES = new Set(['EHOSTUNREACH', 'ENETUNREACH', 'EACCES', 'EPERM'])

/** Discard port: no service is expected, and the datagram is dropped wherever it lands. */
const PROBE_PORT = 9

/** IPv4 LAN interfaces worth probing, from the shape `os.networkInterfaces()` returns. */
export function lanInterfaces(interfaces) {
  return Object.entries(interfaces ?? {})
    .flatMap(([name, entries]) => (entries ?? []).map((entry) => ({ ...entry, name })))
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal && entry.netmask)
    // A /32 is a VPN tunnel (utun), not a LAN: it has no neighbour to aim at.
    .filter((entry) => entry.netmask !== '255.255.255.255')
    .map((entry) => ({ name: entry.name, address: entry.address, netmask: entry.netmask }))
}

/**
 * An address inside our own subnet that is not us, not the network number and not the broadcast.
 *
 * Aiming at the last usable host rather than the first: `.1` and `.254` are where gateways live,
 * and a probe that happens to hit the gateway would still be answered by it, which tells us less
 * than a probe at an address nobody claims.
 */
export function probeTarget({ address, netmask }) {
  const mask = ipv4ToInt(netmask)
  const base = (ipv4ToInt(address) & mask) >>> 0
  const broadcast = (base | (~mask >>> 0)) >>> 0
  if (broadcast - base < 2) return null
  const candidate = broadcast - 1
  const fallback = base + 1
  const chosen = candidate === ipv4ToInt(address) ? fallback : candidate
  return intToIpv4(chosen >>> 0)
}

/** Verdicts, in the same `{ meaning, next }` shape the DNS probe uses, so the CLIs print alike. */
export function explainProbe({ ok, code = null, address = null, target = null } = {}) {
  if (ok) {
    return {
      blocked: false,
      meaning: `Mạng nội bộ: vào được (${address} → ${target}). Kết quả của các phép thử dưới đây là đáng tin.`,
      next: 'Không phải làm gì.',
    }
  }
  if (code === null) {
    return {
      blocked: null,
      meaning: 'Máy này không có giao diện LAN nào (chỉ loopback hoặc VPN). Chưa thử được.',
      next: 'Nối máy vào đúng mạng cần đo rồi chạy lại. Đang ở nhà thì kết quả không nói gì về xưởng.',
    }
  }
  if (BLOCKED_CODES.has(code)) {
    return {
      blocked: true,
      meaning: `macOS đang chặn Node ra mạng nội bộ: gửi ${address} → ${target} trả về ${code}. `
        + 'Đây KHÔNG phải thiết bị đích tắt và KHÔNG phải cáp — đo được cùng lúc là /usr/bin/curl vẫn vào '
        + 'được đúng địa chỉ đó. Khác nhau theo từng file chạy thì chỉ có thể là quyền Local Network.',
      next: 'System Settings → Privacy & Security → Local Network → bật cho ứng dụng đang chạy Node '
        + '(Terminal / iTerm / Claude / node). Rồi THOÁT HẲN ứng dụng đó và mở lại — quyền chỉ có hiệu lực '
        + 'với tiến trình mới. Chạy lại và chờ thấy dòng "Mạng nội bộ: vào được" trước khi tin bất kỳ số nào.',
    }
  }
  return {
    blocked: null,
    meaning: `Phép thử mạng nội bộ trả về ${code} — chưa xếp được loại.`,
    next: 'Ghi nguyên mã lỗi này lại. Đừng suy ra "mạng ổn" cũng đừng suy ra "bị chặn".',
  }
}

/**
 * Why a zero-result run needs its own text: silence has two causes and they lead opposite ways.
 * A blocked stack must never be written down as "the controller never spoke".
 */
export function unusableResult(what = 'phép thử này') {
  return {
    meaning: `KHÔNG KẾT LUẬN ĐƯỢC. ${what} không thu được gì, nhưng chính máy chạy nó đang bị chặn ra mạng nội bộ. `
      + 'Chiều gửi đã đo là bị chặn; chiều nhận chưa đo được, nên số 0 ở đây không phải bằng chứng về máy thêu.',
    next: 'Mở quyền Local Network, chạy lại cho tới khi thấy "Mạng nội bộ: vào được", rồi mới đo lại. '
      + 'Ghi vào execution-notes.md là "chưa đo được vì quyền Local Network", tuyệt đối không ghi "máy không nói gì".',
  }
}

/** Sends the one datagram. Resolves — never rejects — so a caller can preflight without a try block. */
export function probeLocalNetwork({ address, netmask, target = null, timeoutMs = 1500 } = {}) {
  const aim = target ?? probeTarget({ address, netmask })
  if (!aim) return Promise.resolve({ ok: false, code: null, address, target: null })
  return new Promise((resolve) => {
    const socket = createSocket('udp4')
    let settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket.close() } catch { /* already closing */ }
      resolve({ address, target: aim, ...result })
    }
    // A send that neither succeeds nor fails is itself an answer of "unknown", not of "fine".
    const timer = setTimeout(() => done({ ok: false, code: 'ETIMEDOUT' }), timeoutMs)
    socket.on('error', (error) => done({ ok: false, code: error.code ?? error.message }))
    socket.send(Buffer.alloc(0), PROBE_PORT, aim, (error) => {
      if (error) done({ ok: false, code: error.code ?? error.message })
      else done({ ok: true, code: null })
    })
  })
}

/** One call for a CLI startup banner: probe every LAN interface, keep the most usable answer. */
export async function checkLocalNetwork(interfaces, options = {}) {
  const found = lanInterfaces(interfaces)
  if (found.length === 0) return { ...explainProbe({ ok: false, code: null }), results: [] }
  const results = await Promise.all(found.map((entry) => probeLocalNetwork({ ...entry, ...options })))
  const best = results.find((result) => result.ok) ?? results[0]
  return { ...explainProbe(best), results }
}
