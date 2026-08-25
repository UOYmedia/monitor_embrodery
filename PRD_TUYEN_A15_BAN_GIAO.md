# PRD — Tuyến Dahao A15: kết nối · trạng thái · báo lỗi · đẩy mẫu

[PRD]

**Phạm vi tài liệu này** (chốt 25/08/2026): làm cho **phần kết nối chắc trước**, rồi test cho
kỹ đúng ba việc **máy** — thu trạng thái, báo lỗi, đẩy mẫu — rồi mới bàn giao mã cho đội khác
làm tiếp tích hợp MES.

**Nằm ngoài phạm vi:** mọi thứ dính tới RedThread/MES. Tài liệu cũ
`PRD_TEST_TICH_HOP_REDTHREAD_A15.md` giữ lại làm hồ sơ nghiên cứu, **không** phải việc phải làm
bây giờ. Tầng `LA` trong bảng test cũ bị gỡ khỏi tài liệu này.

Tài liệu này đứng **trên** ba PRD đã có và không chép lại chúng:

| Đã có | Trả lời câu gì | Quan hệ |
| --- | --- | --- |
| `PRD_TEST_TOAN_BO.md` | Dựa vào đâu tin bản đang chạy là đúng | Cung cấp **tầng L1–L5** |
| `PRD_DO_THOI_GIAN_DAY_CATALOG.md` | Nghe bao lâu thì biết hết máy nói được gì | Cung cấp **E1** cho nhóm L |
| `PRD_LICH_SU_LOI_MAY.md` | Lỗi gì, từ lúc nào tới lúc nào | Định nghĩa **lần lỗi**, nhóm L dùng lại nguyên văn |

---

## 0. Câu trả lời ngắn

- **Kết nối vừa được vá một lỗ thật, và đã chứng minh bằng gói thật.** Trước 25/08, broker
  không đặt hạn đọc cho socket nào. Máy khai `keepalive=30` lúc CONNECT nhưng broker không áp.
  Một TCP chết âm thầm sẽ **treo luồng vĩnh viễn**, cái xác nằm lại trong `clients`, và
  `deliver()` đếm cả nó rồi báo *"giao 1 sub"* sai sự thật. Bằng chứng lúc phát hiện:
  `logs/broker.out` có **14** dòng `KẾT NỐI TCP` nhưng chỉ **5** dòng `ĐÓNG`.
- **Ba đường vá `V1`/`V2`/`V3` đã lên production và xanh 8/8 bằng gói TCP thật**, không mock.
  Xem `deploy-mini/tests/test_ben_vung_live.py` và `deploy-mini/tests/test_xoay_log.py`.
- **Con số uptime cũ (83,31 %) không dùng được để đánh giá.** 4 trong 5 lần đứt là do chính
  việc sửa chữa gây ra; lần thứ 5 (464 phút) là Mac Mini **ngủ** — đã bịt. Cửa sổ đo sạch bắt
  đầu **2026-08-25T10:39:00Z**, trước mốc đó không tính.
- **Điểm sáng có thật:** trong 4 ngày máy chỉ phải quay số vào broker **7 lần**. Một khi nối
  được thì tuyến bám rất chắc — cái yếu nằm ở *hạ tầng quanh nó*, không nằm ở giao thức.
  Nhịp `state` đo **trực tiếp từng bản tin** ngày 25/08: **min 1,990 s · trung vị 2,001 s ·
  max 2,011 s** — một đồng hồ 2,0 giây cứng, dao động chưa tới 1 %. Con số **1,54 giây/bản**
  ở các bản PRD trước **là sai và đã bỏ**: nó là tổng bản tin ÷ dải thời gian, mà dải đó gộp
  cả những đoạn máy không hề nối — chia cho một mẫu số sai thì ra một nhịp không có thật.
- **Nhóm P (đẩy mẫu) vẫn chưa từng chạy một lần nào với máy thật.** Máy bị chặn ở mức
  `registration` trên HMI. Câu "toàn bộ phía server đã kiểm hết và đúng" ở bản trước là **nói
  quá** — hôm 25/08 nhóm P mới có bài test đầu tiên, và nó tìm ra ngay **hai lỗi thật**: cửa nạp
  mẫu không kiểm gì cả (file rỗng, ảnh PNG đổi đuôi, file .DST cụt đều được nạp và sẵn sàng đẩy
  xuống máy thêu), và khi hai file trùng mã thì bản nào thắng phụ thuộc thứ tự `os.walk` — tức là
  khác nhau giữa các máy. Cả hai đã vá, xem mục nhóm P.
- **Nhóm L (báo lỗi) chỉ có nửa dưới.** Từ 21/08 tới nay máy **chỉ** phát `state=15` (nghỉ),
  `curStitch` luôn `0`, và **không hề có trường `stateID`/`wstrStatusDesc`** trong dữ liệu thật.
  Nhánh "lỗi + mã lỗi" chưa được một byte dữ liệu thật nào chống lưng.
- **Bốn hàm tính ra con số cuối cùng người ta đọc cũng vừa mới có test đầu tiên** (L‑07…L‑10,
  ngày 25/08) — và tìm ra **bốn lỗi thật** nữa. Ba lỗi ở `latestSignificantEvent` đều dẫn tới
  cùng một kết cục: hoặc bịa ra `mã undefined` rồi đóng dấu `actor: bridge` như thể máy đã khai
  ra nó, hoặc ném lỗi làm mất luôn dòng ghi nhận lần lỗi. Lỗi thứ tư ở `durationSeconds`: một mốc
  thời gian thiếu múi giờ được đọc theo giờ **máy chủ**, nên cùng một lần ngừng 12 phút 30 giây
  cho ra **"0 giây"** nếu bridge chạy ở Los Angeles và **"7 giờ 12 phút"** nếu chạy ở Việt Nam.
  Cả bốn đã vá. Điều đáng ghi không phải là các bản vá, mà là: những hàm này nằm ở cuối đường —
  cái sai của chúng đi thẳng vào sổ audit dưới danh nghĩa **sự thật đo được**.
- **Trước khi giao mã cho đội khác, có một việc bắt buộc**: xem mục 6.

---

## 1. Ranh giới hệ thống — 4 tầng, ai test cái gì

```
[B] bridge Node (Mac Mini)   bridge/index.mjs + bridge/lib/*
      │  HTTP/WS, hợp đồng contract.mjs, quyền authz.mjs
      ▼
[C] gateway broker.py        MQTT MQIsdp lvl3, cổng 3865, AES + XXTEA
      │  patterns/<barCodeID>/*.dst  ·  push-cmd.txt  ·  catalog.json
      ▼
[D] mạng LAN                 Mini 192.168.7.202  ·  A15 192.168.7.200
      ▼
[E] controller A15           C41=3865, C44=192.168.7.202, HMI người bấm
```

Ranh giới trách nhiệm **phải giữ khi viết test**: mọi ca test chỉ được khẳng định về tầng nó
quan sát được. Một ca test tầng [B] **không được** kết luận "máy đã nhận file".

---

## 2. Nguyên tắc — chép lại từ `PRD_TEST_TOAN_BO.md` mục 6, không nới

1. **Không mock giao thức Dahao** để giả vờ đã có luồng thật. Bộ test xanh cho thứ chưa từng
   chạy với máy thật là sai lầm nguy hiểm nhất tài liệu này có thể gây ra.
2. **Oracle phải là bằng chứng quan sát được**, không phải trạng thái nội bộ. Với tầng [C]/[E],
   oracle là dòng log có mốc mili-giây; với [B] là JSON trả về thật.
3. **Không gây lỗi cố ý trên máy** để lấy mẫu. Chờ lỗi tự xảy ra trong ca.
4. **Không suy diễn khi máy im.** Máy không nói ⇒ ghi "chưa biết", không ghi "bình thường".
5. **Không in khoá AES/XXTEA ra bất kỳ đâu** — log, test, báo cáo, tài liệu. Enumerator đã có
   lớp che `<redacted:name-only>`; cấm nới lỏng.

---

## 3. Bốn nhóm — chốt định nghĩa TRƯỚC khi test

### 3.1 K — Kết nối bền vững

Ba đường vá đã lên production ngày 25/08 (`broker.py.pre-keepalive.bak` là bản trước đó):

