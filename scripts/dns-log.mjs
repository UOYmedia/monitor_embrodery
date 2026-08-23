#!/usr/bin/env node
/**
 * Phép thử `Z02 DNS Server`: lắng nghe cổng 53, ghi lại mọi tên miền máy thêu hỏi.
 *
 * Đây là phép thử **kết luận được dù kết quả ra sao**, và là phép thử rẻ nhất còn lại. Controller
 * không mở cổng nào, không tự gọi vào `C44:C41`, không phát broadcast — nhưng một thiết bị có ngăn
 * xếp mạng đang sống thì **không tránh được việc hỏi tên miền**. `Z02` là ô ta điền được, nên trỏ
 * nó về máy chạy công cụ này là biến sự im lặng của controller thành bằng chứng.
 *
 * Công cụ chỉ **mô tả và phân loại**, không đoán giao thức: tên miền nào chưa biết thì nó nói thẳng
 * là chưa biết và bảo đi tra WHOIS. Gói nào không phải DNS thì ghi nguyên hex thay vì ném đi — một
 * gói lạ tới cổng 53 tự nó đã là phát hiện.
 *
 *   node scripts/dns-log.mjs                          # ghi log, trả NXDOMAIN cho mọi tên
 *   node scripts/dns-log.mjs --upstream 192.168.7.254 # ghi log NHƯNG vẫn cho máy ra Internet
 *   node scripts/dns-log.mjs --port 5354              # tự thử trên máy không có quyền root
 *
 * Về quyền: cổng 53 < 1024, nhưng **đo được trên Darwin 27 là user thường bind UDP/53 vẫn thành công**
 * (uid 501, không sudo). Linux thường vẫn cần root hoặc `CAP_NET_BIND_SERVICE`, Windows cần
 * *Run as administrator*. Cứ chạy thử trước, không cần nâng quyền theo phản xạ.
 *
 * Chỉ nghe UDP: công cụ này không bao giờ trả bản ghi trả lời nên không có câu trả lời nào bị cắt, do
 * đó không có fallback sang TCP để phải xử lý.
 */

import { createSocket } from 'node:dgram'
import { appendFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { isPrivateIpv4 } from '../bridge/lib/net-policy.mjs'
import { DnsFrameError, RCODES, buildResponse, classifyQuery, parseQuery, summarize, typeName } from './lib/dns-frame.mjs'
import { checkLocalNetwork, unusableResult } from './lib/local-network.mjs'

const args = process.argv.slice(2)
const value = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const port = Number(value('--port', 53))
const host = value('--host', '0.0.0.0')
const outPath = value('--out', './bridge-data/dns-log.jsonl')
const upstream = value('--upstream', null)
const only = value('--only', null)
const upstreamTimeoutMs = Number(value('--upstream-timeout', 4000))

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`--port không hợp lệ: ${value('--port', 53)}`)
  process.exit(1)
}
if (upstream && !isPrivateIpv4(upstream) && !/^\d+\.\d+\.\d+\.\d+$/.test(upstream)) {
  console.error(`--upstream phải là một địa chỉ IPv4: ${upstream}`)
  process.exit(1)
}

/** Mọi truy vấn đã ghi, dùng cho bản kết luận lúc thoát. */
const entries = []
/** Kết quả phép thử quyền mạng nội bộ. Chưa biết thì không được kết luận gì từ một log trắng. */
let lanCheck = null
/** Tên nào đã in phần giải nghĩa rồi, để không in lại mỗi lần máy hỏi lại cùng tên đó. */
const explained = new Set()
let unparsed = 0

function localAddresses() {
  return Object.values(networkInterfaces()).flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
}

