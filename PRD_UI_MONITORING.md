# PRD — Giao diện giám sát dashboard máy thêu Dahao

Tài liệu con của `PRD_CLAUDE_READONLY_FLEET.md`. Mọi ràng buộc của PRD gốc giữ nguyên hiệu lực:
chỉ đọc, không lệnh điều khiển, không truyền file thiết kế, không bịa dữ liệu, trường không đọc
được ghi đúng chuỗi `Chưa đọc được từ controller` (`UNREAD` trong `src/lib/format.ts`), màu không
bao giờ là kênh thông tin duy nhất. Tài liệu này chỉ đặc tả **cách bày dữ liệu đã có** và các
**số dẫn xuất phía dashboard**, không thêm kênh ghi nào tới controller.

Phạm vi code: `src/components/*.tsx`, `src/lib/*.ts`, một phần `bridge/lib/bridge-service.mjs`
(mục 12, dẫn xuất phía bridge). Không đổi hợp đồng adapter (`docs/adapter-contract.md`) trừ danh
sách "cần trường mới" ở mục 12.3 — danh sách đó là backlog chờ giao thức, không làm ở đợt này.

## 1. Ba người dùng, ba câu hỏi phải trả lời trong ≤ 3 giây

| Người dùng | Thiết bị | Câu hỏi số một | Màn hình phục vụ |
| --- | --- | --- | --- |
| Quản đốc | Tablet 1024, đi lại | Máy nào **dừng mà đáng lẽ phải chạy, dừng bao lâu rồi**; máy nào sắp xong để chuẩn bị khung | Tổng quan (chế độ "Cần xử lý"), Andon |
| Thợ vận hành | TV, đọc từ 5 m | Máy của tôi có cần người không | Andon |
| Chủ xưởng | Laptop, cuối ca | Hôm nay ra bao nhiêu mũi, bao nhiêu tiền, máy nào kéo tụt | Sản lượng |

Thứ tự ưu tiên khi xung đột bố cục: an toàn vận hành và truy vết > mạng yếu/quy mô > thẩm mỹ.

## 2. Quy tắc trình bày số dẫn xuất (chi phối mọi màn hình)

Đây là chỗ dễ vi phạm PRD gốc nhất: một con số dashboard tự tính đứng cạnh số máy báo sẽ bị đọc
là "máy nói thế". Năm quy tắc bắt buộc, áp dụng cho **mọi** số không đến trực tiếp từ một
`Reading`:

1. **Nhãn nguồn.** Số dẫn xuất luôn có tiền tố `≈` và một dòng phụ (hoặc `title`/tooltip trên
   desktop, dòng chữ nhỏ trên andon) ghi rõ công thức bằng lời:
   `Dashboard ước tính từ tốc độ hiện tại, không phải máy báo`. Không viết tắt dòng này thành
   icon đơn thuần.
2. **Không đóng băng.** Khi bất kỳ đầu vào nào của phép tính rơi vào `stale`/`offline`/`unknown`,
   con số dẫn xuất **biến mất** và thay bằng chuỗi giải thích (mục 11), không giữ giá trị cũ.
   Số máy báo thì ngược lại: giữ nguyên kèm timestamp — hành vi hiện tại của snapshot, phải giữ.
3. **Thiếu đầu vào ≠ chưa đọc được.** Trường máy báo thiếu → `Chưa đọc được từ controller`.
   Số dẫn xuất thiếu đầu vào → `Không tính được (thiếu <tên đầu vào>)`. Hai chuỗi này không được
   dùng lẫn.
4. **Timestamp của số dẫn xuất = timestamp cũ nhất trong các đầu vào.** In cạnh số ở panel chi
   tiết.
5. **Không trộn ô.** Một ô/khối chỉ chứa hoặc số máy báo hoặc số dẫn xuất. Ví dụ ô tiến độ:
   `18.240 / 46.453 mũi` (máy báo) và `≈ xong 15:42` (dẫn xuất) là hai dòng tách biệt, dòng dưới
   nhỏ hơn và có nhãn.

### 2.1 Danh mục số dẫn xuất và công thức

