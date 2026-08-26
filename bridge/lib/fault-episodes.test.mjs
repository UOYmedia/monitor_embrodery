import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CHUA_BIET_VI, DONG_BINH_THUONG, DONG_CHUA_BIET, FaultEpisodeLog, thoiLuongGiay } from './fault-episodes.mjs'

/**
 * Ca L‑11 … L‑19 và L‑23 … L‑25 của `PRD_TUYEN_A15_BAN_GIAO.md`.
 *
 * ⚠ Giới hạn phải nói ra trước: mọi ca dưới đây bơm `status: 'fault'` vào thẳng tầng bridge.
 * Chúng chứng minh **logic sổ lần lỗi** đúng — chúng KHÔNG chứng minh hệ thống nhận ra được
 * lỗi thật của con A15, vì tới giờ `broker.py` chưa bao giờ suy ra được `'fault'` (việc E3
 * còn chờ E1: một ca máy lỗi thật). Đó là ca L‑30, và nó là cổng của cả nhóm L.
 */

let dir

// Mọi sổ đã mở trong ca hiện tại, để `afterEach` còn đợi hàng đợi ghi cạn trước khi xoá.
const soDaMo = []

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'loi-')) })

afterEach(async () => {
  // `moLanLoi`/`dongLanLoi` KHÔNG phải hàm async: chúng đẩy dòng vào `this.queue` rồi trả về
  // ngay (xem `ghi()` trong fault-episodes.mjs) — cố ý, để đường telemetry nóng không phải
  // đợi đĩa. Nhưng nếu ca test xoá thư mục tạm mà không đợi hàng đợi, lần ghi còn treo sẽ
  // `mkdir` lại ĐÚNG thư mục vừa xoá rồi `appendFile` vào giữa lúc `rm` đang duyệt: `rm`
  // đọc thư mục thấy trống, tới lúc `rmdir` thì đã có file mới ⇒ ENOTEMPTY.
  //
  // Đây là ca đỏ THẬT — bắt được 2/15 lần chạy ngày 26/08, mỗi lần rơi vào một `it` khác
  // nhau (vì nó là chuyện của `afterEach`, không của ca nào cả). Một ca đỏ chập chờn kiểu
  // này nguy hơn một ca đỏ hẳn: đội nhận mã sẽ chạy lại cho tới lúc xanh rồi thôi, và từ
  // đó không ai còn tin bộ test nữa.
  await Promise.all(soDaMo.splice(0).map((so) => so.flush().catch(() => {})))
  await rm(dir, { recursive: true, force: true })
})

function moSo(options = {}) {
  const dongHo = { at: Date.parse('2026-08-25T08:00:00.000Z') }
  const so = new FaultEpisodeLog(join(dir, 'loi-test-1.jsonl'), { now: () => dongHo.at, ...options })
  soDaMo.push(so)
  return { so, dongHo }
}

const doc = async (so) => {
  await so.flush()
  const raw = await readFile(so.filePath, 'utf8').catch(() => '')
  return raw.split('\n').filter(Boolean).map((d) => JSON.parse(d))
}

const suKien = (code, message) => [{ code, message, severity: 'critical' }]

// ------------------------------------------------------------------ L‑11

describe('L‑11 — mở lần lỗi', () => {
  it('mốc là observedAt của CONTROLLER, không phải đồng hồ bridge', async () => {
    const { so, dongHo } = moSo()
    dongHo.at = Date.parse('2026-08-25T09:30:00.000Z')   // đồng hồ bridge lệch hẳn
    const ban = so.moLanLoi('m-1', { siteId: 'test-1', batDau: '2026-08-25T08:00:00.000Z', events: suKien('E12', 'Đứt chỉ kim 3') })
    expect(ban.batDau).toBe('2026-08-25T08:00:00.000Z')
    expect(ban.ghiLuc).toBe('2026-08-25T09:30:00.000Z')  // giờ bridge có ghi, nhưng ở ô riêng
    expect(ban.dangMo).toBe(true)
    expect(ban.thoiLuongGiay).toBeNull()
  })

  it('giữ mã lỗi và mô tả NGUYÊN VĂN máy gửi, không dịch', async () => {
    const { so } = moSo()
    const ban = so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:00.000Z', events: suKien('E12', 'Đứt chỉ kim 3') })
    expect(ban.ma).toBe('E12')
    expect(ban.moTa).toBe('Đứt chỉ kim 3')
  })

  it('ghi xuống đĩa NGAY lúc mở, không đợi tới lúc đóng', async () => {
    // Nếu chỉ ghi lúc đóng thì một lần mất điện giữa chừng xoá sạch dấu vết máy đã từng lỗi —
    // đúng vào lúc người ta cần bằng chứng nhất.
    const { so } = moSo()
    so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:00.000Z' })
    const dong = await doc(so)
    expect(dong).toHaveLength(1)
    expect(dong[0].dangMo).toBe(true)
  })

  it('máy đã lỗi từ trước khi bridge nhìn thấy → đánh dấu ước chừng', async () => {
    const { so } = moSo()
    const ban = so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:00.000Z', uocChung: true })
    expect(ban.batDauUocChung).toBe(true)
  })
})

