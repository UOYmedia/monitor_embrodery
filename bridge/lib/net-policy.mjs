/**
 * Address safety rules for every outbound connection the bridge can be asked to make.
 *
 * The bridge is the only component allowed to touch a controller, so this module is the
 * single choke point that decides whether an IP is inside a site the operator granted.
 * Everything else (scan, pairing, polling, probing) must call `assertAllowedTarget`.
 */

/**
 * A refused address is a bad request, not a bridge failure: the caller asked for something
 * outside the network they were granted. Carrying the status here keeps the HTTP layer from
 * reporting a policy decision as a 500.
 */
export class PolicyError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PolicyError'
    this.status = 400
  }
}

export function isIpv4(value) {
  if (typeof value !== 'string') return false
  const parts = value.trim().split('.')
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

export function ipv4ToInt(ipAddress) {
  return ipAddress.trim().split('.').reduce((total, octet) => (total * 256) + Number(octet), 0) >>> 0
}

export function intToIpv4(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.')
}

export function normalizeMac(value) {
  if (!value) return null
  const compact = String(value).replace(/[^a-fA-F0-9]/g, '')
  if (!/^[a-fA-F0-9]{12}$/.test(compact)) return null
  // Node báo đúng chuỗi toàn 0 cho card KHÔNG có địa chỉ phần cứng (tunnel VPN/utun trên macOS
  // là non-internal nên lọt qua bộ lọc). Trả nó ra là hiện một MAC trông như thật cho một card
  // không có MAC — cùng họ với "không đọc được nhưng không nói là không đọc được".
  if (/^0{12}$/.test(compact)) return null
  return compact.match(/.{2}/g).join(':').toUpperCase()
}

/** Parses `a.b.c.d/prefix` into its integer base, mask and broadcast. */
export function parseCidr(value) {
  const [address, prefixText, ...rest] = String(value ?? '').trim().split('/')
  const prefix = Number(prefixText)
  if (rest.length || !isIpv4(address) || !/^\d{1,2}$/.test(String(prefixText ?? '')) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new PolicyError(`CIDR không hợp lệ: ${value}. Định dạng đúng là 192.168.1.0/24.`)
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  // `>>> 0` on every result: JS bitwise operators return signed 32-bit integers, and a
  // negative base would silently break every range comparison below.
  const base = (ipv4ToInt(address) & mask) >>> 0
  return { prefix, mask, base, broadcast: (base | (~mask >>> 0)) >>> 0, cidr: `${intToIpv4(base)}/${prefix}` }
}

export function cidrContainsAddress(cidr, ipAddress) {
  const parsed = typeof cidr === 'string' ? parseCidr(cidr) : cidr
  const address = ipv4ToInt(ipAddress)
  return address >= parsed.base && address <= parsed.broadcast
}

export function cidrContainsCidr(outer, inner) {
  const a = typeof outer === 'string' ? parseCidr(outer) : outer
  const b = typeof inner === 'string' ? parseCidr(inner) : inner
  return b.base >= a.base && b.broadcast <= a.broadcast
}

const blockedRanges = [
  { cidr: '0.0.0.0/8', label: 'địa chỉ không xác định' },
  { cidr: '169.254.0.0/16', label: 'link-local' },
  { cidr: '224.0.0.0/4', label: 'multicast' },
  { cidr: '240.0.0.0/4', label: 'dải dự trữ' },
].map((entry) => ({ ...entry, parsed: parseCidr(entry.cidr) }))

const loopback = parseCidr('127.0.0.0/8')
const privateRanges = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'].map(parseCidr)

export function isPrivateIpv4(ipAddress) {
  return privateRanges.some((range) => cidrContainsAddress(range, ipAddress))
}

/**
 * Rejects addresses that must never be dialled, independent of any allowlist.
 * Loopback and public ranges are opt-in because both are legitimate only in
 * explicitly configured setups (local fixture development, routed site links).
 */
export function classifyAddress(ipAddress, { allowLoopback = false, allowPublicRanges = false } = {}) {
  if (!isIpv4(ipAddress)) return { allowed: false, reason: 'Địa chỉ không phải IPv4 hợp lệ.' }
  if (ipAddress === '255.255.255.255') return { allowed: false, reason: 'Không được nhắm tới địa chỉ broadcast.' }
  for (const range of blockedRanges) {
    if (cidrContainsAddress(range.parsed, ipAddress)) return { allowed: false, reason: `Không được nhắm tới ${range.label} (${range.cidr}).` }
  }
  if (cidrContainsAddress(loopback, ipAddress)) {
    return allowLoopback ? { allowed: true } : { allowed: false, reason: 'Không được nhắm tới loopback 127.0.0.0/8. Bật scan.allowLoopback chỉ khi chạy fixture phát triển.' }
  }
  if (!isPrivateIpv4(ipAddress) && !allowPublicRanges) {
    return { allowed: false, reason: 'Địa chỉ nằm ngoài dải LAN riêng (RFC1918). Bật scan.allowPublicRanges nếu site thật sự dùng dải định tuyến khác.' }
  }
  return { allowed: true }
}

/**
 * Confirms an address is both intrinsically safe and inside a CIDR the site was granted.
 * Returns the matching site so callers can attribute the action in the audit log.
 */
export function assertAllowedTarget(ipAddress, { sites, siteId = null, safety = {} }) {
  const verdict = classifyAddress(ipAddress, safety)
  if (!verdict.allowed) throw new PolicyError(verdict.reason)
  const candidates = siteId ? sites.filter((site) => site.id === siteId) : sites
  if (siteId && !candidates.length) throw new PolicyError(`Site ${siteId} chưa được cấu hình trên bridge.`)
  const match = candidates.find((site) => site.allowedCidrs.some((cidr) => cidrContainsAddress(cidr, ipAddress)))
  if (!match) throw new PolicyError(`IP ${ipAddress} nằm ngoài dải mạng được cấp cho ${siteId ? `site ${siteId}` : 'mọi site'}.`)
  return match
}

/**
 * Validates a scan request before a single packet leaves the bridge:
 * the CIDR must sit fully inside one of the site's granted ranges and stay under the host cap.
 */
export function assertScannableCidr(cidr, { sites, siteId, maxHosts = 256, safety = {} }) {
  const site = sites.find((entry) => entry.id === siteId)
  if (!site) throw new PolicyError(`Site ${siteId} chưa được cấu hình trên bridge.`)
  const parsed = parseCidr(cidr)
  if (parsed.prefix < 22 || parsed.prefix > 30) throw new PolicyError('Chỉ quét được dải từ /22 đến /30 để tránh làm nghẽn Wi-Fi xưởng.')
  const granted = site.allowedCidrs.find((allowed) => cidrContainsCidr(allowed, parsed))
  if (!granted) throw new PolicyError(`Dải ${parsed.cidr} không nằm trong danh sách mạng được cấp cho site ${site.name}: ${site.allowedCidrs.join(', ')}.`)
  const hosts = hostsFromCidr(parsed, maxHosts)
  for (const host of hosts) {
    const verdict = classifyAddress(host, safety)
    if (!verdict.allowed) throw new PolicyError(`Dải ${parsed.cidr} chứa địa chỉ bị cấm (${host}): ${verdict.reason}`)
  }
  return { site, hosts, cidr: parsed.cidr }
}

/** Enumerates usable hosts, skipping the network and broadcast addresses. */
export function hostsFromCidr(cidr, maxHosts = 256) {
  const parsed = typeof cidr === 'string' ? parseCidr(cidr) : cidr
  const usable = parsed.prefix >= 31
    ? { first: parsed.base, count: parsed.broadcast - parsed.base + 1 }
    : { first: parsed.base + 1, count: Math.max(0, parsed.broadcast - parsed.base - 1) }
  if (usable.count > maxHosts) throw new PolicyError(`Dải ${parsed.cidr} có ${usable.count} host, vượt giới hạn quét ${maxHosts}. Hãy chia nhỏ subnet.`)
  return Array.from({ length: usable.count }, (_, index) => intToIpv4(usable.first + index))
}
