# PRD — Lịch sử lỗi máy: lỗi gì, bắt đầu lúc nào, sửa xong lúc nào

[PRD]

Tài liệu này trả lời một yêu cầu của xưởng: *"tất cả lỗi mà máy có thể nhận diện được, và máy
đó lỗi từ lúc sản xuất tới lúc sửa được là bao lâu."*

Nó đứng cạnh `PRD_DO_THOI_GIAN_DAY_CATALOG.md` (đo enumerator bao lâu thì bão hoà) và
`PRD_TEST_TOAN_BO.md` (kiểm thử). Nó **phụ thuộc** vào cái thứ nhất: danh sách lỗi không viết
ra được, nó phải được máy tự khai dần.

## 0. Câu trả lời ngắn

- **Đường báo lỗi trên dashboard đã xây xong và đang là code chết.** Cảnh báo `state:fault`,
  tone đỏ bảng andon, ô KPI `fault` — không thứ nào có thể kích hoạt với con A15 thật, vì
  `deploy-mini/broker.py` vứt thông tin lỗi trước khi gửi đi.
- **Hợp đồng dữ liệu thì đã sẵn sàng từ lâu.** `contract.mjs:16` đã có `'fault'` trong enum
  trạng thái, `contract.mjs:285-287` đã nhận mảng `events` với mã lỗi. **Không phải sửa hợp
  đồng.** Chỉ cần broker thôi vứt dữ liệu là cả đường báo lỗi sống dậy.
- **Nhưng "sửa được lúc nào" thì chưa có gì lưu.** Không nơi nào trong hệ thống giữ một lần
  lỗi đã kết thúc. `statusSince` chỉ giữ mốc trạng thái *hiện tại*, và cố ý không ghi xuống đĩa.
- **Danh sách lỗi không chép được từ sổ tay** — đã tìm cả 5 file text trong `docs/so-tay-dahao/`:
  không có phụ lục mã lỗi. Nó phải do enumerator khám phá dần qua ca chạy thật.
- Quyết định khó nhất của tài liệu này — *có ghi lịch sử lỗi xuống đĩa không* — được trả lời ở
  mục 3, và câu trả lời **không** mâu thuẫn với quyết định "không ghi `statusSince`" đang có.

---

## 1. Hiện trạng đo được (không suy đoán)

### 1.1 Thông tin lỗi bị vứt ngay trên Mac Mini

`deploy-mini/broker.py:189` — `build_frame()` gửi sang bridge đúng ba thứ:

```python
return {'observedAt':_iso(),'status':state_to_status(dev,body),
        'job':{'fileName':..., 'currentStitch':..., 'totalStitches':...}}
```

Không mã lỗi. Không `events`. Không `stateID`. Không `wstrStatusDesc`.

`deploy-mini/broker.py:181` — `state_to_status()` chỉ có thể trả về **`running` / `stopped` /
`unknown`**. Nó đọc `state` nhưng **chỉ so với `-1`**; mọi giá trị khác bị bỏ, rồi đoán trạng
thái theo việc `curStitch` có tăng hay không. **Không có nhánh nào trả `fault`.**

### 1.2 Hợp đồng đã sẵn sàng — đây là tin tốt nhất trong tài liệu này

| Thứ cần | Hợp đồng đã có chưa | Bằng chứng |
| --- | --- | --- |
| Trạng thái `fault` | **Có** | `bridge/lib/contract.mjs:16` `operationalStatuses = [... 'fault' ...]`, kiểm ở `:283` |
| Mảng sự kiện có mã lỗi | **Có**, tối đa 200 mục/lần | `contract.mjs:285-287` |
| Nguồn sự kiện | **Có**, `['controller','sensor']` | `contract.mjs:234` |
| Số kim kèm lỗi | **Có**, 0–64 | `contract.mjs:241` |
| Bridge dựng cảnh báo từ sự kiện | **Có** | `bridge/lib/alerts.mjs:36-49` |
| Dashboard hiện thẻ lỗi + thời lượng | **Có** | `src/lib/alerts.ts:60-72` |

