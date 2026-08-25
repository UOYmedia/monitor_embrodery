import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rename, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/**
 * Sổ **lần lỗi máy** — chỉ ghi thêm, mỗi dòng một JSON.
 *
 * Vì sao là một sổ riêng chứ không phải thêm vài dòng vào `audit.mjs`: sổ kiểm toán ghi
 * *ai đã làm gì*, mỗi dòng có `actor`/`role`/`result`. Một lần máy lỗi thì không có ai làm
 * gì cả — nó là **sự việc xảy ra với cái máy**. Nhét nó vào khuôn `actor/role` sẽ phải bịa
 * ra `actor: 'bridge'` cho một việc không do bridge gây ra, và người đọc sổ kiểm toán sau
 * này sẽ phải lọc bỏ nó mỗi lần muốn xem thao tác của con người. Cách ghi (chỉ-ghi-thêm,
 * xoay vòng theo cỡ, retention mặc định TẮT) thì chép đúng khuôn `audit.mjs` — xem
 * `PRD_LICH_SU_LOI_MAY.md` mục 3.
 *
 * Vì sao chỉ ghi lần lỗi ĐÃ ĐÓNG xuống đĩa được coi là an toàn, trong khi `statusSince` cố
 * ý KHÔNG ghi: hai thứ khác bản chất. `statusSince` là **đồng hồ đang chạy** — đọc lại sau
 * ba ngày thì "máy đang lỗi từ thứ Sáu" là lời nói dối nếu bridge nghỉ cuối tuần. Một lần
 * lỗi đã đóng là **sự việc đã xong** — "thứ Sáu máy lỗi 42 phút" vẫn đúng mãi mãi.
 *
 * Sổ này ghi CẢ lần lỗi đang mở, nhưng đánh dấu rõ `dangMo: true` và không có thời lượng.
 * Lý do: nếu chỉ ghi lúc đóng thì một lần mất điện giữa chừng sẽ xoá sạch dấu vết máy đã
 * từng lỗi — mà đó đúng là lúc người ta cần bằng chứng nhất.
 */

/** Lần lỗi đóng vì controller thật sự báo sang trạng thái khác. Chỉ trường hợp này mới là "hết lỗi". */
export const DONG_BINH_THUONG = 'controller-bao-trang-thai-khac'
/** Ba trường hợp ở PRD 4.2 — biết là *không còn thấy lỗi*, KHÔNG biết là *đã sửa*. */
export const DONG_CHUA_BIET = 'chua-biet'

export const CHUA_BIET_VI = {
  MAT_TIN_HIEU: 'mat-tin-hieu',
  NHAP_TAY: 'nhap-tay',
  KHOI_DONG_LAI: 'dong-bang-khoi-dong-lai',
}

const LY_DO_HOP_LE = new Set(Object.values(CHUA_BIET_VI))

/** Câu chữ hiện lên màn hình. Ba trường hợp "chưa biết" phải đọc ra được, không phải là mã. */
export const CAU_CHU = {
  [DONG_BINH_THUONG]: 'Controller báo máy rời trạng thái lỗi.',
  [CHUA_BIET_VI.MAT_TIN_HIEU]: 'Chưa biết — mất tín hiệu máy giữa chừng, im lặng không phải là hết lỗi.',
  [CHUA_BIET_VI.NHAP_TAY]: 'Chưa biết — có người gõ tay, không phải controller báo hết lỗi.',
  [CHUA_BIET_VI.KHOI_DONG_LAI]: 'Chưa biết — bridge khởi động lại giữa chừng, không quan sát được lúc kết thúc.',
}

/**
 * Thời lượng theo giây giữa hai mốc ISO, hoặc `null` nếu không tính được.
 *
 * Trả `null` chứ không trả 0 khi mốc cuối LÙI so với mốc đầu (đồng hồ controller nhảy về quá
 * khứ — ca L‑19). 0 đọc như "lỗi xong ngay lập tức", và đó là một câu khẳng định sai. Cái
 * đúng để nói là "không tính được".
 */
export function thoiLuongGiay(tuIso, denIso) {
  const a = Date.parse(tuIso)
  const b = Date.parse(denIso)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  if (b < a) return null
  return Math.round((b - a) / 1000)
}

