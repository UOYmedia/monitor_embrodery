#!/usr/bin/env node
/**
 * Trả lời đúng một câu: tiến trình Node này có được ra/vào mạng nội bộ hay không.
 *
 * Cần một công cụ riêng vì quyền Local Network của macOS áp theo **tiến trình**, không theo máy:
 * bật công tắc rồi mà không thoát hẳn ứng dụng thì tiến trình cũ vẫn mang quyền cũ, và người dùng
 * không có cách nào biết ngoài việc đo. Chạy cái này trước mọi phép đo mạng khác — nhất là trước
 * `dns-log` ở xưởng, nơi một log trắng bị đọc sai sẽ kết thúc cả hướng tự làm.
 *
 *   node scripts/kiem-mang.mjs          # đo cả hai chiều rồi thoát
 *   node scripts/kiem-mang.mjs --giay 25  # đổi thời gian nghe chiều nhận
 *
 * Mã thoát: 0 = cả hai chiều thông, 1 = có chiều bị chặn, 2 = không kết luận được.
 */
import { createSocket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { checkLocalNetwork, lanInterfaces } from './lib/local-network.mjs'

const args = process.argv.slice(2)
const seconds = Number(args[args.indexOf('--giay') + 1]) || 12

// Chiều nhận không đo được bằng cách tự gửi cho mình: gói tới IP của chính máy đi đường nội bộ,
// không ra dây. Nên nghe mDNS — thiết bị trong LAN tự phát liên tục, không cần ai hợp tác và
// không phải quét ai.
function listenInbound(ms) {
  const mine = new Set(lanInterfaces(networkInterfaces()).map((i) => i.address))
  const sources = new Set()
  return new Promise((resolve) => {
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    socket.on('error', () => resolve({ sources, error: true }))
    socket.on('message', (_msg, rinfo) => { if (!mine.has(rinfo.address)) sources.add(rinfo.address) })
    socket.bind(5353, () => {
      try { socket.addMembership('224.0.0.251') } catch { /* vẫn nghe unicast */ }
      setTimeout(() => { try { socket.close() } catch { /* đã đóng */ } resolve({ sources, error: false }) }, ms)
    })
  })
}

const out = await checkLocalNetwork(networkInterfaces())
console.log(`\nChiều GỌI RA : ${out.blocked === false ? 'VÀO ĐƯỢC' : out.blocked === true ? 'BỊ CHẶN' : 'KHÔNG KẾT LUẬN ĐƯỢC'}`)
console.log(`               ${out.meaning}`)

console.log(`\nChiều NHẬN   : đang nghe mDNS ${seconds} giây…`)
const { sources, error } = await listenInbound(seconds * 1000)
const heard = [...sources]
if (heard.length) {
  console.log(`               NHẬN ĐƯỢC — có gói từ ${heard.join(', ')}`)
} else {
  console.log(`               KHÔNG nhận được gói nào từ máy khác${error ? ' (socket lỗi)' : ''}.`)
  console.log('               So sánh ngay: dns-sd -B _ipp._tcp local.  — nếu Apple thấy thiết bị mà')
  console.log('               Node không thấy, đó là quyền Local Network, không phải mạng.')
}

const ok = out.blocked === false && heard.length > 0
console.log(`\n=> ${ok ? 'CẢ HAI CHIỀU THÔNG — tin được kết quả đo mạng.' : 'CHƯA THÔNG — mọi kết quả "không thấy gì" đều VÔ GIÁ TRỊ.'}`)
if (!ok) {
  console.log('   Bật: System Settings → Privacy & Security → Local Network → bật cho ứng dụng đang chạy Node,')
  console.log('   rồi THOÁT HẲN ứng dụng đó (⌘Q) và mở lại. Quyền chỉ áp cho tiến trình sinh ra sau khi bật.')
}
process.exit(out.blocked === null ? 2 : ok ? 0 : 1)