// ------------------------------------------------------------------ L‑12

describe('L‑12 — đóng lần lỗi khi controller báo trạng thái khác', () => {
  it('endedAt = observedAt, thời lượng khớp', async () => {
    const { so } = moSo()
    so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:00.000Z' })
    const dong = so.dongLanLoi('m-1', { ketThuc: '2026-08-25T08:42:30.000Z', trangThaiSau: 'running' })
    expect(dong.ketThuc).toBe('2026-08-25T08:42:30.000Z')
    expect(dong.thoiLuongGiay).toBe(2550)          // 42 phút 30 giây
    expect(dong.lyDoDong).toBe(DONG_BINH_THUONG)
    expect(dong.chuaBietVi).toBeNull()
    expect(dong.dangMo).toBe(false)
  })

  it('bản hợp nhất hiện đúng một dòng cho một lần lỗi, dù đĩa có hai', async () => {
    const { so } = moSo()
    so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:00.000Z' })
    so.dongLanLoi('m-1', { ketThuc: '2026-08-25T08:10:00.000Z', trangThaiSau: 'running' })
    expect(await doc(so)).toHaveLength(2)          // đĩa: chỉ-ghi-thêm
    const { episodes } = await so.docHopNhat()
    expect(episodes).toHaveLength(1)               // màn hình: một sự việc
    expect(episodes[0].thoiLuongGiay).toBe(600)
  })
})

// ------------------------------------------------------------------ L‑13, L‑14, L‑15

describe('ba trường hợp CẤM gọi là "đã sửa" (PRD 4.2)', () => {
  it('L‑13 máy trôi sang unknown → chưa biết, KHÔNG có thời lượng', async () => {
    const { so } = moSo()
    so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:00.000Z' })
    const dong = so.dongLanLoi('m-1', {
      ketThuc: '2026-08-25T08:10:00.000Z', trangThaiSau: 'unknown', chuaBietVi: CHUA_BIET_VI.MAT_TIN_HIEU,
    })
    expect(dong.lyDoDong).toBe(DONG_CHUA_BIET)
    expect(dong.chuaBietVi).toBe('mat-tin-hieu')
    // Đây là điểm quan trọng nhất của cả nhóm: 600 giây ở đây sẽ được đọc là "máy lỗi 10 phút
    // rồi hết", trong khi sự thật chỉ là "ta nhìn được tới phút thứ 10 thì mất dấu".
    expect(dong.thoiLuongGiay).toBeNull()
    const { episodes } = await so.docHopNhat()
    expect(episodes[0].cauChu).toMatch(/im lặng không phải là hết lỗi/)
  })

  it('L‑14 có người gõ tay → chưa biết, ghi rõ vì sao', async () => {
    const { so } = moSo()
    so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:00.000Z' })
    const dong = so.dongLanLoi('m-1', {
      ketThuc: '2026-08-25T08:05:00.000Z', trangThaiSau: 'unknown', chuaBietVi: CHUA_BIET_VI.NHAP_TAY,
    })
    expect(dong.chuaBietVi).toBe('nhap-tay')
    expect(dong.thoiLuongGiay).toBeNull()
    const { episodes } = await so.docHopNhat()
    expect(episodes[0].cauChu).toMatch(/có người gõ tay/)
  })

  it('L‑15 bridge khởi động lại giữa chừng → đóng bằng khởi-động-lại, không tính thời lượng', async () => {
    const { so } = moSo()
    so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:00.000Z' })
    await so.flush()

    // Bridge chết và lên lại: sổ mới, cùng file, RAM trắng.
    const { so: so2 } = moSo()
    const daDong = await so2.donDep({ moc: '2026-08-25T09:00:00.000Z' })
    expect(daDong).toHaveLength(1)
    expect(daDong[0].chuaBietVi).toBe('dong-bang-khoi-dong-lai')
    expect(daDong[0].thoiLuongGiay).toBeNull()

    const { episodes } = await so2.docHopNhat()
    expect(episodes).toHaveLength(1)
    expect(episodes[0].dangMo).toBe(false)
    expect(episodes[0].cauChu).toMatch(/khởi động lại/)
  })

  it('L‑15 khởi động lại KHÔNG làm đứt chuỗi previousEpisodeId', async () => {
    const { so } = moSo()
    so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:00.000Z' })
    const dau = so.dongLanLoi('m-1', { ketThuc: '2026-08-25T08:05:00.000Z', trangThaiSau: 'running' })
    await so.flush()

    const { so: so2 } = moSo()
    await so2.donDep({ moc: '2026-08-25T09:00:00.000Z' })
    const sau = so2.moLanLoi('m-1', { batDau: '2026-08-25T09:10:00.000Z' })
    expect(sau.previousEpisodeId).toBe(dau.episodeId)
  })
})

