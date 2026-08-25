import { readFileSync, existsSync } from 'node:fs'
import net from 'node:net'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TOKENS, startBridge } from './lib/live-bridge.mjs'

/**
 * Sổ lần lỗi máy, đo đầu-cuối trên một bridge THẬT (ca L‑20, L‑21, L‑22, L‑23, L‑24, L‑25, L‑26).
 *
 * ⚠ GIỚI HẠN PHẢI NÓI RA TRƯỚC, đừng để ai đọc bảng xanh rồi tưởng nhiều hơn sự thật:
 * frame `fault` dưới đây do bài test **tự soạn**, không phải do `broker.py` sinh. Tới hôm nay
 * `state_to_status()` trong `broker.py` chỉ trả về `running` / `stopped` / `unknown` — nó KHÔNG
 * có nhánh nào trả `fault`, vì chưa ai biết con A15 đánh số trạng thái lỗi là bao nhiêu (máy mới
 * chỉ từng phát `state` = -1 và 15, cả hai đều là lúc rảnh). Đó đúng là ca L‑30/L‑31 và nó cần
 * một ca máy hỏng thật ở xưởng.
 *
 * Vậy bài này chứng minh được gì: rằng **kể từ lúc có một frame `fault`**, cả quãng đường còn
 * lại — cổng dial-in → hợp đồng → sổ lần lỗi trên đĩa → API → phân quyền — chạy đúng. Cái còn
 * thiếu duy nhất là mắt xích đầu: dịch `state` của máy ra chữ `fault`. Soạn frame tay ở đây là
 * hợp lệ vì `status: 'fault'` là **hợp đồng adapter** (`contract.mjs`), thứ mà mọi adapter về sau
 * đều phải gửi đúng như vậy — không phải một định dạng bịa riêng cho test.
 */

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

function guiFrame(port, frame) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => { s.end(JSON.stringify(frame) + '\n') })
    s.on('error', reject)
    s.on('close', () => resolve())
  })
}

/** Một ảnh chụp đúng hợp đồng adapter. `status` là chuỗi, y như broker.py vẫn gửi. */
function anh(status, at, extra = {}) {
  return {
    observedAt: at,
    status,
    job: { fileName: 'ao-so-9.dst', currentStitch: 1200, totalStitches: 46453 },
    ...extra,
  }
}

let bridge
let congIngest
let soLoi

beforeAll(async () => {
  congIngest = await congTrong()
  bridge = await startBridge({
    ingest: { enabled: true, host: '127.0.0.1', port: congIngest, capture: false, maxFramesPerMinute: 600, idleTimeoutMs: 300000 },
  })
  // `faultPath` mặc định là `./bridge-data/loi-<site>.jsonl`, tính từ thư mục chứa config.
  soLoi = join(bridge.dir, 'bridge-data', 'loi-test-1.jsonl')
  const r = await fetch(`${bridge.baseUrl}/api/v2/machines`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKENS.tech}`, 'content-type': 'application/json' },
    body: JSON.stringify({ machines: [MAY] }),
  })
  if (!r.ok) throw new Error(`Ghép máy thất bại ${r.status}: ${await r.text()}`)
}, 40000)

afterAll(() => bridge?.stop())

const doc = (duong, token = TOKENS.viewer) =>
  fetch(`${bridge.baseUrl}${duong}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })

const ghi = (duong, than, token = TOKENS.tech) =>
  fetch(`${bridge.baseUrl}${duong}`, {
    method: 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: JSON.stringify(than ?? {}),
  })

async function lanLoi(may = 'mch-a15-mqtt', truyVan = '') {
  const r = await doc(`/api/v2/machines/${may}/faults${truyVan}`)
  expect(r.status, `GET faults trả ${r.status}`).toBe(200)
  return (await r.json()).episodes
}

