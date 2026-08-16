#!/usr/bin/env node
/**
 * Serves a real network printer to the bridge as if it were a controller endpoint.
 *
 * The bridge already has an `http-json` adapter whose job is to poll "a controller-side
 * service that already speaks the documented snapshot contract" (bridge/lib/adapters.mjs).
 * This is such a service, and its data source is an actual printer over IPP. So testing
 * with a printer needs no bridge change at all: register the machine with adapter
 * `http-json` pointing here.
 *
 * This is a test rig, not a product feature, and not a Dahao anything. See the header of
 * scripts/lib/printer-ipp.mjs and docs/test-may-in.md for what it does and does not prove.
 *
 *   node scripts/printer-probe.mjs --printer=ipp://10.88.88.28:631/printers/May_In [options]
 *
 *   --port=<n>       cổng HTTP của probe (mặc định 9110)
 *   --bind=<ip>      địa chỉ lắng nghe (mặc định 127.0.0.1; đặt IP LAN nếu bridge ở máy khác)
 *   --timeout=<ms>   hạn chờ mỗi lượt hỏi máy in (mặc định 4000)
 *   --once           đọc một lần, in ra rồi thoát — dùng để xem máy in báo được những gì
 *   --raw            với --once, in luôn toàn bộ thuộc tính IPP đọc được
 */
import { createServer } from 'node:http'
import { readPrinter } from './lib/printer-ipp.mjs'

const flags = process.argv.slice(2)
const flagValue = (name, fallback) => {
  const found = flags.find((flag) => flag.startsWith(`--${name}=`))
  return found === undefined ? fallback : found.slice(name.length + 3)
}

const printerUri = flagValue('printer', '')
const port = Number(flagValue('port', '9110'))
const bind = flagValue('bind', '127.0.0.1')
const timeoutMs = Number(flagValue('timeout', '4000'))
const once = flags.includes('--once')
const raw = flags.includes('--raw')

if (!/^ipps?:\/\/[^/]+\/.+/.test(printerUri)) {
  console.error('Thiếu --printer=ipp://<ip>:631/printers/<ten-hang-doi>')
  console.error('Liệt kê hàng đợi trên máy chủ in:  curl -s http://<ip>:631/printers/ | grep -o "printers/[A-Za-z0-9_-]*"')
  process.exit(1)
}
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`--port không hợp lệ: ${flagValue('port', '')}`)
  process.exit(1)
}

// IPP over HTTP: the transport is plain http(s), the ipp:// scheme is only how the printer
// is named inside the request body. Keep both, they are not interchangeable.
const endpoint = printerUri.replace(/^ipps:\/\//, 'https://').replace(/^ipp:\/\//, 'http://')

async function readOnce() {
  return readPrinter({ endpoint, printerUri, timeoutMs })
}

if (once) {
  try {
    const { snapshot, printer, jobs } = await readOnce()
    if (raw) {
      console.log('--- thuộc tính máy in đọc được ---')
      console.log(JSON.stringify(printer, null, 2))
      console.log(`--- ${jobs.length} việc đang trong hàng đợi ---`)
      console.log(JSON.stringify(jobs, null, 2))
      console.log('--- snapshot gửi cho bridge ---')
    }
    console.log(JSON.stringify(snapshot, null, 2))
    const unread = Object.entries({ rpm: snapshot.rpm, odometer: snapshot.odometer, 'tiến độ': snapshot.job?.totalStitches ?? null })
      .filter(([, value]) => value === null).map(([key]) => key)
    if (unread.length) console.log(`\nMáy in này không báo: ${unread.join(', ')} → dashboard sẽ ghi "Chưa đọc được từ controller". Đúng như thiết kế.`)
    process.exit(0)
  } catch (error) {
    console.error(`Không đọc được máy in: ${error.message}`)
    process.exit(2)
  }
}

const server = createServer((request, response) => {
  // A read failure must reach the bridge as a failure. Serving the previous snapshot would
  // hide exactly the thing this rig exists to test: how the dashboard ages and reports a
  // machine that stopped answering.
  readOnce().then(({ snapshot }) => {
    const body = JSON.stringify(snapshot)
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
    response.end(body)
  }).catch((error) => {
    const body = JSON.stringify({ error: error.message })
    response.writeHead(502, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
    response.end(body)
    console.error(`[probe] ${new Date().toISOString()} đọc máy in thất bại: ${error.message}`)
  })
})

server.listen(port, bind, () => {
  console.log(`[probe] Đọc máy in ${printerUri}`)
  console.log(`[probe] Phát snapshot tại http://${bind}:${port}/  (adapter http-json trỏ vào đây)`)
  if (bind === '127.0.0.1') {
    console.log('[probe] Chỉ loopback. Bridge cùng máy thì cần bật scan.allowLoopback; bridge máy khác thì chạy lại với --bind=<IP LAN>.')
  } else {
    console.log('[probe] ĐANG MỞ RA LAN. Đây là rig thử nghiệm, tắt đi khi thử xong.')
  }
  console.log('[probe] Đây KHÔNG phải máy thêu và KHÔNG phải giả lập Dahao. Mọi số đều đọc từ máy in thật.')
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { server.close(); process.exit(0) })
}
