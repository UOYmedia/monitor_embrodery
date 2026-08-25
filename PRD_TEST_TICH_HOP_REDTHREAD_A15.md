# PRD — Bảng test tích hợp RedThread ↔ bridge Dahao A15

[PRD]

Tài liệu này đứng **trên** ba PRD đã có và không chép lại chúng:

| Đã có | Trả lời câu gì | Quan hệ |
| --- | --- | --- |
| `PRD_DO_THOI_GIAN_DAY_CATALOG.md` | Nghe bao lâu thì biết hết máy nói được gì | Cung cấp **E1** cho nhóm F2 |
| `PRD_LICH_SU_LOI_MAY.md` | Lỗi gì, từ lúc nào tới lúc nào | Định nghĩa **lần lỗi**, F2/F3 dùng lại nguyên văn |
| `PRD_TEST_TOAN_BO.md` | Dựa vào đâu tin bản đang chạy là đúng | Cung cấp **tầng L1–L5**, bảng dưới gắn vào đó |

Câu hỏi riêng của tài liệu này: **muốn nối RedThread với con A15 thật thì phải chứng minh
những gì, bằng bằng chứng nào, và hôm nay chứng minh được tới đâu?**

---

## 0. Câu trả lời ngắn

- **Ba nhóm luồng không cùng độ chín.** F1 (đẩy mẫu) **chưa từng chạy một lần nào** với máy
  thật; F2 (báo lỗi) đã có nửa dưới nhưng thiếu dữ liệu lỗi thật; F3 (mở lại) **chưa được
  định nghĩa ở đâu cả** — đây là lần đầu.
- **"Đẩy file mất bao lâu" là câu hỏi sai nếu hỏi trống.** Giao thức emCAD là **máy hỏi, server
  đáp** — không có nút đẩy. Nên con số phải tách làm ba đoạn (mục 3.1), trong đó **đoạn giữa
  không nằm trong tay ta**. Một con số duy nhất "đẩy mất N giây" là con số bịa.
- **Chỗ chặn cứng hiện nay nằm ở màn hình máy, không nằm ở server.** Broker đã có đủ handler
  `pattern/query` → `query/ack` → `pattern/download` → `pattern/data` → `data/ack`, mã hoá đúng,
  `mesgNo` lặp đúng, cắt file theo `fileStart`/`byteLen` đúng. Nhưng trong toàn bộ lịch sử
  enumerator, máy **gửi đúng 4 loại topic**: `auth/login`, `auth/encode`, `state`,
  `pattern/browse` — **chưa một lần** `pattern/query` hay `pattern/download`.
- **Không có một dòng mã tích hợp RedThread nào trong repo.** `grep -ri podgasus` → **0 kết quả**;
  `grep -ri redthread` chỉ ra tên miền tunnel `redthread.phonh.io.vn` trong cấu hình Cloudflare,
  không phải mã gọi MES. Toàn bộ hiểu biết về API nằm trong ghi chú nghiên cứu — chưa thành code,
  chưa có một test nào.
- Trong **76 ca test** dưới đây: **52 ca chạy được ngay hôm nay** (không cần ai ở xưởng),
  **9 ca cần máy đang nối** (máy đang nối sẵn — vẫn không cần người), **15 ca bắt buộc có người
  ở xưởng hoặc một ca sản xuất thật**.

---

## 1. Ranh giới hệ thống — 5 tầng, ai test cái gì