// ------------------------------------------------------------------ L‑16

describe('L‑16 — nhịp fault dồn dập', () => {
  it('fault mỗi giây suốt 10 phút = ĐÚNG MỘT lần lỗi, không phải 600', async () => {
    const { so } = moSo()
    const goc = Date.parse('2026-08-25T08:00:00.000Z')
    for (let i = 0; i < 600; i += 1) {
      so.moLanLoi('m-1', { batDau: new Date(goc + i * 1000).toISOString() })
    }
    const { episodes } = await so.docHopNhat()
    expect(episodes).toHaveLength(1)
    expect(episodes[0].batDau).toBe('2026-08-25T08:00:00.000Z')   // giữ mốc ĐẦU, không trôi theo
    expect(await doc(so)).toHaveLength(1)                          // và không ghi 600 dòng rác
  })
})

// ------------------------------------------------------------------ L‑17, L‑18 (R1)

describe('R1 — hết lỗi rồi lỗi lại (L‑17, L‑18)', () => {
  it('L‑17 fault → running → fault trong 30 giây = HAI lần lỗi riêng', async () => {
    // Cố ý không gộp: gộp cần một hằng số thời gian mà không dữ liệu nào ở xưởng đỡ nổi, và
    // gộp sai thì che mất một lần dừng máy có thật.
    const { so } = moSo()
    const mot = so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:00.000Z' })
    so.dongLanLoi('m-1', { ketThuc: '2026-08-25T08:00:10.000Z', trangThaiSau: 'running' })
    const hai = so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:30.000Z' })

    expect(hai.episodeId).not.toBe(mot.episodeId)
    expect(hai.previousEpisodeId).toBe(mot.episodeId)
    const { episodes } = await so.docHopNhat()
    expect(episodes).toHaveLength(2)
  })

  it('L‑18 lặp 20 lần → 20 lần lỗi, chuỗi previousEpisodeId nối đúng thứ tự', async () => {
    const { so } = moSo()
    const goc = Date.parse('2026-08-25T08:00:00.000Z')
    const ids = []
    for (let i = 0; i < 20; i += 1) {
      const b = so.moLanLoi('m-1', { batDau: new Date(goc + i * 60_000).toISOString() })
      ids.push(b.episodeId)
      so.dongLanLoi('m-1', { ketThuc: new Date(goc + i * 60_000 + 30_000).toISOString(), trangThaiSau: 'running' })
    }
    const { episodes } = await so.docHopNhat()
    expect(episodes).toHaveLength(20)

    const theoId = new Map(episodes.map((e) => [e.episodeId, e]))
    for (let i = 1; i < 20; i += 1) {
      expect(theoId.get(ids[i]).previousEpisodeId).toBe(ids[i - 1])
    }
    expect(theoId.get(ids[0]).previousEpisodeId).toBeNull()
  })

  it('hai máy khác nhau có chuỗi riêng, không nối lẫn vào nhau', async () => {
    const { so } = moSo()
    const a1 = so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:00.000Z' })
    so.moLanLoi('m-2', { batDau: '2026-08-25T08:00:05.000Z' })
    so.dongLanLoi('m-1', { ketThuc: '2026-08-25T08:01:00.000Z', trangThaiSau: 'running' })
    so.dongLanLoi('m-2', { ketThuc: '2026-08-25T08:01:00.000Z', trangThaiSau: 'running' })
    const a2 = so.moLanLoi('m-1', { batDau: '2026-08-25T08:02:00.000Z' })
    const b2 = so.moLanLoi('m-2', { batDau: '2026-08-25T08:02:00.000Z' })

    expect(a2.previousEpisodeId).toBe(a1.episodeId)
    expect(b2.previousEpisodeId).not.toBe(a1.episodeId)
  })
})

