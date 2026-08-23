import net from 'node:net'
import { normalizeTelemetry, adapterIsPolled } from './contract.mjs'
import { assertAllowedTarget } from './net-policy.mjs'

/**
 * Integration mechanisms, not a Dahao protocol.
 *
 * `manual` is an inventory-only registration. `http-json` and `tcp-json-line` are generic
 * transports for a controller-side service that already speaks the documented snapshot
 * contract. None of them knows a real Dahao wire format — that still needs firmware
 * documentation or an authorised capture. See docs/adapter-contract.md.
 */

export class AdapterError extends Error {
  constructor(message, { retriable = true } = {}) {
    super(message)
    this.name = 'AdapterError'
    this.retriable = retriable
  }
}

const maxResponseBytes = 512 * 1024

async function pollHttpJson(machine, { timeoutMs }) {
  const { port = 80, path = '/', tls = false } = machine.adapterConfig ?? {}
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${tls ? 'https' : 'http'}://${machine.ipAddress}:${port}${path}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      // The controller endpoint is a device, not a website: never follow it somewhere else.
      redirect: 'error',
    })
    if (!response.ok) throw new AdapterError(`Controller trả về HTTP ${response.status}.`)
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > maxResponseBytes) throw new AdapterError(`Phản hồi ${length} byte vượt giới hạn ${maxResponseBytes} byte.`, { retriable: false })
    const body = await response.text()
    if (body.length > maxResponseBytes) throw new AdapterError(`Phản hồi vượt giới hạn ${maxResponseBytes} byte.`, { retriable: false })
    try { return JSON.parse(body) } catch { throw new AdapterError('Controller không trả về JSON hợp lệ.', { retriable: false }) }
  } catch (error) {
    if (error instanceof AdapterError) throw error
    if (error?.name === 'AbortError') throw new AdapterError(`Hết ${timeoutMs} ms chờ phản hồi HTTP.`)
    throw new AdapterError(`Không gọi được endpoint HTTP: ${error.message}`)
  } finally {
    clearTimeout(timer)
  }
}

function pollTcpJsonLine(machine, { timeoutMs }) {
  const { port, command = '' } = machine.adapterConfig ?? {}
  return new Promise((resolve, reject) => {
    let received = ''
    let settled = false
    const socket = net.createConnection({ host: machine.ipAddress, port })
    const done = (error, result) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else resolve(result)
    }
    socket.setTimeout(timeoutMs, () => done(new AdapterError(`Hết ${timeoutMs} ms chờ một dòng JSON từ cổng TCP.`)))
    socket.once('connect', () => { if (command) socket.write(`${command}\n`) })
    socket.on('data', (chunk) => {
      received += chunk.toString('utf8')
      if (received.length > maxResponseBytes) { done(new AdapterError(`Phản hồi TCP vượt giới hạn ${maxResponseBytes} byte.`, { retriable: false })); return }
      const newline = received.indexOf('\n')
      if (newline < 0) return
      try { done(null, JSON.parse(received.slice(0, newline))) } catch { done(new AdapterError('Adapter TCP không trả về một dòng JSON hợp lệ.', { retriable: false })) }
    })
    socket.once('error', (error) => done(new AdapterError(`Lỗi socket TCP: ${error.message}`)))
    // Máy đóng kết nối trước khi gửi đủ một dòng: promise PHẢI settle ở đây.
    // Không có nhánh này thì `socket.setTimeout` đã bị goá theo socket, promise treo vĩnh viễn,
    // và vì `pollOnce` await cả lượt còn `poll()` chặn bằng `if (this.polling) return this.polling`,
    // MỘT máy treo làm TOÀN XƯỞNG ngừng cập nhật cho tới khi khởi động lại bridge — mà máy đó
    // cũng không ghi nhận thất bại nào nên breaker không mở và thẻ máy không hiện lỗi gì.
    socket.once('close', () => done(new AdapterError('Kết nối TCP đóng trước khi nhận đủ một dòng JSON.')))
  })
}

/**
 * Polls one machine and returns a validated snapshot.
 * The address is re-checked against the site allowlist on every poll, so editing a
 * machine's IP can never move the bridge outside the network it was granted.
 */
export async function pollMachine(machine, { sites, safety, timeoutMs = 2500, now = () => new Date().toISOString() } = {}) {
  if (machine.adapter === 'manual') {
    throw new AdapterError('Adapter manual chưa có giao thức telemetry. Cấu hình adapter thật khi có tài liệu firmware.', { retriable: false })
  }
  // `dial-in` là máy TỰ GỌI VÀO bridge; địa chỉ trong bản ghi chỉ là danh tính, không phải chỗ
  // bridge được phép gõ cửa. Trước đây chốt chặn duy nhất nằm ở bridge-service, nên mọi lối gọi
  // khác (probe, script, adapter mới) đều đi thẳng vào pollTcpJsonLine với `port` undefined và
  // ném TypeError thô lên thẻ máy. Chặn tại đây, đúng chỗ hợp đồng đã định nghĩa.
  if (!adapterIsPolled(machine.adapter)) {
    throw new AdapterError(`Adapter ${machine.adapter} không nằm trong vòng poll: máy tự gọi vào bridge, bridge không gõ cửa nó.`, { retriable: false })
  }
  assertAllowedTarget(machine.ipAddress, { sites, siteId: machine.siteId, safety })
  // Bản ghi bị sửa tay thành chuỗi rác sẽ cho NaN: phía HTTP huỷ tức thì (lần poll nào cũng
  // "hết giờ"), phía TCP ném ERR_OUT_OF_RANGE nằm ngoài AdapterError. Ngã về mặc định.
  const yeuCau = Number(machine.adapterConfig?.timeoutMs ?? timeoutMs)
  const adapterTimeout = Number.isFinite(yeuCau) && yeuCau > 0 ? yeuCau : timeoutMs
  const raw = machine.adapter === 'http-json'
    ? await pollHttpJson(machine, { timeoutMs: adapterTimeout })
    : await pollTcpJsonLine(machine, { timeoutMs: adapterTimeout })
  return normalizeTelemetry(raw, { machine, receivedAt: now(), source: machine.adapter })
}
