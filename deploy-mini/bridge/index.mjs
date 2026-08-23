import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { WebSocketServer } from 'ws'
import { AuthorizationError, assertPermission, resolveActor, sessionSummary } from './lib/authz.mjs'
import { BridgeService } from './lib/bridge-service.mjs'
import { SCHEMA_VERSION, configWarnings, loadConfig } from './lib/config.mjs'
import { createDesignLibrary } from './lib/design-library.mjs'
import { Logger, newCorrelationId } from './lib/logger.mjs'
import { localNetworkIdentity, scanSubnet } from './lib/network.mjs'
import { RateLimiter } from './lib/rate-limit.mjs'

const configPath = resolve(process.env.BRIDGE_CONFIG ?? './bridge.config.json')
const config = await loadConfig(configPath)
const logger = new Logger({ level: config.logLevel })

for (const warning of configWarnings(config)) logger.warn(warning)

const sockets = new Set()
const service = new BridgeService(config, { logger, publish: broadcast })
const scanLimiter = new RateLimiter()
const mutationLimiter = new RateLimiter()
const designLibrary = createDesignLibrary(config.designLibrary)

await service.load()
for (const warning of service.migrationWarnings) logger.warn('Migration', { warning })

// ------------------------------------------------------------------ helpers

function broadcast(message) {
  if (!sockets.size) return
  const payload = JSON.stringify(message)
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) socket.send(payload)
  }
}

function corsHeaders(origin) {
  if (!origin) return {}
  // CORS is default-deny: an origin that was not configured gets no headers and is
  // rejected before the handler runs.
  if (!config.allowedOrigins.includes(origin)) return null
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type, authorization, x-correlation-id',
    'access-control-allow-methods': 'GET, POST, PATCH, PUT, OPTIONS',
    'access-control-max-age': '600',
    vary: 'origin',
  }
}

function sendJson(response, status, body, extra = {}) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra,
  })
  response.end(payload)
}

function readBody(request, limitBytes) {
  return new Promise((resolvePromise, rejectPromise) => {
    const declared = Number(request.headers['content-length'] ?? 0)
    if (Number.isFinite(declared) && declared > limitBytes) {
      rejectPromise(httpError(413, `Body vượt giới hạn ${limitBytes} byte.`))
      return
    }
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limitBytes) {
        rejectPromise(httpError(413, `Body vượt giới hạn ${limitBytes} byte.`))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text.trim()) { resolvePromise({}); return }
      try { resolvePromise(JSON.parse(text)) } catch { rejectPromise(httpError(400, 'Body không phải JSON hợp lệ.')) }
    })
    request.on('error', (error) => rejectPromise(httpError(400, `Không đọc được body: ${error.message}`)))
  })
}

function httpError(status, message, extra = {}) {
  const error = new Error(message)
  error.status = status
  Object.assign(error, extra)
  return error
}

function clientKey(request) {
  return request.socket.remoteAddress ?? 'unknown'
}