/** Mã lỗi + mô tả **nguyên văn** máy gửi. Không dịch, không tra bảng — xem PRD mục 7. */
function loiNguyenVan(events = []) {
  if (!Array.isArray(events) || events.length === 0) return { ma: null, moTa: null }
  const nang = events.find((e) => e?.severity === 'critical') ?? events.find((e) => e?.severity === 'warning') ?? events[0]
  return { ma: nang?.code ?? null, moTa: nang?.message ?? null }
}

export class FaultEpisodeLog {
  constructor(filePath, { logger, maxBytes = 8 * 1024 * 1024, now = () => Date.now() } = {}) {
    this.filePath = filePath
    this.logger = logger
    this.maxBytes = maxBytes
    this.now = now
    this.queue = Promise.resolve()
    /** machineId -> lần lỗi đang mở (chỉ trong RAM; đĩa là nguồn sự thật khi khởi động lại). */
    this.dangMo = new Map()
    /** machineId -> episodeId của lần lỗi liền trước, để nối chuỗi R1. */
    this.lanTruoc = new Map()
  }

  /**
   * Mở một lần lỗi. Mốc là `batDau` — `observedAt` của **controller**, không phải đồng hồ bridge.
   *
   * R1 (PRD 3.3): mỗi lần lỗi là một lần riêng, KHÔNG gộp theo ngưỡng thời gian. Gộp cần một
   * hằng số mà không dữ liệu nào ở xưởng đỡ nổi, và gộp sai thì che mất một lần dừng máy có
   * thật. Nối bằng `previousEpisodeId` để vẫn đọc được chuỗi lỗi lặp.
   */
  moLanLoi(machineId, { siteId = null, batDau, events = [], uocChung = false } = {}) {
    const dangCo = this.dangMo.get(machineId)
    if (dangCo) return dangCo            // đang mở rồi thì không mở chồng (ca L‑16)

    const { ma, moTa } = loiNguyenVan(events)
    const ban = {
      loai: 'episode',
      episodeId: randomUUID(),
      machineId,
      siteId,
      batDau,
      ketThuc: null,
      thoiLuongGiay: null,
      dangMo: true,
      lyDoDong: null,
      chuaBietVi: null,
      trangThaiSau: null,
      ma,
      moTa,
      previousEpisodeId: this.lanTruoc.get(machineId) ?? null,
      // Máy đã ở trạng thái lỗi từ TRƯỚC khi bridge bắt đầu nhìn: mốc bắt đầu chỉ là lúc ta
      // nhìn thấy, không phải lúc lỗi xảy ra. Màn hình phải nói "ít nhất từ …".
      batDauUocChung: Boolean(uocChung),
      mocDangNgo: false,
      ghiLuc: new Date(this.now()).toISOString(),
    }
    this.dangMo.set(machineId, ban)
    this.ghi(ban)
    return ban
  }

  /**
   * Đóng một lần lỗi.
   *
   * `chuaBietVi` khác `null` nghĩa là ta KHÔNG quan sát được lúc máy hết lỗi — ba trường hợp
   * ở PRD 4.2. Khi đó vẫn ghi mốc cuối (để biết từ lúc nào ta mất dấu) nhưng thời lượng là
   * `null`, vì một con số ở đây sẽ được đọc là "máy lỗi đúng chừng ấy" trong khi sự thật là
   * "ta chỉ nhìn được tới đó".
   */
  dongLanLoi(machineId, { ketThuc, trangThaiSau = null, chuaBietVi = null } = {}) {
    const ban = this.dangMo.get(machineId)
    if (!ban) return null
    if (chuaBietVi !== null && !LY_DO_HOP_LE.has(chuaBietVi)) {
      throw new Error(`Lý do "chưa biết" không hợp lệ: ${chuaBietVi}`)
    }

    const giay = chuaBietVi === null ? thoiLuongGiay(ban.batDau, ketThuc) : null
    // Mốc cuối lùi trước mốc đầu ⇒ đồng hồ controller đã nhảy. Đánh dấu chứ không im lặng
    // sinh ra một thời lượng âm hay một số 0 giả (ca L‑19).
    const dangNgo = chuaBietVi === null && giay === null && Boolean(ketThuc)

    const dong = {
      ...ban,
      loai: 'episode-dong',
      ketThuc,
      thoiLuongGiay: giay,
      dangMo: false,
      lyDoDong: chuaBietVi === null ? DONG_BINH_THUONG : DONG_CHUA_BIET,
      chuaBietVi,
      trangThaiSau,
      mocDangNgo: dangNgo,
      ghiLuc: new Date(this.now()).toISOString(),
    }
    this.dangMo.delete(machineId)
    this.lanTruoc.set(machineId, ban.episodeId)
    this.ghi(dong)
    return dong
  }

