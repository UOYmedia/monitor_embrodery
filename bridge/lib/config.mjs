import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { defaultIngestConfig } from './dial-in.mjs'
import { parseCidr } from './net-policy.mjs'
import { defaultShifts, hasUncoveredTime, normalizeShifts } from './shifts.mjs'

export const SCHEMA_VERSION = 2

export const defaultConfig = {
  // Loopback by default: exposing the bridge to every interface must be a deliberate act.
  host: '127.0.0.1',
  port: 8787,
  logLevel: 'info',
  sites: [],
  freshness: { freshSeconds: 30, staleSeconds: 90 },
  poll: {
    intervalMs: 30_000,
    concurrency: 8,
    jitterRatio: 0.2,
    timeoutMs: 2_500,
    backoffMs: 15_000,
    maxBackoffMs: 300_000,
    breakerFailures: 5,
    breakerCooldownMs: 120_000,
  },
  scan: {
    concurrency: 12,
    timeoutMs: 350,
    maxPorts: 12,
    maxHosts: 256,
    allowLoopback: false,
    allowPublicRanges: false,
  },
  limits: {
    maxMachines: 1_000,
    maxBatchPairing: 50,
    maxBodyBytes: 262_144,
    scanPerMinute: 6,
    mutationPerMinute: 120,
  },
  production: {
    // Đủ cho một quý bảng lương khoán; sổ chỉ giữ số mũi theo ca, không giữ telemetry thô.
    retentionDays: 120,
    // Trên ngưỡng này thì chênh lệch bộ đếm là lỗi, không phải sản lượng.
    maxStitchesPerMinute: 1_500,
    // Khoảng mất kết nối dài không được tính là giờ máy chạy.
    maxRunGapSeconds: 120,
    flushIntervalMs: 60_000,
  },
  /**
   * Nhật ký kiểm toán. `retentionDays: null` = **giữ mãi**, và đó là mặc định có chủ ý:
   * một nhật ký tự xoá bớt thì không còn dùng làm bằng chứng được. Muốn xoá theo hạn thì
   * phải tự tay ghi số ngày vào `bridge.config.json`; giao diện không có nút nào làm việc đó.
   */
  audit: { maxBytes: 8_388_608, retentionDays: null },
  // Cổng cho máy tự gọi vào (Dahao C44 Server IP / C41 Server Port). Mặc định tắt: mở một
  // cổng lắng nghe cho thiết bị ngoài phải là quyết định có chủ ý.
  ingest: { ...defaultIngestConfig },
  auth: { mode: 'single-admin', localActor: 'local-admin', tokens: [] },
  allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  dataPath: './bridge-data/fleet-store.json',
  auditPath: './bridge-data/audit-log.jsonl',
  productionPath: './bridge-data/production.json',
  capturePath: './bridge-data/dial-in-capture.jsonl',
  uiPath: './dist',
  /**
   * Thư viện mẫu `.DST` của xưởng, dùng để dựng ảnh mẫu trong giao diện. Mặc định **tắt**:
   * không có thư mục thì không có ảnh, và ô máy ghi rõ "chưa cấu hình thư viện mẫu" thay vì
   * hiện một hình gì đó. Ảnh dựng từ đây là ảnh của **file trong thư viện khớp tên**, không
   * phải ảnh đọc từ controller.
   */
  designLibrary: { path: null, maxFiles: 5_000, maxFileBytes: 8_388_608 },
}

// Tên file đang nạp, để câu lỗi chỉ đúng file cần sửa. `package.json` có bridge:xuong,
// bridge:may-in, bridge:may-that — gắn cứng "bridge.config.json" nghĩa là người ở xưởng đi
// sửa một file KHÔNG chạy, còn file đang chạy vẫn sai.
let fileDangNap = 'bridge.config.json'
function fail(message) { throw new Error(`${fileDangNap}: ${message}`) }

