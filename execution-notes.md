# Execution notes

Sổ tiến độ theo 6 slice của PRD (`PRD_CLAUDE_READONLY_FLEET.md`). Mỗi slice có test đi kèm.

## Slice 1 — Rà soát và gỡ bỏ

- [x] Gỡ toàn bộ luồng file thiết kế cục bộ: bộ chọn file `.dst`, parser, preview đường thêu,
      canvas, asset mẫu trong `public/`, CSS và test liên quan.
- [x] Gỡ `controller.transfer` khỏi hợp đồng, validation bridge, UI, fixture và tài liệu.
      Không thay bằng API truyền file nào khác — nạp mẫu vẫn là USB thủ công tại máy.
- [x] Giữ lại đúng phần metadata do controller báo về: `job.fileName`, `controller.designs`
      (tên, slot, số mũi, số lần đổi màu, khung X/Y) — chỉ đọc, không thao tác trên mẫu.
- [x] Gỡ dữ liệu máy mẫu, bộ giả lập và mọi số liệu demo mặc định.
- [x] `index.html`: `lang="vi"`, tiêu đề tiếng Việt, `noindex`.

## Slice 2 — Nền dữ liệu

- [x] Hợp đồng phiên bản hoá `schemaVersion: 2`; mỗi giá trị là `Reading`
      (`value`, `observedAt`, `source`, `quality`). Payload sai kiểu hoặc thiếu trường bắt buộc
      bị từ chối cả gói, không hợp nhất một phần vào ảnh chụp trước.
- [x] Tách telemetry bất biến do controller báo khỏi metadata nghiệp vụ do dashboard quản lý.
- [x] Mô hình site/zone/mã tài sản, `verificationStatus` / `verifiedAt` / `verifiedBy` kèm bằng
      chứng tối thiểu (MAC, serial hoặc mã tài sản).
- [x] Kho lưu trữ bền: ghi tạm → `fsync` → `rename`, giữ `.bak`, validate lúc khởi động,
      cách ly bản ghi hỏng thay vì sập dịch vụ.
- [x] Migration v1 → v2 từ `paired-machines.json`, giữ nguyên máy đã ghép, đánh dấu
      `unverified` để kỹ thuật viên xác minh lại.
- [x] Nhật ký audit append-only (JSONL) có actor, action, target, before/after đã redact,
      thời gian và correlation ID.

## Slice 3 — Gia cố bridge

- [x] Lớp phân quyền theo vai trò (viewer / technician / admin); mutation bị từ chối cũng ghi audit.
- [x] Chính sách mạng chống SSRF: allowlist CIDR theo site, cấm loopback/link-local/multicast/
      broadcast/dải public, giới hạn prefix `/22`–`/30`, trần số host và số cổng.
- [x] Poll có jitter, timeout theo máy, backoff luỹ thừa, circuit breaker, giới hạn đồng thời.
- [x] Rate limit quét/mutation, giới hạn kích thước body, CORS mặc định deny, log có redact.
- [x] `/api/health` chỉ còn liveness; cấu hình site và số lượng máy chuyển sang
      `/api/v2/health` sau quyền `fleet:read`.

## Slice 4 — Trải nghiệm tổng quan đội máy

- [x] KPI theo site/zone; lọc theo site, zone, trạng thái, adapter, mức cảnh báo; tìm theo tên/IP/
      mã tài sản; sắp xếp mặc định đưa critical/fault/offline lên đầu.
- [x] Bốn trạng thái `online` / `stale` / `offline` / `unknown` tách bạch, không suy ra `fault`
      từ mất kết nối TCP. Màu không phải kênh thông tin duy nhất.
- [x] WebSocket gửi delta có `revision`; dashboard thay đúng một máy, hàng đã memo hoá.
- [x] Mất WebSocket hiện banner toàn cục kèm thời điểm cập nhật cuối.
- [x] Trạng thái rỗng hướng dẫn kết nối bridge / ghép máy thật, phân biệt rõ "chưa liên lạc được
      bridge" với "chưa có quyền xem đội máy".