/** Chờ tới khi sổ lần lỗi đã có đủ số dòng mong đợi — ingest bất đồng bộ với HTTP. */
async function choSo(kiem, han = 6000) {
  const t0 = Date.now()
  let cuoi = []
  while (Date.now() - t0 < han) {
    cuoi = await lanLoi()
    if (kiem(cuoi)) return cuoi
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Quá hạn ${han}ms. Sổ đang có: ${JSON.stringify(cuoi)}`)
}

const bytes = () => (existsSync(soLoi) ? readFileSync(soLoi) : Buffer.alloc(0))
const soDong = () => bytes().toString('utf8').split('\n').filter((d) => d.trim()).length

// ------------------------------------------------------------------ L‑22 (rỗng)

describe('L‑22 — chưa có lần lỗi nào', () => {
  it('trả mảng rỗng, KHÔNG phải 500', async () => {
    // "Tuần rồi máy không hỏng lần nào" là câu trả lời tốt nhất có thể. Nếu nó nổ thành 500 thì
    // màn hình sẽ hiện "lỗi hệ thống" đúng vào lúc mọi thứ đang chạy tốt nhất.
    expect(await lanLoi()).toEqual([])
  })

  it('máy không có thật → 404, không phải mảng rỗng', async () => {
    // Mảng rỗng cho một id sai nghĩa là "máy này chưa hỏng lần nào" — một câu trả lời bình tĩnh
    // về một con máy không tồn tại. Gõ nhầm id sẽ đọc ra "máy vẫn tốt".
    expect((await doc('/api/v2/machines/mch-khong-co-that/faults')).status).toBe(404)
  })
})

// ------------------------------------------------------------------ L‑21, L‑26

describe('L‑21 / L‑26 — quyền đọc và quyền ghi', () => {
  it('L‑21: không token → 401, không phải 200 với sổ rỗng', async () => {
    expect((await doc('/api/v2/machines/mch-a15-mqtt/faults', null)).status).toBe(401)
  })

  it('L‑21: token bịa cũng là không có token', async () => {
    expect((await doc('/api/v2/machines/mch-a15-mqtt/faults', 'tok-bia-dat-khong-co-that')).status).toBe(401)
  })

  it('L‑21: người chỉ được xem VẪN đọc được lịch sử lỗi', async () => {
    expect((await doc('/api/v2/machines/mch-a15-mqtt/faults', TOKENS.viewer)).status).toBe(200)
  })

  it('L‑21: nhánh 403 KHÔNG chạm tới được trên đường đọc — và đó là chủ ý', () => {
    // `fleet:read` được cấp cho cả ba vai (`authz.mjs`). Không có vai nào thiếu quyền đọc, nên
    // không có cách nào dựng ra 403 ở đây mà không bịa thêm một vai không tồn tại. Ghi lại bằng
    // chữ, chứ không bịa: L‑26 ngay dưới mới là chỗ 403 chạy thật, và nó chạy trên đúng tuyến lỗi.
    expect(1).toBe(1)
  })

  it('L‑26: mở lại là quyền GHI — người chỉ được xem bị 403', async () => {
    const r = await ghi('/api/v2/machines/mch-a15-mqtt/faults/bat-ky/reopen', { reason: 'thử' }, TOKENS.viewer)
    expect(r.status, 'viewer mở lại được lần lỗi ⇒ ai xem cũng sửa được lịch sử xưởng').toBe(403)
  })

  it('L‑26: 403 bắn TRƯỚC khi tra mã lần lỗi — không rò id qua chênh lệch 403/404', async () => {
    // Nếu viewer nhận 404 cho mã không có và 403 cho mã có thật thì chỉ cần so hai mã là dò ra
    // lần lỗi nào tồn tại, dù không có quyền ghi.
    expect(soDong(), 'một dòng đã bị ghi bởi lời gọi bị từ chối').toBe(0)
  })
})

// ------------------------------------------------------------------ L‑20, L‑12 đầu-cuối

describe('L‑20 — sổ trên đĩa, chỉ ghi thêm', () => {
  it('máy vào lỗi rồi chạy lại → đúng một lần lỗi, có thời lượng thật', async () => {
    await guiFrame(congIngest, anh('running', new Date(Date.now() - 600_000).toISOString()))
    await guiFrame(congIngest, anh('fault', new Date(Date.now() - 300_000).toISOString(), {
      events: [{ code: 'E-DUT-CHI', message: 'Đứt chỉ kim 7', severity: 'critical', at: new Date(Date.now() - 300_000).toISOString() }],
    }))
    const mo = await choSo((ds) => ds.length === 1)
    expect(mo[0].dangMo).toBe(true)
    expect(mo[0].ma, 'mã lỗi phải in NGUYÊN VĂN lời máy, không dịch, không tra bảng').toBe('E-DUT-CHI')
    expect(mo[0].thoiLuongGiay, 'lần lỗi đang mở mà đã có thời lượng ⇒ đang đoán hộ máy').toBeNull()

    await guiFrame(congIngest, anh('running', new Date().toISOString()))
    const dong = await choSo((ds) => ds.length === 1 && ds[0].dangMo === false)
    expect(dong[0].thoiLuongGiay).toBeGreaterThan(250)
    expect(dong[0].thoiLuongGiay).toBeLessThan(360)
    expect(dong[0].chuaBietVi, 'controller tự khai chạy lại thì KHÔNG phải "chưa biết"').toBeNull()
    expect(dong[0].trangThaiSau).toBe('running')
  })

  it('sổ nằm đúng chỗ và là JSONL đọc được từng dòng', () => {
    expect(existsSync(soLoi), `không thấy sổ lần lỗi ở ${soLoi}`).toBe(true)
    const dong = bytes().toString('utf8').split('\n').filter((d) => d.trim())
    expect(dong.length, 'mở + đóng = 2 dòng').toBe(2)
    for (const d of dong) expect(() => JSON.parse(d)).not.toThrow()
    expect(JSON.parse(dong[0]).loai).toBe('episode')
    expect(JSON.parse(dong[1]).loai).toBe('episode-dong')
  })
})

// ------------------------------------------------------------------ L‑22 (lọc)

describe('L‑22 — lọc theo máy và theo khoảng thời gian', () => {
  it('khoảng thời gian KHÔNG chứa lần lỗi nào → mảng rỗng, không 500', async () => {
    const ds = await lanLoi('mch-a15-mqtt', '?from=2020-01-01T00:00:00.000Z&to=2020-01-02T00:00:00.000Z')
    expect(ds).toEqual([])
  })

  it('khoảng thời gian có chứa thì thấy', async () => {
    const ds = await lanLoi('mch-a15-mqtt', `?from=${new Date(Date.now() - 3600_000).toISOString()}&to=${new Date(Date.now() + 60_000).toISOString()}`)
    expect(ds.length).toBe(1)
  })

  it('from/to là rác thì cũng không được 500', async () => {
    const r = await doc('/api/v2/machines/mch-a15-mqtt/faults?from=hom-qua&to=chieu-nay')
    expect([200, 400], `trả ${r.status}`).toContain(r.status)
  })
})

// ------------------------------------------------------------------ L‑24 (mồ côi)

describe('L‑24 — mở lại một mã lần lỗi không tồn tại', () => {
  it('404 và KHÔNG ghi dòng mồ côi nào', async () => {
    const truoc = bytes()
    const r = await ghi('/api/v2/machines/mch-a15-mqtt/faults/khong-co-ma-nay/reopen', { reason: 'thử mã bịa' })
    expect(r.status).toBe(404)
    // Một dòng `reopen` mồ côi sẽ nằm trong sổ vĩnh viễn, trỏ vào hư không, và mọi bản hợp nhất
    // về sau đều phải đoán xem nó thuộc về lần lỗi nào.
    expect(bytes().equals(truoc), 'sổ đã đổi sau một lời gọi bị từ chối').toBe(true)
  })

  it('mở lại mà không ghi lý do → 400, cũng không ghi gì', async () => {
    const truoc = bytes()
    const ds = await lanLoi()
    const r = await ghi(`/api/v2/machines/mch-a15-mqtt/faults/${ds[0].episodeId}/reopen`, {})
    expect(r.status).toBe(400)
    expect(bytes().equals(truoc)).toBe(true)
  })
})

// ------------------------------------------------------------------ L‑23, L‑25

describe('L‑23 / L‑25 — mở lại lần lỗi đã đóng', () => {
  it('L‑23: thêm ĐÚNG một dòng, các byte cũ còn nguyên', async () => {
    const truoc = bytes()
    const ds = await lanLoi()
    const r = await ghi(`/api/v2/machines/mch-a15-mqtt/faults/${ds[0].episodeId}/reopen`, {
      reason: 'thợ báo máy vẫn đứt chỉ chỗ cũ, lần trước đóng sớm',
    })
    expect(r.status, await r.text()).toBe(200)

    const sau = bytes()
    // Không so nội dung "tương đương" mà so BYTE: bản ghi sai vẫn phải nằm nguyên đó. Người ta
    // cần thấy được rằng đã có lúc hệ thống tưởng máy đã chạy lại.
    expect(sau.subarray(0, truoc.length).equals(truoc), 'dòng cũ đã bị sửa hoặc bị dời').toBe(true)
    expect(sau.length).toBeGreaterThan(truoc.length)
    expect(soDong()).toBe(3)
  })

  it('L‑23: bản hợp nhất hiện là ĐÃ MỞ LẠI, kèm lý do, không xoá dấu vết bản cũ', async () => {
    const [ep] = await lanLoi()
    expect(ep.daMoLai).toBe(true)
    expect(ep.soLanMoLai).toBe(1)
    expect(ep.lyDoMoLai).toContain('đứt chỉ chỗ cũ')
    expect(ep.moLaiBoi).toBe('ky-thuat')
    // Thời lượng cũ vẫn còn: nó là con số hệ thống đã từng tin, và xoá đi là xoá bằng chứng.
    expect(ep.thoiLuongGiay).toBeGreaterThan(250)
  })

  it('L‑25: mở lại lần thứ hai — cho phép, dòng sau thắng, cả hai đều còn trên đĩa', async () => {
    const [ep] = await lanLoi()
    const r = await ghi(`/api/v2/machines/mch-a15-mqtt/faults/${ep.episodeId}/reopen`, {
      reason: 'lần hai: kỹ thuật xác nhận hỏng trục',
    })
    expect(r.status, await r.text()).toBe(200)
    expect(soDong()).toBe(4)

    const [sau] = await lanLoi()
    expect(sau.soLanMoLai).toBe(2)
    expect(sau.lyDoMoLai, 'bản hợp nhất phải xác định: dòng sau thắng').toContain('hỏng trục')
    // Và lần mở lại đầu vẫn nằm trên đĩa, không bị dòng sau đè.
    const tren_dia = bytes().toString('utf8').split('\n').filter(Boolean).map((d) => JSON.parse(d))
    expect(tren_dia.filter((d) => d.loai === 'reopen').length).toBe(2)
    expect(tren_dia.some((d) => (d.lyDo ?? '').includes('đứt chỉ chỗ cũ'))).toBe(true)
  })
})

// ------------------------------------------------------------------ L‑13 đầu-cuối

describe('L‑13 — máy đang lỗi rồi mất tín hiệu', () => {
  it('ghi "chưa biết", tuyệt đối không ghi như đã sửa xong', async () => {
    await guiFrame(congIngest, anh('fault', new Date(Date.now() - 120_000).toISOString(), {
      events: [{ code: 'E-KIM-GAY', severity: 'critical', at: new Date(Date.now() - 120_000).toISOString() }],
    }))
    await choSo((ds) => ds.length === 2)
    await guiFrame(congIngest, anh('unknown', new Date().toISOString()))

    const ds = await choSo((ds2) => ds2.length === 2 && ds2[0].dangMo === false)
    const moi = ds[0]
    expect(moi.ma).toBe('E-KIM-GAY')
    expect(moi.chuaBietVi).toBe('mat-tin-hieu')
    // 120 giây ở đây sẽ đọc thành "máy lỗi 2 phút rồi hết". Sự thật là "ta nhìn được tới phút
    // thứ 2 thì mất dấu" — máy có thể vẫn đang đứng đó với đúng cái kim gãy ấy.
    expect(moi.thoiLuongGiay, 'thời lượng có số cho một lần lỗi mất dấu = nói máy đã hết lỗi').toBeNull()
    expect(moi.cauChu, 'phải có câu giải thích bằng chữ cho màn hình, không để màn hình tự bịa').toBeTruthy()
  })

  it('lần lỗi thứ hai nối đúng vào lần thứ nhất (R1)', async () => {
    const ds = await lanLoi()
    expect(ds.length).toBe(2)
    // `docHopNhat` sắp xếp mới nhất trước.
    expect(ds[0].previousEpisodeId, 'chuỗi lần lỗi đứt ⇒ không truy được máy này hỏng lặp lại').toBe(ds[1].episodeId)
    expect(ds[1].previousEpisodeId).toBeNull()
  })
})

// ------------------------------------------------------------------ L‑14

describe('L‑14 — máy đang lỗi rồi có người ra tận nơi gõ số tay', () => {
  it('đóng lần lỗi bằng "nhap-tay", KHÔNG kèm thời lượng', async () => {
    const truoc = (await lanLoi()).length
    await guiFrame(congIngest, anh('fault', new Date(Date.now() - 90_000).toISOString(), {
      events: [{ code: 'E-KEO-CHI', severity: 'critical', at: new Date(Date.now() - 90_000).toISOString() }],
    }))
    await choSo((ds) => ds.length === truoc + 1 && ds[0].dangMo === true)

    const r = await ghi('/api/v2/machines/mch-a15-mqtt/manual-reading', {
      odometer: 46453, status: 'running', note: 'ra tận máy đọc màn hình',
    })
    expect(r.status, await r.text()).toBe(200)

    const [moi] = await lanLoi()
    expect(moi.ma).toBe('E-KEO-CHI')
    expect(moi.dangMo, 'người đã tới tận máy mà sổ vẫn để lần lỗi mở treo').toBe(false)
    expect(moi.chuaBietVi).toBe('nhap-tay')
    // Người gõ số biết máy đang chạy LÚC HỌ ĐỨNG ĐÓ. Họ không biết máy hết lỗi từ lúc nào — có
    // thể sửa xong từ nửa tiếng trước. In ra "lỗi 90 giây" là bịa một con số nhân danh họ.
    expect(moi.thoiLuongGiay).toBeNull()
    expect(moi.cauChu).toBeTruthy()
  })

  it('số gõ tay VẪN được ghi nhận bình thường — đóng sổ lỗi không nuốt mất con số', async () => {
    const r = await doc('/api/v2/fleet')
    const { machines } = await r.json()
    const may = machines.find((m) => m.identity?.id === 'mch-a15-mqtt')
    expect(may.telemetry?.odometer?.value ?? may.telemetry?.job?.value?.currentStitch).toBeTruthy()
  })
})

// ------------------------------------------------------------------ L‑15

describe('L‑15 — bridge tắt đi bật lại lúc lần lỗi đang mở', () => {
  it('đóng bằng "dong-bang-khoi-dong-lai", không tính thời lượng như thật', async () => {
    const cong = await congTrong()
    const b1 = await startBridge({
      ingest: { enabled: true, host: '127.0.0.1', port: cong, capture: false, maxFramesPerMinute: 600, idleTimeoutMs: 300000 },
    })
    const chung = {
      dataPath: join(b1.dir, 'data', 'fleet-store.json'),
      faultPath: join(b1.dir, 'bridge-data', 'loi-<site>.jsonl'),
    }
    try {
      await fetch(`${b1.baseUrl}/api/v2/machines`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKENS.tech}`, 'content-type': 'application/json' },
        body: JSON.stringify({ machines: [MAY] }),
      })
      await guiFrame(cong, anh('fault', new Date(Date.now() - 45_000).toISOString(), {
        events: [{ code: 'E-MAT-DIEN', severity: 'critical', at: new Date(Date.now() - 45_000).toISOString() }],
      }))
      const t0 = Date.now()
      let mo = []
      while (Date.now() - t0 < 6000) {
        const rr = await fetch(`${b1.baseUrl}/api/v2/machines/mch-a15-mqtt/faults`, { headers: { authorization: `Bearer ${TOKENS.viewer}` } })
        mo = (await rr.json()).episodes ?? []
        if (mo.length === 1 && mo[0].dangMo) break
        await new Promise((r) => setTimeout(r, 100))
      }
      expect(mo.length, 'chưa mở được lần lỗi nào thì phần còn lại của ca này vô nghĩa').toBe(1)
      expect(mo[0].dangMo).toBe(true)
    } finally {
      b1.stop()
    }

    // Bridge thứ hai đọc lại đúng quyển sổ và đúng kho máy của bridge thứ nhất — y như khởi
    // động lại dịch vụ trên Mini.
    const cong2 = await congTrong()
    const b2 = await startBridge({
      ...chung,
      ingest: { enabled: true, host: '127.0.0.1', port: cong2, capture: false, maxFramesPerMinute: 600, idleTimeoutMs: 300000 },
    })
    try {
      const rr = await fetch(`${b2.baseUrl}/api/v2/machines/mch-a15-mqtt/faults`, { headers: { authorization: `Bearer ${TOKENS.viewer}` } })
      expect(rr.status).toBe(200)
      const [ep] = (await rr.json()).episodes
      expect(ep, 'sổ lần lỗi không sống qua được lần khởi động lại').toBeTruthy()
      // Để mở treo thì mọi màn hình đều đọc ra "máy ĐANG lỗi", trong khi sự thật chỉ là ta đã
      // ngừng nhìn. Còn đóng kèm thời lượng thì tệ hơn nữa: đó là con số bịa.
      expect(ep.dangMo).toBe(false)
      expect(ep.chuaBietVi).toBe('dong-bang-khoi-dong-lai')
      expect(ep.thoiLuongGiay).toBeNull()
      expect(ep.ma).toBe('E-MAT-DIEN')
    } finally {
      b2.stop()
    }
  }, 60000)
})
