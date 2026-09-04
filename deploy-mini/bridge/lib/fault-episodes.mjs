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

/**
 * **NGUỒN GỐC — trường bắt buộc, và là chốt chặn quan trọng nhất của cả quyển sổ.**
 *
 * Máy Dahao A15 **không gửi mã lỗi qua mạng**. Chốt trên 326.342 khung: đúng 4 giá trị
 * `state`, đúng 8 trường ở cả 4 mã, 21 field / 54 topic toàn hệ, và broker của mình CHÍNH
 * LÀ server nên không còn chỗ nào cho một kênh giấu. Bảng 30 mã EC (EC95 = đứt chỉ) chỉ có
 * ở các đời A18/A58/A68/A88 và là **mã hiển thị trên màn**, không có câu nào trong sổ tay
 * nói nó đi ra dây.
 *
 * Hệ quả: mọi thứ quyển sổ này ghi được đều **KHÔNG PHẢI** máy tự khai lỗi. Nếu không dán
 * nhãn nguồn gốc thì đội đọc sổ sau này sẽ đếm "99 lần máy hỏng" trong khi sự thật là "99
 * lần bridge bấm giờ thấy máy đứng im quá 5 phút" — rồi cử thợ đi tìm một cái hỏng mà
 * controller chưa hề báo. Nên `nguon` là **bắt buộc**, không có mặc định.
 */
export const NGUON = {
  /** Giá trị đến THẲNG từ một trường trong khung MQTT máy đẩy lên. */
  MAY_DAY: 'may-day',
  /** Bridge tự suy ra từ số mũi / đồng hồ. Đúng hay sai là do luật suy luận, không phải do máy. */
  SUY_LUAN: 'suy-luan',
  /** Sự cố của chính hệ thống đo (mất tín hiệu, adapter câm). KHÔNG được đếm chung với sự cố máy. */
  DUONG_DO: 'duong-do',
  /** Người khai. Là "lỗi thật" theo nghĩa có người chứng kiến, nhưng không đo được. */
  NHAP_TAY: 'nhap-tay',
}

const NGUON_HOP_LE = new Set(Object.values(NGUON))

/** Câu giải thích nguồn gốc, in thẳng lên màn hình / trả thẳng qua API. */
export const CAU_NGUON = {
  [NGUON.MAY_DAY]: 'Máy tự khai qua khung MQTT.',
  [NGUON.SUY_LUAN]: 'Bridge suy ra — máy KHÔNG báo lỗi, đây là kết luận từ đồng hồ và số mũi.',
  [NGUON.DUONG_DO]: 'Sự cố ĐƯỜNG ĐO (mất tín hiệu / adapter câm), không phải sự cố của máy.',
  [NGUON.NHAP_TAY]: 'Người khai tại chỗ, không đo được bằng máy.',
}

/**
 * Hệ mã của trường `ma`. Chống trộn hai hệ mã vào một cột — đọc "95" mà không biết nó thuộc
 * hệ nào thì con số vô nghĩa.
 */
export const HE_MA = {
  /** 4 giá trị `state` máy A15 thật sự gửi: -1 / 0 / 2 / 15. Đây KHÔNG phải mã lỗi. */
  A15_STATE: 'a15-state',
  /** Bảng EC của Dahao (EC95 = đứt chỉ). Chỉ có trên MÀN HÌNH ⇒ chỉ vào sổ qua người gõ. */
  DAHAO_EC: 'dahao-ec',
  /** Mã do chính bridge đặt ra (long-stop, mat-tin-hieu…). Không phải mã của hãng. */
  BRIDGE: 'bridge',
}