Nghĩa là **L1 gần như không phải viết gì**. Toàn bộ chi phí nằm ở L0 (broker) và L2 (lịch sử).

### 1.3 Không nơi nào giữ một lần lỗi đã kết thúc

`bridge/lib/bridge-service.mjs:69` — `this.statusSince = new Map()`, trong RAM.
`:563-568` — `trackStatusChange` **ghi đè** khi trạng thái đổi; mốc cũ mất luôn.
`:560-561` — ghi rõ nó **không sống qua lần khởi động lại** bridge.

Nên hôm nay hệ thống trả lời được "đang lỗi bao lâu rồi", nhưng **không** trả lời được
"lần lỗi hôm qua kéo dài bao lâu" — dữ liệu đó chưa từng tồn tại.

### 1.4 Với con A15, `offline` không bao giờ xảy ra

`bridge/lib/bridge-service.mjs:697-702` — máy `dial-in` **không bao giờ bị thăm dò**
("*`dial-in` machines are never touched at all — they call us*"). Nên `reachable` không bao
giờ thành `false`, và `src/lib/freshness.ts:80-82` trả về **`unknown`**, không phải `offline`.
Thêm nữa `freshness.ts:64-71` ép **mọi** máy vừa có số gõ tay về `unknown`.

Hệ quả bắt buộc phải nhớ khi làm L2: **mọi cảnh báo hay logic gắn vào nhánh `offline` là code
chết với chiếc máy duy nhất đang có ở xưởng.** Nhánh phải canh là `unknown`.

### 1.5 Danh sách lỗi không có sẵn ở đâu

- Sổ tay: đã tìm cả `BECS-A15_2018-01.txt`, `BECS-A15_2020-04_recovered-text.txt`,
  `BECS-A18-A58-A98.txt`, `BECS-A68-A88_2021-01.txt` — **không có phụ lục mã lỗi**, chỉ có
  bảng icon HMI và mục mô tả đứt chỉ.
- `plans/001-a15-telemetry-enumerator.md:165-172` — thân bản tin `state` được ghi nhận có
  `stateID` và **`wstrStatusDesc`** (chuỗi mô tả trạng thái bằng lời của chính máy), và ghi rõ
  *"một mã lỗi trong trạng thái lỗi"* là thứ chỉ lộ ra khi máy ở trạng thái đó.
- `deploy-mini/catalog.json` hiện `"states": {}` — chưa bắt được trạng thái nào ngoài lúc idle.

**Nên danh sách lỗi = union các trạng thái enumerator bắt được qua ca thật.** Đó chính là thứ
`PRD_DO_THOI_GIAN_DAY_CATALOG.md` đang đo, và là lý do nó cần một ca sản xuất.

---

## 2. Ba tầng, thứ tự bắt buộc

| Tầng | Việc | Vì sao không đảo thứ tự được |
| --- | --- | --- |
| **L0** | `broker.py` chuyển tiếp thêm: `status:'fault'` khi máy báo lỗi, `events[]` mang mã, và `stateID`/`wstrStatusDesc` nguyên văn | Không có L0 thì L1 và L2 không có dữ liệu nào để chạy |
| **L1** | (gần như không code) đường báo lỗi sẵn có sống dậy; chỉnh chỗ nào còn hở | Hợp đồng đã nhận sẵn — xem 1.2 |
| **L2** | Lịch sử lần lỗi: bắt đầu → kết thúc → thời lượng, lưu lại, hiện ra | Đây mới là "từ lúc lỗi tới lúc sửa được là bao lâu" |

### 2.0 L0 đi bằng đường nào — đã đo, không đoán (22/08)

Câu hỏi phải trả lời trước khi viết một dòng: **thêm trường vào frame thì bridge có nhận không?**
Đã thử thật bằng chính `normalizeTelemetry`:

