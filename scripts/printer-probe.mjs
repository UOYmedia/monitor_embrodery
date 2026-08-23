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
 *   --via-curl       gửi IPP qua /usr/bin/curl thay vì fetch — chỉ để vượt quyền Local Network
 *                    của macOS trên máy này; bridge ngoài xưởng KHÔNG có đường này
 */
import { createServer } from 'node:http'
import { BLOCKED_CODES, explainProbe } from './lib/local-network.mjs'
import { curlTransport, fetchTransport, readPrinter } from './lib/printer-ipp.mjs'

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

// Đường truyền mặc định là `fetch`, đúng như bridge chạy ngoài xưởng. `curl` chỉ là cách đi vòng
// quyền Local Network của macOS trên máy này, nên nó phải luôn được nói ra thành tiếng: một rig
// im lặng chuyển sang curl sẽ làm ta tưởng quyền đã ổn, rồi ra xưởng mới phát hiện bridge không
// vào được máy nào.
let transport = flags.includes('--via-curl') ? curlTransport : fetchTransport
let announcedFallback = flags.includes('--via-curl')

function announceFallback(code) {
  console.error(`[probe] Node bị chặn ra mạng nội bộ (${code}) → chuyển sang /usr/bin/curl cho lượt đọc này.`)
  console.error('[probe] Đây là đi vòng, không phải đã sửa. Bridge ngoài xưởng chỉ dùng fetch, nên phải bật quyền')
  console.error('[probe] System Settings → Privacy & Security → Local Network trước khi tin bất kỳ phép đo mạng nào.')
}

async function readOnce() {
  try {
    return await readPrinter({ endpoint, printerUri, timeoutMs, transport })
  } catch (error) {
    const code = error?.cause?.code ?? error?.code ?? null
    if (transport === curlTransport || !code || !BLOCKED_CODES.has(code)) throw error
    transport = curlTransport
    if (!announcedFallback) { announceFallback(code); announcedFallback = true }
    return readPrinter({ endpoint, printerUri, timeoutMs, transport })
  }
}

// `fetch` gói mọi lỗi mạng thành đúng hai chữ "fetch failed", nên một máy in đang bật vẫn bị đọc
// thành máy in hỏng. Mã thật nằm ở `cause`, và nếu nó là EHOSTUNREACH thì lỗi ở quyền của máy
// đang chạy Node, không phải ở máy in.
function describeReadFailure(error) {
  const code = error?.cause?.code ?? error?.code ?? null
  if (!code) return error.message
  if (!BLOCKED_CODES.has(code)) return `${error.message} (${code})`
  const verdict = explainProbe({ ok: false, code, address: 'máy này', target: endpoint })
  return `${error.message} (${code})\n[probe] ${verdict.meaning}\n[probe] ${verdict.next}`
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
    console.error(`Không đọc được máy in: ${describeReadFailure(error)}`)
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
    console.error(`[probe] ${new Date().toISOString()} đọc máy in thất bại: ${describeReadFailure(error)}`)
  })
})

// EADDRINUSE ở đây gần như luôn là một rig cũ chưa tắt, nhưng Node ném ra stack trace của `net`
// và không nói điều đó. In thẳng cách tìm và cách tắt, vì đó là câu người đọc đang cần.
server.on('error', (error) => {
  if (error.code !== 'EADDRINUSE') throw error
  console.error(`[probe] Cổng ${bind}:${port} đang bị chiếm — gần như chắc chắn là một rig cũ chưa tắt.`)
  console.error(`[probe] Xem ai giữ :  lsof -nP -iTCP:${port} -sTCP:LISTEN`)
  console.error('[probe] Tắt rig cũ :  pkill -f scripts/printer-probe.mjs')
  process.exit(3)
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
  if (transport === curlTransport) {
    console.log('[probe] --via-curl: IPP đi qua /usr/bin/curl. Chỉ đúng cho máy này, không phải cấu hình xưởng.')
  }
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { server.close(); process.exit(0) })
}