function positiveInt(value, fallback, label) {
  if (value === undefined) return fallback
  // `Number(true)` là 1 và `Number(['30'])` là 30. Nhận bừa nghĩa là `"port": true` cho ra
  // bridge lắng nghe ở cổng 1 mà không một lời nào. Chỉ nhận số, hoặc chuỗi chứa số.
  if (typeof value !== 'number' && typeof value !== 'string') fail(`${label} phải là số dương.`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) fail(`${label} phải là số dương.`)
  return Math.floor(parsed)
}

/**
 * Boolean phải là boolean thật.
 *
 * `Boolean("false")` là TRUE. Bọc boolean trong nháy là lỗi gõ JSON phổ biến nhất, và ở đây
 * hậu quả của nó là mở rộng bề mặt phơi ra mạng: `"ingest": { "enabled": "false" }` từng làm
 * bridge MỞ cổng lắng nghe cho thiết bị ngoài, đúng cái người viết định tắt. Thà hỏng lúc khởi
 * động còn hơn mở một cổng không ai biết.
 */
function strictBool(value, fallback, label) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') fail(`${label} phải là true hoặc false (không có nháy).`)
  return value
}

/** Gõ sai mức log thì im lặng rơi về `info` nghĩa là đang dò lỗi tại xưởng mà không có log. */
function normalizeLogLevel(value) {
  if (value === undefined) return defaultConfig.logLevel
  if (!['debug', 'info', 'warn', 'error'].includes(value)) fail('logLevel phải là debug, info, warn hoặc error.')
  return value
}

function mergeNumbers(defaults, configured = {}, label) {
  // `null` là falsy và mảng có typeof 'object', nên phép kiểm cũ để lọt cả hai: `"freshness": null`
  // từng cho bridge khởi động im lặng với ngưỡng mặc định — đúng thứ module này sinh ra để chặn.
  if (configured !== undefined && (configured === null || typeof configured !== 'object' || Array.isArray(configured))) {
    fail(`${label} phải là object.`)
  }
  const merged = { ...defaults }
  for (const [key, fallback] of Object.entries(defaults)) {
    if (typeof fallback === 'boolean') {
      merged[key] = strictBool(configured?.[key], fallback, `${label}.${key}`)
    } else if (key === 'jitterRatio') {
      const ratio = configured?.[key] === undefined ? fallback : Number(configured[key])
      if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) fail(`${label}.jitterRatio phải nằm trong khoảng 0–1.`)
      merged[key] = ratio
    } else {
      merged[key] = positiveInt(configured?.[key], fallback, `${label}.${key}`)
    }
  }
  return merged
}

/**
 * The dial-in listener, where controllers pointed at `C44 Server IP` connect.
 *
 * Kept apart from mergeNumbers because a listening socket deserves its own bounds: a port
 * outside 1–65535 and a capture file that is on while nobody is decoding anything are both
 * mistakes worth failing at startup rather than discovering in a log.
 */
function normalizeIngest(raw, base) {
  if (raw !== undefined && (raw === null || typeof raw !== 'object')) fail('ingest phải là object.')
  const configured = raw ?? {}
  const port = positiveInt(configured.port, defaultIngestConfig.port, 'ingest.port')
  if (port > 65_535) fail('ingest.port phải là cổng TCP 1–65535.')
  const ingest = {
    enabled: strictBool(configured.enabled, defaultIngestConfig.enabled, 'ingest.enabled'),
    host: String(configured.host ?? defaultIngestConfig.host),
    port,
    maxConnections: positiveInt(configured.maxConnections, defaultIngestConfig.maxConnections, 'ingest.maxConnections'),
    maxFrameBytes: positiveInt(configured.maxFrameBytes, defaultIngestConfig.maxFrameBytes, 'ingest.maxFrameBytes'),
    idleTimeoutMs: positiveInt(configured.idleTimeoutMs, defaultIngestConfig.idleTimeoutMs, 'ingest.idleTimeoutMs'),
    maxFramesPerMinute: positiveInt(configured.maxFramesPerMinute, defaultIngestConfig.maxFramesPerMinute, 'ingest.maxFramesPerMinute'),
    capture: strictBool(configured.capture, defaultIngestConfig.capture, 'ingest.capture'),
    captureMaxBytes: positiveInt(configured.captureMaxBytes, defaultIngestConfig.captureMaxBytes, 'ingest.captureMaxBytes'),
    capturePath: resolve(base, configured.capturePath ?? defaultConfig.capturePath),
  }
  if (ingest.maxFrameBytes > 1_048_576) fail('ingest.maxFrameBytes tối đa 1048576 byte.')
  return ingest
}