| Số | Công thức | Điều kiện hiển thị | Nhãn hiển thị |
| --- | --- | --- | --- |
| Tiến độ % | `currentStitch / totalStitches` | có cả hai trường | `62%`. **Bỏ kẹp trần 100%** trong `jobProgressPercent`: nếu > 100% in `Bộ đếm vượt tổng mũi (18.240/12.000) — kiểm tra tại máy` với tone cảnh báo, vì kẹp trần đang che lỗi bộ đếm |
| Giờ xong dự kiến (ETA) | `(totalStitches − currentStitch) / rpm` phút, cộng vào giờ hiện tại của site | `effectiveStatus === 'running'` **và** `connection.state === 'online'` **và** `rpm > 0` | `≈ xong 15:42` + dòng phụ `Ước tính theo tốc độ hiện tại 650 v/ph` |
| Thời lượng trạng thái | `now − statusSince` (mục 12.2, bridge ghi lúc `status.value` đổi) | luôn, khi có `statusSince` | `Dừng từ 09:12 (41 phút)`. Sau khi bridge khởi động lại: `Dừng ít nhất từ 10:05 (lúc bridge khởi động)` — không bịa mốc trước đó |
| Đứt chỉ /1000 mũi | `breaks / stitches × 1000` từ `threadBreakWindow` | có `threadBreakWindow` với `stitches > 0` | `0,4 lần/1000 mũi (2 lần trong 5.000 mũi gần nhất, kim 7)` — luôn in cả phân số gốc lẫn cửa sổ, không in mỗi tỉ lệ |
| Tốc độ 24 mẫu gần nhất | sparkline từ `rpmHistory` | có mảng ≥ 2 phần tử | chú thích `24 lần đọc gần nhất` + min/max bằng chữ |
| Tiền công | `stitches/1000 × pricePer1000Stitches` (máy đè site) | có đơn giá | cột tên đầy đủ `Tiền (theo đơn giá hiện tại)`; xem 8.2 |
| Còn lại tới bảo trì | đã có trong `MaintenanceView.remainingStitches` (bridge tính) | `dueState !== 'unknown'` | `Còn 320.000 mũi (odometer máy báo 12.750.000)` |

ETA cố ý tắt khi `stale`: một ETA tính trên RPM 10 phút tuổi là lời hứa sai với khách. Chuỗi
thay thế: `Không ước tính khi dữ liệu cũ`.

## 3. Thang trạng thái và ngưỡng leo thang theo thời gian

Giữ nguyên hai trục hiện có, **không thêm trạng thái gốc mới**:

- Kết nối: `online / stale / offline / unknown` (ngưỡng fresh/stale theo site, đã có trong
  `Site.freshSeconds/staleSeconds`, mặc định 30/90 giây theo PRD gốc).
- Vận hành: `running / paused / stopped / fault / unknown`, luôn qua `effectiveStatus()` — offline
  thì không bao giờ nói "đang chạy". Giữ nguyên.

Bổ sung **một lớp leo thang hiển thị** (không phải trạng thái dữ liệu mới, chỉ là tone UI):

| Điều kiện | Tone hiển thị | Mặc định | Vì sao |
| --- | --- | --- | --- |
| `stopped`/`paused` liên tục ≥ `stopEscalationMinutes` | `idle-long` — nhãn `DỪNG LÂU`, ký hiệu `■!` | **5 phút** | Theo tiền lệ MachineMetrics (tile chỉ chuyển đỏ sau ngưỡng dừng, mặc định 5 phút) và thực tế xưởng: thay khung, thay suốt, nối chỉ đều dưới 5 phút — báo sớm hơn sẽ tạo báo động giả và bị bỏ qua |
| `stopped`/`paused` < ngưỡng | `idle` như hiện tại, **nhưng tile/ô luôn in thời lượng** (`DỪNG · 2 phút`) | — | Sửa lỗi hiện tại "dừng 2 giờ trông y hệt dừng 2 phút" |
| `offline` mà `connection.reachable === true` | vẫn `offline`, dòng lý do đổi thành `Còn ping được nhưng adapter không đọc được` + nội dung `poll.lastError` | — | Phân biệt máy tắt nguồn với adapter hỏng — hai việc sửa khác nhau |
| `offline` mà `reachable === false`/`null` | `offline`, lý do `Không liên lạc được — có thể máy tắt nguồn hoặc mất mạng` + `lastReachableAt` | — | — |

Cấu hình: `stopEscalationMinutes` là thuộc tính **per-site** đặt cạnh `freshSeconds/staleSeconds`
trong cấu hình site của bridge (`bridge.config.json` + panel quản trị site), sửa bởi Admin, có
audit như mọi mutation. Không cấu hình per-machine ở MVP — thêm khi có nhu cầu thật.