## Slice 5 — Chi tiết máy

- [x] Khối định danh, khối vận hành (mỗi trường kèm thời điểm và chất lượng), khối controller
      (mẫu đang chọn, số mũi, đổi màu, khung, mạng) — không có danh sách file cục bộ, không có
      thao tác nào trên mẫu.
- [x] Dòng thời gian sự kiện/cảnh báo có mức độ, nguồn, thời điểm, trạng thái đã ghi nhận.
      Ghi nhận cảnh báo chỉ nằm trên dashboard, không gửi lệnh xuống controller.
- [x] Bảo trì theo chu kỳ/odometer, hạn và quá hạn, lịch sử hoàn thành; ghi nhận hoàn thành là
      mutation có audit.

## Slice 6 — Sẵn sàng xác thực và tài liệu

- [x] Hai chế độ `single-admin` và `token` theo vai trò; token chỉ nằm trong bộ nhớ tab, không
      ghi `localStorage`, không ghi log. **Không dựng đăng nhập giả.**
- [x] README triển khai LAN doanh nghiệp: topology, firewall/VLAN, Wi-Fi hai băng tần cùng VLAN,
      checklist hardening, cấu hình theo quy mô, tích hợp giao thức thật, backup/restore/rollback,
      xử lý sự cố, migration v1 → v2.
- [x] `docs/adapter-contract.md` + `docs/fixtures/` (fixture phát triển, không phải dữ liệu sống).
- [x] QA trình duyệt trên đội 103 máy, ảnh chụp trong `docs/qa/`.

## Slice 7 — Sản lượng ca & lương khoán theo mũi

- [x] Lịch ca theo múi giờ của site (`bridge/lib/shifts.mjs`): ca qua đêm tính vào ngày bắt đầu,
      ca chồng lấn bị từ chối lúc khởi động, giờ không thuộc ca nào rơi vào nhóm "Ngoài ca".
      Không khai ca = một ca "Cả ngày" 24h, thà gộp thật còn hơn đoán hai ca 12h.
- [x] Sổ sản lượng (`bridge/lib/production.mjs`) cộng **chênh lệch odometer** giữa hai lần đọc.
      Bốn nhánh không tính tiền: lần đọc đầu (lấy mốc), bộ đếm lùi (reset), nhảy quá trần
      `maxStitchesPerMinute` (anomaly), và số đọc không `verified`.
- [x] Lương khoán VND/1.000 mũi: đơn giá máy → đơn giá site → để trống kèm "Chưa đặt đơn giá".
      Đặt đơn giá là mutation `machine:update`, có audit. Không bao giờ hiện `0 đ` khi chưa có giá.
- [x] Máy chưa xác minh vẫn hiện dòng nhưng **không vào tổng**, kèm banner nói rõ lý do.
- [x] `GET /api/v2/production` sau quyền `fleet:read`; ghi đĩa theo nhịp `flushIntervalMs` bằng
      ghi nguyên tử có `.bak` (`bridge/lib/atomic-file.mjs`), retention theo `retentionDays`.
- [x] Xuất CSV ngay trong trình duyệt: BOM UTF-8, phân cách `;` cho Excel tiếng Việt, chặn
      công thức (`=`, `+`, `-`, `@`), có dòng TỔNG và dòng ghi kỳ + thời điểm xuất.
- [x] QA trình duyệt trên bridge thật (4 controller giả, ca-1/ca-2, 1.200 đ/1.000 mũi):
      `docs/qa/13-production-shift-payroll.png` (bảng gộp theo máy) và
      `docs/qa/16-production-unverified-excluded.png` (máy bị gỡ xác minh → còn dòng, tổng về 0,
      banner "1 dòng không vào tổng").

## Slice 8 — Màn hình andon treo tường

- [x] Tab *Bảng andon* và địa chỉ kiosk `?andon=1` (chỉ có bảng, không tab, không lối vào màn
      hình ghép máy) cho TV treo giữa xưởng.