function limitOr429(limiter, key, perMinute) {
  const verdict = limiter.take(key, perMinute)
  if (!verdict.allowed) {
    throw httpError(429, `Vượt giới hạn ${perMinute} lần/phút. Thử lại sau ${Math.ceil(verdict.retryAfterMs / 1000)}s.`, { retryAfterMs: verdict.retryAfterMs })
  }
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/** Serves the built dashboard so the whole product runs on the LAN with no Internet. */
async function serveStatic(pathname, response) {
  if (config.uiPath === null) {
    sendJson(response, 404, { error: 'Bridge này chạy thuần API, không phục vụ giao diện. Xem docs/api/fleet-types.ts.' })
    return
  }
  const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  const candidate = join(config.uiPath, relative === '/' ? 'index.html' : relative)
  if (!candidate.startsWith(config.uiPath)) { sendJson(response, 403, { error: 'Đường dẫn không hợp lệ.' }); return }
  try {
    const file = await readFile(candidate)
    response.writeHead(200, { 'content-type': mimeTypes[extname(candidate)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' })
    response.end(file)
  } catch {
    try {
      const index = await readFile(join(config.uiPath, 'index.html'))
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(index)
    } catch {
      sendJson(response, 404, { error: 'Chưa build giao diện. Chạy `npm run build` rồi khởi động lại bridge.' })
    }
  }
}

// ------------------------------------------------------------------ routes

const routes = [
  { method: 'GET', pattern: /^\/api\/v2\/session$/, permission: null, handler: (ctx) => sessionSummary(ctx.session) },
  // Site names, allowed CIDRs and fleet counts describe the workshop network, so health
  // needs the same permission as the fleet itself. /api/health stays open for probes.
  { method: 'GET', pattern: /^\/api\/v2\/health$/, permission: 'fleet:read', handler: (ctx) => ({ ...service.health(), session: sessionSummary(ctx.session) }) },
  { method: 'GET', pattern: /^\/api\/v2\/readiness$/, permission: null, handler: () => service.readiness() },
  { method: 'GET', pattern: /^\/api\/v2\/fleet$/, permission: 'fleet:read', handler: () => service.fleetState() },
  /**
   * Cổng "máy tự gọi vào" và các địa chỉ vừa gọi tới — kể cả địa chỉ bị từ chối.
   *
   * Cùng quyền với dò mạng (`scan:run`): đây là danh sách địa chỉ chưa ghép máy, phục vụ
   * người đang đấu nối tại xưởng, không phải thông tin để treo lên màn hình chuyền.
   */
  { method: 'GET', pattern: /^\/api\/v2\/ingest$/, permission: 'scan:run', handler: () => service.ingestStatus() },
  // Sản lượng ca là dữ liệu đọc: bảng chấm mũi theo ca, không có đường ghi ngược xuống máy.
  {
    method: 'GET',
    pattern: /^\/api\/v2\/production$/,
    permission: 'fleet:read',
    handler: (ctx) => service.productionReport({
      from: ctx.url.searchParams.get('from'),
      to: ctx.url.searchParams.get('to'),
      siteId: ctx.url.searchParams.get('siteId'),
      machineId: ctx.url.searchParams.get('machineId'),
    }),
  },
  /**
   * Nhật ký kiểm toán, có lọc để xuất được ra file.
   *
   * `truncated` đi kèm kết quả: bản xuất thiếu mà không nói là thiếu thì nguy hiểm hơn không
   * xuất được, vì người đọc sẽ tưởng khoảng trống là "không có ai làm gì".
   */
  {
    method: 'GET',
    pattern: /^\/api\/v2\/audit$/,
    permission: 'audit:read',
    handler: (ctx) => service.audit.read({
      limit: clampAuditLimit(ctx.url.searchParams.get('limit')),
      from: ctx.url.searchParams.get('from'),
      to: ctx.url.searchParams.get('to'),
      actor: ctx.url.searchParams.get('actor'),
      action: ctx.url.searchParams.get('action'),
      result: ctx.url.searchParams.get('result'),
    }),
  },
  { method: 'GET', pattern: /^\/api\/v2\/audit\/retention$/, permission: 'audit:read', handler: () => service.audit.retention() },
  {
    method: 'GET',
    pattern: /^\/api\/v2\/machines\/([^/]+)\/audit$/,
    permission: 'audit:read',
    handler: (ctx) => service.audit.read({ limit: clampLimit(ctx.url.searchParams.get('limit')), targetPrefix: ctx.params[0] })
      .then(({ entries }) => ({ entries })),
  },
  { method: 'GET', pattern: /^\/api\/v2\/network$/, permission: 'scan:run', handler: () => localNetworkIdentity() },
  /**
   * Tra tên mẫu trong thư viện của xưởng. Trả **lý do** chứ không chỉ có/không, vì "chưa cấu
   * hình thư viện", "không có file tên này" và "nhiều mẫu trùng tên rút gọn" là ba việc khác
   * nhau và cách xử lý cũng khác nhau.
   */
  {
    method: 'GET',
    pattern: /^\/api\/v2\/designs$/,
    permission: 'fleet:read',
    handler: async (ctx) => {
      const files = (ctx.url.searchParams.get('files') ?? '')
        .split(',').map((value) => value.trim()).filter(Boolean).slice(0, 200)
      await designLibrary.refreshIndex()
      const entries = {}
      for (const file of files) {
        const found = designLibrary.resolve(file)
        entries[file] = found.status === 'found'
          ? { status: 'found', matchedFile: found.entry.name, viaPrefix: found.viaPrefix === true }
          : { status: found.status, reason: found.reason ?? null, candidates: found.candidates ?? null }
      }
      const library = designLibrary.status()
      // Không trả `path` ra trình duyệt: đường dẫn trên máy bridge không phải việc của giao diện.
      return { library: { enabled: library.enabled, files: library.files, error: library.error }, entries }
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/v2\/scan$/,
    permission: 'scan:run',
    limiter: 'scan',
    handler: async (ctx) => {
      const { siteId, cidr, ports } = ctx.body ?? {}
      if (ctx.body?.acknowledgeScanWarning !== true) {
        throw httpError(400, 'Cần xác nhận cảnh báo quét LAN (acknowledgeScanWarning) trước khi bridge phát gói tin.')
      }
      const result = await scanSubnet({
        cidr, ports, sites: config.sites, siteId,
        timeoutMs: config.scan.timeoutMs,
        concurrency: config.scan.concurrency,
        maxHosts: config.scan.maxHosts,
        maxPorts: config.scan.maxPorts,
        safety: service.safety(),
      })
      service.audit.record({
        actor: ctx.session.actor, role: ctx.session.role, correlationId: ctx.correlationId, remote: ctx.remote,
        action: 'network.scan', targetType: 'subnet', targetId: result.cidr,
        after: { siteId: result.siteId, hostsScanned: result.hostsScanned, portsScanned: result.portsScanned, found: result.results.length },
      })
      // Every hit is an unverified device until a person confirms it at the machine.
      return { ...result, notice: 'Kết quả chỉ nghĩa là địa chỉ IPv4 mở cổng TCP. Chưa xác nhận đây là máy thêu Dahao.' }
    },
  },
  {
    method: 'POST', pattern: /^\/api\/v2\/machines$/, permission: 'machine:pair', limiter: 'mutation',
    handler: (ctx) => service.pairMany(ctx.body?.machines ?? [], ctx.session).then((machines) => ({ machines })),
  },
  {
    method: 'PATCH', pattern: /^\/api\/v2\/machines\/([^/]+)$/, permission: 'machine:update', limiter: 'mutation',
    handler: (ctx) => service.pairMany([{ ...ctx.body, id: ctx.params[0] }], ctx.session).then(([machine]) => ({ machine })),
  },
  {
    method: 'POST', pattern: /^\/api\/v2\/machines\/([^/]+)\/archive$/, permission: 'machine:archive', limiter: 'mutation',
    handler: (ctx) => service.archiveMachine(ctx.params[0], ctx.session, { archived: ctx.body?.archived !== false }).then((machine) => ({ machine })),
  },
  {
    method: 'POST', pattern: /^\/api\/v2\/machines\/([^/]+)\/probe$/, permission: 'machine:probe', limiter: 'mutation',
    handler: (ctx) => service.probe(ctx.params[0], ctx.session),
  },
  // Số bộ đếm do người đọc trên màn hình controller rồi gõ vào. Đi qua `mutation` limiter như mọi
  // thao tác ghi khác: một script gõ hộ nghìn dòng số thì không còn là lời khai của ai cả.
  {
    method: 'POST', pattern: /^\/api\/v2\/machines\/([^/]+)\/manual-reading$/, permission: 'production:enter', limiter: 'mutation',
    handler: (ctx) => service.recordManualReading(ctx.params[0], ctx.body ?? {}, ctx.session),
  },
  {
    method: 'POST', pattern: /^\/api\/v2\/machines\/([^/]+)\/alerts\/([^/]+)\/acknowledge$/, permission: 'alert:acknowledge', limiter: 'mutation',
    handler: (ctx) => service.acknowledgeAlert(ctx.params[0], decodeURIComponent(ctx.params[1]), ctx.session, {
      note: ctx.body?.note ?? null,
      acknowledged: ctx.body?.acknowledged !== false,
    }).then((machine) => ({ machine })),
  },
  {
    method: 'PUT', pattern: /^\/api\/v2\/machines\/([^/]+)\/maintenance$/, permission: 'machine:update', limiter: 'mutation',
    handler: (ctx) => service.setMaintenancePlans(ctx.params[0], ctx.body?.maintenance ?? [], ctx.session).then((machine) => ({ machine })),
  },
  {
    method: 'POST', pattern: /^\/api\/v2\/machines\/([^/]+)\/maintenance\/([^/]+)\/complete$/, permission: 'maintenance:complete', limiter: 'mutation',
    handler: (ctx) => service.completeMaintenance(ctx.params[0], decodeURIComponent(ctx.params[1]), ctx.session, { note: ctx.body?.note ?? null }).then((machine) => ({ machine })),
  },
]

function clampLimit(value) {
  const parsed = Number(value ?? 100)
  return Number.isFinite(parsed) ? Math.min(500, Math.max(1, Math.floor(parsed))) : 100
}

/**
 * Trần riêng, rộng hơn, cho màn hình nhật ký kiểm toán.
 *
 * Xuất một quý nhật ký mà mỗi lần chỉ lấy được 500 dòng thì người ta sẽ đi copy thẳng file
 * JSONL trên máy bridge — và lúc đó bản sao ấy nằm ngoài mọi kiểm soát.
 */
function clampAuditLimit(value) {
  const parsed = Number(value ?? 200)
  return Number.isFinite(parsed) ? Math.min(5_000, Math.max(1, Math.floor(parsed))) : 200
}

/** v1 was removed rather than shimmed, because its payloads implied a transfer feature. */
const removedV1 = /^\/api\/(health|machines|pair|unpair|scan|snapshot|snapshots|network|upload|transfer)(\/|$)/

const server = createServer(async (request, response) => {
  const correlationId = String(request.headers['x-correlation-id'] ?? '').slice(0, 64) || newCorrelationId()
  const log = logger.child(correlationId)
  const url = new URL(request.url, `http://${request.headers.host ?? 'bridge'}`)
  const origin = request.headers.origin ?? null
  const cors = corsHeaders(origin)
  const baseHeaders = { 'x-correlation-id': correlationId, ...(cors ?? {}) }

  if (origin && cors === null) {
    log.warn('Chặn origin ngoài allowlist.', { origin, path: url.pathname })
    sendJson(response, 403, { error: 'Origin không nằm trong allowedOrigins của bridge.' }, baseHeaders)
    return
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(cors ? 204 : 403, baseHeaders)
    response.end()
    return
  }

  if (url.pathname === '/api/health') {
    // Unversioned alias kept for health probes and load balancers: liveness only.
    sendJson(response, 200, service.liveness(), baseHeaders)
    return
  }

  if (!url.pathname.startsWith('/api/')) {
    await serveStatic(url.pathname, response)
    return
  }

  if (!url.pathname.startsWith('/api/v2/') && removedV1.test(url.pathname)) {
    sendJson(response, 410, {
      error: 'API v1 đã bị loại bỏ cùng luồng truyền file. Dùng /api/v2/… và xem mục "Migration v1 → v2" trong README.',
      schemaVersion: SCHEMA_VERSION,
    }, baseHeaders)
    return
  }

  // Ảnh mẫu trả về SVG chứ không phải JSON, nên nó không đi qua bảng route ở trên.
  if (url.pathname === '/api/v2/designs/thumbnail') {
    const session = { ...resolveActor(request, config), correlationId, remote: clientKey(request) }
    try {
      assertPermission(session, 'fleet:read')
    } catch (error) {
      sendJson(response, error.status ?? 403, { error: error.message }, baseHeaders)
      return
    }
    if (request.method !== 'GET') { sendJson(response, 405, { error: 'Chỉ hỗ trợ GET.' }, baseHeaders); return }
    const result = await designLibrary.thumbnail(url.searchParams.get('file'))
    if (result.status !== 'found') {
      sendJson(response, result.status === 'disabled' ? 501 : 404, { error: 'Không có ảnh mẫu.', ...result }, baseHeaders)
      return
    }
    response.writeHead(200, {
      ...baseHeaders,
      'content-type': 'image/svg+xml; charset=utf-8',
      'x-content-type-options': 'nosniff',
      // SVG này do bridge sinh ra, nhưng vẫn khoá lại: một file SVG được phép chứa script, và
      // ảnh mẫu thì không cần tải bất cứ thứ gì từ bên ngoài.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'cache-control': 'private, max-age=300',
    })
    response.end(result.svg)
    return
  }

  const route = routes.find((entry) => entry.pattern.test(url.pathname))
  if (!route) { sendJson(response, 404, { error: 'Không có API này.' }, baseHeaders); return }
  if (route.method !== request.method) { sendJson(response, 405, { error: `Phương thức ${request.method} không hợp lệ cho ${url.pathname}.` }, baseHeaders); return }

  const session = { ...resolveActor(request, config), correlationId, remote: clientKey(request) }
  try {
    if (route.permission) assertPermission(session, route.permission)
    if (route.limiter === 'scan') limitOr429(scanLimiter, `scan:${session.actor}:${clientKey(request)}`, config.limits.scanPerMinute)
    if (route.limiter === 'mutation') limitOr429(mutationLimiter, `mut:${session.actor}:${clientKey(request)}`, config.limits.mutationPerMinute)

    const body = ['POST', 'PATCH', 'PUT'].includes(request.method) ? await readBody(request, config.limits.maxBodyBytes) : null
    const result = await route.handler({ session, body, url, params: url.pathname.match(route.pattern).slice(1), correlationId, remote: clientKey(request) })
    log.info('API ok.', { method: request.method, path: url.pathname, actor: session.actor, role: session.role })
    sendJson(response, 200, result ?? { ok: true }, baseHeaders)
  } catch (error) {
    const status = error.status ?? 500
    if (error instanceof AuthorizationError) {
      // A denied mutation is still evidence: it goes into the audit trail, not just the log.
      service.audit.record({
        actor: session.actor, role: session.role ?? 'anonymous', correlationId, remote: clientKey(request),
        action: `denied:${route.permission}`, targetType: 'api', targetId: url.pathname, result: 'denied', message: error.message,
      })
    }
    log[status >= 500 ? 'error' : 'warn']('API lỗi.', { method: request.method, path: url.pathname, status, reason: error.message, actor: session.actor })
    sendJson(response, status, { error: error.message, field: error.field ?? null, correlationId }, baseHeaders)
  }
})

// ------------------------------------------------------------------ websocket

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host ?? 'bridge'}`)
  if (url.pathname !== '/ws') { socket.destroy(); return }
  const origin = request.headers.origin ?? null
  if (origin && !config.allowedOrigins.includes(origin)) {
    logger.warn('Chặn WebSocket từ origin ngoài allowlist.', { origin })
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    socket.destroy()
    return
  }
  // Browsers cannot set an Authorization header on a WebSocket, so the token travels as a
  // subprotocol instead of a query string (query strings end up in proxy access logs).
  const offered = String(request.headers['sec-websocket-protocol'] ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
  const presented = offered.length > 1 && offered[0] === 'bearer' ? offered[1] : null
  const session = resolveActor({ headers: presented ? { authorization: `Bearer ${presented}` } : {} }, config)
  if (config.auth.mode !== 'single-admin' && !session.authenticated) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request, session, presented ? 'bearer' : undefined))
})

wss.on('connection', (socket, request, session) => {
  sockets.add(socket)
  logger.info('Dashboard kết nối.', { actor: session.actor, role: session.role, clients: sockets.size })
  socket.send(JSON.stringify({
    type: 'hello',
    schemaVersion: SCHEMA_VERSION,
    serverTime: new Date().toISOString(),
    session: sessionSummary(session),
    heartbeatSeconds: 20,
  }))
  socket.send(JSON.stringify(service.fleetState()))
  socket.isAlive = true
  socket.on('pong', () => { socket.isAlive = true })
  // The socket is a one-way feed. Client messages are ignored on purpose: no command
  // channel to a controller exists in this product.
  socket.on('message', () => {})
  socket.on('close', () => { sockets.delete(socket); logger.info('Dashboard ngắt kết nối.', { clients: sockets.size }) })
  socket.on('error', (error) => logger.warn('Lỗi WebSocket.', { reason: error.message }))
})

const heartbeat = setInterval(() => {
  for (const socket of sockets) {
    if (!socket.isAlive) { socket.terminate(); sockets.delete(socket); continue }
    socket.isAlive = false
    socket.ping()
  }
  scanLimiter.prune()
  mutationLimiter.prune()
}, 20_000)

const pollTimer = setInterval(() => { void service.poll() }, Math.max(1000, Math.floor(config.poll.intervalMs / 4)))
service.startProductionFlush()
void service.poll()

// Cổng cho máy tự gọi vào (Dahao C44/C41). Trả về null khi ingest.enabled = false.
const ingestAddress = await service.dialIn.listen().catch((error) => {
  logger.error('Không mở được cổng dial-in.', { host: config.ingest.host, port: config.ingest.port, reason: error.message })
  return null
})
if (ingestAddress) logger.info('Cổng dial-in đang lắng nghe.', { ...ingestAddress, capture: config.ingest.capture })

server.listen(config.port, config.host, () => {
  logger.info('Bridge sẵn sàng.', {
    url: `http://${config.host}:${config.port}`,
    websocket: `ws://${config.host}:${config.port}/ws`,
    sites: config.sites.map((site) => site.id),
    machines: service.machines.length,
    authMode: config.auth.mode,
  })
})

async function shutdown(signal) {
  logger.info('Đang dừng bridge.', { signal })
  clearInterval(heartbeat)
  clearInterval(pollTimer)
  for (const socket of sockets) socket.close(1001, 'Bridge shutting down')
  await service.dialIn.close().catch(() => {})
  await service.audit.flush()
  // Sản lượng ca chưa kịp ghi phải xuống đĩa trước khi tắt, nếu không là mất mũi của ca đang chạy.
  await service.stopProductionFlush().catch(() => {})
  await service.store.removeTemporary().catch(() => {})
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