| Mã | Vá gì | Vì sao |
| --- | --- | --- |
| **V1** | `main()` **đổi tên** `broker.log` thay vì `open(LOG,'w')` cắt trắng; giữ 10 bản | Mỗi lần khởi động lại là mất sạch nhật ký phiên trước, không còn gì mà soi |
| **V2** | Đặt `SO_KEEPALIVE` + `settimeout(60)` lúc vào luồng, rồi siết theo đúng `keepalive` máy khai | TCP chết âm thầm treo luồng **vĩnh viễn**; đây là lỗ hổng thật, không phải giả thuyết |
| **V3** | CONNECT trùng `clientId` → **đá phiên cũ** (đúng chuẩn MQTT) | Ngăn "hai entry, một cái là xác chết" làm `deliver()` báo nhầm |

**Chốt về cách đo uptime.** Nguồn duy nhất là `enum-growth.csv` — enumerator ghi một dòng mỗi
30 giây khi broker còn sống. Thiếu quá 3 nhịp (90 giây) tính là gián đoạn. Cách này bắt được
**cả** broker chết **lẫn** Mini ngủ, vì cả hai đều làm ngưng nhịp ghi. Công cụ:
`deploy-mini/do_on_dinh.py`, có cờ `--tu <mốc>` để đo từ cửa sổ sạch.

**Chốt về việc gì tính là "tuyến sống".** Bốn mắt xích phải cùng sống, và phải nói rõ mắt nào
đứt chứ không gộp làm một con số:

```
broker chạy?  →  máy đang nối?  →  state mới nhất bao lâu rồi?  →  bridge trả lời được?
```

Riêng tunnel Cloudflare **không** nằm trong chuỗi này: nó đứt thì dashboard LAN vẫn phải chạy.

### 3.2 S — Thu trạng thái máy

Đây là phần **duy nhất đang chạy thật 24/7** và có dữ liệu dày. Sự thật phải nói thẳng:

> Từ 21/08 tới 25/08, qua **110.072 bản tin**, máy chỉ phát đúng **2 trạng thái**: `-1` và `15`
> (nghỉ). `curStitch` luôn `0`. Catalog enumerator gom được **4 topic, 17 trường** hoàn toàn từ
> thứ máy **tự phát**, không cần server hỏi. Nghĩa là: đường ống thu trạng thái **đã chứng minh
> là bền**, nhưng **độ phủ trạng thái thì chưa** — vì máy chưa chạy ca thật nào trong cửa sổ
> quan sát.

Cấm dùng độ dày dữ liệu này để kết luận "đã bao phủ hết trạng thái".

### 3.3 L — Báo lỗi + đo khoảng máy lỗi

Dùng lại **nguyên văn** định nghĩa đã chốt ở `PRD_LICH_SU_LOI_MAY.md`:

- Lần lỗi **mở** khi controller báo `status === 'fault'` lần đầu sau một trạng thái khác; mốc là
  `observedAt` của bản tin (đồng hồ controller).
- Lần lỗi **đóng** khi controller báo một trạng thái khác `fault`.
- **Ba trường hợp cấm gọi là "sửa được"**: (a) máy trôi sang `unknown`; (b) có người gõ tay;
  (c) bridge khởi động lại giữa chừng. Cả ba ghi là **chưa biết**, hiện thành chữ trên màn hình.

**Chốt về mở lại (reopen)** — ba việc khác hẳn nhau, tách ra kẻo test nhầm:

| Ký hiệu | Mở lại cái gì | Chốt |
| --- | --- | --- |
| **R1** | **Máy** — hết lỗi rồi lỗi lại | Luôn mở **lần lỗi mới**, không có ngưỡng gộp. Gộp cần một hằng số thời gian mà không dữ liệu nào ở xưởng đỡ nổi, và gộp sai thì che mất một lần dừng máy có thật. Nối bằng `previousEpisodeId`. |
| **R2** | **Mẫu** — gửi lại đúng mẫu đó sau khi hỏng giữa chừng | `barCodeID` **giữ nguyên**, không sinh mã mới. Mã là danh tính của *mẫu*, không phải của *lần gửi*. Máy từ chối mẫu trùng thì đó là **phát hiện**, phải ghi lại, cấm lách bằng đổi mã. |
| **R3** | **Lần lỗi đã đóng nhầm** | **Không sửa dòng đã ghi.** Sổ là chỉ-ghi-thêm theo khuôn `bridge/lib/audit.mjs`. Biết thêm sự thật thì ghi dòng **mới** kiểu `reopen` trỏ về `episodeId` cũ. Màn hình hiện bản hợp nhất; đĩa giữ cả hai. |

### 3.4 P — Đẩy mẫu xuống máy, và "mất bao lâu"

Bảy mốc. Ai cũng phải dùng đúng tên mốc này khi báo số:

| Mốc | Sự việc | Quan sát ở đâu |
| --- | --- | --- |
| `t1` | Có `.DST` nằm trên đĩa Mini | [B] |
| `t2` | `load_patterns()` đã nạp, xuất hiện trong `PATTERNS` | [C] log `[PATTERNS] nạp N mẫu` |
| `t3` | **Máy tự hỏi** — `pattern/browse` hoặc `pattern/query` REQ đầu tiên chạm mẫu này | [C] log `[browse REQ]` / `[query REQ]` |
| `t4` | `pattern/download` REQ đầu tiên | [C] log `[download REQ]` |
| `t5` | Mảnh `pattern/data` cuối cùng gửi xong | [C] log `[pattern/data]` |
| `t6` | Máy xác nhận `data/ack` | [C] log `[data/ack]` |
| `t7` | Mẫu chọn được trên HMI | [E] mắt người |

Ba đoạn phải báo **tách bạch**, cấm gộp:

- **`T_chuẩn bị = t1 → t2`** — hoàn toàn trong tay ta, đo được hôm nay, **không cần máy**.
- **`T_chờ máy hỏi = t2 → t3`** — **KHÔNG trong tay ta.** emCAD không có topic để server gọi máy;
  đoạn này bằng đúng thời gian từ lúc mẫu sẵn sàng tới lúc **có người bấm** trên HMI. Báo cáo
  phải ghi nó là *thời gian chờ thao tác*, không phải *thời gian truyền*.
- **`T_truyền = t4 → t6`** — con số kỹ thuật thật sự của việc "đẩy file".

> **Chốt:** khi ai hỏi "đẩy mẫu mất bao lâu", câu trả lời hợp lệ là **`T_truyền`**, kèm câu
> "cộng thời gian chờ người bấm trên máy, vì giao thức không cho đẩy chủ động".

`T_truyền` dự kiến rất nhỏ: file lớn nhất đang có 32.328 B, một gói `pattern/data` gửi hết
trong một lần. Nhưng **dự kiến không phải kết quả** — chưa đo được lần nào.

**Chỗ chặn cứng nằm ở màn hình máy, không nằm ở server.** Broker đã có đủ handler
`pattern/query` → `query/ack` → `pattern/download` → `pattern/data` → `data/ack`, mã hoá đúng,
`mesgNo` lặp đúng, cắt file theo `fileStart`/`byteLen` đúng. Nhưng trong toàn bộ lịch sử
enumerator, máy **gửi đúng 4 loại topic**: `auth/login`, `auth/encode`, `state`,
`pattern/browse` — **chưa một lần** `pattern/query` hay `pattern/download`.

---

## 4. BẢNG TEST

Cột **Chạy được?**:

- 🟩 = **đã xanh, có bằng chứng** — chạy rồi, đạt rồi
- ✅ = chạy được **ngay hôm nay**, không cần ai ở xưởng — chưa viết
- 🟡 = cần **máy đang nối** (máy đang nối sẵn — vẫn không cần người)
- 🔴 = cần **người ở xưởng** hoặc **một ca sản xuất thật**

Cột **Tầng** theo `PRD_TEST_TOAN_BO.md` mục 3 (L1 hàm thuần · L2 hợp đồng · L3 bề mặt HTTP ·
L4 giao diện · L5 tại xưởng), thêm **L0** = `broker.py`.

### 4.1 Nhóm K — Kết nối bền vững