- [x] Xếp theo mức cần người xử lý: `LỖI MÁY` → `MẤT KẾT NỐI` → `CẢNH BÁO` → `DỮ LIỆU CŨ` →
      `CHƯA RÕ` → `DỪNG` → `ĐANG CHẠY`; trong cùng nhóm xếp theo tên để ô không nhảy chỗ.
- [x] Máy không đọc được **không bao giờ** hiển thị "đang chạy" — nằm ở nhóm cần chú ý.
- [x] Dùng lại WebSocket sẵn có: treo thêm TV không làm bridge poll thêm lần nào; chỉ thêm một
      lần gọi `/api/v2/production` mỗi phút cho số mũi trong ca.
- [x] Tự chuyển trang mỗi 15 giây khi số máy vượt số ô một trang (tắt được), nút toàn màn hình.
- [x] Mỗi ô có chữ + ký hiệu (`✕ ○ ▲ ◐ ? ■ ▶`), màu chỉ là kênh thứ ba. Bảng vẫn chỉ đọc,
      không có nút nào tác động tới máy.
- [x] QA trình duyệt: `docs/qa/14-andon-wall-board.png` (1 đang chạy / 4 cần xử lý, đủ tông
      `MẤT KẾT NỐI` và `CHƯA RÕ`) và `docs/qa/15-andon-kiosk.png` (`?andon=1`: không tab,
      không header, chỉ còn dòng nhịp tim bridge ở chân trang).

## Slice 9–12 — Giao diện theo `PRD_UI_MONITORING.md`

- [x] Mật độ hàng theo ngân sách dọc của PRD §5, đo bằng `getBoundingClientRect` chứ không
      ước lượng bằng mắt. Kết quả cuối (13 máy trong kho QA, hàng đều 44 px):

      | Màn hình      | Chrome trên bảng | Hàng/màn hình | Mục tiêu PRD | Cuộn ngang |
      |---------------|------------------|---------------|--------------|------------|
      | 1920 × 1080   | 242 px           | 19            | ≥ 19         | không      |
      | 1920 (mở panel chi tiết) | 249 px | 18            | —            | không      |
      | 1366 × 768    | 242 px           | 11            | ≥ 11         | không      |
      | 1024 × 768    | 305 px           | 10            | ≥ 9          | không      |

      Ảnh: `docs/qa/16-fleet-density-1920.png`, `docs/qa/17-fleet-tablet-1024.png`.

- [x] Bốn thứ đội chiều cao hàng đã sửa: `.muted` (padding 12 px, kiểu của khối rỗng cả trang)
      dùng inline trong ô "Không có"; badge `Chưa xác minh` mang margin dọc 2 px; thanh tiến độ
      `display: block` đẩy ETA xuống dòng thứ ba; câu "Chưa đọc được từ controller" xuống bốn
      dòng trong cột RPM hẹp.
- [x] Tabs chuyển vào trong header (hai dải viền chồng nhau tốn 106 px mà không nói thêm gì).
- [x] Máy tính bảng ≤ 1120 px: ẩn cột IP và BT, thu padding ngang ô còn 7 px, và **nói ra**
      bằng một dòng chữ dưới bảng — bảng thiếu cột mà không giải thích đọc như bảng đầy đủ.
- [x] Popover `Lọc khác` đóng khi bấm ra ngoài và khi bấm Esc (Esc bắt ở pha capture để đóng
      popover trước panel chi tiết); mọi điều kiện đang áp vẫn hiện thành token gỡ được.
- [x] Hai màn hình đếm khác nhau thì phải mang nhãn khác nhau: bảng andon dùng lại
      `needsAttention()` cho ô *Cần xử lý*, còn phép đếm rộng hơn của nó đổi tên thành
      `abnormal` / `Chưa đọc được`, kèm chú thích một máy có thể nằm trong nhiều ô.
- [x] `totals.anomalies` của bridge gộp `resets` + `anomalies`; giao diện tách lại thành
      *Khoảng đọc bị loại* có phân tích để KPI đối chiếu được với từng dòng bảng.

## Slice 13 — Trung tâm cảnh báo trên dashboard

