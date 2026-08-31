/**
 * Bài thử THẬT cho `xem/index.html` — chạy trên chính đoạn script trong file đang phục vụ, không
 * phải trên bản chép lại. Cách làm: cắt đoạn `<script>` ra, chèn một dòng xuất hàm ngay TRƯỚC
 * mấy dòng gắn sự kiện DOM ở cuối, rồi chạy trong node với DOM giả tối thiểu.
 *
 * Vì sao phải vòng vèo: cả script nằm trong một IIFE, không có `export` nào, nên không gọi thẳng
 * `tinhTrang` từ ngoài được. `node --check` chỉ chứng minh file ĐỌC ĐƯỢC, không chứng minh nhánh
 * mới chạy đúng — mà nhánh mới chính là thứ vừa sửa.
 */
import { readFileSync, existsSync } from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

// Tìm theo thứ tự: đối số dòng lệnh → bản trong repo (cạnh chính mình) → bản đang phục vụ.
// Bên nhận gói không có `~/dahao-gateway`; ghim cứng đường ấy là bài thử chết ngay câu đầu.
const gan = fileURLToPath(new URL('../deploy-mini/xem/index.html', import.meta.url))
const duong = process.argv[2] ?? (existsSync(gan) ? gan : process.env.HOME + '/dahao-gateway/xem/index.html')
const html = readFileSync(duong, 'utf8')
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1]

const MOC = "  el('cong-form').addEventListener"
if (js.split(MOC).length !== 2) { console.error('không tìm thấy mốc chèn'); process.exit(1) }
const XUAT = `
  globalThis.__T = {
    tinhTrang: tinhTrang, khaoSat: khaoSat, trongGioLam: trongGioLam,
    dangDoTuSo: dangDoTuSo, viecDangDo: viecDangDo, nhoViec: nhoViec,
    lauTinhTrang: lauTinhTrang, chuLau: chuLau, jobCua: jobCua, bayGio: bayGio,
    NHAN_TT: NHAN_TT, KY_HIEU_TT: KY_HIEU_TT, TT_IM: TT_IM,
    datMay: function (x) { may = x },
    datLech: function (x) { lechDongHo = x },
  }
`
const kich = js.replace(MOC, XUAT + MOC)

// ------------------------------------------------------------------ DOM giả tối thiểu
const kho = new Map()
function nut () {
  return new Proxy({}, {
    get (t, k) {
      if (k === 'addEventListener' || k === 'removeEventListener' || k === 'appendChild' ||
          k === 'remove' || k === 'setAttribute' || k === 'focus' || k === 'blur' ||
          k === 'insertBefore' || k === 'replaceChildren' || k === 'scrollIntoView') return () => {}
      if (k === 'classList') return { add () {}, remove () {}, toggle () {}, contains: () => false }
      if (k === 'style') return {}
      if (k === 'dataset') return {}
      if (k === 'children' || k === 'childNodes') return []
      if (k === 'value' || k === 'textContent' || k === 'innerHTML') return t[k] ?? ''
      if (k === 'hidden') return t[k] ?? false
      return t[k]
    },
    set (t, k, v) { t[k] = v; return true },
  })
}
const sandbox = {
  console,
  Date, Math, JSON, Number, String, Object, Array, Boolean, Error, RegExp, Map, Set, Promise,
  isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, isFinite,
  URLSearchParams, URL, TextDecoder, TextEncoder, Intl, atob, btoa,
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  requestAnimationFrame: () => 0,
  fetch: () => new Promise(() => {}),          // treo mãi: không cho batDau() đi tiếp
  WebSocket: function () { return nut() },
  EventSource: function () { return nut() },
  localStorage: {
    _d: kho,
    getItem: (k) => (kho.has(k) ? kho.get(k) : null),
    setItem: (k, v) => kho.set(k, String(v)),
    removeItem: (k) => kho.delete(k),
  },
  location: { href: 'https://test.phonh.io.vn/', protocol: 'https:', host: 'test.phonh.io.vn',
              search: '', hash: '', origin: 'https://test.phonh.io.vn' },
  navigator: { userAgent: 'node', language: 'vi' },
  document: {
    getElementById: nut, querySelector: nut, querySelectorAll: () => [],
    createElement: nut, addEventListener () {}, body: nut(), documentElement: nut(),
    hidden: false, title: '',
  },
  globalThis: undefined,
}
sandbox.window = sandbox
sandbox.self = sandbox
sandbox.globalThis = sandbox
vm.createContext(sandbox)
try {
  vm.runInContext(kich, sandbox, { filename: 'xem-inline.js' })
} catch (e) {
  // Nổ ở phần dựng màn hình thì kệ — chỗ chèn nằm TRƯỚC đó nên hàm vẫn lấy ra được. Chỉ chết
  // thật khi không lấy được hàm nào, và trường hợp ấy bắt ngay bên dưới.
  console.error('(phần dựng màn hình nổ, bỏ qua):', e && e.message)
}
const T = sandbox.__T
if (!T) { console.error('không lấy được hàm ra — chỗ chèn nằm sau chỗ nổ?'); process.exit(1) }