| ID | Tầng | Ca test | Kỳ vọng | Bằng chứng (oracle) | Chạy được? |
| --- | --- | --- | --- | --- | --- |
| K‑01 | L0 | `_xoay_log` khi chưa có log cũ | Bỏ qua êm, không nổ | `test_xoay_log.py` [1] | 🟩 |
| K‑02 | L0 | `_xoay_log` có log cũ | **Đổi tên**, nội dung còn nguyên byte | `test_xoay_log.py` [2] | 🟩 |
| K‑03 | L0 | `_xoay_log` với log rỗng | Không đẻ bản lưu vô nghĩa | `test_xoay_log.py` [3] | 🟩 |
| K‑04 | L0 | `_xoay_log` khi đã có 15 bản | Còn đúng 10, bỏ bản cổ nhất | `test_xoay_log.py` [4] | 🟩 |
| K‑05 | L0 | `_xoay_log` khi thư mục chỉ-đọc | Nuốt lỗi, **broker vẫn khởi động được** | `test_xoay_log.py` [5] | 🟩 |
| K‑06 | L0 | Kết nối TCP rồi im lặng | Broker **cắt** sau ~60 s | `test_ben_vung_live.py` T1 | 🟩 |
| K‑07 | L0 | Log ghi rõ lý do cắt | Dòng `IM QUÁ LÂU, cắt kết nối` | `test_ben_vung_live.py` T1 | 🟩 |
| K‑08 | L0 | Hai CONNECT cùng `clientId` | Phiên **A bị đá**, B sống; log `[V3] đá phiên cũ` | `test_ben_vung_live.py` T2 | 🟩 |
| K‑09 | L0 | Máy A15 thật **không** bị đá nhầm khi test | Không dòng nào đá `602602704E7B` | `test_ben_vung_live.py` T3 | 🟩 |
| K‑10 | L0 | Máy tự quay số lại sau khi broker restart | Trọn chuỗi auth trong ≤60 s, có `*** AUTH XONG ***` | `broker.log` 25/08 03:29→03:30 | 🟩 |
| K‑11 | L0 | Hạn đọc **siết theo** `keepalive` máy khai, không phải hằng số | ✅ 25/08: khai 0→cắt 90,0s; khai 30→60,0s; khai 10→45,0s (chênh 45s ⇒ không phải hằng số) | `test_ben_vung_live.py` T4 — 3 client giả song song | 🟩 |
| K‑12 | L0 | `kill -9` broker → launchd dựng lại | PID đổi, máy nối lại, `sessions[]` thêm 1 | `test_tu_hoi_phuc.py` K‑12a…h | 🟩 |
| K‑13 | L0 | `kill -9` bridge → broker **không** chết theo | Broker giữ PID, `state` không đứt nhịp, `[FWD]` tự nối lại | `test_tu_hoi_phuc.py` K‑13a…f | 🟩 |
| K‑14 | L0 | Tunnel Cloudflare đứt | Dashboard **LAN** vẫn trả lời trong lúc tunnel nằm | `test_tu_hoi_phuc.py` K‑14a,b,c,e,f | 🟩 |
| K‑14d | L0 | Mất tunnel thì đường **công khai** phải mất theo | Tên miền trả mã ≠ 200 khi cloudflared chết | `test_tu_hoi_phuc.py` K‑14d | 🟡 |
| K‑15 | L0 | Chống ngủ: `pmset -g` khi tuyến đang chạy | `sleep 0`, `disksleep 0`, `standby 0`, có caffeinate | `pmset -g` + `pmset -g log` | 🟩 |
| K‑16 | L0 | Cả 4 job launchd đều `RunAtLoad` + `KeepAlive` | `com.dahao.{broker,bridge,tunnel,caffeinate}` đủ 4 | `launchctl list` + đọc plist | 🟩 |
| K‑17 | L0 | `do_on_dinh.py --tu` trên cửa sổ sạch | UPTIME có số, liệt kê từng lần đứt | `do_on_dinh.py` | 🟩 |
| K‑18 | L0 | `do_on_dinh.py` khi thiếu `enum-growth.csv` / catalog hỏng | Báo lỗi rõ, **không** ném traceback trần | `test_do_on_dinh.py` [1]…[9] | 🟩 |
| K‑18b | L0 | Nhịp `state` phải chia theo dải catalog, không theo `--tu` | Không ra con số vô nghĩa kiểu "0,01 giây/bản" | `test_do_on_dinh.py` [8b],[8c] | 🟩 |
| K‑19 | L0 | **UPTIME ≥ 99 % trong 7 ngày liền** trên cửa sổ sạch | Con số thật, kèm danh sách mọi lần đứt | `do_on_dinh.py --tu 2026-08-25T11:59:00Z` | 🟡 |
| K‑20 | L0 | `logs/broker.out` **không** xoay vòng (đo thật 1,6 MB/ngày) | Job `com.dahao.xoaylog` chép-rồi-cắt mỗi ngày, ngưỡng 8 MiB, giữ 60 bản | `test_xoay_log_he_thong.py` [1]…[8] | 🟩 |
| K‑20b | L0 | launchd giữ fd log kiểu `O_APPEND`? (nếu không thì cắt tại chỗ sẽ đẻ lỗ NUL) | Sau khi cắt, file đầy lại từ offset 0, 0 byte NUL | Job thử riêng 25/08 + chính `broker.out` | 🟩 |
| K‑20c | L0 | Bao nhiêu % dòng log là `STATE` lặp lúc máy rảnh | ✅ 25/08 — **đếm xong: 99,0 %, không phải 79,8 %.** Cột `so_lap` đếm bản tin trùng y nguyên bản trước trên chữ ký `(state, curStitch, patternStitch, patternName)`: cửa sổ 1 = 149/151, cửa sổ 2 = 150/151. Ước cũ 79,8 % lấy từ một lát cắt log, **hụt 19 điểm**. **Quyết định của chủ máy: KHÔNG gộp dòng**, chỉ thêm dấu giờ — nên phần "cân nhắc" của ca này đóng lại ở đây. Đếm trước rồi mới bàn gộp; gộp khi chưa đếm là bỏ dữ liệu theo linh cảm. Hệ quả về dung lượng: xem K‑20d | `test_nhip_state.py` N‑4 + `nhip-state.csv` | 🟩 |
| K‑20d | L0 | `broker.log` phình bao nhiêu, và có ai xoay nó khi broker chạy dài ngày không | ✅ 25/08 — **đo thật: 3.754 KiB/ngày** (dòng `*** STATE` từ 54 B lên 85 B sau khi thêm dấu giờ, +57 %). Và đây là chỗ hở: job `com.dahao.xoaylog` chỉ canh `logs/*.out|*.err`, **không canh `broker.log`**; `broker.log` chỉ xoay **lúc broker khởi động** (đổi tên kèm mốc, giữ 10 bản). Nghĩa là broker càng chạy lâu, log càng to — mà chạy lâu chính là **mục tiêu K‑19 (7 ngày liền)**. 7 ngày ≈ **26 MB** một file không ai cắt. Chưa nguy hiểm, nhưng phải vá trước khi bàn giao, và vá `broker.py` thì **cần duyệt** | `xoay_log_he_thong.py` (phạm vi) + đo trực tiếp 25/08 | ✅ |
| K‑21 | L0 | Rút dây LAN của máy giữa lúc đang nối | Broker phát hiện trong ≤60 s, dọn entry, máy nối lại được | `broker.log` + `pgrep` | 🔴 |
| K‑22 | L0 | Đứt TCP giữa lúc gửi `pattern/data` | Broker không treo, không kẹt luồng | `broker.log` + `pgrep` | 🔴 |

> K‑19 là **cổng bàn giao**. Chưa có 7 ngày sạch thì chưa được nói "kết nối đã ổn định" —
> chỉ được nói "đã vá xong lỗ đã biết, đang đo".

### 4.2 Nhóm S — Thu trạng thái máy