Thứ hạng sắp xếp andon mới (cao hơn = trên-trái): `fault > offline > alert > idle-long > stale >
unknown > idle > running`. Giữ sort phụ theo tên để tile không nhảy (hành vi hiện tại trong
`andon.ts`, phải giữ). Lưu ý: một máy `idle` leo lên `idle-long` sẽ đổi chỗ đúng một lần tại
phút thứ 5 — chấp nhận được, không phải nhấp nháy.

Ngưỡng đứt chỉ: `threadBreakWarnPer1000` per-site, **mặc định `null` = không phán xét**, chỉ in
con số. Lý do: không có benchmark công khai cho tỉ lệ đứt chỉ chấp nhận được; một mặc định bịa ra
sẽ tạo cảnh báo sai ở xưởng thêu chỉ kim tuyến (vốn đứt nhiều). Khi site đặt giá trị, vượt ngưỡng
tạo alert `thread-break-rate` (kind đã tồn tại trong `Alert`).

## 4. Thẻ một máy ở ba mật độ

Cùng một máy, ba cách bày. Thứ bậc chung, từ to đến nhỏ: **(1) trạng thái + thời lượng trạng
thái, (2) định danh máy, (3) lý do/việc cần làm, (4) số sản xuất, (5) metadata**. Cỡ chữ ghi
tương đối theo rem; token màu/tone lấy từ `StateBadge` hiện có.

### 4.1 Tile andon (TV, đọc từ 5 m)

```
┌──────────────────────────────────┐
│ ■! DỪNG LÂU              41 phút │  ← nhãn+ký hiệu 2.4rem đậm, thời lượng 2.4rem
│ MÁY 07 · Khu A                   │  ← 1.6rem
│ Đứt chỉ kim 7                    │  ← lý do, 1.2rem
│ 80_4127~.DST · 62%               │  ← 1.1rem
│ Hôm nay 118.000 mũi              │  ← 1.1rem, "Chưa có số" nếu ledger chưa tải
└──────────────────────────────────┘
```

- Hàng 1 chiếm ≥ 35% chiều cao tile. Ký hiệu chữ (`✕ ○ ▲ ■! ◐ ? ■ ▶`) đứng trước nhãn —
  giữ nguyên nguyên tắc `toneSymbols` để board vẫn đọc được trên máy chiếu bạc màu.
