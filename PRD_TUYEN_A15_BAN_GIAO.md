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
- **Điểm sáng có thật:** trong 4 ngày máy chỉ phải quay số vào broker **7 lần**, nhịp `state`
  đều **1,54 giây/bản** (110.072 bản tin). Một khi nối được thì tuyến bám rất chắc — cái yếu
  nằm ở *hạ tầng quanh nó*, không nằm ở giao thức.
- **Nhóm P (đẩy mẫu) vẫn chưa từng chạy một lần nào với máy thật**, và không phải vì mã sai.
  Máy bị chặn ở mức `registration` trên HMI. Toàn bộ phía server đã kiểm hết và đúng.
- **Nhóm L (báo lỗi) chỉ có nửa dưới.** Từ 21/08 tới nay máy **chỉ** phát `state=15` (nghỉ),
  `curStitch` luôn `0`, và **không hề có trường `stateID`/`wstrStatusDesc`** trong dữ liệu thật.
  Nhánh "lỗi + mã lỗi" chưa được một byte dữ liệu thật nào chống lưng.
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
| K‑20c | L0 | 79,8 % dòng log là `STATE` lặp lúc máy rảnh | Cân nhắc chỉ ghi `STATE` khi đổi + nhịp tim — **cần duyệt vì sửa `broker.py`** | — | 🟡 |
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
| S‑11 | L0 | Nhịp `state` trung bình trên cửa sổ sạch | Trung bình đã có (1,54 s/bản). **Min/max chưa lấy được từ bất kỳ dữ liệu nào đang có**: `broker.log` không đóng dấu thời gian từng dòng, `enum-growth.csv` không có cột đếm bản tin ⇒ chỉ tính ra được trung bình = tổng/dải. Muốn có min/max phải **sửa `broker.py`** (thêm cột đếm bản tin vào CSV, hoặc đóng dấu giờ vào dòng `*** STATE`) → **cần duyệt**, xếp cùng nhóm với K‑20c | `do_on_dinh.py` | 🟡 |
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
| L‑06 | L2 | `events[].code` >40 ký tự / `message` >400 | Bridge **từ chối cả gói**, lỗi rõ ràng | vitest hợp đồng | ✅ |
| L‑07 | L1 | `isDowntime` / `isImmediateDowntime` cho cả 5 trạng thái | `fault`/`stopped`/`paused` = downtime; `running`/`unknown` = không | `downtime.test.mjs` | ✅ |
| L‑08 | L1 | `durationSeconds` khi `to < from`, ISO sai, lệch múi giờ | Không số âm; ISO sai → lỗi, không NaN lặng lẽ | `downtime.test.mjs` | ✅ |
| L‑09 | L1 | `formatSpokenDuration` 0s · 59s · 61s · 3599s · 24h+ | Chuỗi tiếng Việt đọc được, không "0 phút 0 giây" | `downtime.test.mjs` | ✅ |
| L‑10 | L1 | `latestSignificantEvent` khi rỗng / toàn `info` / lẫn `critical` | Chọn đúng, rỗng → `null`, không ném | `downtime.test.mjs` | ✅ |
| L‑11 | L1 | Mở lần lỗi: `fault` đầu tiên sau trạng thái khác | Mốc = `observedAt` của **controller**, không phải giờ bridge | vitest | ✅ |
| L‑12 | L1 | Đóng lần lỗi: `fault` → `running` | `endedAt` = `observedAt`, `durationSeconds` khớp | vitest | ✅ |
| L‑13 | L1 | `fault` → `unknown` (trôi tín hiệu) | Ghi **`chua-biet`**, tuyệt đối không ghi "đã sửa" | vitest | ✅ |
| L‑14 | L1 | `fault` → có người gõ tay | Ghi **`chua-biet`**; `trackStatusChange` **không** được gọi | vitest | ✅ |
| L‑15 | L1 | Bridge restart lúc lần lỗi đang mở | Ghi `dong-bang-khoi-dong-lai`, **không** tính thời lượng như thật | vitest | ✅ |
| L‑16 | L1 | Nhịp `fault` liên tiếp 1 giây/lần trong 10 phút | Đúng **một** lần lỗi, không phải 600 | vitest | ✅ |
| L‑17 | L1 | **R1** `fault` → `running` → `fault` trong 30 giây | **Hai** lần lỗi riêng; lần 2 có `previousEpisodeId` trỏ lần 1 | vitest | ✅ |
| L‑18 | L1 | R1 lặp 20 lần liên tiếp | 20 lần lỗi, chuỗi `previousEpisodeId` nối đúng thứ tự | vitest | ✅ |
| L‑19 | L1 | R1 nhưng `observedAt` **lùi về quá khứ** (đồng hồ máy nhảy) | Không sinh thời lượng âm; đánh dấu mốc đáng ngờ | vitest | ✅ |
| L‑20 | L3 | Ghi `bridge-data/loi-<site>.jsonl` chỉ-ghi-thêm, xoay vòng theo cỡ | Dòng cũ không bị sửa; mỗi lần xoá cũng được ghi lại | Test HTTP + đọc file | ✅ |
| L‑21 | L3 | API đọc lịch sử lỗi cần `fleet:read` | Thiếu quyền → **403**; không token → **401** | Test HTTP cổng 0 | ✅ |
| L‑22 | L3 | Lọc lịch sử theo máy + khoảng thời gian; khoảng rỗng | Trả mảng rỗng, **không** 500 | Test HTTP | ✅ |
| L‑23 | L3 | **R3** ghi dòng `reopen` trỏ `episodeId` đã đóng | Dòng cũ **còn nguyên byte**; file thêm đúng 1 dòng | Đọc `.jsonl` trước/sau | ✅ |
| L‑24 | L3 | R3 `reopen` trỏ `episodeId` không tồn tại | Từ chối có lỗi rõ, **không** ghi dòng mồ côi | Test HTTP | ✅ |
| L‑25 | L3 | R3 `reopen` hai lần cùng `episodeId` | Cho phép, bản hợp nhất vẫn xác định (dòng sau thắng) | Test HTTP + đọc lại | ✅ |
| L‑26 | L3 | R3 cần quyền **ghi**, không phải `fleet:read` | Thiếu → 403 | Test HTTP | ✅ |
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
| P‑01 | L1 | Đọc header `.DST` (`ST`/`CO`/`+X`/`-X`/`+Y`/`-Y`) | Số mũi, số màu, khổ khớp 2 file thật (4.341 mũi/13.536 B · 10.605 mũi/32.328 B) | vitest với file thật | ✅ |
| P‑02 | L1 | `.DST` hỏng / cụt / không phải DST | Lỗi rõ ràng, **không** nạp vào `PATTERNS` | vitest | ✅ |
| P‑03 | L1 | Sinh `barCodeID`: cùng đầu vào → cùng mã; khác → khác | Ổn định, chỉ chữ số, ≤ trần của `_item` | vitest | ✅ |
| P‑04 | L0 | Thả file vào `patterns/<code>/x.dst` → `load_patterns()` | Log `[PATTERNS] nạp N mẫu`, `PATTERNS[code]` đủ 10 khoá của `_item` | `broker.log` | ✅ |
| P‑05 | L0 | Trùng `barCodeID` ở hai thư mục | Không sập, ghi log cảnh báo, chốt rõ bản nào thắng | `broker.log` | ✅ |
| P‑06 | L0 | **Đo `T_chuẩn bị`** (`t1 → t2`) | Con số mili-giây, tách chặng | Log có mốc, xuất CSV | ✅ |
| P‑07 | L0 | `push-cmd.txt` ← `browse` khi chưa có máy nối | Log `[CTRL] chưa có máy nối`, không sập | `broker.log` | ✅ |
| P‑08 | L0 | Payload `browse reply` giải mã ngược được bằng đúng AES giao thức | Round-trip khớp byte, **không in khoá ra bất kỳ đâu** | Self-test python offline | ✅ |
| P‑09 | L0 | `type` của `_item` đang là chuỗi `'DST'` — máy chờ chuỗi hay số? | Chốt bằng bằng chứng, không đoán | Đối chiếu grep `DesignServer.exe` | ✅ |
| P‑10 | L0 | `_send_browse` lặp đúng `iPage`/`userId`/`companyId` máy hỏi | Reply có `iPage` bằng máy hỏi, `nPage` tính theo `iCount` | `hmi-watch.log` | 🟡 |
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
| K — Kết nối | 26 | **21** | **0** | 3 | 2 |
| S — Trạng thái | 14 | **10** | **1** | 1 | 2 |
| L — Báo lỗi | 33 | 5 | 24 | 0 | 4 |
| P — Đẩy mẫu | 23 | 0 | 9 | 6 | 8 |
| **Cộng** | **96** | **36** | **34** | **10** | **16** |

*(Bảng này đếm bằng máy, không đếm tay: quét mọi dòng `| X‑NN | … | dấu |` trong mục 4.)*

**Nhóm S đã đóng phần làm được mà không cần xưởng** (S‑07…S‑10, S‑12 xanh ngày 25/08). S‑11 chờ duyệt sửa `broker.py`; S‑13/S‑14 chờ ca chạy thật.

**Nhóm K đã đóng.** Không còn ca ✅ nào — mọi thứ làm được mà không cần máy chạy hay
người ra xưởng đều đã xanh. Bốn ca 🟡 còn lại chờ *thời gian* chứ không chờ việc:
K‑19 cần 7 ngày liền, K‑14d cần bắt được lúc cloudflared chưa kịp dựng lại, K‑20c cần
duyệt vì phải sửa `broker.py`. Hai ca 🔴 cần người rút dây ở xưởng.

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