| ID | Tầng | Ca test | Kỳ vọng | Bằng chứng | Chạy được? |
| --- | --- | --- | --- | --- | --- |
| S‑01 | L0 | `build_frame` giữ nguyên khoá cũ khi máy không nói gì thêm | Đúng 3 khoá `observedAt`/`status`/`job` | `test_frame.py` [1] | 🟩 |
| S‑02 | L0 | Lần đầu thấy máy → `status='unknown'` | Không bịa "bình thường" khi chưa đủ cơ sở | `test_frame.py` [1] | 🟩 |
| S‑03 | L0 | Enumerator gom topic/trường/trạng thái, ghi `catalog.json` | Catalog thật: **4 topic, 17 trường, 2 trạng thái** (`-1`, `15`), không cần server hỏi | `test_enumerator.py` + `catalog.json` | 🟩 |
| S‑04 | L0 | Catalog cũ hỏng → `.bad` + bắt đầu lại rỗng, không sập | `test_enumerator.py` [8] | `test_enumerator.py` | 🟩 |
| S‑05 | L0 | `enum-growth.csv` chỉ-ghi-thêm, đếm đúng, **không rò bí mật** | `test_enumerator.py` [9] | `test_enumerator.py` | 🟩 |
| S‑06 | L0 | Trường tên nghi bí mật → `<redacted:name-only>` | Quét `catalog.json` thật: **4 trường đã che, 0 chuỗi nghi là khoá** | Quét toàn bộ `catalog.json` | 🟩 |
| S‑07 | L2 | Frame Python thật → hợp đồng JS thật | ✅ 25/08: 5/5, frame do chính `broker.py` sinh, không viết tay | `scripts/broker-frame.test.mjs` | 🟩 |
| S‑08 | L1 | Độ tươi: `state` cũ hơn ngưỡng → **không** hiện như số sống | ✅ 25/08 đo đầu-cuối qua bridge THẬT, đủ ba mức: 0s→`online`; 60s→`stale` (>30s); 300s→hết `online`, `ageSeconds=301` kèm lý do bằng chữ. Số cũ **vẫn đọc được**, chỉ đổi nhãn | `scripts/trang-thai-a15-e2e.test.mjs` | 🟩 |
| S‑09 | L3 | API trạng thái cần `fleet:read`; không token → 401 | ✅ 25/08: không token/token bịa → 401; máy **không tồn tại** + không token cũng 401 (không rò id máy); viewer → 200. **Nhánh 403 không chạm được trên đường này** — bảng quyền cấp `fleet:read` cho cả ba vai; 403 thật được kiểm trên `/api/v2/ingest` (`scan:run`) | `scripts/trang-thai-a15-e2e.test.mjs` | 🟩 |
| S‑10 | L4 | Bất biến K1: thiếu dữ liệu controller → **không** hiện `0` | ✅ 25/08: frame thiếu `curStitch` → `null` suốt từ `broker.py` tới API, **không** hoá 0; các trường máy CÓ nói vẫn giữ nguyên | `scripts/trang-thai-a15-e2e.test.mjs` | 🟩 |
| S‑11 | L0 | Nhịp `state`: trung bình **và min/max** trên cửa sổ sạch | ✅ 25/08 — **đo được rồi, và số cũ là sai.** Mỗi dòng `*** STATE` nay mang thêm `@<ISO‑Z> Δ<giây>` (đã được duyệt), broker chốt 5 phút một dòng vào `nhip-state.csv`. Hai cửa sổ đầu (302 bản tin): **min 1,990 · trung vị 2,001 · max 2,011 giây** — đồng hồ 2,0 s cứng, dao động <1 %. Số cũ *1,54 s/bản* (tổng ÷ dải) chênh **23 %** vì mẫu số gộp cả lúc máy không nối. Bản ĐẦU của mỗi máy ghi `Δ-` chứ không phải `0`: một số 0 bịa sẽ ghim `giay_min` xuống 0 vĩnh viễn. ⚠ **Chỉ mới đo lúc máy NGHỈ** — nhịp lúc máy chạy thật vẫn chưa ai thấy (xem S‑13/S‑14) | `test_nhip_state.py` (8 ca) + `nhip-state.csv` | 🟩 |
| S‑12 | L0 | Bản tin `state` méo / giải mã hỏng | ✅ 25/08: 11/11. Bốn kiểu hỏng vỡ ở bốn tầng khác nhau của `dec_json` → mỗi gói 1 dòng log + vẫn PUBACK; gói ĐÚNG ngay sau đó vẫn chạy (hồi phục thật). **Đối chứng âm**: bẻ chốt `try/except` → 4/11, đúng như mong đợi | `deploy-mini/tests/test_goi_hong.py` | 🟩 |
| S‑13 | **L5** | **Ca sản xuất thật**: `curStitch` chạy từ 0 tới `patternStitch` | Telemetry tăng đơn điệu, khớp mẫu đang thêu | `state.log` + dashboard | 🔴 |
| S‑14 | **L5** | Độ phủ trạng thái sau ≥3 ca thật | Liệt kê **mọi** giá trị `state` đã gặp, ghi rõ "chưa gặp sau X ca" | `catalog.json` | 🔴 |

### 4.3 Nhóm L — Báo lỗi + đo khoảng lỗi