- Thời lượng góc phải hàng 1: với `running` là thời gian chạy job (`elapsedSeconds`, máy báo);
  với mọi tone khác là thời lượng trạng thái (dẫn xuất, mục 2.1). Trên tile không đủ chỗ cho
  dòng nhãn nguồn → quy ước andon: **mọi thời lượng cạnh nhãn trạng thái là "tính đến hiện tại
  theo đồng hồ dashboard"**, ghi chú cố định một lần ở footer board: `Thời lượng do dashboard
  tính từ lúc đổi trạng thái`.
- Máy `unknown`: hàng 4–5 thay bằng `Chưa đọc được từ controller` — tile vẫn chiếm chỗ, không
  bao giờ ẩn (im lặng = "ổn" là cách máy dừng bị bỏ quên).

### 4.2 Hàng trong bảng fleet (desktop, quét bằng mắt theo cột)

```
│ MÁY 07        │ ● Đang kết nối │ ■! Dừng lâu · 41p │ 80_4127~.DST ▸ Logo áo khoác │ ◐650 (09:41) │ ▲ Cảnh báo │ 12s trước │ BT: còn 320k │
│ TS-007 · Khu A│                │                   │ ▓▓▓▓▓░░░ 62% · ≈ xong 15:42  │              │ Đứt chỉ k.7 │ 09:41:03  │            │
```

Thay đổi so với `FleetTable.tsx` hiện tại:

- Cột trạng thái vận hành in kèm **thời lượng** (`· 41p`).
- Cột job in thêm `job.product` (`▸ Logo áo khoác`) — trường đang có mà chưa hiển thị ở đâu; dòng
  hai là tiến độ + ETA (ETA theo quy tắc mục 2).
- **Đánh dấu stale tại ô**: khi `connection.state === 'stale'`, mọi ô telemetry (job, RPM) nhận
  tiền tố `◐` và giờ đọc trong ngoặc, ô mờ đi nhưng vẫn đạt contrast AA. Sửa rủi ro hiện tại:
  RPM in trơn cách badge stale 3 cột.
- Thêm cột `BT` (bảo trì): `còn 320k` / `Sắp đến hạn` / `Quá hạn` / `—`; sort và filter được.
  Đây là mục "sắp đến hạn bảo trì" đang không nhìn thấy từ fleet.
- Chiều cao hàng mục tiêu 40–44 px (hai dòng chữ 0.85/0.75rem). Tên máy là phần tử to nhất
  trong hàng (0.95rem đậm).

### 4.3 Panel chi tiết (giữ cấu trúc `MachineDetail.tsx`, bổ sung khối)

```
┌ MÁY 07 · TS-007 · Khu A · Xưởng 1 ────────────────── [Đóng ✕] ┐
│ ■! Dừng lâu — 41 phút (từ 09:12)   ● Đang kết nối · 12s trước │
│ Lý do gần nhất: Đứt chỉ kim 7 (controller báo 09:12:40)       │
├─ Kết nối ─────────────────────────────────────────────────────┤
│ Ping gần nhất: 09:52:58 (thành công) · Telemetry: 09:52:51    │
│ Lỗi poll gần nhất: "ECONNREFUSED 192.168.7.100:1600" (2 lần)  │
├─ Job ─────────────────────────────────────────────────────────┤
│ 80_4127~.DST — Logo áo khoác · kim 7 · chỉ Vàng kim           │
│ 18.240 / 46.453 mũi   62%   chạy 28p (máy báo)                │
│ ≈ xong 15:42 — dashboard ước tính theo tốc độ 650 v/ph        │
│ Tốc độ: 650 v/ph  [sparkline 24 lần đọc]  min 600 · max 650   │
│ Đứt chỉ: 0,4/1000 mũi (2 lần / 5.000 mũi gần nhất, kim 7)     │
├─ Controller ──────────────────────────────────────────────────┤
│ Mẫu chọn: slot 80 · 46.453 mũi · 11 đổi màu · 279,8×303,1 mm  │
│ Khung: Khung 1500x700 (1500×700) · Firmware DH-A18-2.14       │
│ Mạng máy: Wi-Fi 74% "XUONG-THEU-5G" / Ethernet                │
├─ Bảo trì ─ Cảnh báo ─ Sản lượng máy ─ Audit ──────────────────┤
│ Đơn giá hiệu lực: 40.000 đ/1.000 mũi (đơn giá riêng máy,      │
│ đè đơn giá xưởng 38.000 đ — sửa trong cấu hình máy)           │
└───────────────────────────────────────────────────────────────┘
```

Bổ sung so với hiện tại: khối Kết nối hiển thị `lastReachableAt`/`reachable` và **nội dung**
`poll.lastError` (đang chỉ đếm số lần); sparkline `rpmHistory`; kim số mấy trong đứt chỉ; đơn giá
hiệu lực và nguồn của nó (máy hay site — dùng `identity.pricePer1000Stitches` đè
`Site.pricePer1000Stitches`); `signalPercent`/`hoopName`/`selectedDesign` giữ vị trí hiện tại
nhưng khối Controller kéo lên trên khối Bảo trì. Mọi dòng vẫn qua `ReadingRow` để giữ
timestamp + nguồn.

## 5. Màn hình Tổng quan đội máy

Vấn đề đo được: header + tabs + 10 thẻ KPI cỡ bằng nhau + 9 trường lọc ăn ~330 px, chỉ còn
~11–12 hàng máy; "Chưa xác minh" to ngang "Lỗi máy". Sửa bằng ba việc:

1. **Nén KPI thành một dải chip 56 px, hai bậc.** Bậc một (to, 1.4rem): `Cần xử lý: N` — tổng
   fault + critical + offline + idle-long. Bậc hai (chip 0.85rem, mỗi chip = số + nhãn + ký
   hiệu): `Đang chạy 21 · Dừng 4 · Dừng lâu 2 · Lỗi 1 · Mất kết nối 3 · Dữ liệu cũ 1 · Chưa rõ 2
   · Bảo trì 2 · Chưa xác minh 5`. Mọi chip **bấm được** để lọc (mục 10). Hint dài của
   `KpiBar.tsx` chuyển thành `title`/tooltip.
2. **Thu bộ lọc còn một hàng 40 px**: ô tìm kiếm + site + khu vực + nút `Lọc khác ▾` (mở popover
   chứa 6 trường còn lại). Chip lọc đang áp hiện ngay dưới dạng token gỡ được (`Trạng thái: Dừng ✕`).
3. **Hàng 40–44 px** theo mục 4.2.

Ngân sách dọc tại 1080 px: header 48 + tabs 36 + KPI 56 + lọc 40 + thead 36 = 216 px → ≥ 19 hàng
máy không cuộn. Tại 768 px: ≥ 11 hàng. Tablet 1024 (ngang): bảng bỏ cột IP và BT (dồn vào dòng
phụ), ≥ 9 hàng; tablet dọc chuyển sang danh sách card 1 cột, mặc định lọc sẵn "Cần xử lý" — đây
là chế độ quản đốc đi xưởng.

Sort mặc định giữ `attention` (fault trước). `attentionScore` cập nhật để `idle-long` xếp trên
`stale`. Banner mất WebSocket toàn cục giữ nguyên (`ConnectionBanner`).

## 6. Màn hình Chi tiết một máy

Bố cục mục 4.3. Thêm yêu cầu:

- Desktop ≥ 1366: panel là cột phải 480 px, bảng fleet vẫn thấy bên trái (giữ ngữ cảnh, bấm máy
  khác không mất chỗ). Dưới 1366 và tablet: panel phủ toàn màn, nút `← Danh sách máy` cố định
  trên cùng.
- Tab phụ trong panel: `Tổng quan · Bảo trì · Cảnh báo · Sản lượng máy · Audit`. "Sản lượng máy"
  là báo cáo production lọc sẵn machineId 7 ngày — trả lời "đơn giá và tiền của máy này" không
  phải đổi tab lớn.
- `telemetryError` giữ hành vi hiện tại (snapshot cũ + hộp giải thích lỗi kèm giờ) — đưa hộp này
  lên ngay dưới header trạng thái, tone cảnh báo.
- Acknowledge alert và ghi hoàn thành bảo trì là hai mutation duy nhất, giữ nguyên confirmation +
  audit. Không thêm nút nào khác.

## 7. Màn hình Andon

Giữ kiến trúc `AndonBoard.tsx` (WebSocket sẵn có + ledger 1 phút/lần, kiosk `?andon=1`, xoay
trang 15 s, sort ổn định). Thay đổi:

- Tile theo mẫu 4.1; thêm tone `idle-long` (mục 3).
- Header board: `Cần xử lý: N` to nhất màn (2.8rem) + đồng hồ + `andonHeartbeat` giữ nguyên.
- Lưới theo cỡ trang hiện có (8/12/24/40): 1920×1080 → 8 tile = 4×2 (chữ trạng thái ~3rem, đọc
  7–8 m), 12 = 4×3 (2.4rem, chuẩn 5 m), 24 = 6×4 (1.6rem, chỉ đạt 3 m — UI ghi chú ngay cạnh
  lựa chọn), 40 chỉ dành cho giám sát gần. 1366×768: khuyến nghị mặc định 8. Không nhồi thêm số
  vào tile — bài học "TV treo tường đừng nhồi số".
- Khi có máy `fault` hoặc `offline`, trang chứa nó **không bị xoay mất**: xoay trang tạm dừng
  và hiện `Đang giữ trang vì có N máy cần xử lý`; các máy đó cũng luôn được dồn về trang 1 nhờ
  sort. Ưu tiên an toàn hơn công bằng luân phiên.

## 8. Màn hình Sản lượng

### 8.1 Bày thêm dữ liệu đã có

- Cột `Lần đọc` (`readings`), `Reset bộ đếm` (`resets`), `Bất thường` (`anomalies`), và khoảng
  `firstAt → lastAt` (dạng `06:02 → 13:58`) ở cấp dòng — đang có trong `ProductionRow` mà không
  hiển thị. `resets > 0` hoặc `anomalies > 0` in badge chữ `⚠ kiểm tra bộ đếm` trên dòng đó.
- Hàng tổng giữ nguyên; `rowsWithoutPrice > 0` hiện câu ở mục 11.

### 8.2 Quy tắc tiền

- Tên cột tiền cố định: `Tiền (theo đơn giá hiện tại)`.
- Khi khoảng ngày bắt đầu trước ngày hôm nay, hiện banner (không phải chữ chìm): `Tiền tính lại
  toàn bộ theo đơn giá đang đặt hôm nay. Nếu đơn giá đã đổi trong kỳ, số tiền kỳ cũ không phải
  số đã trả.` Đây là nâng cấp cách trình bày rủi ro hiện có; lịch sử đơn giá là việc của backlog
  (mục 12.3 không giải quyết được vì là dữ liệu dashboard, ghi TODO riêng trong code).
- Không nhân số đầu máy: hợp đồng chưa có số đầu thực chạy (mục 12.3). Ghi chú cạnh tổng tiền:
  `Chưa nhân số đầu máy — hợp đồng dữ liệu chưa đọc được số đầu thực chạy`.

## 9. Mật độ theo quy mô đội máy

| Quy mô | Tổng quan | Andon |
| --- | --- | --- |
| ≤ 8 máy | Bảng như thường; KPI bậc hai ẩn chip bằng 0 | Cỡ trang 8, tile lớn, thêm dòng ETA vào tile (đủ chỗ) |
| ~30 máy | Bố cục chuẩn ở mục 5/7 (19+ hàng, trang 12 tile ×3 trang xoay) | Chuẩn |
| ~100 máy | Bảng ảo hoá (virtualized) — yêu cầu PRD gốc "100 máy không lag"; mặc định **gập theo khu vực**: mỗi zone một hàng tóm tắt `Khu A — 24 máy · ▶18 ■2 ■!1 ✕1 ○2`, bấm mở; chip `Cần xử lý` lọc phẳng toàn bộ | Board một site/zone cho mỗi TV (filter site/zone đã có); một TV không gánh 100 tile — 24 tile/TV là trần đọc được |

Quy tắc chuyển: gập theo khu vực bật tự động khi danh sách sau lọc > 40 máy, người dùng tắt được
(ghi nhớ trong localStorage — đây là tuỳ chọn hiển thị, không phải dữ liệu, nên không cần audit).

## 10. Điều hướng và phím tắt

- **KPI chip → lọc**: bấm `Dừng lâu 2` đặt `filter.status = stopped ∧ idle-long` (thêm trường
  lọc dẫn xuất `escalation` vào `FleetFilter`); chip chuyển trạng thái "đang áp", bấm lần nữa
  hoặc bấm `✕` trên token lọc để gỡ. `Cần xử lý` = preset nhiều điều kiện, hiện thành một token.
- Chọn máy trong bảng mở panel chi tiết; `Esc` đóng panel; `Esc` lần nữa xoá token lọc gần nhất.
- URL phản ánh trạng thái: `?tab=fleet&machine=<id>&filter=…` để quản đốc gửi link qua điện
  thoại và nút Back của trình duyệt hoạt động đúng.
- Phím tắt (desktop, không đè lên khi đang gõ trong input): `/` focus tìm kiếm; `1..5` đổi tab
  lớn; `j/k` hoặc `↑/↓` di chuyển hàng, `Enter` mở chi tiết (bảng đã có `tabIndex`, mở rộng ra
  điều hướng danh sách). Tablet/kiosk không cần phím tắt.
- Andon kiosk giữ nguyên: không tab, không điều hướng.

## 11. Microcopy chuẩn (chuỗi cố định, copy nguyên văn vào code)

| Ngữ cảnh | Chuỗi |
| --- | --- |
| Trường máy báo thiếu | `Chưa đọc được từ controller` (giữ `UNREAD`) |
| Số dẫn xuất thiếu đầu vào | `Không tính được (thiếu tốc độ máy)` / `(thiếu tổng mũi)` |
| ETA khi stale | `Không ước tính khi dữ liệu cũ` |
| ETA bình thường | `≈ xong 15:42 — dashboard ước tính theo tốc độ hiện tại` |
| Dừng ngắn | `Dừng · 2 phút (từ 09:51)` |
| Dừng lâu | `DỪNG LÂU · 41 phút (từ 09:12)` |
| Sau khi bridge khởi động lại | `Dừng ít nhất từ 10:05 (lúc bridge khởi động, chưa rõ mốc trước đó)` |
| Offline còn ping được | `Còn ping được nhưng adapter không đọc được — lỗi gần nhất: "<poll.lastError>"` |
| Offline không ping được | `Không liên lạc được — có thể máy tắt nguồn hoặc mất mạng. Lần ping được gần nhất: 08:12` |
| Chưa từng ping được | `Chưa từng liên lạc được với máy này` |
| Đứt chỉ | `0,4 lần/1000 mũi (2 lần trong 5.000 mũi gần nhất, kim 7)` |
| Đứt chỉ chưa có ngưỡng | `Xưởng chưa đặt ngưỡng cảnh báo đứt chỉ — chỉ hiển thị số đo` |
| Bộ đếm vượt tổng | `Bộ đếm vượt tổng mũi (52.100/46.453) — kiểm tra tại máy` |
| Sản lượng chưa tải (andon) | `Chưa có số` (giữ nguyên, không bao giờ in 0 thay thế) |
| Dòng sản lượng bất thường | `⚠ Có 2 lần reset bộ đếm trong ca — số mũi có thể thiếu` |
| Tổng thiếu đơn giá | `3 dòng chưa có đơn giá — chưa tính vào tổng tiền` |
| Banner đơn giá | `Tiền tính lại toàn bộ theo đơn giá đang đặt hôm nay. Nếu đơn giá đã đổi trong kỳ, số tiền kỳ cũ không phải số đã trả.` |
| Andon giữ trang | `Đang giữ trang vì có 2 máy cần xử lý` |
| Footer andon | `Thời lượng do dashboard tính từ lúc đổi trạng thái · Tin gần nhất từ bridge lúc 13:58:12` |
| Bảng rỗng sau lọc | `Không máy nào khớp bộ lọc. [Xoá bộ lọc]` |
| Chưa ghép máy | giữ empty state hiện có hướng dẫn ghép máy thật |

Mọi chuỗi trạng thái luôn đi kèm ký hiệu chữ hiện có (`connectionSymbols`, `toneSymbols`) —
không thêm trạng thái chỉ-có-màu.

## 12. Phân loại dữ liệu — ranh giới quan trọng nhất của tài liệu này

### 12.1 Đã có trong `MachineView`, chỉ cần bày ra (làm ngay, không đụng bridge)

`job.product`; `rpmHistory`; `threadBreakWindow.needle`; `connection.lastReachableAt` +
`reachable`; nội dung `poll.lastError`; `Site.pricePer1000Stitches` + `identity.pricePer1000Stitches`
(đơn giá hiệu lực); `controller.network.signalPercent`; `hoopName`/`selectedDesign` (kéo lên);
`ProductionRow.resets/readings/anomalies/firstAt/lastAt`; `maintenance` thành cột + bộ lọc fleet.

### 12.2 Dẫn xuất từ dữ liệu đã có (sửa UI + một thay đổi nhỏ ở bridge)

- `statusSince`: bridge so `status.value` giữa hai snapshot liên tiếp, ghi mốc đổi vào
  `MachineView` (trường mới phía view-model, **không** đổi hợp đồng adapter). Mất khi bridge
  restart → hiển thị "ít nhất từ". Không lưu bền vững ở MVP.
- ETA, đứt chỉ/1000, tiến độ không kẹp trần, tone `idle-long`, preset lọc `Cần xử lý`: thuần UI
  (`src/lib/fleet.ts`, `src/lib/andon.ts`).
- Cấu hình mới per-site: `stopEscalationMinutes` (mặc định 5), `threadBreakWarnPer1000`
  (mặc định `null`).

### 12.3 Cần trường mới từ adapter — backlog, **không làm đợt này**, phụ thuộc giao thức chưa có

Liệt kê để cột/ô không bị ai "lấp tạm" bằng suy diễn: **lý do dừng do controller phân loại**
(thợ dừng / lỗi / hết chỉ — Barudan làm được vì giao thức của họ báo); **số đầu máy thực chạy**
(cần cho lương khoán nhân đầu); **giờ bật/tắt nguồn máy**; **mã lỗi có bảng tra** (cần tài liệu
firmware, xem `docs/adapter-contract.md` §3); **odometer theo kim** để nhắc thay kim theo mốc
1–2 triệu mũi/kim (hiện chỉ có odometer máy — template bảo trì mặc định đặt 1.500.000 mũi và ghi
rõ là mốc odometer máy, không phải từng kim). Mọi ô liên quan tới các trường này hiển thị
`Chưa đọc được từ controller` cho tới khi có adapter thật.

## 13. Tiêu chí nghiệm thu (kiểm được bằng mắt/`npm run verify`)

**Tổng quan** — 1920×1080: ≥ 19 hàng máy không cuộn; 1366×768: ≥ 11 hàng; phần tử chữ to nhất
màn là `Cần xử lý: N`, không phải lưới KPI; máy stale có `◐` ngay trong ô RPM và ô job; máy dừng
41 phút hiện `41p` ngay trong cột trạng thái; bấm chip `Mất kết nối` lọc đúng và tạo token gỡ
được; có cột bảo trì sort được; máy `currentStitch > totalStitches` hiện chuỗi "vượt tổng mũi",
không hiện 100%.

**Chi tiết** — thấy được không cần cuộn ở 1080: trạng thái + thời lượng, lý do, job + ETA có nhãn
nguồn; kéo xuống thấy `poll.lastError` nguyên văn, `lastReachableAt`, sparkline RPM có chú thích
"24 lần đọc gần nhất", đơn giá hiệu lực ghi rõ nguồn máy/site; máy adapter `manual` không có ô
nào hiện số — toàn `Chưa đọc được từ controller`; ETA biến mất khi giả lập stale (fixture
`telemetry-partial.json` + chờ quá `staleSeconds`).

**Andon** — 12 tile ở 1920×1080, nhãn trạng thái đọc được ở 5 m (≥ 2.2rem sau render); tile
`DỪNG` 2 phút và 41 phút khác nhau bằng chữ (`DỪNG` vs `DỪNG LÂU`) lẫn thời lượng; chuyển
greyscale toàn màn vẫn phân biệt được mọi tone nhờ ký hiệu; có máy fault thì trang chứa nó không
xoay mất và có dòng "Đang giữ trang…"; ledger lỗi → tile ghi `Chưa có số`, board không sập.

**Sản lượng** — dòng có `resets > 0` mang badge chữ; kỳ nhiều ngày hiện banner đơn giá; tổng ghi
chú số dòng thiếu đơn giá; cột tiền mang đúng tên `Tiền (theo đơn giá hiện tại)`.

**Chung** — `rg "≈"` trong `src/` chỉ ra các chỗ có kèm chuỗi nhãn ước tính; không chuỗi nào
trong mục 11 bị viết lại khác đi; mọi trạng thái mới (`DỪNG LÂU`) có ký hiệu + chữ; keyboard:
`/`, `Esc`, `Enter` hoạt động như mục 10; 100 máy giả lập lọc/sort không giật (yêu cầu PRD gốc).

## 14. Cố tình KHÔNG làm, và vì sao

- **Sơ đồ mặt bằng xưởng kiểu Melco SUMMIT**: giá trị thật nhưng cần trình soạn thảo vị trí +
  dữ liệu toạ độ máy; gộp theo `zone` (mục 9) trả lời 80% nhu cầu định vị với 5% công sức. Backlog.
- **Một con số OEE tổng**: bài học ngành — con số gộp che nguyên nhân; dashboard này bày thẳng
  ba thành phần (máy chạy/dừng, tốc độ, sản lượng) thay vì thờ một chỉ số.
- **Push notification / Zalo**: Zalo chỉ có ZNS (template duyệt trước, cần Internet + trả phí,
  gửi tới số điện thoại) — mâu thuẫn với yêu cầu LAN-không-Internet của PRD gốc. Andon TV là kênh
  báo động của MVP. Backlog có điều kiện.
- **Gán mã lý do dừng bởi thợ (kiểu Factbird)**: cần thiết bị nhập tại máy và kỷ luật vận hành;
  làm nửa vời sẽ đầy dữ liệu "Khác". Chờ có lý do dừng từ controller (12.3) hoặc quyết định
  nghiệp vụ riêng. Nếu làm sau, giới hạn 5–12 mã.
- **Âm thanh báo động trên board**: TV xưởng thường tắt tiếng, tiếng ồn nền lớn; tạo cảm giác an
  toàn giả. Kênh hình + chữ + ký hiệu là đủ và kiểm được.
- **Biểu đồ lịch sử dài (timeline 1h–7 ngày kiểu Evocon)**: bridge hiện không lưu chuỗi thời
  gian ngoài ledger sản lượng; làm đúng cần lớp lưu trữ mới. Sparkline 24 mẫu là mức trung thực
  với dữ liệu đang có.
- **Mọi thứ ghi tới máy**: theo PRD gốc, vĩnh viễn ngoài phạm vi — kể cả "tiện tay" như đồng bộ
  giờ hay đặt lại bộ đếm từ dashboard.
