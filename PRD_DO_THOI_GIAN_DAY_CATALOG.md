# PRD — Đo bao lâu thì catalog telemetry A15 "đầy"

[PRD]

Tài liệu này đứng sau `plans/001-a15-telemetry-enumerator.md` (đã DONE, enumerator đang chạy
thật trên broker production từ 21/08/2026). Plan 001 trả lời *máy nói ra được những gì*.
Tài liệu này trả lời câu tiếp theo: **phải nghe bao lâu thì mới nghe hết?**

## 0. Câu hỏi và câu trả lời ngắn

Câu hỏi: *thu thập dữ liệu tự động thì mất bao lâu để nó "đầy file"?*

Trả lời ngắn, trước khi vào chi tiết:

- **"Đầy" không phải là đầy đĩa.** `catalog.json` và `enum.log` bị **ghi đè** mỗi 30 giây
  (`open(path,'w')`, broker.py:615 và :637). Kích thước của chúng bị chặn trên bởi **số field
  khác nhau**, không bởi thời gian chạy. Chạy 1 giờ hay 1 tháng, file vẫn cỡ vài KB.
- **"Đầy" là bão hoà độ phủ**: tới lúc nghe thêm cũng không lộ thêm field/state/topic mới.
- **Hiện tại chưa đo được con số đó**, vì ba lỗ hổng đo lường ở mục 2. Không phải thiếu thời
  gian chạy — thiếu **đồng hồ**.
- Sau khi vá ba lỗ hổng đó, con số sẽ có hai phần tách bạch: bão hoà lúc **máy nhàn rỗi**
  (dự kiến phút, đã gần chạm) và bão hoà **toàn bộ** (cần một ca chạy thật + ít nhất một lần
  đứt chỉ — tính bằng ca, không tính bằng phút).

---

## 1. Hiện trạng đo được (không suy đoán)

### 1.1 Enumerator đang ghi cái gì

| Mục | Cấu trúc | Có mốc thời gian? |
| --- | --- | --- |
| `topics{}` | `dir, count, firstSeen, lastSeen, decodable, minLen, maxLen` | **Có** — `firstSeen` + `lastSeen` |
| `fields{}` | `types, example, count, states, topics, numMin, numMax, redacted` | **Không** |
| `states{}` | `count, keys[]` | **Không** |
| `connect{}` | `clientId, …` | **Không** |

Nguồn: `deploy-mini/broker.py:568-610`.

### 1.2 Hai lần chạy đã có

| Lần chạy | Nơi | Thời lượng | Kết quả |
| --- | --- | --- | --- |
| Production, 21/08/2026 | Mac Mini, `~/dahao-gateway/broker.py` | ~4 phút, máy **nhàn rỗi** | 3 topic (`auth/encode`, `auth/login`, `state`), 2 state (`15`=idle, `-1`=init), **13 field** |
| Bản trong repo, `deploy-mini/catalog.json` | máy dev | — | 1 topic, **0 state**, 6 field |

**Đính chính (22/08):** lần thứ hai **không phải dữ liệu máy**. Nó là artifact do chính
`tests/test_enumerator.py` ghi ra: nội dung khớp từng field với fixture của test [3]
(`secret[]`, `encode[]`, `machineName='A15'`, `header.mesgNo='1'`, `maxLen=172`). Bộ test gọi
`catalog_dump()` trước khi chuyển hướng đường ghi, nên nó ghi thẳng vào đường mặc định của
deploy-mini. Đã sửa (mục 4, A4) — test nay chuyển hướng ngay từ đầu file và có assert [10]
canh chính bất biến đó. `install.sh:25` chỉ `cp broker.py`, nên artifact này **chưa bao giờ**
được ship lên Mini.

### 1.3 Ràng buộc từ giao thức (đã chốt ở plan 001, không kiểm lại)

emCAD **không có topic nào để server hỏi máy**. Mọi thông điệp server→máy là reply/ack.
Vì vậy tốc độ khám phá field **không điều khiển được từ phía ta** — nó bằng đúng tốc độ máy
tự phát. Hệ quả trực tiếp: bài đo này là **đo thụ động**, không có nút "tua nhanh".

---

## 2. Ba lỗ hổng chặn phép đo

### 2.1 Field và state không có `firstSeen` → không vẽ được đường cong khám phá