| ID | Tầng | Ca test | Kỳ vọng | Bằng chứng | Chạy được? |
| --- | --- | --- | --- | --- | --- |
| L‑01 | L0 | `controller_state_event()` khi máy khai đủ mô tả + số hiệu | Sinh 1 `event`, `severity='info'`, `id` ≤80 ký tự | `test_frame.py` [2][3] | 🟩 |
| L‑02 | L0 | Máy **thiếu** `wstrStatusDesc` hoặc thiếu số hiệu | **Không** sinh sự kiện — không nói hộ máy | `test_frame.py` [4] | 🟩 |
| L‑03 | L0 | Không có `stateID` thì ngã về `state` | Không bịa mã lỗi | `test_frame.py` [5] | 🟩 |
| L‑04 | L0 | Cắt đúng trần `code`/`message`/`id` của hợp đồng | Không tràn trần | `test_frame.py` [6] | 🟩 |
| L‑05 | L0 | `id` ổn định theo trạng thái, đổi khi trạng thái đổi | Không nhân bản sự kiện | `test_frame.py` [7] | 🟩 |
| L‑06 | L2 | `events[].code` >40 ký tự / `message` >400 | ✅ 25/08: 40/400 ký tự lọt **nguyên văn**; 41/401 ném `ContractError` nêu đúng `events[1].code`, `status 400`. Hai sự kiện lành trong cùng gói **không** lọt — nhận nửa lời khai là tự bịa ra một khoảnh khắc chưa từng có. Đếm theo **ký tự**, không theo byte (400 ký tự tiếng Việt = >400 B vẫn qua) | `contract.test.mjs` | 🟩 |
| L‑07 | L1 | `isDowntime` / `isImmediateDowntime` cho cả 5 trạng thái | ✅ 25/08: kiểm bằng **bảng đủ 5 trạng thái** cho cả hai hàm (thêm trạng thái mới mà quên xếp loại thì đỏ ngay, không lặng lẽ rơi vào "không"). `unknown` = **không** ngừng — mất tín hiệu không phải máy đứng, xếp nhầm thì tổng giờ ngừng của xưởng thành thước đo chất lượng đường mạng. `'Fault'`/`' fault '`/rỗng/`null` không lọt | `downtime.test.mjs` | 🟩 |
| L‑08 | L1 | `durationSeconds` khi `to < from`, ISO sai, lệch múi giờ | ✅ 25/08 — **tìm ra lỗi thật**: mốc thiếu múi giờ (`2026-08-24T00:00:00`) không hề báo lỗi, `Date.parse` đọc nó theo giờ **máy chủ**. Cùng một lần ngừng 12′30″, bridge chạy ở Los Angeles ghi **"0 giây"** còn chạy ở Việt Nam ghi **"7 giờ 12 phút"** — hai con số bịa khác nhau, im lặng. Nay bắt buộc `isIsoTimestamp` (có `Z` hoặc `±HH:MM`), thiếu thì `null` = "không rõ". Kèm: `to<from`→`0` (không âm), `+07:00` ≡ `Z`, làm tròn phần lẻ dưới giây, `'14/08/2026'`/epoch ms → `null` | `downtime.test.mjs` | 🟩 |
| L‑09 | L1 | `formatSpokenDuration` 0s · 59s · 61s · 3599s · 24h+ | ✅ 25/08: bảng 0 · 59 · 60 · 61 · 3.599 · 3.600 · 86.400 · 90.061 giây, không chuỗi nào có bậc rỗng ("1 giờ 0 phút") hay `NaN`/`undefined`. Quá 1 giờ thì **bỏ phần giây** — có chủ ý, đã ghi vào test để lần sau không ai "sửa" lại. Mọi đầu vào không phải số giây hữu hạn không âm → `null` | `downtime.test.mjs` | 🟩 |
| L‑10 | L1 | `latestSignificantEvent` khi rỗng / toàn `info` / lẫn `critical` | ✅ 25/08 — **tìm ra ba lỗi thật**, đều dẫn tới bịa mã lỗi hoặc mất dòng ghi nhận: (1) truyền `null` thì **ném `TypeError`** ngay trên đường ghi sổ lúc máy vào lỗi — hỏng đúng lúc cần nhất; (2) truyền một **chuỗi** thì `for…of` duyệt theo **ký tự** và trả về ký tự đầu như một sự kiện, dòng audit in ra `mã undefined` đóng dấu `actor: bridge`; (3) một sự kiện có **mốc thời gian hỏng chặn đứng** mọi sự kiện thật đến sau nó (`Date.parse` → `NaN`, mọi so sánh đều false) ⇒ mã lỗi báo cho xưởng đổi theo thứ tự adapter xếp mảng. Đã vá cả ba; thêm: sự kiện **không có mã** thì không nêu tên (thà thiếu còn hơn `mã undefined`) | `downtime.test.mjs` | 🟩 |
| L‑11 | L1 | Mở lần lỗi: `fault` đầu tiên sau trạng thái khác | ✅ 25/08: mốc lấy từ `observedAt` của controller; đồng hồ bridge chỉ vào `ghiLuc` | `fault-episodes.test.mjs` | 🟩 |
| L‑12 | L1 | Đóng lần lỗi: `fault` → `running` | ✅ 25/08: 2.550 s khớp đúng mốc controller (đơn vị) + đo lại đầu-cuối qua HTTP thật | `fault-episodes.test.mjs` · `loi-may-e2e.test.mjs` | 🟩 |
| L‑13 | L1 | `fault` → `unknown` (trôi tín hiệu) | ✅ 25/08: `chuaBietVi='mat-tin-hieu'`, `thoiLuongGiay=null` (KHÔNG phải 0), kèm câu chữ cho màn hình. Đo cả ở tầng sổ lẫn đầu-cuối | `fault-episodes.test.mjs` · `loi-may-e2e.test.mjs` | 🟩 |
| L‑14 | L1 | `fault` → có người gõ tay | ✅ 25/08: `chuaBietVi='nhap-tay'`, không thời lượng; `trackStatusChange` vẫn KHÔNG được gọi (đồng hồ "đang ở trạng thái này từ…" không bị một mẫu đơn lẻ đè); số gõ tay vẫn vào sổ bình thường | `loi-may-e2e.test.mjs` | 🟩 |
| L‑15 | L1 | Bridge restart lúc lần lỗi đang mở | ✅ 25/08: dựng bridge THẬT, mở lần lỗi, giết tiến trình, dựng bridge thứ hai trên cùng quyển sổ → `dong-bang-khoi-dong-lai`, `thoiLuongGiay=null`, mã lỗi còn nguyên | `loi-may-e2e.test.mjs` | 🟩 |
| L‑16 | L1 | Nhịp `fault` liên tiếp 1 giây/lần trong 10 phút | ✅ 25/08: 600 lần gọi mở → đúng 1 lần lỗi và **đúng 1 dòng** trên đĩa | `fault-episodes.test.mjs` | 🟩 |
| L‑17 | L1 | **R1** `fault` → `running` → `fault` trong 30 giây | ✅ 25/08: hai lần lỗi riêng, `previousEpisodeId` nối đúng — đo cả ở đơn vị lẫn đầu-cuối qua HTTP | `fault-episodes.test.mjs` · `loi-may-e2e.test.mjs` | 🟩 |
| L‑18 | L1 | R1 lặp 20 lần liên tiếp | ✅ 25/08: đủ 20, chuỗi nối đúng thứ tự, lần đầu tiên `previousEpisodeId=null` | `fault-episodes.test.mjs` | 🟩 |
| L‑19 | L1 | R1 nhưng `observedAt` **lùi về quá khứ** (đồng hồ máy nhảy) | ✅ 25/08: `thoiLuongGiay=null` (không âm, không 0) + cờ `mocDangNgo` | `fault-episodes.test.mjs` | 🟩 |
| L‑20 | L3 | Ghi `bridge-data/loi-<site>.jsonl` chỉ-ghi-thêm, xoay vòng theo cỡ | ✅ 25/08: sổ nằm đúng chỗ, JSONL đọc được từng dòng, mở+đóng = 2 dòng; xoay vòng qua nhiều mảnh vẫn đọc nối được. **Vá 1 lỗi thật lúc viết test**: hai lần xoay trong cùng mili-giây ra cùng tên file, `rename` **đè im lặng** mất trắng một mảnh | `loi-may-e2e.test.mjs` · `fault-episodes.test.mjs` | 🟩 |
| L‑21 | L3 | API đọc lịch sử lỗi cần `fleet:read`; không token → **401** | ✅ 25/08: không token/token bịa → 401; viewer → 200. **Nhánh 403 không chạm được trên đường đọc** (cả ba vai đều có `fleet:read`) — 403 thật nằm ở L‑26, trên đúng tuyến lỗi | `loi-may-e2e.test.mjs` | 🟩 |
| L‑22 | L3 | Lọc lịch sử theo máy + khoảng thời gian; khoảng rỗng | ✅ 25/08: khoảng rỗng → `[]`; `from`/`to` là rác cũng không 500; máy **không có thật** → 404 chứ không phải `[]` (mảng rỗng cho id gõ nhầm sẽ đọc ra "máy vẫn tốt") | `loi-may-e2e.test.mjs` | 🟩 |
| L‑23 | L3 | **R3** ghi dòng `reopen` trỏ `episodeId` đã đóng | ✅ 25/08: so **byte** file trước/sau — phần cũ khớp nguyên vẹn, thêm đúng 1 dòng; bản hợp nhất hiện `daMoLai` kèm lý do và người bấm, thời lượng cũ vẫn còn | `loi-may-e2e.test.mjs` · `fault-episodes.test.mjs` | 🟩 |
| L‑24 | L3 | R3 `reopen` trỏ `episodeId` không tồn tại | ✅ 25/08: 404 và file **không đổi một byte**; mở lại mà không ghi lý do → 400, cũng không ghi gì | `loi-may-e2e.test.mjs` | 🟩 |
| L‑25 | L3 | R3 `reopen` hai lần cùng `episodeId` | ✅ 25/08: cho phép; bản hợp nhất lấy dòng sau, `soLanMoLai=2`; **cả hai dòng vẫn nằm trên đĩa**, lần đầu không bị đè | `loi-may-e2e.test.mjs` · `fault-episodes.test.mjs` | 🟩 |
| L‑26 | L3 | R3 cần quyền **ghi**, không phải `fleet:read` | ✅ 25/08: `machine:update`; viewer → **403**, và 403 bắn **trước** khi tra mã lần lỗi nên không dò được mã qua chênh lệch 403/404 | `loi-may-e2e.test.mjs` | 🟩 |
| L‑27 | L4 | Bảng lần lỗi: *lỗi gì · từ · đến · kéo dài* | Ba trường hợp "chưa biết" hiện thành **chữ**, không `0 phút` | happy-dom | ✅ |
| L‑28 | L4 | Mã lỗi in **nguyên văn**, không dịch, không bảng tra | Chuỗi hiển thị khớp byte với `events[].code` | happy-dom | ✅ |
| L‑29 | L4 | Lần lỗi đã `reopen` hiện là **đã mở lại**, kèm lý do | Không xoá dấu vết bản cũ | happy-dom | ✅ |
| L‑30 | **L5** | **Máy lỗi thật** (đứt chỉ tự xảy ra) → enumerator bắt được trường mới | Có `state` mới ngoài `-1` và `15`; có `stateID`/`wstrStatusDesc` hay **không có** | `catalog.json` + `enum-growth.csv` | 🔴 |
| L‑31 | **L5** | Suy ra nhánh `fault` từ dữ liệu thật (E3) | Điều kiện `fault` viết được, **có dẫn chứng**, không đoán | Ghi chú + code | 🔴 |
| L‑32 | **L5** | Đối chiếu thời lượng hệ thống đo vs **đồng hồ tay người** | Lệch ≤5 giây, hoặc nói rõ vì sao lệch | Sổ ca + báo cáo | 🔴 |
| L‑33 | **L5** | Danh sách lỗi máy nhận diện được (E7) | Union đã quan sát, in nguyên văn, ghi rõ "chưa gặp sau X ca" | Báo cáo | 🔴 |