// ------------------------------------------------------------------ bài thử
let tong = 0, hong = 0
function ca (ten, that, mong) {
  tong++
  const a = JSON.stringify(that), b = JSON.stringify(mong)
  if (a !== b) { hong++; console.log(`  ✗ ${ten}\n      ra   ${a}\n      mong ${b}`) }
}
function may (o) {
  return {
    identity: { id: o.id ?? 'm1', name: o.ten ?? 'Máy 1' },
    connection: { state: o.kn ?? 'online', lastTelemetryAt: o.at ?? null },
    telemetry: o.mui === undefined ? { observedAt: o.at ?? null } : {
      observedAt: o.at ?? '2026-08-28T09:00:00Z',
      status: { value: o.tt ?? 'stopped' },
      job: { value: { currentStitch: o.mui, totalStitches: o.tong, fileName: o.mau ?? 'A.DST' } },
    },
    telemetryError: o.loi ?? null,
    derivedAlerts: o.canhbao ?? [],
    alerts: [],
  }
}
// đặt đồng hồ về đúng giờ VN mong muốn: bayGio() = Date.now() + lechDongHo
function datGioVN (h) {
  const nay = Date.now()
  const gioVN = new Date(nay + 7 * 3600 * 1000).getUTCHours()
  T.datLech((h - gioVN) * 3600 * 1000)
}

console.log('— nhãn và bảng tra —')
ca('off đã đổi tên', T.NHAN_TT.off, 'MẤT TÍN HIỆU')
ca('có đủ 4 nhãn mới', [T.NHAN_TT['tat-han'], T.NHAN_TT['ngoai-gio'], T.NHAN_TT['cum-im'], T.NHAN_TT['tat-may']],
   ['TẮT HẲN', 'NGOÀI GIỜ LÀM', 'CẢ XƯỞNG IM', 'THỢ TẮT MÁY'])
ca('TT_IM đủ 5 mã im', Object.keys(T.TT_IM).sort(), ['cum-im', 'ngoai-gio', 'off', 'tat-han', 'tat-may'])
ca('mã im không lẫn mã đang nói', [T.TT_IM.chay, T.TT_IM.dung, T.TT_IM.loi], [undefined, undefined, undefined])

console.log('— dangDoTuSo —')
ca('dở giữa chừng', T.dangDoTuSo(500, 1000), true)
ca('xong tấm', T.dangDoTuSo(1000, 1000), false)
ca('quá tấm', T.dangDoTuSo(1200, 1000), false)
ca('chưa động vào', T.dangDoTuSo(0, 1000), false)
ca('không có tổng', T.dangDoTuSo(500, 0), null)
ca('tổng không phải số', T.dangDoTuSo(500, null), null)
ca('mũi không phải số', T.dangDoTuSo(null, 1000), null)

console.log('— thang bằng chứng lúc máy im —')
datGioVN(12)
ca('trong giờ làm lúc 12h', T.trongGioLam(), true)
datGioVN(3)
ca('3h sáng là ngoài giờ', T.trongGioLam(), false)

// 1. ngoài giờ thắng tất cả
datGioVN(3)
T.datMay([may({ id: 'a', kn: 'unknown', mui: 500, tong: 1000 })])
ca('ngoài giờ → ngoai-gio', T.tinhTrang(may({ id: 'a', kn: 'unknown', mui: 500, tong: 1000 })), 'ngoai-gio')

// 2. cả đàn im
datGioVN(12)
T.datMay([may({ id: 'a', kn: 'unknown' }), may({ id: 'b', kn: 'unknown' }), may({ id: 'c', kn: 'offline' })])
ca('cả đàn im → cum-im', T.tinhTrang(may({ id: 'a', kn: 'unknown', mui: 500, tong: 1000 })), 'cum-im')
ca('một mình một máy thì KHÔNG kết luận cum-im',
   (T.datMay([may({ id: 'a', kn: 'unknown' })]), T.tinhTrang(may({ id: 'a', kn: 'unknown' }))), 'off')