const HE_MA_HOP_LE = new Set(Object.values(HE_MA))

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
  moLanLoi(machineId, {
    siteId = null, batDau, events = [], uocChung = false, batDauSomNhat = null,
    nguon, heMa = null, ma: maVao = null, moTa: moTaVao = null, kieu = null, nguoi = null,
  } = {}) {
    // `nguon` KHÔNG có mặc định, và ném lỗi chứ không ngã về một giá trị "an toàn". Một dòng
    // không dán nhãn nguồn gốc còn tệ hơn là không có dòng nào: nó sẽ được đọc là lỗi máy.
    if (!NGUON_HOP_LE.has(nguon)) {
      throw new Error(`Lần lỗi phải khai nguồn gốc hợp lệ (${[...NGUON_HOP_LE].join(' | ')}), nhận: ${nguon}`)
    }
    if (heMa !== null && !HE_MA_HOP_LE.has(heMa)) {
      throw new Error(`Hệ mã không hợp lệ: ${heMa}`)
    }
    // Mã EC chỉ tồn tại trên MÀN HÌNH máy — không có đường nào để nó tự đi ra dây. Một dòng
    // `dahao-ec` mà không do người gõ nghĩa là ở đâu đó có code đang bịa mã lỗi cho controller.
    if (heMa === HE_MA.DAHAO_EC && nguon !== NGUON.NHAP_TAY) {
      throw new Error('Mã EC của Dahao chỉ hiện trên màn hình máy — chỉ được vào sổ qua nhập tay.')
    }
    if (maVao !== null && heMa === null) {
      throw new Error('Có mã thì phải khai hệ mã — "95" không thuộc hệ nào là một con số vô nghĩa.')
    }
    if (nguon === NGUON.NHAP_TAY && !nguoi) {
      throw new Error('Dòng nhập tay phải ghi rõ ai khai.')
    }

    const dangCo = this.dangMo.get(machineId)
    if (dangCo) return dangCo            // đang mở rồi thì không mở chồng (ca L‑16)

    const tuEvents = loiNguyenVan(events)
    const ma = maVao ?? tuEvents.ma
    const moTa = moTaVao ?? tuEvents.moTa
    const ban = {
      loai: 'episode',
      episodeId: randomUUID(),
      machineId,
      siteId,
      // Ba trường dưới đây là hợp đồng với đội dùng sổ. Đọc `ma` mà bỏ qua `nguon`/`heMa`
      // là đọc sai — xem khối chú thích NGUON ở đầu file.
      nguon,
      heMa,
      kieu,                              // loại sự việc: 'dung-lau' | 'mat-tin-hieu' | 'nguoi-khai' …
      nguoi,                             // ai khai, chỉ có khi nguon = nhap-tay
      batDau,
      ketThuc: null,
      thoiLuongGiay: null,
      thoiLuongToiDaGiay: null,
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
      // Cận TRÊN của lần lỗi: mốc bridge đã tận mắt thấy máy ở đúng trạng thái này TRƯỚC
      // khoảng mù gần nhất. Không phải suy đoán — là một quan sát cũ, chỉ mất tính chắc chắn
      // vì giữa chừng ta không nhìn. `null` khi không có gì trước đó, hoặc khi hai bên khoảng
      // mù là hai trạng thái khác nhau (lúc đó mốc cũ nói về chuyện khác, không được dùng).
      batDauSomNhat: batDauSomNhat ?? null,
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
    // Cận trên: tính từ mốc quan sát cũ nhất còn dùng được (`batDauSomNhat`) tới lúc đóng.
    // Đi kèm `thoiLuongGiay` chứ không thay thế nó — một con số là "chắc chắn ít nhất chừng
    // này", con số kia là "nhiều nhất chừng này". Gộp hai thứ lại thành một số duy nhất là
    // đúng cái việc đã làm hỏng mọi thời lượng trước ngày 27/08.
    const giayToiDa = chuaBietVi === null && ban.batDauSomNhat
      ? thoiLuongGiay(ban.batDauSomNhat, ketThuc)
      : null
    // Mốc cuối lùi trước mốc đầu ⇒ đồng hồ controller đã nhảy. Đánh dấu chứ không im lặng
    // sinh ra một thời lượng âm hay một số 0 giả (ca L‑19).
    const dangNgo = chuaBietVi === null && giay === null && Boolean(ketThuc)

    const dong = {
      ...ban,
      loai: 'episode-dong',
      ketThuc,
      thoiLuongGiay: giay,
      thoiLuongToiDaGiay: giayToiDa,
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
  async docHopNhat({ machineId = null, from = null, to = null, nguon = null, limit = 100, maxSegments = 12 } = {}) {
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
    // Danh sách rỗng = "không lọc", KHÔNG phải "lọc ra rỗng". `?nguon=` để trống trên URL mà
    // trả về không dòng nào thì màn hình hiện "máy chưa hỏng lần nào" đúng lúc sổ đang đầy.
    const xin = nguon === null ? null : (Array.isArray(nguon) ? nguon : [nguon]).filter(Boolean)
    const loc = xin === null || xin.length === 0 ? null : new Set(xin)
    for (const ban of theoId.values()) {
      if (machineId && ban.machineId !== machineId) continue
      if (loc && !loc.has(ban.nguon ?? null)) continue
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
        // Đi kèm mọi dòng, kể cả dòng cũ ghi trước khi có trường `nguon`: dòng nào không
        // khai nguồn thì nói thẳng là không biết, chứ không đoán hộ.
        cauNguon: CAU_NGUON[ban.nguon] ?? 'Không rõ nguồn gốc — dòng ghi trước khi sổ bắt buộc khai nguồn.',
        // Nói thẳng mốc bắt đầu chắc tới đâu. Một dòng `batDauUocChung: true` mà không có câu
        // chữ đi kèm thì trên bảng nó trông y hệt dòng chắc chắn, và người đọc vẫn trừ hai mốc
        // ra rồi tin con số đó.
        cauMoc: !ban.batDauUocChung
          ? 'Mốc bắt đầu chắc chắn — bridge nhìn thấy máy chuyển vào trạng thái này.'
          : ban.batDauSomNhat
            ? `Mốc bắt đầu là CẬN DƯỚI — giữa chừng mất tín hiệu. Trước khoảng mù, bridge đã thấy máy ở đúng trạng thái này từ ${ban.batDauSomNhat}.`
            : 'Mốc bắt đầu là CẬN DƯỚI — máy đã ở trạng thái này từ trước lúc bridge nhìn thấy, không rõ từ bao giờ.',
      })
    }

    ra.sort((a, b) => Date.parse(b.batDau) - Date.parse(a.batDau))
    const catBot = ra.length > limit
    // Đếm theo nguồn đi kèm MỌI câu trả lời, tính trên toàn bộ tập đã lọc chứ không phải
    // trên trang đang trả. Đây là con số làm người đọc khỏi hiểu nhầm ngay từ dòng đầu:
    // `may-day: 0` nói thẳng rằng máy chưa từng tự khai một lỗi nào.
    const theoNguon = Object.fromEntries([...NGUON_HOP_LE].map((k) => [k, 0]))
    theoNguon['khong-ro'] = 0
    for (const ban of ra) theoNguon[ban.nguon ?? 'khong-ro'] += 1
    return { episodes: ra.slice(0, limit), truncated: catBot, tongCong: ra.length, theoNguon }
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