> L‑30 là **cổng của cả nhóm**. Trước khi nó xanh, mọi ca `L‑11..L‑19` chỉ chứng minh **logic
> nội bộ** đúng — chúng **không** chứng minh hệ thống nhận ra được lỗi thật của máy này.

### 4.4 Nhóm P — Đẩy mẫu xuống máy

| ID | Tầng | Ca test | Kỳ vọng | Bằng chứng | Chạy được? |
| --- | --- | --- | --- | --- | --- |
| P‑01 | L1 | Đọc header `.DST` (`ST`/`CO`/`+X`/`-X`/`+Y`/`-Y`) | ✅ 25/08 trên **2 file .DST thật**: 4.341 mũi/13.536 B/khổ 1408×233 và 10.605 mũi/32.328 B/khổ 1210×513, khớp từng con số. Thêm một file tự dựng để bài chạy được ở máy không có sẵn mẫu | `test_mau_dst.py` | 🟩 |
| P‑02 | L1 | `.DST` hỏng / cụt / không phải DST | ✅ 25/08 — **tìm ra lỗi thật**: trước bản vá, cả 6 kiểu file xấu (rỗng 0 B, PNG đổi đuôi, văn bản, header cụt, thân cụt, khai 0 mũi) đều được nạp và sẵn sàng đẩy xuống máy. Nay có `_dst_hop_le()`: mỗi file bị loại có một dòng nói rõ vì sao, file tốt vẫn vào | `test_mau_dst.py` | 🟩 |
| P‑03 | L1 | `barCodeID` **suy từ đường dẫn** (không có hàm sinh): thư mục số → lấy thư mục, không thì lấy đầu tên file | ✅ 25/08: hai lần nạp cùng thư mục ra cùng mã; mã là chuỗi chữ số, `barCodeID` = `patternNetID`. Mã **không** phải chữ số (vd `AO-01`) thì vẫn nạp nhưng có cảnh báo — chưa có bằng chứng nào nói A15 nhận hay từ chối mã chữ, nên không chặn bừa | `test_mau_dst.py` | 🟩 |
| P‑04 | L0 | Thả file vào `patterns/<code>/x.dst` → `load_patterns()` | ✅ 25/08: đúng dòng `[PATTERNS] nạp 3 mẫu`, `_item()` đúng 10 khoá không thừa không thiếu, và cả 10 khoá đều xuống được JSON (không lọt `bytes`/`None` vào dây) | `test_mau_dst.py` | 🟩 |
| P‑05 | L0 | Trùng `barCodeID` ở hai thư mục | ✅ 25/08 — **tìm ra lỗi thật**: bản thắng do thứ tự `os.walk` quyết định, mà thứ tự đó không được hứa hẹn ⇒ cùng một thư mục `patterns/` cho ra hai kết quả khác nhau trên hai máy, không dòng log nào. Nay sắp đường dẫn trước khi nạp (**đường dẫn nhỏ hơn theo thứ tự chữ thì thắng**) và nêu tên bản bị bỏ | `test_mau_dst.py` | 🟩 |
| P‑06 | L0 | **Đo `T_chuẩn bị`** (`t1 → t2`) | ✅ 25/08: **0,1–0,5 ms** cho 2 mẫu thật / 45.864 B (lần đầu 0,5 ms lúc đĩa còn nguội, các lần sau 0,1 ms). Tách 3 chặng (liệt kê · đọc · kiểm) trong log và nối một dòng vào `patterns-nap.csv` mỗi lần nạp | `test_mau_dst.py` · `patterns-nap.csv` | 🟩 |
| P‑07 | L0 | `push-cmd.txt` ← `browse` khi chưa có máy nối | ✅ 25/08: cả 4 lệnh (`browse`, `query`, `data`, lệnh bịa) đều ra đúng dòng `[CTRL] chưa có máy nối` và không ném ra ngoài | `test_mau_dst.py` | 🟩 |
| P‑08 | L0 | Payload giải mã ngược được bằng đúng AES giao thức | ✅ 25/08: `pattern/data` mang trọn file 32 KB đi qua `aes_enc_json` → `dec_json` về **khớp từng byte**, `mesgNo` giữ nguyên; cắt mảnh rồi ghép lại cũng khớp byte (nền của P‑14). Bài test chỉ đi qua hàm, không chạm giá trị khoá | `test_mau_dst.py` | 🟩 |
| P‑09 | L0 | `type` của `_item` đang là chuỗi `'DST'` — máy chờ chuỗi hay số? | ✅ 25/08: chốt được **phía ta** — `type` là chuỗi `'DST'` ở cả ba chỗ phát ra (`_item`, `query/ack` tìm thấy, `query/ack` không tìm thấy), và đuôi `.DST` viết hoa vẫn nạp. Máy chờ chuỗi hay số thì **vẫn chưa biết** và chỉ P‑16/P‑17 mới trả lời được; ca này khoá hiện trạng lại để nếu ai đổi thì đỏ ngay | `test_mau_dst.py` | 🟩 |
| P‑10 | L0 | `_send_browse` lặp đúng `iPage`/`userId`/`companyId` máy hỏi | ⚠ 25/08 đọc mã thấy: `_send_browse` **lặp lại `iPage` máy hỏi và tính `nPage` theo `iCount`, nhưng KHÔNG cắt trang** — nó luôn gửi toàn bộ danh sách. Hôm nay vô hại (chỉ có 2 mẫu) và **cố tình chưa sửa**: chưa có một lần `browse` thật nào để biết máy chờ gì, sửa mò lúc này là đoán giao thức. Chốt lại ở đây để P‑10 đo đúng cái cần đo | `hmi-watch.log` | 🟡 |
| P‑11 | L0 | `handle_pattern_query` với mã có thật | `query/ack` `isFind=1`, `patternSize` = cỡ file thật | `broker.log` | 🟡 |
| P‑12 | L0 | `handle_pattern_query` với mã không có | `isFind=0`, không sập, không trả mẫu khác | `broker.log` | 🟡 |
| P‑13 | L0 | `handle_pattern_download` `fileStart=0`, `byteLen=0` | Trả **trọn** file, b64 đúng độ dài | `broker.log` | 🟡 |
| P‑14 | L0 | `handle_pattern_download` chia mảnh (`fileStart>0`) | Ghép mảnh lại **khớp byte** với file gốc | Script ghép + so hash | 🟡 |
| P‑15 | L0 | `fileStart` vượt cỡ file / âm | Kẹp về biên, không tràn, không trả mảnh rỗng vô hạn | `broker.log` | 🟡 |
| P‑16 | **L5** | **Máy tự gửi `pattern/query`** lần đầu trong lịch sử | Có dòng `[query REQ]` | `hmi-watch.log` | 🔴 |
| P‑17 | **L5** | **Máy tự gửi `pattern/download`** | Có dòng `[download REQ]` | `hmi-watch.log` | 🔴 |
| P‑18 | **L5** | **Đo `T_truyền`** (`t4 → t6`) | Số mili-giây thật, lặp ≥5 lần, báo trung vị + min/max | `hmi-watch.log` đã cắm sẵn | 🔴 |
| P‑19 | **L5** | Mẫu hiện đúng trên HMI: tên, số mũi, khổ, số màu | Đối chiếu mắt với header `.DST` | Ảnh chụp màn hình | 🔴 |
| P‑20 | **L5** | Máy thêu thật mẫu vừa nhận | `curStitch` chạy từ 0 tới `patternStitch` | `state.log` + dashboard | 🔴 |
| P‑21 | **L5** | `C43`/`C45` đang là `0.0.0.0` → đặt đúng rồi thử lại P‑16 | Ghi lại **có/không** đổi kết quả — kể cả khi không đổi | Ảnh HMI trước/sau + log | 🔴 |
| P‑22 | **L5** | Tìm màn hình **nhập mã vạch mẫu** trên HMI | Xác nhận cửa này **có** hay **không có** trên A15 | Ảnh HMI | 🔴 |
| P‑23 | **L5** | **R2** gửi lại đúng `barCodeID` sau khi tải hỏng giữa chừng | Máy nhận trùng mã, hoặc từ chối — **ghi lại sự thật**, cấm đổi mã để lách | `hmi-watch.log` | 🔴 |