  /**
   * R3 (PRD 3.3): một lần lỗi đã đóng NHẦM thì **không sửa dòng cũ**. Ghi một dòng `reopen`
   * mới trỏ về `episodeId`, màn hình hiện bản hợp nhất, đĩa giữ cả hai.
   *
   * Ném lỗi khi `episodeId` không có thật: một dòng mồ côi trỏ vào hư vô còn tệ hơn là từ
   * chối, vì nó sẽ nằm trong sổ mãi mãi và không ai biết nó nói về cái gì (ca L‑24).
   */
  async moLai(episodeId, { actor, role, lyDo, message = null } = {}) {
    const co = await this.timTheoId(episodeId)
    if (!co) throw new Error(`Không có lần lỗi nào mang mã ${episodeId} để mở lại.`)
    const ban = {
      loai: 'reopen',
      id: randomUUID(),
      episodeId,
      machineId: co.machineId,
      at: new Date(this.now()).toISOString(),
      actor: actor ?? 'unknown',
      role: role ?? 'unknown',
      lyDo: lyDo ?? null,
      message,
    }
    this.ghi(ban)
    await this.flush()
    return ban
  }

  // ------------------------------------------------------------------ ghi đĩa

  ghi(line) {
    this.queue = this.queue.then(() => this.them(line)).catch((error) => {
      this.logger?.error('Không ghi được sổ lần lỗi.', { reason: error.message, machineId: line.machineId })
    })
    return line
  }

  async them(line) {
    await mkdir(dirname(this.filePath), { recursive: true })
    await this.xoayNeuCan()
    await appendFile(this.filePath, `${JSON.stringify(line)}\n`, 'utf8')
  }

  async xoayNeuCan() {
    const info = await stat(this.filePath).catch((error) => { if (error?.code === 'ENOENT') return null; throw error })
    if (!info || info.size < this.maxBytes) return

    // Tên mảnh lấy theo giờ. Hai lần xoay trong cùng một mili-giây sẽ ra cùng một tên, và
    // `rename` thì ĐÈ IM LẶNG lên file cũ — mất trắng cả một mảnh sổ mà không có lấy một
    // dòng log. Nên phải tìm một tên còn trống trước khi đổi.
    const goc = `${this.filePath}.${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}`
    let moi = goc
    for (let i = 1; await this.daCo(moi); i += 1) moi = `${goc}-${i}`
    await rename(this.filePath, moi)
    this.logger?.info('Đã xoay vòng sổ lần lỗi.', { rotated: moi })
  }

  async daCo(duong) {
    return stat(duong).then(() => true).catch(() => false)
  }

  async flush() { await this.queue }

  // ------------------------------------------------------------------ đọc

  /** Các mảnh của sổ, mới nhất trước (mảnh đang ghi, rồi tới các bản đã xoay vòng). */
  async cacManh() {
    const thuMuc = dirname(this.filePath)
    const ten = basename(this.filePath)
    const ds = await readdir(thuMuc).catch(() => [])
    const daXoay = ds.filter((f) => f.startsWith(`${ten}.`)).sort().reverse()
    return [ten, ...daXoay]
  }