async function record(entry) {
  entries.push(entry)
  try {
    await appendFile(outPath, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch (error) {
    console.error(`Không ghi được ${outPath}: ${error.message}`)
  }
}

function timestamp() {
  return new Date().toISOString()
}

/**
 * Chuyển tiếp truy vấn tới một DNS thật rồi trả nguyên văn câu trả lời về cho máy.
 *
 * Vì sao cần chế độ này: `Z02 = 0.0.0.0` nghĩa là máy không có DNS nào, nên nếu nó cần phân giải
 * tên đám mây thì nó không thể — và ta sẽ không bao giờ biết chuyện gì xảy ra *sau khi* phân giải
 * xong. Chuyển tiếp giữ cho máy hoạt động bình thường, nhờ đó xem được icon cloud trên chính máy có
 * sáng lên không. Chỉ chuyển tiếp cho nguồn trong dải LAN riêng (và loopback, để tự thử được trên
 * chính máy đang chạy): công cụ chẩn đoán không được vô tình thành một open resolver.
 */
function forward(buffer, remote, socket) {
  const client = createSocket('udp4')
  const timer = setTimeout(() => {
    client.close()
    console.log(`         ↳ DNS thật ${upstream} không trả lời trong ${upstreamTimeoutMs} ms`)
  }, upstreamTimeoutMs)

  client.on('message', (answer) => {
    clearTimeout(timer)
    socket.send(answer, remote.port, remote.address)
    client.close()
  })
  client.on('error', (error) => {
    clearTimeout(timer)
    console.error(`         ↳ lỗi khi hỏi ${upstream}: ${error.message}`)
    client.close()
  })
  client.send(buffer, 53, upstream)
}

const socket = createSocket('udp4')

socket.on('message', async (buffer, remote) => {
  const at = timestamp()
  if (only && remote.address !== only) return

  let query
  try {
    query = parseQuery(buffer)
  } catch (error) {
    unparsed += 1
    const reason = error instanceof DnsFrameError ? error.message : String(error?.message ?? error)
    console.log(`${at}  ${remote.address}  ⚠ KHÔNG PHẢI DNS — ${reason}`)
    console.log(`         hex: ${buffer.toString('hex')}`)
    await record({ at, remote: remote.address, port: remote.port, name: null, type: null, verdict: 'not-dns', reason, hex: buffer.toString('hex') })
    return
  }

  const forwardable = isPrivateIpv4(remote.address) || remote.address === '127.0.0.1'
  const mode = upstream && forwardable ? 'forward' : 'nxdomain'
  for (const question of query.questions) {
    const verdict = classifyQuery(question.name)
    console.log(`${at}  ${remote.address}  ${typeName(question.type).padEnd(5)} ${question.name || '(không có câu hỏi)'}  → ${verdict.verdict}`)
    if (!explained.has(verdict.verdict)) {
      explained.add(verdict.verdict)
      console.log(`         ${verdict.meaning}`)
      console.log(`         Việc tiếp: ${verdict.next}`)
    }
    await record({
      at, remote: remote.address, port: remote.port, id: query.id,
      name: question.name, type: question.type, class: question.class,
      verdict: verdict.verdict, answered: mode,
    })
  }
  if (query.questions.length === 0) {
    const verdict = classifyQuery('')
    console.log(`${at}  ${remote.address}  gói DNS không có câu hỏi nào (QDCOUNT ${query.counts.questions})`)
    await record({ at, remote: remote.address, port: remote.port, id: query.id, name: '', type: null, verdict: verdict.verdict, answered: mode, hex: buffer.toString('hex') })
  }

  if (mode === 'forward') forward(buffer, remote, socket)
  else socket.send(buildResponse(query, buffer, { rcode: RCODES.nameError }), remote.port, remote.address)
})

socket.on('error', (error) => {
  if (error.code === 'EACCES') {
    console.error(`\nKhông bind được cổng ${port}: cần quyền quản trị.`)
    console.error('  macOS/Linux : sudo node scripts/dns-log.mjs')
    console.error('  Windows     : mở Command Prompt bằng "Run as administrator" rồi chạy lại')
    console.error(`  Tự thử      : node scripts/dns-log.mjs --port 5354   (rồi dig @127.0.0.1 -p 5354 ...)`)
  } else if (error.code === 'EADDRINUSE') {
    console.error(`\nCổng ${port} đã có tiến trình khác giữ. Tắt nó, hoặc chọn --port khác.`)
  } else {
    console.error(`\nLỗi socket: ${error.message}`)
  }
  process.exit(1)
})

socket.on('listening', async () => {
  const bound = socket.address()
  console.log(`\n=== dns-log — phép thử Z02 DNS Server ===`)
  console.log(`Đang nghe   : ${bound.address}:${bound.port} (UDP)`)
  console.log(`Ghi log     : ${outPath}`)
  console.log(`Trả lời     : ${upstream ? `chuyển tiếp tới DNS thật ${upstream} (máy vẫn ra được Internet)` : 'NXDOMAIN cho mọi tên (chỉ ghi log)'}`)
  if (only) console.log(`Chỉ nhận    : ${only}`)
  const addresses = localAddresses()
  console.log(`IP máy này  : ${addresses.length ? addresses.join(', ') : 'không thấy IP LAN nào — máy này chưa nối mạng xưởng'}`)
  console.log('')
  console.log('Việc phải làm tại máy thêu (2 phút):')
  console.log(`  1. Emb asst. Para trang 3/4 → Z02 DNS Server = ${addresses[0] ?? '<IP của máy này>'}`)
  console.log('  2. Kiểm C46 Gateway = 192.168.7.254 và C45 Subnet mask = 255.255.255.0')
  console.log('  3. Tắt nguồn máy, chờ 10 giây, bật lại')
  console.log('  4. Nhìn icon cloud/wifi trên thanh trạng thái của CHÍNH máy, không nhìn bảng này')
  console.log('')
  // Phải kiểm trước khi máy thêu kịp nói gì: nếu tiến trình này không được ra mạng nội bộ thì một
  // log trắng chẳng chứng minh điều gì về controller, mà đó lại là kết luận đắt nhất của cả dự án.
  lanCheck = await checkLocalNetwork(networkInterfaces())
  console.log(`Mạng nội bộ : ${lanCheck.meaning}`)
  if (lanCheck.blocked !== false) console.log(`Việc tiếp   : ${lanCheck.next}`)
  console.log('')
  console.log('Ctrl-C để dừng và in bản kết luận.')
  console.log('')
})

function finish() {
  const summary = summarize(entries)
  console.log(`\n\n=== Kết luận sau ${entries.length} bản ghi ===`)
  if (unparsed) console.log(`Gói không phải DNS : ${unparsed} (đã ghi nguyên hex vào ${outPath})`)
  for (const seen of summary.names) {
    const label = seen.name == null ? '(gói không phải DNS)' : (seen.name || '(gói DNS rỗng câu hỏi)')
    console.log(`  ${String(seen.count).padStart(4)}×  ${label}  [${seen.types.join(', ') || '—'}]  → ${seen.verdict}`)
  }
  console.log('')
  if (entries.length === 0 && lanCheck?.blocked === true) {
    const unusable = unusableResult('Log DNS')
    console.log(`Kết luận  : không-đo-được`)
    console.log(`Nghĩa là  : ${unusable.meaning}`)
    console.log(`Việc tiếp : ${unusable.next}`)
  } else {
    console.log(`Kết luận  : ${summary.verdict}`)
    console.log(`Nghĩa là  : ${summary.meaning}`)
    console.log(`Việc tiếp : ${summary.next}`)
  }
  console.log('')
  console.log(`Ghi kết quả này vào execution-notes.md — kể cả khi là "không có truy vấn nào".`)
  console.log(`Chưa làm thì ghi "chưa làm", đừng ghi "không có tác dụng".`)
  process.exit(0)
}

process.on('SIGINT', finish)
process.on('SIGTERM', finish)

socket.bind(port, host)