| Thử | Kết quả |
| --- | --- |
| Frame hiện tại | Nhận |
| Frame + khoá lạ ở cấp trên cùng (`stateID`, `wstrStatusDesc`) | Nhận, nhưng **bỏ qua lặng lẽ** — dữ liệu rơi ở bridge, gửi cũng như không |
| Frame `status:'fault'` + `events[]` | **Nhận, chạy thẳng** — `status.value = fault`, event nguyên vẹn |

Hợp đồng **không có chỗ nào** chứa lời máy ở tầng `status`: đó là enum cứng 5 giá trị
(`contract.mjs:283`), không có trường mô tả đi kèm. Nhưng `events[].code` (≤40 ký tự) và
`events[].message` (≤400) là **văn bản tự do và tới màn hình nguyên văn**.

**Kết luận:** lời máy đi bằng `events[]`, **không đổi hợp đồng một dòng nào**. Điều kiện DỪNG số
4 ("phải đổi hợp đồng thì dừng") không bị chạm tới.

Mức của sự kiện **cố ý là `info`**: `bridge/lib/alerts.mjs:37` bỏ qua đúng mức này. Máy đẩy nhịp
`state` liên tục; phong lên `warning` là biến mỗi nhịp tim thành một cảnh báo, mà cảnh báo nào
cũng kêu thì không cảnh báo nào được đọc. Nâng mức là việc của E3, sau khi biết trạng thái nào
thật sự là lỗi.

### 2.1 L0 — nguyên tắc bất di bất dịch

Giữ đúng kỷ luật của slice 001: **thuần cộng thêm**. Ba trường `observedAt` / `status` / `job`
đang chạy production phải giữ **nguyên từng byte** cho các trường hợp hiện có. Chỉ:

- thêm nhánh trả `'fault'` khi máy thật sự báo lỗi (chưa biết điều kiện — xem 5.1, đây là chỗ
  **chặn**, phải có dữ liệu ca thật trước);
- thêm `events: [...]` khi có mã;
- thêm các trường máy tự khai (`stateID`, `wstrStatusDesc`) **nguyên văn**, không dịch.

Nếu không suy được `fault` một cách trung thực từ bản tin, **không được suy**. Gửi
`unknown` kèm `wstrStatusDesc` nguyên văn vẫn tốt hơn một `fault` đoán mò.

---

## 3. Quyết định khó: có ghi lịch sử lỗi xuống đĩa không?

**Có — nhưng chỉ ghi lần lỗi ĐÃ ĐÓNG.**

Nghe như mâu thuẫn với quyết định đang có ở `bridge-service.mjs:560-561` (*không ghi
`statusSince` xuống đĩa*). Không mâu thuẫn, vì hai thứ khác bản chất:

| | `statusSince` | Lần lỗi đã đóng |
| --- | --- | --- |
| Bản chất | **Đồng hồ đang chạy** | **Sự việc đã xong** |
| Đọc lại sau 3 ngày | Sai — "máy đang lỗi từ thứ Sáu" là lời nói dối nếu bridge nghỉ cuối tuần | Đúng — "thứ Sáu máy lỗi 42 phút" vẫn đúng mãi mãi |
| Cờ `approximate` | Chính là cách nói thật về việc không ghi | Không cần: mốc đầu và mốc cuối đều đã quan sát được |

Đã có sẵn tiền lệ đúng khuôn trong repo: `bridge/lib/audit.mjs:5-16` — **chỉ ghi thêm, mỗi
dòng một JSON**, xoay vòng khi quá cỡ, và **retention mặc định tắt** với lý do ghi rõ: *"nhật
ký mà tự nó rụng bớt thì không còn là bằng chứng"*. Lịch sử lỗi là cùng loại bằng chứng đó.

**Chốt:** một file `bridge-data/loi-<site>.jsonl` chỉ-ghi-thêm, theo đúng khuôn `AuditLog`
(xoay vòng theo cỡ, retention tắt mặc định, mỗi lần xoá cũng được ghi lại). Đồng hồ đang chạy
vẫn ở RAM như cũ — **không đụng `statusSince`.**