// ------------------------------------------------------------------ L‑19

describe('L‑19 — đồng hồ controller nhảy về quá khứ', () => {
  it('không sinh thời lượng ÂM, và đánh dấu mốc đáng ngờ', async () => {
    const { so } = moSo()
    so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:00.000Z' })
    const dong = so.dongLanLoi('m-1', { ketThuc: '2026-08-25T07:50:00.000Z', trangThaiSau: 'running' })
    expect(dong.thoiLuongGiay).toBeNull()      // KHÔNG phải -600, cũng KHÔNG phải 0
    expect(dong.mocDangNgo).toBe(true)
  })

  it('mốc ISO rác → null, không NaN lặng lẽ', () => {
    expect(thoiLuongGiay('hom-qua', '2026-08-25T08:00:00.000Z')).toBeNull()
    expect(thoiLuongGiay('2026-08-25T08:00:00.000Z', 'khong-phai-gio')).toBeNull()
    expect(thoiLuongGiay('2026-08-25T08:00:00.000Z', '2026-08-25T08:00:00.000Z')).toBe(0)
  })

  it('lệch múi giờ vẫn tính đúng (cùng một khoảnh khắc, hai cách viết)', () => {
    expect(thoiLuongGiay('2026-08-25T08:00:00.000Z', '2026-08-25T15:10:00.000+07:00')).toBe(600)
  })
})

// ------------------------------------------------------------------ L‑23, L‑24, L‑25 (R3)

describe('R3 — mở lại một lần lỗi đã đóng nhầm (L‑23…L‑25)', () => {
  it('L‑23 ghi thêm ĐÚNG một dòng, dòng cũ còn nguyên từng byte', async () => {
    const { so } = moSo()
    so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:00.000Z' })
    so.dongLanLoi('m-1', { ketThuc: '2026-08-25T08:10:00.000Z', trangThaiSau: 'running' })
    await so.flush()
    const truoc = await readFile(so.filePath, 'utf8')
    const { episodes } = await so.docHopNhat()

    await so.moLai(episodes[0].episodeId, { actor: 'tổ trưởng', role: 'technician', lyDo: 'Máy vẫn lỗi, thợ đóng nhầm' })
    const sau = await readFile(so.filePath, 'utf8')

    expect(sau.startsWith(truoc)).toBe(true)                     // không sửa byte nào phía trước
    expect(sau.split('\n').filter(Boolean)).toHaveLength(3)      // thêm đúng 1 dòng
  })

  it('L‑23 bản hợp nhất hiện "đã mở lại" kèm lý do, không xoá dấu vết bản cũ', async () => {
    const { so } = moSo()
    so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:00.000Z' })
    so.dongLanLoi('m-1', { ketThuc: '2026-08-25T08:10:00.000Z', trangThaiSau: 'running' })
    await so.flush()
    const truoc = (await so.docHopNhat()).episodes[0]
    await so.moLai(truoc.episodeId, { actor: 'tổ trưởng', role: 'technician', lyDo: 'Đóng nhầm' })

    const sau = (await so.docHopNhat()).episodes[0]
    expect(sau.daMoLai).toBe(true)
    expect(sau.lyDoMoLai).toBe('Đóng nhầm')
    expect(sau.moLaiBoi).toBe('tổ trưởng')
    expect(sau.ketThuc).toBe(truoc.ketThuc)          // sự thật cũ vẫn còn đó
    expect(sau.thoiLuongGiay).toBe(truoc.thoiLuongGiay)
  })

  it('L‑24 mở lại một episodeId KHÔNG tồn tại → từ chối, không ghi dòng mồ côi', async () => {
    const { so } = moSo()
    so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:00.000Z' })
    so.dongLanLoi('m-1', { ketThuc: '2026-08-25T08:10:00.000Z', trangThaiSau: 'running' })
    await so.flush()
    const truoc = await readFile(so.filePath, 'utf8')

    await expect(so.moLai('khong-co-that', { actor: 'a', role: 'technician', lyDo: 'x' }))
      .rejects.toThrow(/Không có lần lỗi nào/)
    expect(await readFile(so.filePath, 'utf8')).toBe(truoc)      // đĩa không đổi một byte
  })

  it('L‑25 mở lại HAI lần cùng episodeId → cho phép, dòng sau thắng, bản hợp nhất vẫn xác định', async () => {
    const { so, dongHo } = moSo()
    so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:00.000Z' })
    so.dongLanLoi('m-1', { ketThuc: '2026-08-25T08:10:00.000Z', trangThaiSau: 'running' })
    await so.flush()
    const id = (await so.docHopNhat()).episodes[0].episodeId

    dongHo.at = Date.parse('2026-08-25T09:00:00.000Z')
    await so.moLai(id, { actor: 'thợ A', role: 'technician', lyDo: 'Lý do thứ nhất' })
    dongHo.at = Date.parse('2026-08-25T10:00:00.000Z')
    await so.moLai(id, { actor: 'thợ B', role: 'technician', lyDo: 'Lý do thứ hai' })

    const ban = (await so.docHopNhat()).episodes[0]
    expect(ban.soLanMoLai).toBe(2)
    expect(ban.lyDoMoLai).toBe('Lý do thứ hai')     // dòng sau thắng
    expect(ban.moLaiBoi).toBe('thợ B')
    expect(ban.moLaiLuc).toBe('2026-08-25T10:00:00.000Z')
    expect((await doc(so)).filter((d) => d.loai === 'reopen')).toHaveLength(2)   // cả hai vẫn nằm trên đĩa
  })
})

