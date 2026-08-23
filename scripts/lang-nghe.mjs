#!/usr/bin/env node
/**
 * Ngồi sẵn ở một cổng và in ra từng byte mà máy khác gửi tới.
 *
 * Máy thêu A15 không mở cổng nào cả — quét hết 65535 cổng TCP của 192.168.7.100 và .200 không có cổng
 * nào nghe. Đó không phải hỏng hóc, đó là thiết kế: sổ tay BECS-285A, Appendix 4 §4.2–4.3 ghi `C44 Server
 * IP` là *IP của cái PC có cài EmbNetServer* và `C41 Server Port` là *cổng mà EmbNetServer dùng*.
 * **Máy là bên gọi, PC là bên nghe.** Nên muốn biết nó nói gì thì không có cách nào khác ngoài việc ngồi
 * đúng cổng đó mà chờ — và tìm ổ khoá trên thân máy thêu là tìm sai cánh cửa.
 *
 * NHƯNG NGỒI CHỜ SUÔNG LÀ RA KẾT QUẢ ÂM GIẢ. Đo 18/08/2026: đặt `C44`/`C41` đúng, tắt bật nguồn thật
 * (chứng minh bằng ARP: `.100` `expired` sáu lần liền rồi tươi lại), chờ — **0 byte**. Lý do không phải
 * mạng: ba việc mạng chính thức của A15 là *đưa mẫu vào máy* / bảo trì từ xa / khoá-mở máy trả góp.
 * **Đẩy sản lượng ra server của khách không nằm trong đó**, nên chờ máy tự khai là chờ một việc nó không
 * làm. Muốn nó gọi ra thì phải BẤM LỆNH TẢI MẪU QUA MẠNG trên HMI trong lúc công cụ này đang chạy.
 *
 * Công cụ này CHỈ NGHE VÀ GHI, không trả lời một byte nào. Máy thêu đang chạy sản xuất; đoán bừa một
 * byte trả lời có thể làm controller hiểu sai trạng thái, mà cái giá của việc đó là một tấm hàng hỏng.
 * Muốn trả lời thì phải hiểu giao thức trước, và muốn hiểu giao thức thì phải có bản ghi này trước.
 *
 * PHẢI CHẠY TRONG TERMINAL. Tiến trình không có giao diện thì macOS không hiện được hộp xin quyền
 * Local Network lẫn hộp xin quyền nhận kết nối vào của tường lửa, nên nó mặc định bị từ chối và im
 * lặng — im lặng đó trông y hệt "máy thêu không gửi gì", là kết luận sai đắt nhất có thể rút ra.
 *
 * Ghi ra HAI file, và phải là hai file:
 *   <ra>.bin    chỉ byte thô, không thêm một byte nào của mình → `xxd` đọc được ngay
 *   <ra>.jsonl  ai gửi, lúc nào, nằm ở khúc nào của file thô
 * Tách ra vì đã có lần bắt được 6056 byte mà không biết của ai: trộn chú thích vào file thô thì hỏng
 * file thô, còn không ghi chú thích thì bản ghi vô nghĩa — TLS ClientHello của Safari và gói của máy
 * thêu đều chỉ là byte, chỉ IP nguồn phân biệt được. Cột `offset` là thứ nối hai file lại với nhau.
 *
 *   node scripts/lang-nghe.mjs
 *
 *   --cong=<spec> cổng cần nghe (mặc định 1600, đúng giá trị C41 trên máy). Nhận cả danh sách và
 *                 khoảng: `--cong=1600,8080` hoặc `--cong=1-3865` — khoảng `<1,3865>` là khoảng mà
 *                 chính màn hình HMI ghi là hợp lệ cho C41, nên nghe hết khoảng đó thì "máy gọi vào
 *                 cổng khác" không còn là một thất bại vô hình (SYN vào cổng đóng bị kernel trả RST,
 *                 mình không bao giờ thấy). Chỉ dùng khi đã bí, vì nó chiếm rất nhiều cổng.
 *   --bind=<ip>   địa chỉ lắng nghe (mặc định 0.0.0.0 — nghe mọi giao diện)
 *   --ra=<file>   nơi ghi byte thô (mặc định ./bat-goi-<cong>.bin)
 *   --im          không in hex ra màn hình, chỉ ghi file
 */
import { appendFileSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { networkInterfaces } from 'node:os'
import { createSocket } from 'node:dgram'
import { hexDump } from './lib/hex-dump.mjs'
import { parsePorts } from './lib/port-list.mjs'
import { lanInterfaces } from './lib/local-network.mjs'

const flags = process.argv.slice(2)
const flagValue = (name, fallback) => {
  const found = flags.find((flag) => flag.startsWith(`--${name}=`))
  return found === undefined ? fallback : found.slice(name.length + 3)
}

const spec = flagValue('cong', '1600')
const bind = flagValue('bind', '0.0.0.0')
const quiet = flags.includes('--im')

let ports = []
try {
  ports = parsePorts(spec)
} catch (error) {
  console.error(`--cong không hợp lệ: ${error.message}`)
  console.error('Ví dụ đúng:  --cong=1600   --cong=1600,8080   --cong=1-3865')
  process.exit(1)
}

const rawPath = flagValue('ra', `./bat-goi-${ports.length === 1 ? ports[0] : 'nhieu-cong'}.bin`)
const logPath = `${rawPath.replace(/\.bin$/, '')}.jsonl`

const now = () => new Date().toTimeString().slice(0, 8)

// Đếm tiếp từ chỗ file thô đang dừng, không đếm lại từ 0. Chạy lần hai thì `appendFileSync` nối vào
// cuối file cũ, nên `offset` đếm lại từ 0 sẽ trỏ vào byte của lần chạy trước — đúng cái cột dùng để
// nối .jsonl với .bin lại thành ra chỉ sai. Không có file thì bắt đầu từ 0.
let total = (() => {
  try { return statSync(rawPath).size } catch { return 0 }
})()

// Giờ ISO đầy đủ trong file, giờ ngắn trên màn hình: bản ghi còn phải đối chiếu với đồng hồ trên HMI
// máy thêu, mà đồng hồ đó đang lệch ngày, nên thiếu ngày tháng là mất luôn khả năng đối chiếu.
function note(entry) {
  appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
}

function record(proto, port, from, bytes) {
  const offset = total
  total += bytes.length
  appendFileSync(rawPath, bytes)
  note({ event: 'bytes', proto, port, from, offset, bytes: bytes.length })
  console.log(`\n[${now()}] ${proto.toUpperCase()} :${port} ← ${from} — ${bytes.length} byte (tổng ${total})`)
  if (!quiet) for (const line of hexDump(bytes, { offset })) console.log(`  ${line}`)
}

// Mỗi cổng một cặp socket TCP + UDP. Nghe cả UDP cùng cổng vì chưa ai biết A15 đẩy bằng TCP hay UDP,
// và đoán sai một chiều thì ngồi chờ vô ích mà vẫn tưởng là máy không gửi.
const openSockets = []
const failures = []

function listenOn(port) {
  const server = createServer((socket) => {
    const from = `${socket.remoteAddress?.replace('::ffff:', '')}:${socket.remotePort}`
    note({ event: 'open', proto: 'tcp', port, from })
    console.log(`\n[${now()}] TCP MỞ KẾT NỐI :${port} ← ${from}`)
    let received = 0
    socket.on('data', (chunk) => { received += chunk.length; record('tcp', port, from, chunk) })
    socket.on('close', () => {
      note({ event: 'close', proto: 'tcp', port, from, bytes: received })
      console.log(`[${now()}] TCP đóng :${port} ← ${from} (phiên này ${received} byte)`)
    })
    socket.on('error', (error) => {
      const code = error.code ?? error.message
      note({ event: 'error', proto: 'tcp', port, from, code })
      console.log(`[${now()}] TCP lỗi :${port} ← ${from}: ${code}`)
    })
  })
  // Một cổng bị chiếm không được làm sập cả dàn khi đang nghe nhiều cổng: ghi lại rồi đi tiếp, nhưng
  // PHẢI nói ra cuối cùng bỏ mất cổng nào — một bản ghi thiếu cổng mà không báo thì đọc thành "máy
  // không gửi", đúng cái kết luận sai mà công cụ này sinh ra để tránh.
  server.on('error', (error) => failures.push({ proto: 'tcp', port, code: error.code ?? error.message }))
  server.listen(port, bind)
  openSockets.push(server)

  const udp = createSocket({ type: 'udp4', reuseAddr: true })
  udp.on('message', (message, rinfo) => record('udp', port, `${rinfo.address}:${rinfo.port}`, message))
  udp.on('error', (error) => failures.push({ proto: 'udp', port, code: error.code ?? error.message }))
  udp.bind(port, bind)
  openSockets.push(udp)
}

for (const port of ports) listenOn(port)

// Báo cáo sau khi vòng bind đã chạy xong: `listen` là bất đồng bộ nên lỗi tới sau, và in sớm thì bảng
// tổng kết sẽ nói là bind hết trong khi thực ra hụt.
setTimeout(() => {
  const addresses = lanInterfaces(networkInterfaces()).map((i) => i.address)
  const lost = [...new Set(failures.map((f) => f.port))]
  const bound = ports.filter((port) => !lost.includes(port))
  note({ event: 'listen', bind, addresses, asked: ports.length, bound: bound.length, failures })
  const range = bound.length === 1 ? `${bound[0]}` : `${bound.length} cổng (${bound[0]}–${bound.at(-1)})`
  console.log(`Đang nghe TCP + UDP ${range} tại ${bind}`)
  if (failures.length) {
    const codes = [...new Set(failures.map((f) => f.code))].join(', ')
    console.log(`KHÔNG nghe được ${lost.length} cổng (${codes}) — những cổng này là điểm mù, không phải đã kiểm.`)
    if (codes.includes('EMFILE')) console.log('EMFILE = hết file descriptor. Nâng lên rồi chạy lại:  ulimit -n 12288')
    if (lost.length <= 20) console.log(`Cổng bỏ mất: ${lost.join(', ')}`)
  }
  console.log(`Byte thô  → ${rawPath}`)
  console.log(`Ai gửi gì → ${logPath}`)
  console.log(`IP của máy này trong LAN: ${addresses.join(', ') || '(không thấy)'}`)
  console.log('')
  console.log('Trên máy thêu (Emb asst. Para, TRANG 2/4):')
  console.log(`  C44 Server IP   = ${addresses[0] ?? '<IP máy này ở trên>'}`)
  console.log(`  C41 Server Port = ${bound[0] ?? spec}`)
  console.log('Sửa xong phải TẮT BẬT NGUỒN — Dahao chỉ đọc khối tham số này lúc khởi động.')
  console.log('')
  console.log('RỒI PHẢI BẤM LỆNH TẢI MẪU QUA MẠNG TRÊN HMI. Đây là bước hay bị bỏ, và bỏ nó thì kết quả')
  console.log('trắng KHÔNG có nghĩa gì: đo 18/08/2026 cho thấy đặt đúng tham số + tắt bật nguồn thật vẫn ra')
  console.log('0 byte, vì A15 không có chức năng tự đẩy sản lượng ra. Nó chỉ gọi ra khi được yêu cầu lấy mẫu.')
  console.log('')
  console.log('Công cụ này không trả lời một byte nào, nên máy sẽ gọi vào rồi tự ngắt — có thể ngắt ngay.')
  console.log('Ngắt ngay vẫn là THÀNH CÔNG: chỉ cần thấy một dòng "TCP MỞ KẾT NỐI" là đã biết đường LAN có')
  console.log('thật, và mấy byte đầu tiên là thứ duy nhất mở được đường giải mã giao thức.')
  console.log('Ctrl-C để dừng.')
}, ports.length > 64 ? 1500 : 200)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    note({ event: 'stop', bytes: total })
    console.log(`\n[${now()}] Dừng. Tổng cộng nhận ${total} byte, đã ghi vào ${rawPath}`)
    for (const socket of openSockets) { try { socket.close() } catch { /* đang đóng dở thì thôi */ } }
    process.exit(0)
  })
}