```
[A] RedThread MES            GraphQL  POST /api/graph/query   (Bearer)
      │  designs[].design_url → .DST trên CloudFront
      ▼
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
   oracle là dòng log có mốc mili-giây; với [A]/[B] là JSON trả về thật.
3. **Không gây lỗi cố ý trên máy** để lấy mẫu. Chờ lỗi tự xảy ra trong ca.
4. **Không suy diễn khi máy im.** Máy không nói ⇒ ghi "chưa biết", không ghi "bình thường".

---

## 3. Ba nhóm luồng — chốt định nghĩa TRƯỚC khi test

### 3.1 F1 — Gửi file thiết kế xuống máy, và "mất bao lâu"

Bảy mốc. Ai cũng phải dùng đúng tên mốc này khi báo số:

| Mốc | Sự việc | Quan sát ở đâu |
| --- | --- | --- |
| `t0` | RedThread có design sẵn sàng (`LineItem.designs` / `downloadBatchDesigns`) | [A] |
| `t1` | Bridge tải xong `.DST` về đĩa Mini | [B] |
| `t2` | `load_patterns()` đã nạp mẫu, xuất hiện trong `PATTERNS` | [C] log `[PATTERNS] nạp N mẫu` |
| `t3` | **Máy tự hỏi** — `pattern/browse` hoặc `pattern/query` REQ đầu tiên chạm mẫu này | [C] log `[browse REQ]` / `[query REQ]` |
| `t4` | `pattern/download` REQ đầu tiên | [C] log `[download REQ]` |
| `t5` | Mảnh `pattern/data` cuối cùng gửi xong | [C] log `[pattern/data]` |
| `t6` | Máy xác nhận `data/ack` | [C] log `[data/ack]` |
| `t7` | Mẫu chọn được trên HMI | [E] mắt người |

Ba đoạn phải báo **tách bạch**, cấm gộp:

- **`T_chuẩn bị = t0 → t2`** — hoàn toàn trong tay ta, đo được hôm nay, **không cần máy**.
- **`T_chờ máy hỏi = t2 → t3`** — **KHÔNG trong tay ta.** emCAD không có topic để server gọi máy;
  đoạn này bằng đúng thời gian từ lúc mẫu sẵn sàng tới lúc **có người bấm** trên HMI. Báo cáo
  phải ghi nó là *thời gian chờ thao tác*, không phải *thời gian truyền*.
- **`T_truyền = t4 → t6`** — con số kỹ thuật thật sự của việc "đẩy file".

> **Chốt:** khi ai hỏi "đẩy mẫu mất bao lâu", câu trả lời hợp lệ là **`T_truyền`**, kèm câu
> "cộng thời gian chờ người bấm trên máy, vì giao thức không cho đẩy chủ động".

`T_truyền` dự kiến rất nhỏ: file lớn nhất đang có 32.328 B, một gói `pattern/data` gửi hết
trong một lần. Nhưng **dự kiến không phải kết quả** — chưa đo được lần nào.

### 3.2 F2 — Thông báo lỗi + đo khoảng máy lỗi

Dùng lại **nguyên văn** định nghĩa đã chốt ở `PRD_LICH_SU_LOI_MAY.md`:

- Lần lỗi **mở** khi controller báo `status === 'fault'` lần đầu sau một trạng thái khác; mốc là
  `observedAt` của bản tin (đồng hồ controller).
- Lần lỗi **đóng** khi controller báo một trạng thái khác `fault`.
- **Ba trường hợp cấm gọi là "sửa được"**: (a) máy trôi sang `unknown`; (b) có người gõ tay;
  (c) bridge khởi động lại giữa chừng. Cả ba ghi là **chưa biết**, hiện thành chữ trên màn hình.

Bổ sung riêng cho tích hợp RedThread — **chốt mới**:

> Downtime của máy **không** tự động thành downtime của batch. `Batch.machineId` chỉ nói batch
> *được giao* cho máy nào, không nói batch *đang chạy* trên máy lúc đó. Muốn quy downtime về
> batch thì phải có bằng chứng thời gian chồng lấn, và bằng chứng đó hôm nay **chưa tồn tại**.

RedThread cũng **không có trường downtime**: `UpdateBatchInput` chỉ `name/priority/status`.
Đường ghi duy nhất là `appendLineItemNote` / `LineItem.errorLogs` — tức **văn bản tự do**.
Nên mọi ca test F2 hướng ra RedThread chỉ được khẳng định về *nội dung ghi chú*, không được
khẳng định về *trạng thái batch*.

### 3.3 F3 — Mở lại (reopen). Lần đầu định nghĩa

"Mở lại" trong yêu cầu gốc gộp ba việc khác hẳn nhau. Tách ra, nếu không sẽ test nhầm:

| Ký hiệu | Mở lại cái gì | Câu hỏi phải trả lời |
| --- | --- | --- |
| **R1** | **Máy** — máy hết lỗi rồi lỗi lại | Lỗi lại sau `X` phút thì là lần lỗi **mới** hay nối vào lần cũ? |
| **R2** | **File/mẫu** — gửi lại đúng mẫu đó sau khi hỏng giữa chừng | Máy có nhận trùng `barCodeID` không? Có phải đổi mã không? Tải dở có nối tiếp được không? |
| **R3** | **Lần lỗi đã đóng nhầm** — đóng bằng "mất tín hiệu"/"restart bridge" | Sau đó biết thêm sự thật thì sửa dòng cũ hay ghi dòng mới? |

**Chốt R1:** luôn mở **lần lỗi mới**. Không có ngưỡng gộp. Lý do: gộp cần một hằng số thời gian
mà không dữ liệu nào ở xưởng đỡ nổi, và gộp sai thì che mất một lần dừng máy có thật. Hai lần
lỗi liên tiếp được nối bằng trường `previousEpisodeId`, còn lại để người đọc tự nhìn.

**Chốt R2:** `barCodeID` giữ nguyên, **không sinh mã mới**. Mã là danh tính của mẫu, không phải
danh tính của lần gửi. Nếu máy từ chối mẫu trùng thì đó là **phát hiện**, phải ghi lại, không
được lách bằng cách đổi mã — lách là che mất một sự thật về giao thức.

**Chốt R3:** **không sửa dòng đã ghi.** Sổ lần lỗi là chỉ-ghi-thêm, theo đúng khuôn
`bridge/lib/audit.mjs`. Biết thêm sự thật thì ghi một dòng **mới** kiểu `reopen` trỏ về
`episodeId` cũ. Màn hình hiển thị bản hợp nhất; đĩa giữ cả hai dòng.

---

## 4. BẢNG TEST

Cột **Chạy được?**:

- ✅ = chạy được **ngay hôm nay**, không cần ai ở xưởng
- 🟡 = cần **máy đang nối** (máy đang nối sẵn — vẫn không cần người)
- 🔴 = cần **người ở xưởng** hoặc **một ca sản xuất thật**

Cột **Tầng** theo `PRD_TEST_TOAN_BO.md` mục 3 (L1 hàm thuần · L2 hợp đồng · L3 bề mặt HTTP ·
L4 giao diện · L5 tại xưởng), thêm **L0** = broker.py và **LA** = RedThread API.

### 4.1 Nhóm F1 — Gửi file thiết kế xuống máy

| ID | Tầng | Ca test | Kỳ vọng | Bằng chứng (oracle) | Chạy được? |
| --- | --- | --- | --- | --- | --- |
| F1‑01 | LA | Gọi `POST /api/graph/query` với Bearer hợp lệ, query `LineItem.designs` | 200, `designs` là JSON parse được, có `design_url[]` | Body trả về thật, lưu lại | ✅ |
| F1‑02 | LA | Gọi thiếu header `Authorization` | **401**, không rò dữ liệu | Mã HTTP | ✅ |
| F1‑03 | LA | Token hết hạn / sai | 401, thông báo không chứa token | Body + kiểm chuỗi bí mật | ✅ |
| F1‑04 | LA | `downloadBatchDesigns(batchId)` với batch có thật | Trả URL tải được, HTTP 200, `Content-Type` là file | Tải thử, đối chiếu cỡ | ✅ |
| F1‑05 | LA | `batchId` không tồn tại | Lỗi GraphQL có cấu trúc, **không** 500 trần | `errors[]` | ✅ |
| F1‑06 | L1 | Tên file `.DST` chứa `orderNumber` → tách được mã đơn | Hàm thuần tách đúng cho ≥10 tên thật, kể cả tên có dấu cách | Bộ test vitest | ✅ |
| F1‑07 | L1 | Sinh `barCodeID` từ đơn/mẫu: cùng đầu vào → cùng mã; khác → khác | Ổn định, dài ≤ trần của `_item`, chỉ chữ số | vitest | ✅ |
| F1‑08 | L1 | Đọc header `.DST` (`ST`/`CO`/`+X`/`-X`/`+Y`/`-Y`) | Số mũi, số màu, khổ khớp file thật đã biết (4341 mũi / 13.536 B và 10.605 mũi / 32.328 B) | vitest với 2 file thật | ✅ |
| F1‑09 | L1 | `.DST` hỏng / cụt / không phải DST | Trả lỗi rõ ràng, **không** nạp vào `PATTERNS` | vitest | ✅ |
| F1‑10 | L0 | Thả file vào `patterns/<code>/x.dst` → `load_patterns()` | Log `[PATTERNS] nạp N mẫu`, `PATTERNS[code]` đủ 10 khoá của `_item` | broker.log | ✅ |
| F1‑11 | L0 | Trùng `barCodeID` ở hai thư mục | Không sập, ghi log cảnh báo, chốt rõ bản nào thắng | broker.log | ✅ |
| F1‑12 | L0 | **Đo `T_chuẩn bị`** (`t0 → t2`) cho 1 mẫu | Có con số mili-giây, tách 3 chặng (gọi API · tải · nạp) | Log có mốc, xuất CSV | ✅ |
| F1‑13 | L0 | `push-cmd.txt` ← `browse` khi chưa có máy nối | Log `[CTRL] chưa có máy nối`, không sập | broker.log | ✅ |
| F1‑14 | L0 | Payload `browse reply` giải mã ngược được bằng đúng AES của giao thức | Round-trip khớp byte, **không in khoá ra bất kỳ đâu** | Self-test python offline | ✅ |
| F1‑15 | L0 | `_send_browse` lặp đúng `iPage`/`userId`/`companyId` máy hỏi | Reply có `iPage=0`, `nPage` tính theo `iCount` máy gửi | `hmi-watch.log` | 🟡 |
| F1‑16 | L0 | `handle_pattern_query` với mã có thật | `query/ack` `isFind=1`, `patternSize` = cỡ file thật | broker.log | 🟡 |
| F1‑17 | L0 | `handle_pattern_query` với mã không có | `isFind=0`, không sập, không trả mẫu khác | broker.log | 🟡 |
| F1‑18 | L0 | `handle_pattern_download` `fileStart=0`, `byteLen=0` | Trả **trọn** file, b64 đúng độ dài | broker.log | 🟡 |
| F1‑19 | L0 | `handle_pattern_download` chia mảnh (`fileStart>0`) | Ghép các mảnh lại **khớp byte** với file gốc | Script ghép + so sánh hash | 🟡 |
| F1‑20 | L0 | `fileStart` vượt cỡ file / âm | Kẹp về biên, không tràn, không trả mảnh rỗng vô hạn | broker.log | 🟡 |
| F1‑21 | L0 | Đứt TCP giữa lúc gửi `pattern/data` | Broker không treo, máy nối lại được, không kẹt thread | broker.log + `pgrep` | 🟡 |
| F1‑22 | **L5** | **Máy tự gửi `pattern/query`** lần đầu trong lịch sử | Có dòng `[query REQ]` | `hmi-watch.log` | 🔴 |
| F1‑23 | **L5** | **Máy tự gửi `pattern/download`** | Có dòng `[download REQ]` | `hmi-watch.log` | 🔴 |
| F1‑24 | **L5** | **Đo `T_truyền`** (`t4 → t6`) | Con số mili-giây thật, lặp lại ≥5 lần, báo trung vị + min/max | `hmi-watch.log` đã cắm sẵn | 🔴 |
| F1‑25 | **L5** | Mẫu hiện đúng trên HMI: tên, số mũi, khổ, số màu | Đối chiếu mắt với header `.DST` | Ảnh chụp màn hình | 🔴 |
| F1‑26 | **L5** | Máy thêu thật mẫu vừa nhận, `curStitch` tăng tới `patternStitch` | Telemetry `state` chạy từ 0 tới tổng mũi | `state.log` + dashboard | 🔴 |
| F1‑27 | **L5** | `C43`/`C45`/`C46` đang là `0.0.0.0` → đặt đúng rồi thử lại F1‑22 | Ghi lại **có/không** đổi kết quả — kể cả khi không đổi | Ảnh HMI trước/sau + log | 🔴 |
| F1‑28 | **L5** | Tìm màn hình **nhập mã vạch mẫu** trên HMI (emCAD tự sinh mã vạch cho mẫu) | Xác nhận cửa này **có** hay **không có** trên A15 | Ảnh HMI | 🔴 |

> F1‑22 là **ca test quan trọng nhất trong cả tài liệu**. Chừng nào nó chưa xanh thì F1‑23 →
> F1‑26 không chạy được, và **không được báo bất kỳ con số "đẩy mẫu mất N giây" nào**.

### 4.2 Nhóm F2 — Thông báo lỗi + đo khoảng lỗi

| ID | Tầng | Ca test | Kỳ vọng | Bằng chứng | Chạy được? |
| --- | --- | --- | --- | --- | --- |
| F2‑01 | L0 | `controller_state_event()` khi máy khai đủ mô tả + số hiệu | Sinh 1 `event`, `severity='info'`, `id` ≤80 ký tự | `test_frame.py` | ✅ |
| F2‑02 | L0 | Máy **thiếu** `wstrStatusDesc` hoặc thiếu số hiệu | **Không** sinh sự kiện — không nói hộ máy | `test_frame.py` | ✅ |
| F2‑03 | L2 | Frame Python thật → hợp đồng JS thật | `normalizeTelemetry` nhận, `events[]` nguyên vẹn | `scripts/broker-frame.test.mjs` | ✅ |
| F2‑04 | L2 | `events[].code` >40 ký tự / `message` >400 | Bridge **từ chối cả gói** với lỗi rõ ràng | vitest hợp đồng | ✅ |
| F2‑05 | L1 | `isDowntime` / `isImmediateDowntime` cho cả 5 trạng thái | `fault`/`stopped`/`paused` = downtime; `running`/`unknown` = không | `downtime.test.mjs` | ✅ |
| F2‑06 | L1 | `durationSeconds` khi `to < from`, khi ISO sai, khi lệch múi giờ | Không trả số âm; ISO sai → lỗi, không NaN lặng lẽ | `downtime.test.mjs` | ✅ |
| F2‑07 | L1 | `formatSpokenDuration` 0s · 59s · 61s · 3599s · 24h+ | Chuỗi tiếng Việt đọc được, không "0 phút 0 giây" | `downtime.test.mjs` | ✅ |
| F2‑08 | L1 | `latestSignificantEvent` khi `events[]` rỗng / toàn `info` / lẫn `critical` | Chọn đúng, rỗng → `null`, không ném | `downtime.test.mjs` | ✅ |
| F2‑09 | L1 | Mở lần lỗi: `fault` đầu tiên sau trạng thái khác | Mốc = `observedAt` của **controller**, không phải giờ bridge | vitest | ✅ |
| F2‑10 | L1 | Đóng lần lỗi: `fault` → `running` | `endedAt` = `observedAt`, `durationSeconds` khớp | vitest | ✅ |
| F2‑11 | L1 | `fault` → `unknown` (trôi tín hiệu) | Ghi **`chua-biet`**, tuyệt đối không ghi "đã sửa" | vitest | ✅ |
| F2‑12 | L1 | `fault` → có người gõ tay | Ghi **`chua-biet`**; `trackStatusChange` **không** được gọi | vitest | ✅ |
| F2‑13 | L1 | Bridge restart lúc lần lỗi đang mở | Ghi `dong-bang-khoi-dong-lai`, **không** tính thời lượng như thật | vitest | ✅ |
| F2‑14 | L1 | Nhịp `fault` liên tiếp 1 giây/lần trong 10 phút | Đúng **một** lần lỗi, không phải 600 | vitest | ✅ |
| F2‑15 | L3 | Ghi `bridge-data/loi-<site>.jsonl` chỉ-ghi-thêm, xoay vòng theo cỡ | Dòng cũ không bị sửa; mỗi lần xoá cũng được ghi lại | Test bề mặt HTTP + đọc file | ✅ |
| F2‑16 | L3 | API đọc lịch sử lỗi cần quyền `fleet:read` | Thiếu quyền → **403**; không có token → **401** | Test HTTP thật (cổng 0) | ✅ |
| F2‑17 | L3 | Lọc lịch sử theo máy + khoảng thời gian; khoảng rỗng | Trả mảng rỗng, **không** 500 | Test HTTP | ✅ |
| F2‑18 | L4 | Bảng lần lỗi: *lỗi gì · từ · đến · kéo dài* | Ba trường hợp "chưa biết" hiện thành **chữ**, không hiện `0 phút` | happy-dom + testing-library | ✅ |
| F2‑19 | L4 | Bất biến K1: thiếu dữ liệu controller → **không** hiện `0` | Hiện "Chưa đọc được từ controller" | happy-dom | ✅ |
| F2‑20 | L4 | Mã lỗi in **nguyên văn**, không dịch, không bảng tra | Chuỗi hiển thị khớp byte với `events[].code` | happy-dom | ✅ |
| F2‑21 | LA | Ghi downtime sang RedThread bằng `appendLineItemNote` | Ghi chú vào đúng `lineItemId`, nội dung có mốc giờ + thời lượng | Đọc lại `LineItem.note` | ✅ |
| F2‑22 | LA | Ghi 2 lần cùng nội dung (retry mạng) | **Không** đẻ 2 ghi chú trùng — có khoá chống lặp | Đọc lại note | ✅ |
| F2‑23 | LA | Khẳng định **âm**: `UpdateBatchInput` không có trường downtime | Introspection xác nhận; test **đỏ** nếu ngày nào đó RedThread thêm trường | Introspection query | ✅ |
| F2‑24 | L5 | **Máy lỗi thật** (đứt chỉ tự xảy ra) → enumerator bắt được `state`/`stateID`/`wstrStatusDesc` | Có state mới ngoài `-1` và `15` | `catalog.json` + `enum-growth.csv` | 🔴 |
| F2‑25 | L5 | Suy ra nhánh `fault` từ dữ liệu thật (E3) | Điều kiện `fault` viết được, **có dẫn chứng**, không đoán | Ghi chú + code | 🔴 |
| F2‑26 | L5 | Đối chiếu thời lượng hệ thống đo vs **đồng hồ tay người** | Lệch ≤ 5 giây, hoặc nói rõ vì sao lệch | Sổ ca + báo cáo | 🔴 |
| F2‑27 | L5 | Toàn bộ danh sách lỗi máy nhận diện được (E7) | Union đã quan sát, in nguyên văn, ghi rõ "chưa gặp sau X ca" | Báo cáo | 🔴 |

### 4.3 Nhóm F3 — Mở lại

| ID | Tầng | Ca test | Kỳ vọng | Bằng chứng | Chạy được? |
| --- | --- | --- | --- | --- | --- |
| F3‑01 | L1 | **R1** `fault` → `running` → `fault` trong 30 giây | **Hai** lần lỗi riêng; lần 2 có `previousEpisodeId` trỏ lần 1 | vitest | ✅ |
| F3‑02 | L1 | R1 lặp 20 lần liên tiếp | 20 lần lỗi, chuỗi `previousEpisodeId` nối đúng thứ tự | vitest | ✅ |
| F3‑03 | L1 | R1 nhưng `observedAt` **lùi về quá khứ** (đồng hồ máy nhảy) | Không sinh thời lượng âm; đánh dấu mốc đáng ngờ | vitest | ✅ |
| F3‑04 | L3 | **R3** ghi dòng `reopen` trỏ `episodeId` đã đóng | Dòng cũ **còn nguyên byte**; file có thêm đúng 1 dòng | Đọc `.jsonl` trước/sau | ✅ |
| F3‑05 | L3 | R3 `reopen` trỏ `episodeId` không tồn tại | Từ chối có lỗi rõ ràng, **không** ghi dòng mồ côi | Test HTTP | ✅ |
| F3‑06 | L3 | R3 `reopen` hai lần cùng một `episodeId` | Cho phép, nhưng bản hợp nhất vẫn xác định (dòng sau thắng) | Test HTTP + đọc lại | ✅ |
| F3‑07 | L3 | R3 cần quyền gì | Quyền **ghi**, không phải `fleet:read`; thiếu → 403 | Test HTTP | ✅ |
| F3‑08 | L4 | Màn hình lần lỗi đã `reopen` | Hiện là **đã mở lại**, kèm lý do; không xoá dấu vết bản cũ | happy-dom | ✅ |
| F3‑09 | L1 | **R2** gửi lại cùng `barCodeID` với file **khác nội dung** | Phát hiện đổi nội dung, cảnh báo; **không** đổi mã lặng lẽ | vitest | ✅ |
| F3‑10 | L0 | R2 tải dở dang (mất giữa chừng) rồi máy hỏi lại `fileStart>0` | Broker trả đúng phần còn lại; ghép lại khớp hash | Script ghép | 🟡 |
| F3‑11 | L0 | R2 máy hỏi lại **từ đầu** sau khi đã `data/ack` | Broker trả lại trọn file, không từ chối | broker.log | 🟡 |
| F3‑12 | L5 | R2 máy nhận **cùng** `barCodeID` lần thứ hai | Ghi lại máy **nhận đè** hay **từ chối trùng** — kết quả nào cũng là phát hiện | HMI + log | 🔴 |
| F3‑13 | L5 | R2 sau khi mẫu đã thêu xong: gửi lại thêu tiếp | Ghi lại hành vi thật | HMI + log | 🔴 |
| F3‑14 | L5 | R1 máy hết lỗi thật → dashboard đóng lần lỗi trong ≤ 5 giây | Đối chiếu giờ HMI với giờ dashboard | Sổ ca | 🔴 |
| F3‑15 | L5 | Mini mất điện giữa lần lỗi, bật lại | Lần lỗi cũ ghi `dong-bang-khoi-dong-lai`; máy tự nối lại ≤ ~5 giây | broker.log + `.jsonl` | 🔴 |

### 4.4 Xuyên suốt — không thuộc nhóm nào nhưng chặn cả ba

| ID | Tầng | Ca test | Kỳ vọng | Chạy được? |
| --- | --- | --- | --- | --- |
| X‑01 | — | Không file xuất ra nào chứa hằng 16 ký tự KEY/IV | Cổng quét hằng, đỏ nếu lọt | ✅ |
| X‑02 | — | `catalog.json` giữ `<redacted:name-only>` cho `secret[]`/`encode[]` | Không giá trị thật | ✅ |
| X‑03 | — | `bridge/` ≡ `deploy-mini/bridge/` | Lệch 1 byte → đỏ, báo tên file | ✅ |
| X‑04 | — | **Repo trên Mac Mini và repo máy chính đã tách nhánh** — HEAD khác nhau | Phải hợp nhất trước khi tin bất kỳ số nào | ✅ |
| X‑05 | — | `broker.py` `py_compile` exit 0 + diff với bản đang chạy **chỉ có dòng thêm** | Cổng trước mọi lần triển khai | ✅ |
| X‑06 | — | Token RedThread không lọt vào log/audit/catalog | Quét chuỗi | ✅ |

### 4.5 Đếm lại

| Nhóm | ✅ hôm nay | 🟡 cần máy nối | 🔴 cần người/ca thật | Tổng |
| --- | ---: | ---: | ---: | ---: |
| F1 — đẩy mẫu | 14 | 7 | 7 | **28** |
| F2 — báo lỗi + downtime | 23 | 0 | 4 | **27** |
| F3 — mở lại | 9 | 2 | 4 | **15** |
| X — xuyên suốt | 6 | 0 | 0 | **6** |
| **Tổng** | **52** | **9** | **15** | **76** |

Đọc bảng này đúng cách: **52 ca xanh không chứng minh hệ thống chạy được với máy thật.** Chúng
chứng minh phần ta viết là đúng. Phần còn lại chỉ có xưởng mới trả lời được.

---

## 5. Ma trận chặn — đọc từ trên xuống

```
F1-22 (máy tự gửi query)  ──chặn──▶ F1-23 ──▶ F1-24 (T_truyền) ──▶ F1-25/26
        ▲                                          ▲
        └── F1-27 (C43/C45/C46) ─── F1-28 (màn hình mã vạch) ──┘
                     [cả hai cần người ở xưởng]