/**
 * Không dùng `mergeNumbers` được: `retentionDays` cần phân biệt "không khai" (giữ mãi) với
 * một con số, mà `positiveInt` thì coi mọi giá trị không dương là lỗi cấu hình.
 */
function normalizeAudit(raw) {
  if (raw !== undefined && (raw === null || typeof raw !== 'object')) fail('audit phải là object.')
  const configured = raw ?? {}
  const maxBytes = positiveInt(configured.maxBytes, defaultConfig.audit.maxBytes, 'audit.maxBytes')
  if (maxBytes < 65_536) fail('audit.maxBytes tối thiểu 65536 byte: xoay vòng quá dày làm nhật ký vỡ vụn thành hàng trăm mảnh.')
  if (configured.retentionDays === undefined || configured.retentionDays === null) {
    return { maxBytes, retentionDays: null }
  }
  const days = Number(configured.retentionDays)
  if (!Number.isFinite(days) || days < 30) fail('audit.retentionDays phải từ 30 ngày trở lên, hoặc bỏ trống để giữ mãi.')
  return { maxBytes, retentionDays: Math.floor(days) }
}

function readShifts(rawShifts, label) {
  try {
    return normalizeShifts(rawShifts, label)
  } catch (error) {
    fail(error.message)
  }
}

/** Site-level fallback rate; a machine's own đơn giá overrides it. */
function readPrice(value, label) {
  if (value === undefined || value === null) return null
  const price = Number(value)
  if (!Number.isFinite(price) || price < 0 || price > 10_000_000) fail(`${label} phải là số tiền VND từ 0 đến 10.000.000 cho 1.000 mũi.`)
  return Math.round(price)
}

/**
 * Ngưỡng cảnh báo đứt chỉ, số lần trên 1.000 mũi.
 *
 * Mặc định `null` = xưởng chưa đặt ngưỡng, dashboard chỉ in con số đo được. Không có
 * benchmark công khai cho tỉ lệ đứt chỉ "chấp nhận được", nên một mặc định bịa ra sẽ tạo
 * cảnh báo sai ở xưởng thêu chỉ kim tuyến (vốn đứt nhiều).
 */
function readBreakThreshold(value, label) {
  if (value === undefined || value === null) return null
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1000) fail(`${label} phải là số lần đứt trên 1.000 mũi, lớn hơn 0 và tối đa 1000.`)
  return Math.round(rate * 10) / 10
}