// 3. bridge nói offline
T.datMay([may({ id: 'a', kn: 'unknown' }), may({ id: 'b', kn: 'online', mui: 5, tong: 10 })])
ca('bridge nói offline → tat-han', T.tinhTrang(may({ id: 'a', kn: 'offline', mui: 500, tong: 1000 })), 'tat-han')

// 4. một mình im giữa đàn đang nói
T.datMay([may({ id: 'a', kn: 'unknown' }), may({ id: 'b', kn: 'online', mui: 5, tong: 10 }),
          may({ id: 'c', kn: 'online', mui: 5, tong: 10 })])
ca('xong tấm rồi mới im → tat-may', T.tinhTrang(may({ id: 'a', kn: 'unknown', mui: 1000, tong: 1000 })), 'tat-may')
ca('im giữa mẫu dở → off (mất tín hiệu thật)', T.tinhTrang(may({ id: 'a', kn: 'unknown', mui: 500, tong: 1000 })), 'off')
ca('không đủ số thì vẫn off, KHÔNG đoán tat-may', T.tinhTrang(may({ id: 'a', kn: 'unknown' })), 'off')

console.log('— sổ nhớ localStorage —')
const mA = may({ id: 'nho1', kn: 'online', mui: 1000, tong: 1000, at: '2026-08-28T08:00:00Z' })
T.nhoViec.quet([mA])
ca('nhớ được lời máy khai', T.nhoViec.doc('nho1'), { mui: 1000, tong: 1000, at: '2026-08-28T08:00:00Z' })
T.nhoViec.quet([may({ id: 'nho2', kn: 'online' })])
ca('không nhớ khi thiếu số', T.nhoViec.doc('nho2'), null)
T.nhoViec.quet([may({ id: 'nho3', kn: 'online', mui: 0, tong: 0 })])
ca('không nhớ khi tổng = 0', T.nhoViec.doc('nho3'), null)
// máy im, KHÔNG còn số mũi trên đường truyền — đúng cảnh sau khi bridge khởi động lại
T.datMay([may({ id: 'nho1', kn: 'unknown' }), may({ id: 'b', kn: 'online', mui: 5, tong: 10 }),
          may({ id: 'c', kn: 'online', mui: 5, tong: 10 })])
ca('có sổ nhớ ⇒ đọc ra tat-may', T.tinhTrang(may({ id: 'nho1', kn: 'unknown' })), 'tat-may')
ca('không có sổ nhớ ⇒ vẫn off', T.tinhTrang(may({ id: 'lam', kn: 'unknown' })), 'off')
ca('lời máy khai lúc này THẮNG sổ nhớ',
   T.viecDangDo(may({ id: 'nho1', kn: 'online', mui: 500, tong: 1000 })), true)

console.log('— máy còn nói thì trạng thái thật thắng đồng hồ —')
datGioVN(3)
T.datMay([may({ id: 'a', kn: 'online', mui: 5, tong: 10 })])
ca('3h sáng mà máy đang chạy vẫn là chay',
   T.tinhTrang(may({ id: 'a', kn: 'online', tt: 'running', mui: 5, tong: 10 })), 'chay')
ca('3h sáng mà bridge báo lỗi đọc vẫn là loi',
   T.tinhTrang(may({ id: 'a', kn: 'online', tt: 'stopped', mui: 5, tong: 10, loi: { code: 'x' } })), 'loi')

console.log('— lauTinhTrang đi theo cả 5 mã im —')
datGioVN(3)
T.datMay([may({ id: 'a', kn: 'unknown' })])
const mIm = may({ id: 'a', kn: 'unknown', at: new Date(T.bayGio() - 600000).toISOString(), mui: 1, tong: 2 })
ca('máy này đúng là ngoai-gio', T.tinhTrang(mIm), 'ngoai-gio')
const l = T.lauTinhTrang(mIm)
ca('ngoai-gio vẫn đo được im bao lâu', l && Math.round(l.giay), 600)
ca('…và đó là số ĐO ĐƯỢC, không phải cận dưới', l && l.itNhat, false)
datGioVN(12)
const mTat = may({ id: 'a', kn: 'offline', at: new Date(T.bayGio() - 900000).toISOString(), mui: 1, tong: 2 })
T.datMay([mTat, may({ id: 'b', kn: 'online', mui: 5, tong: 10 })])
ca('máy này đúng là tat-han', T.tinhTrang(mTat), 'tat-han')
ca('tat-han cũng đo được im bao lâu', Math.round(T.lauTinhTrang(mTat).giay), 900)

console.log(`\n${tong - hong}/${tong} ca đạt`)
process.exit(hong ? 1 : 0)