> P‑16 là **ca test quan trọng nhất trong cả tài liệu**. Chừng nào nó chưa xanh thì P‑17 →
> P‑20 không chạy được, và **không được báo bất kỳ con số "đẩy mẫu mất N giây" nào**.

### 4.5 Đếm

| Nhóm | Tổng | 🟩 đã xanh | ✅ làm được ngay | 🟡 cần máy nối | 🔴 cần xưởng |
| --- | --- | --- | --- | --- | --- |
| K — Kết nối | 27 | **22** | **1** | 2 | 2 |
| S — Trạng thái | 14 | **12** | **0** | 0 | 2 |
| L — Báo lỗi | 33 | **26** | **3** | 0 | 4 |
| P — Đẩy mẫu | 23 | **9** | **0** | 6 | 8 |
| **Cộng** | **97** | **69** | **4** | **8** | **16** |

*(Bảng này đếm bằng máy, không đếm tay: quét mọi dòng `| X‑NN | … | dấu |` trong mục 4.)*

**Nhóm P: chín ca không cần máy đã xanh ngày 25/08 — và chúng tìm ra hai lỗi thật.**
Trước hôm nay nhóm P không có một dòng test nào; `deploy-mini/tests/test_mau_dst.py` là bài đầu
tiên. Hai lỗi:

1. **Cửa nạp mẫu không kiểm gì cả.** Bất kỳ file nào có đuôi `.dst` đều vào `PATTERNS`: file
   rỗng 0 byte, một ảnh PNG đổi tên, một file `.DST` sao chép dở dang khai 5.000 mũi nhưng thân
   chỉ có 665 byte. Máy thêu **không kiểm hộ ta** — nó nhận gì thì thêu nấy — nên chỗ đầu tiên
   lộ ra một file rác sẽ là một mẻ hàng hỏng trên khung. Nay có `_dst_hop_le()`: đủ dài, có
   `LA:`, có `ST:` > 0, và thân file phải đủ `3 × số mũi` byte.
2. **Trùng mã thì bản thắng không cố định.** `os.walk` không hứa thứ tự thư mục, nên cùng một
   thư mục `patterns/` có thể cho hai kết quả khác nhau trên hai máy — và không có một dòng log
   nào. Nay sắp đường dẫn trước khi nạp, chốt "đường dẫn nhỏ hơn theo thứ tự chữ thì thắng", và
   nêu tên bản bị bỏ.

Đối chứng âm đã chạy: bẻ gãy lần lượt bảy chốt (cửa kiểm `.DST`, cảnh báo mã chữ, chốt bản thắng,
phép sắp đường dẫn, xuất CSV, tách chặng đo, đếm file bị bỏ) → mỗi lần đúng ca tương ứng đỏ.

**Con số duy nhất của nhóm P đo được hôm nay: `T_chuẩn bị` = 0,1–0,5 ms.** Nói cách khác, chặng
nằm trong tay ta gần như bằng không. Toàn bộ thời gian thật của việc "đẩy mẫu" nằm ở hai chặng
còn lại: `T_chờ máy hỏi` (máy quyết định, ta không gọi được máy) và `T_truyền` (cần máy hỏi thật).
Vậy nên khi ai hỏi "đẩy mẫu mất bao lâu", câu trả lời trung thực hôm nay là: **chưa biết, và cái
chưa biết đó không nằm ở phía ta.**

Hai điều đọc được từ header 2 file `.DST` thật, cần **mắt người ở xưởng** xác nhận, không đoán ở đây:

- Trường `LA:` trong file chỉ chứa **8 ký tự** (`41440742`), tức mã đơn 10 chữ số `4144074237`
  đã bị chính phần mềm xuất file cắt cụt. Trong khi đó `patternName` ta gửi lên là tên file
  (`4144074237_1_Front`). HMI hiện cái nào thì **P‑19** phải nhìn tận mắt.
- `CO:` của hai file là `0` và `1`. Theo chuẩn Tajima đó là **số lần đổi màu**, nên số màu thật
  là 1 và 2. Ta đang gửi thẳng `CO` vào `drawingColorCn`. Nếu máy hiểu trường đó là *số màu* thì
  file thứ nhất sẽ hiện "0 màu". Cũng là việc của **P‑19**; sửa bây giờ là đoán.

⚠ Ranh giới của cả chín ca: chúng chứng minh **phía server** đọc mẫu, dựng danh sách, cắt mảnh và
mã hoá đúng. Chúng KHÔNG chứng minh máy nhận được mẫu. Máy chưa từng gửi `pattern/query` lần nào
— đó là P‑16/P‑17, và cổng vẫn là mức `registration` trên HMI.

**Nhóm L: đã xanh L‑11…L‑26 ngày 25/08, và phải đọc kèm một giới hạn.** Sổ lần lỗi
(`bridge/lib/fault-episodes.mjs`) là code MỚI viết cho nhóm này — trước đó hệ thống không hề có
`episodeId`, không có `previousEpisodeId`, và `fault → unknown` đang ghi ra một thời lượng **như
thể máy đã hết lỗi thật**. Nay đã có, đã nối vào bridge, và đã đo đầu-cuối qua HTTP thật.

⚠ Giới hạn: mọi ca trên đều bắt đầu từ một frame `status: 'fault'`. Tới hôm nay `broker.py`
**chưa bao giờ sinh được** chữ đó — `state_to_status()` chỉ trả `running`/`stopped`/`unknown`, vì
chưa ai biết con A15 đánh số trạng thái lỗi là bao nhiêu (máy mới chỉ từng phát `state` = -1 và
15, cả hai đều lúc rảnh). Nên nhóm L chứng minh: **kể từ lúc có một frame `fault`**, cả quãng
đường còn lại chạy đúng. Mắt xích còn thiếu là mắt xích đầu tiên — và đó đúng là **L‑30/L‑31**,
cổng của cả nhóm, cần một ca máy hỏng thật ở xưởng. Không được báo bất kỳ con số "máy hỏng bao
nhiêu lâu" nào từ máy thật trước khi L‑30 xanh.

**L‑06…L‑10 xanh ngày 25/08 — và đây là lần đầu bốn hàm này được kiểm.** Chúng nhỏ, thuần
tính toán, không chạm mạng — đúng loại code người ta hay tin là "chắc đúng rồi". Bốn lỗi thật
tìm được đều có chung một hình dạng: **hàm không hề báo sai, nó trả về một con số/một mã trông
hoàn toàn bình thường**. `durationSeconds('2026-08-24T00:00:00', …)` không ném, không log, chỉ
lặng lẽ trả `0` ở múi giờ này và `25.950` ở múi giờ kia. `latestSignificantEvent('critical')`
không ném, nó trả về ký tự `'c'` và dòng audit thành `Controller báo máy lỗi · mã undefined`.
Không lớp nào phía sau bắt lại được, vì phía sau chúng chỉ còn cái sổ.

Hai chỗ **cố ý giữ nguyên**, đã chốt bằng test để lần sau không ai "sửa" nhầm: (a) `to < from`
vẫn kẹp về `0` chứ không thành `null` — PRD đòi "không số âm", và sau bản vá múi giờ thì nguồn
sinh ra `to < from` gần như chỉ còn đồng hồ nhảy lùi; (b) quá 1 giờ thì bỏ phần giây lẻ
(3.601 s → "1 giờ") — ở thang giờ, một giây lẻ chỉ làm dòng báo dài ra.

Đối chứng âm: bẻ gãy lần lượt tám chốt (chặn đầu vào không phải mảng, bỏ sự kiện không mã, mốc
hỏng không che sự kiện thật, bắt buộc múi giờ, `unknown` không phải ngừng, không nối bậc rỗng,
trần 40 ký tự của `code`, từ chối cả gói thay vì bỏ riêng sự kiện hỏng) → mỗi lần đúng ca tương
ứng đỏ, không ca nào ngoài phạm vi.