function normalizeSites(rawSites) {
  if (!Array.isArray(rawSites) || !rawSites.length) {
    fail('phải khai báo ít nhất một site với allowedCidrs. Bridge không quét mạng khi chưa được cấp dải IP.')
  }
  const ids = new Set()
  return rawSites.map((site, index) => {
    if (!site || typeof site !== 'object') fail(`site thứ ${index + 1} không hợp lệ.`)
    const id = String(site.id ?? '').trim()
    if (!/^[a-z0-9][a-z0-9-]{0,48}$/i.test(id)) fail(`site thứ ${index + 1} cần id dạng chữ-số-gạch ngang.`)
    if (ids.has(id)) fail(`site id trùng: ${id}.`)
    ids.add(id)
    const allowedCidrs = Array.isArray(site.allowedCidrs) ? site.allowedCidrs : []
    if (!allowedCidrs.length) fail(`site ${id} chưa có allowedCidrs.`)
    return {
      id,
      name: String(site.name ?? id).trim() || id,
      timeZone: String(site.timeZone ?? 'Asia/Ho_Chi_Minh').trim(),
      allowedCidrs: allowedCidrs.map((cidr) => parseCidr(cidr).cidr),
      shifts: readShifts(site.shifts, `site ${id}.shifts`),
      pricePer1000Stitches: readPrice(site.pricePer1000Stitches, `site ${id}.pricePer1000Stitches`),
      freshSeconds: positiveInt(site.freshSeconds, undefined, `site ${id}.freshSeconds`),
      staleSeconds: positiveInt(site.staleSeconds, undefined, `site ${id}.staleSeconds`),
      // Dừng bao lâu thì gọi là "dừng lâu". 5 phút vì thay khung, thay suốt, nối chỉ đều
      // dưới 5 phút — báo sớm hơn là báo động giả, và báo động giả thì bị bỏ qua.
      stopEscalationMinutes: positiveInt(site.stopEscalationMinutes, 5, `site ${id}.stopEscalationMinutes`),
      threadBreakWarnPer1000: readBreakThreshold(site.threadBreakWarnPer1000, `site ${id}.threadBreakWarnPer1000`),
    }
  })
}

function normalizeAuth(rawAuth) {
  const auth = { ...defaultConfig.auth, ...(rawAuth ?? {}) }
  if (!['single-admin', 'token'].includes(auth.mode)) fail('auth.mode phải là "single-admin" hoặc "token".')
  const tokens = Array.isArray(auth.tokens) ? auth.tokens : []
  const resolved = tokens.map((entry, index) => {
    if (!entry || typeof entry !== 'object') fail(`auth.tokens[${index}] không hợp lệ.`)
    const role = String(entry.role ?? '').trim()
    if (!['viewer', 'technician', 'admin'].includes(role)) fail(`auth.tokens[${index}].role phải là viewer|technician|admin.`)
    // Prefer an environment variable so the secret never has to live in a config file.
    const secret = entry.tokenEnv ? process.env[String(entry.tokenEnv)] : entry.token
    if (!secret || String(secret).length < 16) {
      fail(`auth.tokens[${index}] cần token tối thiểu 16 ký tự (đặt qua tokenEnv để không lưu secret trong file).`)
    }
    return { id: String(entry.id ?? `token-${index + 1}`), actor: String(entry.actor ?? `token-${index + 1}`), role, token: String(secret) }
  })
  if (auth.mode === 'token' && !resolved.length) fail('auth.mode="token" nhưng chưa khai báo auth.tokens nào.')
  return { mode: auth.mode, localActor: String(auth.localActor ?? 'local-admin'), tokens: resolved }
}