- [x] `src/lib/alerts.ts` gom cảnh báo cả đội về một danh sách: cảnh báo bridge/controller giữ,
      cộng thêm nhóm dashboard tự suy ra từ kết nối và trạng thái (`state:fault`,
      `connection:offline`, `telemetry:error`, `state:idle-long`, `connection:stale`).
      `alerts.mjs` bên bridge cố ý không sinh nhóm này: tuổi dữ liệu chạy tiếp giữa hai tin
      nhắn bridge nên chỉ trình duyệt mới biết lúc này máy đã cũ bao lâu.
- [x] **Không ghi vào `machine.alerts`.** Danh sách là một khung nhìn dựng thêm; `andonTone()`
      và `summarize()` đọc thẳng `machine.alerts`, nhét cảnh báo dashboard vào đó sẽ lặng lẽ đổi
      màu bảng andon và đổi số KPI. Có test khoá lại điều này.
- [x] Cảnh báo dashboard **không xác nhận được**: bridge từ chối alert id nó không giữ
      (`bridge-service.mjs` ⇒ 400), nên một nút "đã xem" chỉ sống trong tab trình duyệt là nút
      nói dối — người bên cạnh không thấy, F5 là mất. Nhóm đó tự tắt khi máy trở lại. Panel nói
      thẳng lý do thay vì để một khoảng trống cạnh những dòng đang có nút.
- [x] Máy `archived` im hoàn toàn; máy `enabled: false` không bị báo mất kết nối; máy adapter
      `manual` không bị báo "dữ liệu cũ" (nó chưa bao giờ được kỳ vọng trả lời).
- [x] Chuông trên header (`a`) + panel trượt phải, lọc *Đang chờ / Tất cả* và lọc theo xưởng,
      nút nhảy sang máy tương ứng. Không làm tab thứ hai: thanh tab đang cố ý chỉ có một mục.
- [x] Thẻ nổi góc dưới (tối đa 4 + dòng đếm phần dồn) và con số trên tiêu đề tab. Lần tải đầu
      không nổ thẻ nào; mức `info` không bao giờ nổi lên; cảnh báo tự hết thì rời khỏi tập "đã
      thấy" để lần tái phát còn được báo — máy chập chờn chính là thứ cần thấy.
- [x] **Cố ý không có tiếng.** `PRD_UI_MONITORING.md` §14 đã loại âm thanh khỏi bảng xưởng
      ("TV xưởng thường tắt tiếng, tiếng ồn nền lớn; tạo cảm giác an toàn giả") và lý do vẫn
      đúng trên trình duyệt: trình duyệt còn chặn phát tiếng khi người dùng chưa bấm vào trang.
      Kênh hình + chữ + số thì kiểm được bằng mắt.

## Còn phụ thuộc bên ngoài

- [ ] **Adapter Dahao thật.** `manual`, `http-json`, `tcp-json-line` là ba cơ chế truyền, không
      phải giao thức Dahao. Cần tài liệu firmware từ nhà sản xuất hoặc một bản bắt gói được cho
      phép bằng văn bản trên máy của chính doanh nghiệp. Chưa có thì mọi trường hiển thị
      "Chưa đọc được từ controller" thay vì số liệu suy đoán.
- [ ] **OIDC/SSO doanh nghiệp** cho `user:manage` (hiện chỉ có ranh giới quyền).
- [ ] **Xuất CSV/JSON** nhật ký audit và cấu hình retention qua giao diện (sản lượng đã có).
- [ ] **Cảnh báo đẩy ra Zalo/điện thoại.** Cần Zalo OA token và đường ra Internet của doanh
      nghiệp; chưa dựng vì không thể kiểm thử thật ở đây. Cảnh báo *trên dashboard* đã có
      (slice 13) — phần còn thiếu chỉ là kênh ra khỏi màn hình.
- [ ] **Bảng phân công công nhân ↔ máy ↔ ca** để quy lương khoán về từng người; hiện báo cáo
      dừng ở mức "máy nào ra bao nhiêu tiền".