// ------------------------------------------------------------------ bền vững sổ

describe('sổ bền vững', () => {
  it('lọc theo máy và theo khoảng thời gian; khoảng rỗng → mảng rỗng, không ném', async () => {
    const { so } = moSo()
    so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:00.000Z' })
    so.dongLanLoi('m-1', { ketThuc: '2026-08-25T08:10:00.000Z', trangThaiSau: 'running' })
    so.moLanLoi('m-2', { batDau: '2026-08-25T12:00:00.000Z' })
    await so.flush()

    expect((await so.docHopNhat({ machineId: 'm-1' })).episodes).toHaveLength(1)
    expect((await so.docHopNhat({ from: '2026-08-25T11:00:00.000Z' })).episodes).toHaveLength(1)
    expect((await so.docHopNhat({ from: '2020-01-01T00:00:00.000Z', to: '2020-01-02T00:00:00.000Z' })).episodes).toEqual([])
  })

  it('một dòng hỏng giữa sổ không làm mất cả cuốn', async () => {
    const { so } = moSo()
    so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:00.000Z' })
    so.dongLanLoi('m-1', { ketThuc: '2026-08-25T08:10:00.000Z', trangThaiSau: 'running' })
    await so.flush()
    const { appendFile } = await import('node:fs/promises')
    await appendFile(so.filePath, '{ dòng này hỏng\n', 'utf8')
    so.moLanLoi('m-2', { batDau: '2026-08-25T09:00:00.000Z' })
    await so.flush()

    const { episodes } = await so.docHopNhat()
    expect(episodes).toHaveLength(2)
  })

  it('xoay vòng khi quá cỡ, và bản hợp nhất vẫn đọc qua cả mảnh cũ', async () => {
    const { so } = moSo({ maxBytes: 400 })
    const goc = Date.parse('2026-08-25T08:00:00.000Z')
    for (let i = 0; i < 12; i += 1) {
      so.moLanLoi(`m-${i}`, { batDau: new Date(goc + i * 60_000).toISOString() })
      so.dongLanLoi(`m-${i}`, { ketThuc: new Date(goc + i * 60_000 + 30_000).toISOString(), trangThaiSau: 'running' })
      await so.flush()
    }
    const { readdir } = await import('node:fs/promises')
    const ds = await readdir(dir)
    expect(ds.length).toBeGreaterThan(1)                       // đã có mảnh xoay vòng
    const { episodes } = await so.docHopNhat({ limit: 100 })
    expect(episodes).toHaveLength(12)                          // không mất lần lỗi nào
  })

  it('lý do "chưa biết" bịa đặt bị từ chối ngay, không ghi vào sổ', async () => {
    const { so } = moSo()
    so.moLanLoi('m-1', { batDau: '2026-08-25T08:00:00.000Z' })
    expect(() => so.dongLanLoi('m-1', { ketThuc: '2026-08-25T08:10:00.000Z', chuaBietVi: 'tu-nghi-ra' }))
      .toThrow(/không hợp lệ/)
  })

  it('đóng một máy chưa hề mở lần lỗi nào → null, không ném, không ghi', async () => {
    const { so } = moSo()
    expect(so.dongLanLoi('m-chua-tung-loi', { ketThuc: '2026-08-25T08:10:00.000Z' })).toBeNull()
    expect(await doc(so)).toHaveLength(0)
  })
})
