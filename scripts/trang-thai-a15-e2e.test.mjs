import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TOKENS, startBridge } from './lib/live-bridge.mjs'

/**
 * Tuyến trạng thái máy A15, đo đầu-cuối trên một bridge THẬT (ca S‑08, S‑09, S‑10).
 *
 * Vì sao phải có bài này dù ba mảnh đã có test riêng: `freshness.mjs` biết phân biệt tươi/ôi,
 * `authz.mjs` biết cấm ai, `contract.mjs` biết không bịa số — nhưng **không có gì chứng minh
 * ba thứ đó gặp nhau đúng chỗ** trên đường máy → broker → cổng dial-in → API. Cả ba đều xanh
 * riêng lẻ trong khi số hiện ra ngoài vẫn có thể sai. Bài này đi trọn đường đó một lần: dựng
 * bridge thật trên cổng trống, bật ingest thật, ghép đúng bản ghi máy A15 đang chạy ở xưởng,
 * bơm frame do CHÍNH `deploy-mini/broker.py` sinh ra, rồi đọc lại bằng HTTP có token.
 *
 * MỘT CHỮ DỄ ĐỌC NHẦM, ghi ở đây để đội tích hợp khỏi mất buổi chiều: trong `contract.mjs`,
 * `quality: 'verified'` nghĩa là **máy tự khai** (đối lập `'manual'` = người gõ tay). Nó KHÔNG
 * nói gì về việc số còn tươi hay đã ôi. Câu trả lời về độ tươi nằm ở khối `connection`, và
 * chỉ ở đó. Đừng viết test dựa vào `quality` để bắt số ôi — bài này từng suýt sai như vậy.
 */

const repo = fileURLToPath(new URL('..', import.meta.url))
const broker = join(repo, 'deploy-mini', 'broker.py')

function coPython() {
  if (!existsSync(broker)) return false
  try {
    execFileSync('python3', ['-c', 'import Crypto'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const du = coPython()

/**
 * Sinh frame bằng chính broker.py. KHÔNG viết tay JSON ở đây: frame viết tay chỉ chứng minh
 * bridge nhận được thứ mình vừa nghĩ ra, chứ không chứng minh nó nhận được thứ máy thật gửi.
 */
function frameTuBroker(bodyPython) {
  const ma = [
    'import importlib.util, sys, json',
    'sys.argv = ["broker"]',
    `spec = importlib.util.spec_from_file_location("broker", ${JSON.stringify(broker)})`,
    'b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)',
    'b._prev.clear()',
    `print(json.dumps(b.build_frame("mch-a15-mqtt", ${bodyPython})))`,
  ].join('\n')
  return JSON.parse(execFileSync('python3', ['-c', ma], { encoding: 'utf8' }))
}

function congTrong() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

/** Gửi một dòng JSON vào cổng dial-in, đúng như broker.py vẫn làm. */
function guiFrame(port, frame) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => { s.end(JSON.stringify(frame) + '\n') })
    s.on('error', reject)
    s.on('close', () => resolve())
  })
}

const MAY = {
  id: 'mch-a15-mqtt',
  assetTag: 'A15-MQTT',
  name: 'Máy thêu A15 (qua gateway MQTT)',
  siteId: 'test-1',
  zone: 'Chuyền A',
  model: 'BECS-A15-B104H-B',
  serial: '602602704E7B',
  ipAddress: '127.0.0.1',
  adapter: 'dial-in',
  adapterConfig: {},
}

let bridge
let congIngest

beforeAll(async () => {
  congIngest = await congTrong()
  // freshSeconds 30 / staleSeconds 90 — đúng ngưỡng xưởng A15 đang chạy thật hôm nay.
  bridge = await startBridge({
    ingest: { enabled: true, host: '127.0.0.1', port: congIngest, capture: false, maxFramesPerMinute: 600, idleTimeoutMs: 300000 },
  })
  const r = await fetch(`${bridge.baseUrl}/api/v2/machines`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKENS.tech}`, 'content-type': 'application/json' },
    body: JSON.stringify({ machines: [MAY] }),
  })
  if (!r.ok) throw new Error(`Ghép máy thất bại ${r.status}: ${await r.text()}`)
}, 40000)

afterAll(() => bridge?.stop())

const goi = (duong, token = TOKENS.viewer) =>
  fetch(`${bridge.baseUrl}${duong}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })

async function layMay() {
  const r = await goi('/api/v2/fleet')
  expect(r.status).toBe(200)
  const { machines } = await r.json()
  const may = machines.find((m) => m.identity?.id === 'mch-a15-mqtt')
  expect(may, 'không thấy máy A15 trong /api/v2/fleet').toBeTruthy()
  return may
}

/** Chờ tới khi bridge đã nuốt xong frame — ingest là bất đồng bộ với HTTP. */
async function choNgam(kiem, han = 6000) {
  const t0 = Date.now()
  let cuoi = null
  while (Date.now() - t0 < han) {
    cuoi = await layMay()
    if (kiem(cuoi)) return cuoi
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Quá hạn ${han}ms. Trạng thái cuối: ${JSON.stringify(cuoi?.connection)}`)
}

const soMui = (may) => may.telemetry?.job?.value?.currentStitch ?? null

// ------------------------------------------------------------------ S‑09

describe('S‑09 — API trạng thái đòi quyền fleet:read', () => {
  it.skipIf(!du)('không token thì 401, KHÔNG phải 200 với danh sách rỗng', async () => {
    // 200 kèm danh sách rỗng là kiểu hỏng tệ nhất: màn hình trông y hệt "xưởng không có máy nào".
    expect((await goi('/api/v2/fleet', null)).status).toBe(401)
  })

  it.skipIf(!du)('token bịa cũng là không có token', async () => {
    expect((await goi('/api/v2/fleet', 'tok-bia-dat-khong-co-that')).status).toBe(401)
  })

  it.skipIf(!du)('đường đọc theo từng máy cũng phải đòi quyền, không chỉ danh sách đội', async () => {
    expect((await goi('/api/v2/machines/mch-a15-mqtt/audit', null)).status).toBe(401)
  })

  it.skipIf(!du)('máy KHÔNG tồn tại + không token cũng phải 401, không được 404', async () => {
    // 404 ở đây là rò rỉ: người chưa đăng nhập chỉ cần so 401/404 là dò ra id máy nào có thật.
    // Chặn quyền phải chạy TRƯỚC khi tra bản ghi, nếu không thì cái khoá chỉ khoá nửa cánh cửa.
    const r = await goi('/api/v2/machines/mch-hoan-toan-bia-dat/audit', null)
    expect(r.status, 'trả 404 cho máy không có thật ⇒ dò được id máy khi chưa có token').toBe(401)
  })

  it.skipIf(!du)('viewer đọc được trạng thái', async () => {
    expect((await goi('/api/v2/fleet')).status).toBe(200)
  })

  it.skipIf(!du)('403 CÓ chạy thật — chỉ là không nằm trên đường trạng thái', async () => {
    // Nếu bỏ ca này thì mọi thứ ở trên vẫn xanh kể cả khi tầng phân quyền chỉ biết mỗi 401.
    // `/ingest` đòi `scan:run`, mà viewer không có ⇒ đây là nhánh 403 thật, chạm được.
    expect((await goi('/api/v2/ingest')).status).toBe(403)
    expect((await goi('/api/v2/ingest', TOKENS.tech)).status).toBe(200)
  })

  it.skipIf(!du)('MỌI vai đều có fleet:read, nên 403 trên đường trạng thái là không thể', async () => {
    // Đây là lý do ca S‑09 KHÔNG thể có nhánh "thiếu quyền -> 403" trên API trạng thái: bảng
    // quyền cấp `fleet:read` cho cả ba vai. Ghi lại bằng test chứ không bằng lời hứa — nếu mai
    // có ai thêm một vai KHÔNG có `fleet:read`, dòng dưới đỏ lên và ca S‑09 phải viết lại,
    // thay vì im lặng để một vai mới bị chặn mà không ai kiểm.
    const { permissions, roles } = await import('../bridge/lib/authz.mjs')
    for (const vai of roles) {
      expect(permissions['fleet:read'], `vai ${vai} không có fleet:read — S‑09 cần thêm nhánh 403`).toContain(vai)
    }
  })
})

// ------------------------------------------------------------------ S‑10

describe('S‑10 — controller không nói thì để trống, không bịa số 0', () => {
  it.skipIf(!du)('chưa có frame nào: chưa có telemetry, và KHÔNG phải online', async () => {
    const may = await layMay()
    expect(may.telemetry, 'máy chưa từng gửi gì mà đã có telemetry').toBeNull()
    expect(may.connection.state).not.toBe('online')
    expect(may.connection.reason).toBeTruthy()
  })

  it.skipIf(!du)('frame thiếu curStitch: số mũi là null, tuyệt đối không phải 0', async () => {
    // `0 mũi` đọc như "máy đứng yên chưa thêu gì"; `null` đọc như "chưa biết". Hai câu khác hẳn
    // nhau, và chỉ một câu là thật. Máy thật im tiếng về một trường là chuyện thường ngày.
    const frame = frameTuBroker('{"patternName": "AO-01", "patternStitch": 9538}')
    expect(frame.job.currentStitch, 'broker.py đã bịa số ngay từ đầu nguồn').toBeNull()
    await guiFrame(congIngest, frame)
    const may = await choNgam((m) => m.telemetry !== null)
    expect(soMui(may), `bịa số mũi ${soMui(may)} từ frame không hề có curStitch`).toBeNull()
    // Trường máy CÓ nói thì vẫn phải giữ, không được vứt cả cụm vì thiếu một mảnh.
    expect(may.telemetry.job.value.totalStitches).toBe(9538)
    expect(may.telemetry.job.value.fileName).toBe('AO-01')
  })
})

// ------------------------------------------------------------------ S‑08

describe('S‑08 — số cũ hơn ngưỡng tươi không được hiện như số sống', () => {
  it.skipIf(!du)('frame vừa tới (0s): online, và nói rõ mới bao nhiêu giây', async () => {
    const frame = frameTuBroker('{"patternName": "AO-01", "curStitch": 120, "patternStitch": 9538}')
    await guiFrame(congIngest, { ...frame, observedAt: new Date().toISOString() })
    const may = await choNgam((m) => m.connection.state === 'online')
    expect(may.connection.ageSeconds).toBeLessThanOrEqual(30)
    expect(may.connection.reason).toMatch(/Telemetry mới/)
    expect(soMui(may)).toBe(120)
  })

  it.skipIf(!du)('mốc 60 giây trước (giữa 30 và 90): thành "ôi", không còn là sống', async () => {
    // Đây mới là nhánh phân biệt thật. Nhảy thẳng từ 0s sang 5 phút thì `stale` không bao giờ
    // được chạy qua, và ca S‑08 sẽ xanh mà chưa hề kiểm cái nó nói là kiểm.
    const frame = frameTuBroker('{"patternName": "AO-01", "curStitch": 3000, "patternStitch": 9538}')
    const moc = new Date(Date.now() - 60_000).toISOString()
    await guiFrame(congIngest, { ...frame, observedAt: moc })
    const may = await choNgam((m) => m.connection.ageSeconds !== null && m.connection.ageSeconds >= 55)
    expect(may.connection.state).toBe('stale')
    expect(may.connection.ageSeconds).toBeGreaterThan(30)
    expect(may.connection.ageSeconds).toBeLessThanOrEqual(90)
    expect(may.connection.reason).toMatch(/quá ngưỡng 30s/)
  })

  it.skipIf(!du)('mốc 5 phút trước (quá cả 90): dứt khoát không còn online', async () => {
    const frame = frameTuBroker('{"patternName": "AO-01", "curStitch": 7000, "patternStitch": 9538}')
    const moc = new Date(Date.now() - 300_000).toISOString()
    await guiFrame(congIngest, { ...frame, observedAt: moc })
    const may = await choNgam((m) => m.connection.ageSeconds !== null && m.connection.ageSeconds > 90)
    expect(may.connection.state).not.toBe('online')
    expect(may.connection.state).not.toBe('stale')
    expect(['offline', 'unknown']).toContain(may.connection.state)
    // Tuổi phải hiện ra được: người ở xưởng cần biết số này cũ cỡ nào, chứ không chỉ thấy màu.
    expect(may.connection.ageSeconds).toBeGreaterThan(90)
    expect(may.connection.reason, 'phải giải thích bằng chữ, màu không được là kênh duy nhất').toBeTruthy()
  })

  it.skipIf(!du)('số cũ VẪN đọc được — cái phải đổi là nhãn, không phải xoá số đi', async () => {
    // Xoá số cũng sai: người ở xưởng cần biết lần cuối máy nói gì trước khi mất liên lạc.
    const may = await layMay()
    expect(soMui(may)).toBe(7000)
    expect(may.telemetry.observedAt).toBeTruthy()
    expect(may.connection.state).not.toBe('online')
  })
})