/** Reads and validates bridge.config.json. An invalid config stops startup rather than degrading silently. */
export async function loadConfig(configPath) {
  fileDangNap = configPath
  let raw = {}
  try {
    raw = JSON.parse(await readFile(configPath, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error(`Không đọc được ${configPath}: ${error.message}`)
    fail(`không tìm thấy ${configPath}. Sao chép bridge.config.example.json rồi khai báo site/allowedCidrs.`)
  }
  const base = dirname(configPath)
  const freshness = mergeNumbers(defaultConfig.freshness, raw.freshness, 'freshness')
  if (freshness.staleSeconds <= freshness.freshSeconds) fail('freshness.staleSeconds phải lớn hơn freshSeconds.')

  const sites = normalizeSites(raw.sites).map((site) => ({
    ...site,
    freshSeconds: site.freshSeconds ?? freshness.freshSeconds,
    staleSeconds: site.staleSeconds ?? freshness.staleSeconds,
  }))
  for (const site of sites) {
    if (site.staleSeconds <= site.freshSeconds) fail(`site ${site.id}: staleSeconds phải lớn hơn freshSeconds.`)
  }

  // Quên ngoặc vuông từng cho ra hậu quả ngược hẳn ý định: origin thật của xưởng bị bỏ, còn hai
  // origin dev localhost lại được mở trên bridge đang chạy ở xưởng. Thay ngầm là sai chỗ này.
  if (raw.allowedOrigins !== undefined && !Array.isArray(raw.allowedOrigins)) {
    fail('allowedOrigins phải là mảng chuỗi, ví dụ ["https://vi-du.example"].')
  }
  const allowedOrigins = Array.isArray(raw.allowedOrigins) ? raw.allowedOrigins.map(String) : defaultConfig.allowedOrigins
  return {
    schemaVersion: SCHEMA_VERSION,
    host: String(raw.host ?? defaultConfig.host),
    port: positiveInt(raw.port, defaultConfig.port, 'port'),
    logLevel: normalizeLogLevel(raw.logLevel),
    sites,
    freshness,
    poll: mergeNumbers(defaultConfig.poll, raw.poll, 'poll'),
    scan: mergeNumbers(defaultConfig.scan, raw.scan, 'scan'),
    limits: mergeNumbers(defaultConfig.limits, raw.limits, 'limits'),
    production: mergeNumbers(defaultConfig.production, raw.production, 'production'),
    productionPath: resolve(base, raw.productionPath ?? defaultConfig.productionPath),
    ingest: normalizeIngest(raw.ingest, base),
    auth: normalizeAuth(raw.auth),
    allowedOrigins,
    dataPath: resolve(base, raw.dataPath ?? defaultConfig.dataPath),
    auditPath: resolve(base, raw.auditPath ?? defaultConfig.auditPath),
    audit: normalizeAudit(raw.audit),
    // `uiPath: null` = KHÔNG phục vụ giao diện. Bridge chạy như một dịch vụ thuần API, để bên
    // khác dựng màn hình riêng hoặc cắm agent vào web của họ. Khác hẳn "trỏ vào thư mục không
    // tồn tại": cái sau vẫn mời gọi mọi đường dẫn lạ rồi trả 404 nhầm thông điệp.
    uiPath: raw.uiPath === null ? null : resolve(base, raw.uiPath ?? defaultConfig.uiPath),
    designLibrary: normalizeDesignLibrary(raw.designLibrary, base),
    khoaLa: khoaKhongNhanRa(raw),
  }
}

/**
 * Khoá cấu hình mà bridge KHÔNG nhận ra — gần như luôn là gõ sai.
 *
 * Trước đây không tầng nào kiểm: `"poll": {"intervalMss": 5000}` cho ra intervalMs mặc định
 * mà không một lời nào, và gõ nhầm `freshSecond` cho ra đúng cái tình huống module này sinh
 * ra để chặn — một ngưỡng tươi sai âm thầm.
 *
 * CẢNH BÁO chứ không làm hỏng: file mẫu cố ý mang khoá chú thích (`_comment`, `_shifts`,
 * `//audit`), nên chặn cứng sẽ làm hỏng chính tài liệu của repo. Khoá bắt đầu bằng `_` hoặc
 * `//` được coi là chú thích và bỏ qua.
 */
function khoaKhongNhanRa(raw) {
  const chuThich = (k) => k.startsWith('_') || k.startsWith('//')
  const cap1 = new Set([...Object.keys(defaultConfig), 'sites', 'auth', 'schemaVersion'])
  const la = []
  for (const k of Object.keys(raw ?? {})) {
    if (chuThich(k)) continue
    if (!cap1.has(k)) la.push(k)
  }
  // Các khối chỉ gồm số/boolean: so với đúng bộ khoá mặc định của khối đó.
  for (const khoi of ['freshness', 'poll', 'scan', 'limits', 'production']) {
    const con = raw?.[khoi]
    if (!con || typeof con !== 'object' || Array.isArray(con)) continue
    const biet = new Set(Object.keys(defaultConfig[khoi] ?? {}))
    for (const k of Object.keys(con)) {
      if (chuThich(k)) continue
      if (!biet.has(k)) la.push(`${khoi}.${k}`)
    }
  }
  return la
}

function normalizeDesignLibrary(raw, base) {
  const defaults = defaultConfig.designLibrary
  if (!raw || raw.path === undefined || raw.path === null || raw.path === '') return { ...defaults, path: null }
  if (typeof raw.path !== 'string') fail('designLibrary.path phải là chuỗi đường dẫn tới thư mục chứa file .DST.')
  return {
    path: resolve(base, raw.path),
    maxFiles: positiveInt(raw.maxFiles, defaults.maxFiles, 'designLibrary.maxFiles'),
    maxFileBytes: positiveInt(raw.maxFileBytes, defaults.maxFileBytes, 'designLibrary.maxFileBytes'),
  }
}

/** Startup warnings for settings that are legal but widen the bridge's exposure. */
export function configWarnings(config) {
  const warnings = []
  if (config.khoaLa?.length) {
    warnings.push(`Không nhận ra khoá cấu hình: ${config.khoaLa.join(', ')}. Gõ sai tên khoá thì giá trị bạn đặt KHÔNG được áp dụng và bridge lặng lẽ dùng mặc định.`)
  }
  if (config.host === '0.0.0.0' || config.host === '::') warnings.push('host đang bind mọi interface. Đặt host thành IPv4 LAN của máy bridge để không lộ ra mạng khác.')
  if (config.auth.mode === 'single-admin') warnings.push('auth.mode="single-admin": mọi request trong LAN được coi là admin cục bộ. Chuyển sang "token" trước khi có nhiều người dùng.')
  if (config.scan.allowLoopback) warnings.push('scan.allowLoopback đang bật. Chỉ dùng cho fixture phát triển, không bật ở xưởng.')
  if (config.scan.allowPublicRanges) warnings.push('scan.allowPublicRanges đang bật. Bridge có thể chạm địa chỉ ngoài dải LAN riêng.')
  if (config.audit?.retentionDays) {
    warnings.push(`audit.retentionDays=${config.audit.retentionDays}: bridge sẽ xoá các mảnh nhật ký kiểm toán cũ hơn ${config.audit.retentionDays} ngày. Bỏ khai báo này nếu cần giữ nhật ký để đối chiếu lương hoặc tranh chấp.`)
  }
  if (config.ingest.enabled) {
    warnings.push(`ingest đang mở cổng ${config.ingest.host}:${config.ingest.port} cho máy tự gọi vào. Chỉ mở trong LAN xưởng và chỉ nhận địa chỉ đã ghép máy.`)
    if (config.ingest.capture) warnings.push('ingest.capture đang bật: bridge ghi lại byte thô chưa giải mã ra đĩa. Chỉ bật khi đang dò giao thức, và nhớ tắt sau đó.')
  }
  for (const site of config.sites) {
    // Wrong shift boundaries produce wrong payroll, so an undeclared calendar must be loud.
    const shifts = site.shifts ?? []
    if (shifts.length === 1 && shifts[0].id === defaultShifts[0].id) {
      warnings.push(`site ${site.id} chưa khai báo ca làm việc: sản lượng đang gộp cả ngày vào một ca. Khai báo sites[].shifts trước khi dùng số liệu để tính lương khoán.`)
    } else if (shifts.length && hasUncoveredTime(shifts)) {
      warnings.push(`site ${site.id} có khoảng thời gian không thuộc ca nào; sản lượng trong khoảng đó sẽ nằm ở nhóm "Ngoài ca".`)
    }
  }
  return warnings
}