Có `count` nhưng không có mốc thời điểm xuất hiện lần đầu. Từ một ảnh chụp `catalog.json`
không thể trả lời "field thứ 13 xuất hiện ở phút thứ mấy". Đây là lỗ hổng **chặn** — không vá
thì mọi con số về sau chỉ là ước lượng bằng mắt.

### 2.2 `_enum` chỉ nằm trong RAM → khởi động lại là mất sạch

`_enum` khởi tạo rỗng ở broker.py:530 và không bao giờ đọc lại `catalog.json` lúc start.
Một lần `launchctl kickstart`, một lần mất điện Mini, một lần swap file — độ phủ về 0.
Một phép đo kéo dài nhiều ca **không thể sống sót** qua ràng buộc này. Đây là lỗ hổng suy ra
từ code, không phải từ quan sát: bản catalog trong repo từng bị hiểu nhầm là bằng chứng của
nó (xem đính chính mục 1.2), nhưng bản thân đoạn code thì vẫn đúng như mô tả.

### 2.3 `enum.log` bị ghi đè → không có lịch sử

Mỗi 30 giây ghi đè toàn bộ. Không tồn tại chuỗi thời gian nào để hồi cứu. Cần một file
**chỉ ghi thêm**, tách khỏi hai file ảnh chụp hiện có.

---

## 3. Định nghĩa "đầy" (phải chốt trước khi đo, nếu không sẽ tự lừa mình)

**Bão hoà theo state, không bão hoà toàn cục.** Máy nhàn rỗi sẽ bão hoà rất nhanh và tạo ra
một **đáy giả**: 20 phút không thấy field mới không có nghĩa là đã hết field, mà chỉ có nghĩa
là máy chưa chạy. Định nghĩa dùng cho tài liệu này:

> Catalog gọi là **đầy với state S** khi đã quan sát state S liên tục qua **K = 20 chu kỳ báo
> cáo (≈10 phút)** mà không sinh thêm field mới nào thuộc S.
>
> Catalog gọi là **đầy toàn bộ** khi đầy với **mọi state trong tập mục tiêu** ở mục 3.1.

### 3.1 Tập state mục tiêu

| State | Đã bắt được? | Cách kích hoạt |
| --- | --- | --- |
| `-1` init | Có (21/08) | Máy khởi động / nối lại |
| `15` idle | Có (21/08) | Mặc định |
| running | **Chưa** | Ca sản xuất thật |
| đứt chỉ / break | **Chưa** | Xảy ra tự nhiên trong ca; **không cố ý gây ra** |
| hết ca / dừng | **Chưa** | Cuối ca |

Ba dòng cuối là lý do con số cuối cùng **tính bằng ca**. Không có ca chạy thì không có
`curStitch`, `patternStitch`, `patternName` khác 0/rỗng — đúng như phần "còn nợ" của slice 001
đã ghi.

### 3.2 Cái không được tính là "đầy"

- Không tính bằng dung lượng file (mục 5).
- Không tính bằng số field đạt một ngưỡng định trước — ta không biết trước tổng số field.
- Không tính khi mới chỉ phủ state idle.

---

## 4. Việc phải làm

Nguyên tắc giữ nguyên như slice 001: **thuần cộng thêm**. Không sửa, không xoá dòng nào của
luồng `state → bridge → dashboard`. Mọi thay đổi nằm trong khối enumerator.

| # | Việc | File | Chặn ai |
| --- | --- | --- | --- |
| A1 | Thêm `firstSeen` cho mỗi field và mỗi state (gán lúc `setdefault`, y hệt cách topic đang làm) | `deploy-mini/broker.py` | A4 |
| A2 | Lúc start, nếu `catalog.json` tồn tại thì nạp vào `_enum` và hợp nhất; giữ `startedAt` cũ, thêm `sessions[]` ghi từng lần chạy | `deploy-mini/broker.py` | A4 |
| A3 | Ghi thêm `enum-growth.csv` **chỉ ghi thêm**, mỗi chu kỳ một dòng: `ts,nTopics,nStates,nFields,newFieldsThisCycle` | `deploy-mini/broker.py` | A4 |
| A4 | Self-test offline cho A1–A3 (mở rộng `tests/test_enumerator.py`, vẫn không cần máy/mạng/người) | `deploy-mini/tests/test_enumerator.py` | Triển khai |