  async docManh(ten) {
    const noi_dung = await readFile(join(dirname(this.filePath), ten), 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') return ''
      throw error
    })
    const ra = []
    for (const dong of noi_dung.split('\n')) {
      if (!dong.trim()) continue
      // Một dòng hỏng (đĩa đầy giữa lúc ghi, máy mất điện) không được làm mất cả cuốn sổ.
      try { ra.push(JSON.parse(dong)) } catch { /* bỏ đúng dòng đó */ }
    }
    return ra
  }

  /**
   * Bản **hợp nhất** để hiện lên màn hình: mỗi `episodeId` một dòng, trạng thái mới nhất
   * thắng, và các dòng `reopen` được gắn vào đúng lần lỗi của nó.
   *
   * Đọc từ mảnh mới nhất về cũ nhưng dựng theo thứ tự ghi, vì một lần lỗi có thể có nhiều
   * dòng (mở → đóng → mở lại) và dòng sau mới là sự thật hiện hành.
   */
  async docHopNhat({ machineId = null, from = null, to = null, limit = 100, maxSegments = 12 } = {}) {
    // Ghi là bất đồng bộ (xếp hàng), đọc là từ đĩa. Không đợi hàng ghi cạn trước thì một lần
    // lỗi vừa xảy ra sẽ KHÔNG có trong câu trả lời của API gọi ngay sau đó — đúng cái khoảnh
    // khắc người ta mở màn hình ra xem vì máy vừa dừng.
    await this.flush()
    const manh = (await this.cacManh()).slice(0, Math.max(1, maxSegments))
    const tuMs = from ? Date.parse(from) : null
    const denMs = to ? Date.parse(to) : null

    const theoId = new Map()
    const moLaiTheoId = new Map()
    // Đi từ mảnh CŨ nhất tới mới nhất để dòng sau ghi đè dòng trước đúng thứ tự thời gian.
    for (const ten of [...manh].reverse()) {
      for (const dong of await this.docManh(ten)) {
        if (dong.loai === 'reopen') {
          const ds = moLaiTheoId.get(dong.episodeId) ?? []
          ds.push(dong)
          moLaiTheoId.set(dong.episodeId, ds)
          continue
        }
        if (!dong.episodeId) continue
        theoId.set(dong.episodeId, dong)
      }
    }

    const ra = []
    for (const ban of theoId.values()) {
      if (machineId && ban.machineId !== machineId) continue
      const batDauMs = Date.parse(ban.batDau)
      if (tuMs !== null && Number.isFinite(batDauMs) && batDauMs < tuMs) continue
      if (denMs !== null && Number.isFinite(batDauMs) && batDauMs > denMs) continue

      const ds = moLaiTheoId.get(ban.episodeId) ?? []
      const cuoi = ds.length ? ds[ds.length - 1] : null
      ra.push({
        ...ban,
        daMoLai: ds.length > 0,
        soLanMoLai: ds.length,
        moLaiLuc: cuoi?.at ?? null,
        moLaiBoi: cuoi?.actor ?? null,
        lyDoMoLai: cuoi?.lyDo ?? null,
        cauChu: ban.dangMo
          ? 'Đang lỗi — chưa thấy controller báo trạng thái khác.'
          : CAU_CHU[ban.chuaBietVi ?? ban.lyDoDong] ?? null,
      })
    }

    ra.sort((a, b) => Date.parse(b.batDau) - Date.parse(a.batDau))
    const catBot = ra.length > limit
    return { episodes: ra.slice(0, limit), truncated: catBot, tongCong: ra.length }
  }

  async timTheoId(episodeId) {
    const { episodes } = await this.docHopNhat({ limit: Number.MAX_SAFE_INTEGER })
    return episodes.find((e) => e.episodeId === episodeId) ?? null
  }

  /**
   * Lúc bridge khởi động: mọi lần lỗi còn `dangMo` trên đĩa là lần lỗi bị cắt ngang bởi lần
   * tắt máy trước. Đóng chúng bằng `dong-bang-khoi-dong-lai` — KHÔNG tính thời lượng, vì ta
   * không nhìn thấy lúc nó kết thúc (ca L‑15).
   *
   * Cũng khôi phục `lanTruoc` để chuỗi `previousEpisodeId` không đứt qua mỗi lần khởi động.
   */
  async donDep({ moc = null } = {}) {
    const { episodes } = await this.docHopNhat({ limit: Number.MAX_SAFE_INTEGER })
    const luc = moc ?? new Date(this.now()).toISOString()
    const daDong = []
    // Mới nhất trước, nên lần đầu gặp mỗi máy chính là lần lỗi gần nhất của máy đó.
    for (const ban of episodes) {
      if (!this.lanTruoc.has(ban.machineId)) this.lanTruoc.set(ban.machineId, ban.episodeId)
      if (!ban.dangMo) continue
      this.dangMo.set(ban.machineId, ban)
      daDong.push(this.dongLanLoi(ban.machineId, {
        ketThuc: luc, trangThaiSau: null, chuaBietVi: CHUA_BIET_VI.KHOI_DONG_LAI,
      }))
    }
    await this.flush()
    return daDong
  }
}