---

## 4. Định nghĩa (chốt trước, nếu không sẽ tự lừa mình)

### 4.1 Một "lần lỗi" bắt đầu khi nào

Khi controller báo `status === 'fault'` lần đầu sau một trạng thái khác. Mốc là `observedAt`
của bản tin đó — đồng hồ của controller, không phải đồng hồ bridge (giữ đúng cách
`trackStatusChange` đang làm ở `bridge-service.mjs:563-568`).

### 4.2 "Sửa được" là gì — và ba trường hợp KHÔNG được gọi là sửa được

Lần lỗi **đóng** khi controller báo một trạng thái không phải `fault`.

Ba trường hợp phải ghi là **"chưa biết"**, tuyệt đối không ghi là đã sửa:

1. **Mất tín hiệu.** Máy trôi sang `unknown` (xem 1.4 — với A15 đây là đường phổ biến, không
   phải ngoại lệ). Ta không nhìn thấy máy nữa; im lặng không phải là hết lỗi.
2. **Có người gõ tay.** `freshness.ts:64-71` ép về `unknown`, và `bridge-service.mjs:463-472`
   cố ý **không** gọi `trackStatusChange` cho số gõ tay. Một người gõ "đang chạy" không phải
   là controller nói đã hết lỗi.
3. **Bridge khởi động lại giữa chừng.** Lần lỗi đang mở phải được ghi là *đóng bằng khởi động
   lại, không quan sát được lúc kết thúc*.

Ba trường hợp này phải hiện ra thành chữ trên màn hình, không được lặng lẽ tính vào thời lượng.

### 4.3 "Từ lúc sản xuất" nghĩa là gì

Yêu cầu nói *"từ lúc sản xuất tới lúc sửa được"*. Con số báo cáo là **thời lượng lần lỗi**
(4.1 → 4.2). Nếu muốn thêm "mất bao nhiêu sản lượng", cần đối chiếu với ca sản xuất trong
`bridge/lib/shifts.mjs` — **để sau**, không nằm trong lô này.

---

## 5. Việc phải làm

| # | Việc | Tầng | Chặn bởi |
| --- | --- | --- | --- |
| E1 | Enumerator bắt được trạng thái lỗi thật của máy: `state`, `stateID`, `wstrStatusDesc` khi máy lỗi | — | **Một ca chạy thật** (đang nợ ở PRD bão hoà) |
| E2 | `broker.py`: chuyển lời máy (`wstrStatusDesc` + `stateID`/`state`) sang bridge qua `events[]`, mức `info`, nguyên văn | L0 | — **✅ XONG 22/08** |
| E3 | `broker.py`: nhánh trả `'fault'` + `events[]` | L0 | **E1** — chưa biết điều kiện thì chưa được đoán |
| E4 | Bridge: ghi lần lỗi vào `bridge-data/loi-*.jsonl` theo khuôn `AuditLog`; ba trường hợp "chưa biết" ở 4.2 phải phân biệt được | L2 | E2 |
| E5 | API đọc lịch sử lỗi theo máy + khoảng thời gian, quyền `fleet:read` | L2 | E4 |
| E6 | Màn hình: bảng lần lỗi của một máy (lỗi gì · từ · đến · kéo dài), và tổng thời gian lỗi trong ca | L2 | E5 |
| E7 | Danh sách "tất cả lỗi máy nhận diện được": dựng từ union đã quan sát, in **nguyên văn** lời máy | L2 | E1 |
| E8 | Cảnh báo giữ dấu vết lỗi khi máy trôi sang `unknown` (KHÔNG phải `offline` — xem 1.4) | L1 | E3 |