**Tình trạng 22/08/2026: A1–A4 ĐÃ XONG.** `broker.py` +42 dòng, `py_compile` exit 0,
self-test 10/10 pass offline. B1–B3 vẫn chờ ca sản xuất thật.
| B1 | Sổ ca: người vận hành ghi mốc giờ thật — vào ca, nạp mẫu, bắt đầu chạy, mỗi lần đứt chỉ, tan ca | `docs/qa/` | Quy kết đường cong |
| B2 | Chạy đo qua **ít nhất một ca sản xuất trọn vẹn**, tốt nhất hai ca liên tiếp | Mini | Kết luận |
| B3 | Script đọc `enum-growth.csv` + sổ ca, xuất bảng "field thứ N lộ ra ở phút thứ mấy, dưới state nào" | `scripts/` | Báo cáo |

A1–A4 làm được ngay, không cần máy, không cần người ở xưởng. B1–B3 phải đợi ca thật.

### 4.1 Bất biến bí mật — giữ nguyên, không nới

`body.secret[]` và `body.encode[]` vẫn chỉ ghi `<redacted:name-only>`. `enum-growth.csv` **chỉ
chứa số đếm**, không chứa tên field, không chứa giá trị — nên nó không mở thêm bề mặt rò rỉ nào.
Cổng kiểm tra cũ giữ nguyên: quét hằng 16 ký tự (KEY/IV) trong mọi file xuất ra.

---

## 5. Dung lượng đĩa — trả lời phần "đầy file" theo nghĩa đen

| File | Cơ chế | Cỡ |
| --- | --- | --- |
| `catalog.json` | ghi đè | ~400 B/field (đo sau A1: 6 field = 2421 B). 13 field ≈ 5 KB; kể cả 60 field vẫn < 25 KB |
| `enum.log` | ghi đè | cùng bậc, vài KB |
| `enum-growth.csv` (mới, A3) | **chỉ ghi thêm** | ~30 B/dòng × 2 dòng/phút ≈ **86 KB/ngày**, ≈ 2,6 MB/tháng |

Kết luận: **không có kịch bản nào đầy đĩa.** File duy nhất tăng theo thời gian là CSV mới, và
nó tăng ~2,6 MB/tháng trên một Mac Mini. Nếu muốn chặn cứng thì xoay vòng theo tháng — nhưng
đó là tuỳ chọn, không phải yêu cầu.

### B3 đã xong (22/08) — và nó đã trả lời trên dữ liệu thật

`scripts/lib/growth-curve.mjs` + `scripts/duong-cong.mjs` đọc `enum-growth.csv` thành đường cong.
Chạy trên chính Mini, sau 316 chu kỳ (~158 phút):

> Bão hoà sau 316 chu kỳ sạch, **NHƯNG mới thấy 2 trạng thái — đây là đáy giả của máy nhàn rỗi,
> không phải đã hết field.**

Đúng cái bẫy mục 3.2 cảnh báo, và công cụ tự gọi tên nó ra thay vì báo "đã đầy". Còn lại B1/B2
vẫn chờ một ca sản xuất thật.

---

## 6. Kết quả mong đợi của phép đo

Phép đo phải xuất ra đúng bốn con số, kèm bằng chứng:

1. **t_idle** — bao lâu để bão hoà khi máy nhàn rỗi. Dữ liệu 21/08 gợi ý **cỡ phút** (13 field
   trong ~4 phút, phần lớn đến từ một lần handshake duy nhất). Cần xác nhận bằng K chu kỳ sạch.
2. **t_ca** — bao lâu kể từ lúc máy bắt đầu chạy tới khi bão hoà state running.
3. **n_ca** — cần bao nhiêu ca để chạm được các state hiếm (đứt chỉ). Không kiểm soát được;
   báo cáo trung thực là "chưa gặp sau X ca" nếu chưa gặp.
4. **N_total** — tổng số field cuối cùng, chia theo state.

Báo cáo phải nói rõ cái gì **chưa gặp**. Một catalog im lặng về đứt chỉ và một catalog đã
chứng minh máy không báo đứt chỉ là hai thứ khác nhau; đường cong khám phá là thứ phân biệt được.

---

## 7. Điều kiện DỪNG

- **Không** cố ý gây đứt chỉ, không bơm gói vào máy đang chạy để "ép" lộ state. `enumprobe`
  vẫn nằm trong diện chờ máy rảnh + có người đồng ý, đúng như slice 001 đã ghi.
- **Không** sửa luồng `state → bridge → dashboard`. Nếu một thay đổi trong A1–A3 buộc phải chạm
  vào luồng đó thì dừng lại và báo, không tự quyết.
- **Không** kết luận "đã đầy" chỉ dựa trên dữ liệu idle.