F2-24 (lỗi thật)  ──chặn──▶ F2-25 (nhánh fault) ──▶ F2-26/27 ──▶ F3-14
                                     │
                                     └── và chặn phần lớn F2 tầng L4 chạy với dữ liệu THẬT
                                         (chạy với dữ liệu dựng thì xanh được ngay)

X-04 (hai repo lệch nhau) ──chặn──▶ mọi con số báo cáo từ nay
```

**Hai nút thắt, cả hai đều cần người ở xưởng: `F1‑22` và `F2‑24`.** Không nút nào mua được bằng
thêm code. Nói thẳng ra thay vì lấp bằng dữ liệu giả.

---

## 6. Đồ nghề đo — đã có, đang chạy

| Công cụ | Ở đâu | Làm gì | Trạng thái |
| --- | --- | --- | --- |
| `hmi_watch.py` | Mini, `~/hmi_watch.py` → `~/dahao-gateway/hmi-watch.log` | Bắt mọi sự kiện nạp mẫu, mốc **mili-giây**, tự tính `t4→t6`, sống qua broker restart | **Đang chạy** |
| `push-cmd.txt` | `~/dahao-gateway/` | Kênh điều khiển thủ công: `browse` · `query <mã>` · `data <mã>` · `enumprobe` | Có |
| `catalog.json` + `enum-growth.csv` | `~/dahao-gateway/` | Đường cong khám phá field/state | Đang chạy |
| `scripts/duong-cong.mjs` | repo | Đọc CSV → bảng "field thứ N lộ ra phút thứ mấy" | Có |
| `broker.log` / `state.log` | `~/dahao-gateway/` | Nhật ký thô | Có |
| **Chưa có** | — | Đồ đo `T_chuẩn bị` (`t0→t2`) đầu RedThread | **Phải viết** (F1‑12) |
| **Chưa có** | — | Script ghép mảnh `pattern/data` rồi so hash (F1‑19, F3‑10) | **Phải viết** |

---

## 7. Cố ý KHÔNG test

- **Không mock máy A15** để làm F1‑22 → F1‑26 xanh. Chúng phải đỏ cho tới khi máy thật trả lời.
  Một bộ test xanh cho luồng chưa từng chạy là thứ nguy hiểm nhất tài liệu này có thể đẻ ra.
- **Không test đường xoá file trên máy.** Giao thức emCAD **không có topic xoá** (đã grep đủ
  danh sách topic). Không có tính năng thì không có ca test — và cũng đừng hứa với xưởng.
- **Không test webhook RedThread.** Subscription duy nhất là `notificationAdded`; muốn biết đã
  quét thì phải **poll**. Test cho webhook là test cho thứ không tồn tại.
- **Không dựng bảng tra "EC12 = đứt chỉ".** Cấm rõ ở `docs/adapter-contract.md:200-203`.
- **Không test lại đường mạng** đã chốt ở `PRD_NGUON_DU_LIEU_MAY_THEU.md`.
- **Không đặt ngưỡng coverage chặn merge.**

---

## 8. Điều kiện DỪNG

1. **Không báo con số `T_truyền` khi F1‑24 chưa chạy.** Ước lượng từ cỡ file **không phải** kết quả đo.
2. **Không suy ra `fault`** khi F2‑24 chưa có dữ liệu ca thật. Dừng và báo.
3. **Không gây lỗi cố ý** trên máy, không đẩy gói vào máy đang chạy để ép lộ trạng thái.
4. **Không sửa ba trường `observedAt`/`status`/`job`** của frame đang chạy production.
5. **Không sửa dòng đã ghi** trong sổ lần lỗi. Đụng vào là mất tính bằng chứng.
6. **Không đổi hợp đồng `contract.mjs`** để tiện làm F1/F2/F3. Phải đổi ⇒ thiết kế sai ⇒ dừng, báo.
7. **Không viết mã RedThread trước khi X‑04 xong.** Viết vào nhánh nào cũng là viết vào nhánh sai.
8. **Không đổi `barCodeID`** để lách chuyện máy từ chối mẫu trùng (F3‑12). Lách là che sự thật.