**E2 đã xong (22/08).** `deploy-mini/broker.py`: thêm `controller_state_event()`, `build_frame()`
gắn thêm `events[]` khi máy tự nói — ba khoá cũ giữ nguyên từng byte, máy không nói thì **không
nói hộ** (thiếu mô tả hoặc thiếu số hiệu ⇒ không sinh sự kiện). Kiểm: `deploy-mini/tests/test_frame.py`
7/7 offline, và `scripts/broker-frame.test.mjs` chạy **code Python thật** rồi đẩy frame qua
**hợp đồng JS thật** 5/5. `npm run verify` xanh: 53 file / 825 test.

Bài test nối Python↔JS đó đã bắt được một lỗi thật ngay lần chạy đầu: `id` sự kiện dài 106 ký tự,
vượt trần 80 của `contract.mjs:236` ⇒ bridge sẽ **từ chối cả gói**. Hai bên test riêng đều xanh
trong khi thực địa hỏng, và một gói bị từ chối trên Mac Mini thì không ai nhìn thấy. Đã vá.

Phần còn lại: E1 chặn E3, và E3 chặn phần lớn phần còn lại — **không có ca chạy thật thì
lô này không đi hết được**, và đó là sự thật phải nói ra chứ không phải thứ để lấp bằng dữ liệu giả.

---

## 6. Cổng

`npm run verify` (nay đã gồm self-test Python) + hai điều kiện riêng của lô này:

- `deploy-mini/broker.py`: `python3 -m py_compile` exit 0, self-test offline pass, và **diff với
  bản đang chạy chỉ có dòng thêm** cho ba trường cũ.
- `scripts/deploy-mini-sync.test.mjs` xanh — mọi thay đổi bridge phải được đồng bộ sang bản sao.

---

## 7. Cố ý KHÔNG làm

- **Không dựng bảng tra "EC12 = đứt chỉ".** `docs/adapter-contract.md:200-203` cấm rõ: dashboard
  hiện **nguyên văn** mã và mô tả nguồn gửi lên; bảng tra cần tài liệu firmware, chưa có thì
  đoán nghĩa mã là bịa dữ liệu máy dưới dạng tệ nhất — thợ sẽ mở máy tìm một lỗi không ai báo.
- **Không ghép mã lỗi vào thẻ `state:fault` như một danh sách trơ.** Không có ràng buộc thời
  gian nào giữa `telemetry.events` và mốc vào trạng thái lỗi; in kèm là ngầm khẳng định nhân
  quả mà dữ liệu không đỡ nổi. Muốn nhắc mã thì phải lọc theo `occurredAt >= statusSince.at`
  và nói rõ là "kèm theo", không phải "nguyên nhân".
- **Không cho bridge tự sinh cảnh báo lỗi theo `status`.** Cảnh báo bridge giữ thì xác nhận
  được, sẽ đẻ ra hai dòng cho một sự việc — một dòng tắt được, một dòng không.
- **Không ghi `statusSince` xuống đĩa** (mục 3).
- **Không đẩy cảnh báo ra Zalo/chuông/Notification API** trong lô này. Cả ba là loại trừ đã ghi
  ở `PRD_UI_MONITORING.md` và `useAlertWatch.ts`.
- **Không thêm ngưỡng `faultEscalationMinutes` riêng.** Dùng lại ngưỡng dừng lâu của xưởng và
  nói ra là dùng chung, cho tới khi xưởng thật sự cần hai ngưỡng.

---

## 8. Điều kiện DỪNG

- **Không suy ra `fault` khi chưa có dữ liệu ca thật.** Nếu tới bước E3 mà E1 chưa có, **dừng
  và báo** — một `fault` đoán mò đắt hơn nhiều so với không có tính năng.
- **Không đổi ba trường `observedAt`/`status`/`job` của frame hiện có.** Đụng vào là đụng đường
  đang chạy production.
- **Không gây lỗi cố ý trên máy** để lấy mẫu trạng thái lỗi. Chờ lỗi tự xảy ra trong ca.
- Nếu E4 buộc phải đổi `store.mjs` hay hợp đồng — **dừng và báo**. Theo thiết kế mục 3 thì
  không cần, và việc phải đổi là dấu hiệu thiết kế sai chứ không phải giấy phép sửa rộng ra.