L‑27/L‑28/L‑29 là ca giao diện (happy-dom) và **thuộc repo trên máy chính**, không làm được ở
Mini (bản Mini không có thư mục `src/`). Xem mục "hai repo đã lệch nhau".

**Nhóm S đã đóng sạch phần làm được mà không cần xưởng** (S‑07…S‑12 xanh ngày 25/08).
Không còn ca 🟡 nào: S‑11 đóng bằng số đo thật sau khi dấu giờ được duyệt và lên production
lúc 25/08 14:08 Z. S‑13/S‑14 chờ ca chạy thật.

Đáng ghi lại: **dựng được dụng cụ đo thì con số cũ liền lộ ra là sai.** Nhịp `state` báo cáo
suốt mấy bản PRD trước là 1,54 s/bản — suy ra từ tổng bản tin ÷ dải thời gian. Đo thẳng từng
bản tin thì nó là **2,00 s**, lệch 23 %, vì mẫu số cũ gộp cả những đoạn máy không hề nối.
Cùng một lần đo cũng lật con số 79,8 % dòng log lặp thành **99,0 %**. Cả hai con số cũ đều
không hề vô lý khi đọc — đó mới là vấn đề: **một con số suy diễn không tự khai rằng nó là suy
diễn.** Chỗ nào còn báo cáo số suy ra từ tổng/dải mà chưa đo trực tiếp thì nên coi là chưa đo.

**Nhóm K gần đóng.** Còn đúng **một** ca ✅: K‑20d — chính việc đo cho S‑11/K‑20c làm lộ ra
rằng `broker.log` không nằm trong tầm của job xoay log, nên broker chạy càng lâu file càng to.
Vá được ngay, nhưng phải sửa `broker.py` nên **cần duyệt**. Bốn ca 🟡 còn lại chờ *thời gian* chứ không chờ việc:
K‑19 cần 7 ngày liền, K‑14d cần bắt được lúc cloudflared chưa kịp dựng lại, K‑20c đã
được duyệt và đã có dụng cụ đếm chạy thật — chờ số chứ không chờ việc. Hai ca 🔴 cần
người rút dây ở xưởng.

**Một bẫy đã cắn thật khi làm hai ca này, ghi lại để đội sau khỏi mất buổi.** Các self-test
Python ở đây nạp broker bằng `spec_from_file_location('broker', '../broker.py')`, mà bộ kiểm
tra `.pyc` của Python chỉ so đúng hai thứ: **mtime tính theo GIÂY** và **kích thước file**.
Kịch bản đối chứng âm bẻ cùng một file nhiều lần trong vài trăm mili-giây; hai lần bẻ tình cờ
ra file **cùng kích thước trong cùng một giây** thì lần sau chạy lại bytecode của lần TRƯỚC.
Nó không báo lỗi — nó in ra một ca đỏ trông hoàn toàn hợp lý, chỉ là của mutation khác. Đã
xảy ra đúng như vậy ở đây (bẻ "trung vị → trung bình" lại làm đỏ ca N‑6). Quy tắc: harness
đối chứng phải xoá `__pycache__` và chạy với `PYTHONDONTWRITEBYTECODE=1`; và khi ca đỏ
**không phải ca mình nhắm tới**, chạy lại riêng lẻ trước khi ghi nhận bất cứ điều gì.

---

## 5. Thứ tự làm — cái gì chặn cái gì

```
K‑19 (7 ngày uptime sạch)  ──chặn──▶  tuyên bố "kết nối đã ổn"  ──chặn──▶  BÀN GIAO
L‑30 (một lần lỗi thật)    ──chặn──▶  L‑31 ──chặn──▶ L‑32, L‑33
P‑16 (máy tự hỏi mẫu)      ──chặn──▶  P‑17 ──chặn──▶ P‑18, P‑19, P‑20, P‑23
P‑21, P‑22 (thao tác HMI)  ──mở khoá──▶  P‑16
```

**Làm được ngay, không cần chờ ai** — 43 ca ✅. Ưu tiên theo đúng thứ tự bạn chốt:

1. **K‑12, K‑13, K‑14, K‑18, K‑20** — đóng nốt nhóm kết nối.
2. **S‑07, S‑08, S‑09, S‑10, S‑12** — chốt đường thu trạng thái.
3. **L‑06 → L‑29** — 24 ca, nhóm to nhất, toàn bộ logic báo lỗi và mở lại.
4. **P‑01 → P‑09** — phần đẩy mẫu không cần máy hỏi.

**Chỉ cần máy đang nối (máy đang nối sẵn)** — 9 ca 🟡. Làm được bất cứ lúc nào.

**Phải có người ở xưởng** — 16 ca 🔴. Danh sách việc cầm ra xưởng, đúng một chuyến:

- Đặt `C43 = 192.168.7.200`, `C45 = 255.255.255.0`, `C46 = 192.168.7.254` *(hiện `C43` và `C45`
  đang là `0.0.0.0`)*. `C44 = 192.168.7.202` và `C41 = 3865` đã đúng, đừng đụng.
- Chụp **biểu tượng trạng thái mạng** trên HMI — cần biết đang ở mức nào trong ba mức
  `disconnected → connected → successful registration`.
- Tìm màn hình **nhập mã vạch mẫu**.
- Thử chọn mẫu qua mạng, để `hmi-watch.log` bắt mốc.
- Rút dây LAN 2 phút rồi cắm lại (K‑21).

---

## 6. Gói bàn giao — đội nhận được gì

| Thành phần | Đường dẫn | Tình trạng |
| --- | --- | --- |
| Gateway MQTT + giao thức Dahao | `deploy-mini/broker.py` | Chạy production, đã vá V1/V2/V3 |
| Bridge HTTP/WS + hợp đồng + quyền | `bridge/`, `deploy-mini/bridge/` | Chạy production |
| Dashboard React | `src/` | Chạy production |
| Test offline giao thức | `deploy-mini/tests/test_frame.py`, `test_enumerator.py`, `test_xoay_log.py` | Xanh |
| Test sống bền vững kết nối | `deploy-mini/tests/test_ben_vung_live.py` | Xanh 8/8 |
| Đo độ ổn định | `deploy-mini/do_on_dinh.py` | Chạy được, có `--tu` |
| Canh mốc mili-giây khi nạp mẫu | `~/hmi_watch.py` (Mini) | Đang chạy nền |
| Cài đặt một phát | `deploy-mini/install.sh` + `README.txt` | Có |

### 6.1 Hai việc BẮT BUỘC làm trước khi đưa mã ra ngoài

1. **Khoá AES/XXTEA đang nằm cứng trong `deploy-mini/broker.py` và đã vào lịch sử git**
   (commit `458550b`). Repo **chưa có remote nào** nên hiện chưa lọt ra ngoài — nhưng giao repo
   đi là giao luôn cả khoá trong lịch sử. Phải chốt: đưa ra biến môi trường / file bí mật riêng,
   và quyết định có cần viết lại lịch sử git hay không. **Đừng giao trước khi chốt xong việc này.**
2. **Hai bản repo đang lệch nhau.** Máy chính `4a76958`, Mac Mini `7fa61e8`, mỗi bên có việc bên
   kia không có. Mọi con số "verify xanh / N test" chỉ đúng với **một** bên. Phải hợp nhất trước
   khi giao, nếu không đội nhận sẽ tin vào một con số không có thật.

### 6.2 Ba điều đội nhận phải biết ngay ngày đầu

1. **Giao thức là máy-hỏi-server-đáp.** Không có nút đẩy. Mọi thiết kế kiểu "bấm nút gửi mẫu
   xuống máy" đều sai từ gốc — thứ đúng là *đặt mẫu sẵn rồi chờ máy hỏi*.
2. **Máy chưa bao giờ hỏi mẫu.** Nó bị chặn ở mức `registration` trên HMI. Phía server đã kiểm
   hết và đúng; đừng đi sửa lại schema `browse` — đã thử hai lần, cả hai đều âm tính.
3. **Dữ liệu lỗi thật chưa có một byte nào.** Toàn bộ nhánh `fault` hiện là logic viết theo hợp
   đồng, chưa được dữ liệu thật chống lưng. Đừng báo cáo nó như đã kiểm chứng.
