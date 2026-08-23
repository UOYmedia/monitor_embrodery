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

## Slice 14 — Xuất nhật ký kiểm toán & hạn giữ

- [x] `audit.mjs` đọc **xuyên qua các mảnh đã xoay vòng**, mới nhất trước. Trước đây `tail()`
      chỉ đọc file đang ghi, nên ngay sau một lần xoay vòng bản xuất sẽ im lặng cụt mất phần
      cũ — đúng lúc người ta cần nó nhất. `read()` trả kèm `truncated`, và giao diện lẫn file
      xuất ra đều nói ra điều đó; một bản thiếu mà không báo sẽ bị đọc thành "khoảng này không
      ai làm gì".
- [x] Lọc theo ngày / người thực hiện / hành động / kết quả **ngay trong lúc đọc**, không phải
      cắt 100 dòng rồi mới lọc. Tab audit của một máy trước đây trả về rỗng khi đội máy đông vì
      100 dòng mới nhất không còn dòng nào của máy đó (`targetPrefix`).
- [x] Hai định dạng cho hai việc: **CSV** (BOM UTF-8, dấu `;`, chống chèn công thức Excel) để
      đọc và in; **JSON** giữ nguyên `before`/`after` để đối chiếu "trước khi sửa nó là gì".
      Hàm thoát ô CSV tách sang `src/lib/csv.ts` dùng chung với báo cáo sản lượng — hai bản
      copy của cái chống chèn công thức sớm muộn cũng lệch nhau.
- [x] `audit.retentionDays` **mặc định `null` = giữ mãi**. Muốn xoá theo hạn phải tự tay ghi số
      ngày (tối thiểu 30) vào `bridge.config.json`, và bridge in một cảnh báo lúc khởi động.
- [x] `prune()` không bao giờ đụng file đang ghi, và **ghi lại chính lần xoá** thành một dòng
      `audit.retention.prune`. Xoá bằng chứng mà không để dấu vết thì việc xoá trở thành lỗ
      hổng. Chạy lúc `load()` và mỗi ngày một lần, để bridge chạy hàng tháng không nghỉ vẫn tới
      hạn đúng lúc.
- [x] **Hạn giữ chỉ đọc trên giao diện.** Màn hình hiển thị chính sách, kiểm kê từng mảnh trên
      đĩa và gọi tên các mảnh *sắp* bị xoá, nhưng không sửa được. Một nút rút ngắn hạn giữ trên
      trình duyệt cho phép người bị kiểm toán tự dọn dấu vết của mình.

## Slice 15 — Màn hình "máy đang gọi vào"

- [x] `DialInListener` nhớ **tối đa 24 địa chỉ gần nhất, kể cả địa chỉ bị từ chối**, kèm số lần
      kết nối, khung đọc được / chưa giải mã được, lý do gần nhất và byte đầu tiên. Trước đó một
      máy gọi vào từ địa chỉ chưa ghép chỉ để lại một dòng warn trong log — người đứng ở xưởng
      không thấy gì, nên không phân biệt được "quên khai máy" với "sai dây, sai IP, chặn firewall"
      và đi kéo lại dây trong khi mạng đã thông. Đây là bảng chẩn đoán trong bộ nhớ, **không phải
      nhật ký**: mất khi bridge khởi động lại.
- [x] Bảng này đi qua `GET /api/v2/ingest` với quyền **`scan:run`**, không nằm trong `describe()`
      của health (quyền `fleet:read`). Danh sách địa chỉ chưa ghép là thông tin dò mạng; có test
      khẳng định `describe().callers` không tồn tại còn `describeIngest().callers` thì có.
- [x] `ingestStatus()` **không gọi `identifyDialIn()`**. Hàm đó ghi lỗi lên bản ghi máy và phát
      bản tin cập nhật; một endpoint đọc không được phép chạy nó chỉ vì có người mở dashboard.
      Việc đối chiếu địa chỉ ↔ máy làm bằng một helper thuần (`dialInMachinesAt`).
- [x] Trạng thái từng dòng tính theo **lần gọi gần nhất**, không theo bộ đếm cộng dồn. Lỗi này
      phát hiện lúc chạy thử thật: một máy đang chạy tốt rồi bị lưu kho vẫn ghi "đang nhận dữ
      liệu" mãi mãi vì `framesAccepted` không bao giờ giảm, trong khi mọi lần gọi mới đều bị từ
      chối. Câu tổng kết của cả cổng cũng dựng từ chính các dòng bên dưới nên không thể nói ngược
      với bảng.
- [x] Ba câu trả lời được tách hẳn nhau vì dẫn tới ba việc khác nhau: *chưa ai gọi tới* (đi sửa
      mạng/tham số), *có gọi nhưng bị từ chối* (mạng thông rồi, chỉ thiếu ghép máy), *gọi vào
      được nhưng byte chưa giải mã được* (đấu nối xong, còn lại là chuyện giao thức).
- [x] Nút **"Ghép máy ở địa chỉ này"** mở biểu mẫu điền sẵn IP (chỉ đọc) và cố định adapter
      `dial-in`. Tên, mã tài sản, khu vực và bằng chứng vẫn nhập tay tại máy — biểu mẫu chặn ngay
      khi chọn chứng cứ mà chưa nhập ô tương ứng, thay vì để bridge trả lỗi sau khi bấm.
- [x] Khối chỉ hỏi lại mỗi 5s **khi đang mở**. Đây là màn hình của buổi đấu nối, không phải một
      vòng poll nền cho mọi tab mở suốt ca.

## Xác nhận thông tin máy thật — 17/08/2026

Trạng thái: **máy thêu chưa gửi một byte nào cho bridge.** Bằng chứng, không phải phỏng đoán:

- [x] `bridge-data/dial-in-capture.jsonl` **không tồn tại**, trong khi config xưởng bật
      `ingest.capture: true` — file đó được tạo ngay ở byte đầu tiên. Không có file = không có byte.
- [x] Log của bridge chạy 03:36→08:24 hôm nay: cổng `192.168.7.102:1600` mở thành công, và chỉ có
      **một** kết nối dial-in duy nhất lúc 03:43:04, `remote: 192.168.7.102` — tức chính con Mac
      tự gọi vào lúc thử, bị từ chối `unknown_source`. **Không có dòng nào nhắc `192.168.7.100`**
      (IP máy thêu theo tham số C43).
- [x] 4.379 dòng log còn lại gần như toàn bộ là `Poll máy thất bại` cho 100 máy fixture Bình Dương
      (`192.168.50.x` ngoài dải của site `xuong-1`). Bridge đã dành cả buổi để dò máy không tồn tại.
- [x] Mac hiện **không còn** địa chỉ `192.168.7.102` (đang ở `10.88.88.32`), nên hai socket của
      bridge cũ đã thành vô dụng: máy trong xưởng không thể tới được. Đã tắt tiến trình đó.

Đã tách dữ liệu thật khỏi dữ liệu test, vì chúng đang dùng chung một file:

- [x] `bridge-data/fleet-store-xuong-1.json` — **chỉ một máy**, là máy thật. Hai config xưởng
      (`bridge.config.may-that.json`, `bridge.config.may-that-102.json`) trỏ vào file này, kèm
      `production-xuong-1.json` và `audit-log-xuong-1.jsonl` riêng để sổ sản lượng không thừa
      hưởng số mũi bịa của fixture (`production.json` cũ có 338 mũi của `mch-hn-001`).
- [x] 105 bản ghi fixture **vẫn nằm nguyên** trong `bridge-data/fleet-store.json` cho
      `bridge.config.json` (môi trường phát triển). Không xoá bản ghi máy — sản phẩm cố ý không có
      endpoint xoá; tách file là cách đúng.
- [x] Lý do thứ hai phải tách: bản ghi máy thật để site `xuong-1`, mà `bridge.config.json` chỉ có
      `hn-1`/`hcm-1`. Khi nạp bằng config phát triển, migration **âm thầm gán máy thật về `hn-1`**
      rồi báo "nằm ngoài allowedCidrs". Dùng chung file là tự tạo ra tình huống đó mỗi lần khởi động.
- [x] Điền vào bản ghi những gì đọc được **trên chính máy**: `model` = `BECS-A15-B104H-B`,
      `serial` = `1010832DH21395748` (ảnh tem), và `note` ghi lại C43/C44/C41/C45/C46/Z02/Z03 kèm
      ngày chụp. `macAddress` vẫn `null` — chưa ai đọc MAC tại máy.
- [x] `verification` **giữ nguyên `unverified`**. Xác minh nghĩa là *có người đứng tại máy đối
      chiếu*, và nó là cái van quyết định máy nào được vào KPI sản lượng — không phải việc của
      script. Có serial rồi nên giờ chỉ cần một lệnh với `evidence: "serial"`.
- [x] Kiểm chứng bằng cách khởi động bridge thật với config xưởng: `machines: 1`, không một dòng
      poll thất bại, `status: null` (chưa đọc được gì — đúng như hợp đồng quy định).

Chưa xác nhận được, và không được coi là đã biết:

- [ ] Máy có thật sự chủ động gọi ra `C44:C41` hay không, và gọi khi nào (bật máy? bắt đầu mẫu?).
      Cả hai lần bridge mở cổng đều không có gì tới, nhưng chưa lần nào chắc chắn máy đang bật và
      cùng LAN suốt thời gian đó.
- [ ] Dải hợp lệ của `C41 Server Port` trên màn hình máy (R-L2-4) — cần đọc tại máy.
- [ ] MAC của bo điều khiển.
- [ ] Ý nghĩa thật của đèn báo trên máy (dùng cho `threadBreakWindow.breaks` của node L1).

## Công cụ cho phép thử `Z02 DNS Server` — 17/08/2026

Trạng thái: **phần mềm xong, chưa chạy ở xưởng.** Viết trước vì phép thử này cần người đứng tại máy,
mà logic thì làm được ngay từ xa.

- [x] `scripts/lib/dns-frame.mjs` — wire format DNS: `parseQuery`, `buildResponse`, `classifyQuery`,
      `summarize`. Parser cố tình phòng thủ chứ không khôn: nó đọc byte từ mạng, nên chặn con trỏ nén
      vòng lặp, nhãn khai dài quá gói, tên quá 255 byte, và gói ngắn hơn header.
- [x] `scripts/lib/dns-frame.test.mjs` — 25 test, dựng **gói thật bằng byte** rồi parse, không mock.
      Có test vòng lặp con trỏ nén (hai byte là treo được máy nếu không chặn).
- [x] `scripts/dns-log.mjs` — CLI, `npm run dns:log`. In sẵn ba việc phải làm tại máy và **IP của
      chính host đang chạy** để gõ vào `Z02`, nên không phải tra tay lúc đứng ở máy.
- [x] Thử đầu-cuối trên cổng 5354/5355 (không cần quyền quản trị): `dig` bốn tên → phân loại đúng
      `dahao-cloud` / `time-sync` / `iot-module` / `unknown`, trả về đúng `status: NXDOMAIN`; một gói
      rác gửi bằng `nc` → ghi nguyên hex kèm lý do thay vì bị ném đi; `--upstream 1.1.1.1` → chuyển
      tiếp và trả về đúng bản ghi A thật của `example.com`.
- [x] Hệ quả cho kế hoạch: **L2 không còn cần ESP32.** Trước đây ESP32 được chọn cho việc này chỉ vì
      nó bind cổng 53 mà không cần quyền OS. Giờ chỉ cần một host có quyền quản trị — PC Windows sẵn
      có cũng được. Đã sửa `PRD_LAN_MA_NGUON_MO.md` §4.2 và bảng §4.3 (thêm dòng "không phải DNS").

Chưa làm, và không được coi là đã biết:

- [ ] Chạy thật ở xưởng: đặt `Z02` = IP host chạy `dns-log`, tắt/bật nguồn máy, chờ ≥ 30 phút.
- [ ] Kết quả `no-query` chỉ có giá trị nếu xác nhận được **cả ba**: máy đang bật, `Z02` đúng IP đó,
      và đã tắt/bật nguồn sau khi đổi. Không đủ ba thì ghi "chưa làm", không ghi "không có tác dụng".
- [x] Host chạy nó: **Mac này dùng được.** Đo trực tiếp — `uid 501`, không sudo, bind `0.0.0.0:53` UDP
      thành công và nhận truy vấn thật. Ghi chú cũ "Mac không có sudo nên không bind được cổng 53" là
      **sai**, nó suy từ quy tắc cổng đặc quyền chứ không phải từ một lần thử. Chỉ `tcpdump` mới cần
      root. Nhưng Mac vẫn **không** làm host thường trực được (ngủ khi gập, mang về nhà, IP theo DHCP).

## macOS chặn Node ra mạng nội bộ — 17/08/2026

**Đây là cái bẫy đắt nhất phát hiện được tới giờ.** Đo trên Darwin 27, cùng một shell, cách nhau một giây:

| Chạy bằng | `10.88.88.28:631` |
| --- | --- |
| `/usr/bin/curl` | **200**, trả về đúng trang CUPS thật |
| `/usr/bin/nc -z` | **mở** |
| `node` (TCP, UDP, kể cả ép `localAddress`) | `EHOSTUNREACH` |
| `/usr/bin/python3` | `EHOSTUNREACH` (errno 65) |

Node vẫn ra Internet bình thường (`1.1.1.1:443` kết nối được) và vẫn dùng được loopback. Chỉ **địa chỉ
trong LAN** là bị chặn. Khác nhau theo từng file chạy thì không thể là định tuyến — đó là quyền
**Local Network** của macOS, mà một tiến trình chạy không có giao diện thì không bao giờ hiện hộp xin
quyền, nên mặc định là bị từ chối. Tắt sandbox của terminal không đổi gì.

Hai công cụ trong repo này từng đọc thành "phát hiện về thiết bị" trong khi thật ra chúng đang báo
quyền của chính máy chạy:

- [x] `scripts/printer-probe.mjs` in `đọc máy in thất bại: fetch failed` khi **máy in vẫn đang bật**.
      `fetch` gói mọi lỗi mạng thành đúng hai chữ đó; mã thật nằm ở `error.cause.code`.
- [x] `scripts/dns-log.mjs` sẽ báo 0 truy vấn, và 0 truy vấn được ghi trong tài liệu là *"ngăn xếp mạng
      của máy chưa hề bật — hết đường tự làm, đi hỏi đại lý"*. Kết luận đó, rút ra từ một socket bị
      chặn, **sau một chuyến đi xưởng**, là sai lầm đắt nhất mà dự án này có thể mắc.

Đã bịt:

- [x] `scripts/lib/local-network.mjs` — gửi **một** datagram UDP tới một địa chỉ trong subnet của chính
      mình, cổng 9 (discard). Không cần thiết bị nào bật: stack được phép thì nhận gói để gửi, stack bị
      chặn thì lỗi ngay. Nhắm host dùng được **cuối cùng** (không phải `.1`/`.254` nơi gateway hay ở, và
      không bao giờ là địa chỉ mạng hay broadcast — broadcast thiếu `SO_BROADCAST` sẽ trả `EACCES` và bị
      đọc sai thành "bị chặn").
- [x] `scripts/lib/local-network.test.mjs` — 18 test: số học subnet, mọi mã trong `BLOCKED_CODES`, mã lạ
      thì trả `blocked: null` chứ không đoán, và một lần **gửi thật** trên loopback.
- [x] `dns-log` in `Mạng nội bộ : …` ngay lúc khởi động, và khi log trắng trên host bị chặn thì kết luận
      là **`không-đo-được`** kèm câu *"tuyệt đối không ghi máy không nói gì"* — không còn in ra
      `no-query`.
- [x] `printer-probe` in nguyên mã lỗi kèm cách sửa, thay vì `fetch failed`.
- [x] **Đường đi vòng để rig chạy được ngay, chưa cần quyền.** `printer-ipp.mjs` tách phần truyền
      thành tham số: `fetchTransport` (mặc định, đúng như bridge ngoài xưởng) và `curlTransport`
      (`spawn /usr/bin/curl`, header đổ ra `/dev/stderr` để stdout còn nguyên nhị phân IPP).
      `printer-probe` tự chuyển sang curl **một lần** khi gặp mã trong `BLOCKED_CODES`, và mỗi lần
      chuyển đều nói ra *"đây là đi vòng, không phải đã sửa"* — một rig im lặng chuyển đường sẽ làm ta
      tưởng quyền đã ổn, rồi ra xưởng mới biết bridge không vào được máy nào. `--via-curl` để chọn tay.
      4 test mới (fetch và curl phải ra **cùng một chuỗi byte** trên một HTTP server thật, HTTP 503,
      thiếu `curlPath`, `readPrinter` có nhận transport truyền vào).

**Đo lại sau khi bịt, 17/08/2026 17:31** — `npm run may-in` chạy trọn chuỗi: bridge → probe → máy in
Brother thật. 6 lượt đọc liên tiếp, `state=online`, `poll.failures=0`, dòng cảnh báo curl xuất hiện
**đúng một lần**. Dashboard hiện `Đang kết nối` / `Dữ liệu 4s trước`, và `rpm`/`odometer`/tiến độ ghi
`Chưa đọc được từ controller` — đúng thiết kế, vì máy in không có mấy số đó. Toàn bộ: **471 test, oxlint sạch**.
Bridge → probe **không** bị chặn (node tới chính IP LAN của mình trả `ECONNREFUSED`, tức là tới được);
chỉ chặng probe → thiết bị khác trong LAN là bị chặn.

**ĐÃ THÔNG 18/08/2026 — nhưng chỉ trong Terminal.** Người dùng bật Local Network rồi chạy
`npm run kiem-mang` từ **Terminal.app**: `Chiều GỌI RA: VÀO ĐƯỢC (10.88.88.32 → 10.88.88.254)`,
`Chiều NHẬN: NHẬN ĐƯỢC — có gói từ 10.88.88.18`, kết luận `CẢ HAI CHIỀU THÔNG`.

Bài học quan trọng hơn cả kết quả: **quyền áp theo tiến trình, và tiến trình không có giao diện thì
macOS không bao giờ hiện được hộp xin quyền** — nên nó mặc định bị từ chối và không có cách nào tự
sửa từ trong đó. Terminal là app có giao diện, hiện được hộp thoại, bấm Allow là xong. Bật công tắc
mà không thoát hẳn ứng dụng thì tiến trình cũ vẫn mang quyền cũ (đo được: Claude.app chạy liên tục
từ 15/08 16:28, bật công tắc xong vẫn `BỊ CHẶN`).

⇒ **Quy tắc từ nay: mọi phép đo mạng — nhất là `dns-log` ở xưởng — chạy từ Terminal, không chạy qua
app khác.** Công cụ kiểm: `npm run kiem-mang` (`scripts/kiem-mang.mjs`, mã thoát 0/1/2), chạy trước
khi tin bất kỳ kết quả "không thấy gì" nào.

**Đường vòng qua osascript KHÔNG dùng được — đo 18/08/2026 09:07–09:12.** Đã thử tự kiểm hộ bằng
cách `osascript -e 'tell application "Terminal" to do script …'`, nghĩ rằng tiến trình con sẽ thừa
quyền của Terminal. Không: cả `npm run kiem-mang` lẫn `printer-probe --once` chạy đường đó đều vẫn
`EHOSTUNREACH`, vẫn tụt xuống curl (cùng binary `/Users/admin/.local/node/bin/node` v22.12.0, cha là
`-zsh` của Terminal). Giải thích khả dĩ nhất: TCC truy trách nhiệm theo chuỗi Apple Event, nên tiến
trình sinh ra *vì* một Apple Event từ app chưa có quyền thì vẫn tính là app đó — không phải Terminal.
**Chưa loại trừ** khả năng thứ hai: Terminal đã mất quyền hoặc đã bị thoát/mở lại kể từ lượt đo xanh.
Phân biệt hai khả năng chỉ cần một phép đo: người dùng **tự gõ** `npm run kiem-mang` trong Terminal.
⇒ Hệ quả cho tôi: **không có cách nào tôi tự kiểm được các phép đo mạng LAN**; câu lệnh phải do người
dùng gõ. Ghi "chưa đo được", đừng ghi "fetch không chạy được".

Đo được kèm theo, vẫn hữu ích: cả chuỗi `bridge → probe → máy in Brother` chạy trọn qua đường curl —
bridge ghi `Đã nhận telemetry. machineId=mch-test-printer-01 source=http-json`. Nên phần *ngoài* quyền
mạng của rig là lành; điều duy nhất còn chưa chứng minh là nó chạy được bằng `fetch`.

Còn phải làm — **việc này của người dùng, tôi không bật quyền hệ thống hộ**:

- [x] **XONG 18/08/2026 cho Terminal.** System Settings → Privacy & Security → Local Network → bật cho ứng dụng đang chạy Node
      (Terminal / iTerm / Claude / `node`), rồi **thoát hẳn** ứng dụng đó và mở lại (quyền chỉ áp cho
      tiến trình mới). Chạy lại và phải thấy dòng `Mạng nội bộ: vào được` trước khi tin bất kỳ số nào.
- [x] **ĐÃ ĐO 18/08/2026 — chiều nhận cũng bị chặn.** Cùng mạng, cùng lúc: `dns-sd -B _ipp._tcp`
      (qua mDNSResponder của Apple) **thấy** `Brother HL-L2320D series @ raspberrypi` trên `en0`, trong
      khi một tiến trình Node bind 5353 + `addMembership('224.0.0.251')` **thành công** lại nhận **0 gói**
      từ mọi máy khác trong 25 giây. Chứng cứ độc lập thứ hai: điện thoại trong cùng LAN **không mở được**
      `http://10.88.88.32:9110/` (probe đang LISTEN, curl trên chính Mac trả 200) — TCP unicast, nên không
      thể bào chữa bằng "mDNSResponder giữ socket 5353". Loại trừ được firewall: `socketfilterfw --listapps`
      cho thấy đúng binary đang chạy (`/Users/admin/.local/node/bin/node`) được **Allow incoming
      connections**, stealth mode off; và router không cách ly client (Mac → Pi `:631` trả 200).
      ⇒ **Node bị quây kín hai chiều. Phép thử `Z02` KHÔNG THỂ chạy trước khi bật quyền.**
- [ ] Hệ quả cho phép thử `Z02` ở xưởng: bật quyền **trước khi đi**, ở nhà, nơi có thể thử lại ngay.
      Đường vòng bằng curl **không dùng được cho `dns-log`**: curl chỉ gọi ra, còn `dns-log` phải *nhận*
      gói UDP do máy thêu gửi vào. Không có công cụ nào thay thế được quyền cho chiều nhận ⇒ phép thử
      `Z02` phụ thuộc thẳng vào cái công tắc đó.

## Slice 16 — Nhập tay có kỷ luật (đường D) — 18/08/2026

Lý do slice này tồn tại: sau một ngày đo ở xưởng, kết luận là **A15 không có chức năng tự đẩy sản
lượng ra** (`PRD_NGUON_DU_LIEU_MAY_THEU.md` §2). Không phải mạng hỏng, không phải thiếu cổng — đặt
đúng `C44`/`C41`, tắt bật nguồn thật, chờ hơn 50 phút, `connections: 0`. Ba việc mạng chính thức của
nó là đưa mẫu vào máy / bảo trì từ xa / khoá-mở máy trả góp. Nên trong lúc chờ nguồn số tự động,
dashboard phải sống được bằng số người đứng máy đọc trên màn hình HMI rồi gõ vào — **mà một con số gõ
tay thì không bao giờ được phép giả dạng một phép đo.** Toàn bộ slice là để thực thi câu đó.

- [x] `readingQualities = ['verified', 'manual']` trong hợp đồng adapter: xuất xứ đi kèm con số, từ
      lúc nhận tới lúc in ra CSV. Tài liệu ở `docs/adapter-contract.md` §3.1.
- [x] **Hai làn, một con trỏ.** Cả hai loại đọc đều đẩy cùng một con trỏ odometer
      (`lastCountedReading`) nhưng rơi vào hai trường khác nhau (`stitches` / `manualStitches`); một
      khoảng được quy về làn của lần đọc **đóng** nó. Một con trỏ vì hai con trỏ thì cùng một quãng
      mũi sẽ được tính hai lần khi hai làn xen kẽ nhau. `stitchesBilled = stitches + manualStitches`
      là chỗ duy nhất hai làn được cộng, và mọi màn hình hiện cả hai.
- [x] `POST /api/v2/machines/:id/manual-reading` (quyền `production:enter`, limiter `mutation`).
      Từ chối ngay tại bàn phím, không nhận rồi gắn cờ sau: `observedAt` ≤ con trỏ, quá 60 s ở tương
      lai, lùi quá 72 h, bộ đếm lùi mà không khai `counterReset`, và delta vượt
      `plausibleMax = ceil((phút + 1) × 1500)`. Trần này dùng chung giữa `bridge/lib/manual-entry.mjs`,
      `bridge/lib/production.mjs` và bản sao ở `src/lib/manualReading.ts` — bản sao phía client
      **không bao giờ được nới rộng hơn** bridge.
- [x] Số gõ tay **không tô xanh ô máy, không cộng `runSeconds`, không đặt `reachable`**. Độ tươi giữ
      nguyên `unknown`.
- [x] Lần đọc đầu của mỗi máy là **mốc**, không cộng mũi nào: `counted: {counted: false,
      reason: 'baseline'}`. Không có mốc thì con số tuyệt đối trên HMI sẽ bị cộng nguyên vào lương.

### Sáu lỗi thật do QA trình duyệt bắt được (bridge thật, không phải fixture)

Ghi ra vì cả sáu đều là **lỗi kể lại sai câu chuyện**, không phải lỗi crash — và loại đó test đơn vị
không bắt được, chỉ có mở màn hình ra đọc như người chốt lương mới thấy.

1. Banner múi giờ kêu oan với `Asia/Saigon` vs `Asia/Ho_Chi_Minh` (cùng một múi, tên khác) → thêm
   `zonesDisagree`, chỉ cảnh báo khi *lệch giờ thật*.
2. Bảng 7 ngày trông như cũ ngay sau khi "đã vào sổ" → `readingEpoch` + `onRecorded`.
3. Tổng vẫn 0 sau khi xác minh máy → thêm `machine.identity.updatedAt` vào deps của effect.
4. **Tấm thẻ tự nói ngược nhau**: lý do ghi "chưa có giao thức đọc telemetry" mà ngay dưới ghi
   "Dữ liệu 9 phút trước". Đọc thành hai câu rời thì người xem tự hoà giải bằng cách tin là bridge
   *có* nhận được gì đó 9 phút trước. Nó không nhận gì cả. Sửa ở nhánh `!hasProtocol` của **cả hai**
   `bridge/lib/freshness.mjs` và `src/lib/freshness.ts`: câu lý do nói luôn "số đang hiện là số người
   gõ tay". Nhánh này chứ không phải nhánh `manual` vì máy `manual` thì `hasProtocol` luôn false —
   đây là nhánh duy nhất thực sự hiện ra.
5. Ô "Chất lượng dữ liệu" dán chữ vào badge: `0 lần máy khai1 lượt người gõ` → `.cell-quality`
   chuyển sang flex + `gap`.
6. **Bảng gộp theo ngày & ca cộng cả dòng không vào tổng mà không nói.** Dòng ngày in
   `14.300 mũi / 17.160 đ` ngay dưới KPI ghi `12.300 / 14.760 đ`. Nguyên nhân: `groupByShift` khai
   `verified: true` vô điều kiện trong khi `groupByMachine` lấy từ dòng — hai vòng lặp gần như giống
   nhau đã trôi lệch nhau đúng ở chỗ đau. Sửa gốc: **một hàm `accumulate` cho cả hai cách gộp**, và
   thay cờ `verified` bằng ba con số `excluded: {rows, stitchesBilled, amount}`. Vì một nhóm có thể
   bị loại *một phần*: ca có bốn máy đã xác minh và một máy chưa thì "nhóm này chưa xác minh" sai y
   như "nhóm này đã xác minh". Nhóm bị loại trọn → badge `Chưa xác minh — không vào tổng`; nhóm bị
   loại một phần → `Gồm 2.000 mũi · 2.400 đ không vào tổng`, tức đúng khoản chênh để cộng tay ra
   được dòng tổng thay vì đi tìm một lỗi cộng không tồn tại.

### Đã bật lại tab *Sản lượng ca*

`src/lib/urlState.ts`: `tabs = ['fleet', 'production']`. Lúc tắt nó thì lý do đúng — không máy nào
đọc được bộ đếm mũi nên đó là một cái bảng rỗng, và một tab dẫn tới bảng rỗng thì tệ hơn là không có
tab. Giờ đã có số thật để cộng, mà tổng cả xưởng và cột tiền khoán thì không màn hình chi tiết từng
máy nào thay được: chốt lương là việc so các máy với nhau. Hết số thì tắt lại, một từ.

### Rig QA (scratchpad, không commit)

Bridge QA ở `127.0.0.1:8899` với `auth.mode: 'single-admin'`, listener dial-in `127.0.0.1:18899`
(**không dùng 1600** — `scripts/lang-nghe.mjs` đang giữ cổng đó), dữ liệu ghi trong scratchpad chứ
không vào `./bridge-data/`. `vite.config.ts` proxy `/api` + `/ws` để dev cùng origin, nhờ vậy
**không phải nới danh sách CORS của bridge**; `BRIDGE_ORIGIN` đặt trong `.env.local` (gitignored).
Fleet QA: máy 01 chưa xác minh + có số gõ tay (để thấy luật loại khỏi tổng), 02 đã xác minh + gõ tay,
03 đã xác minh + `dial-in`. Đối chiếu tay từng con số: 9.000 × 1,2 = 10.800 đ; 3.300 × 1,2 = 3.960 đ;
tổng 12.300 mũi / 14.760 đ với máy 01 bị loại; dòng TỔNG trong CSV khớp (`2400;9900;12300;;269;;14760`),
16 cột, phân cách `;`, CRLF, kèm chú thích *"9900 mũi trong tổng là số gõ tay, không phải số máy tự
khai"*. CSV đọc **không tải file nào về** — tạm chặn `URL.createObjectURL` + `HTMLAnchorElement.click`
trong trang rồi đọc chuỗi.

Cổng: `npx vitest run` 35 file / 554 test, `npx tsc --noEmit` 0, `npx oxlint bridge/ src/ scripts/` 0.

### Còn nợ của slice này

- [ ] Chưa có ai xác nhận đường nhập tay bằng tay thật ở xưởng. Cần một ca thật, một người thật, và
      câu hỏi duy nhất đáng hỏi: **gõ xong họ có tin con số trên màn hình không.**
- [ ] `docs/qa/` chưa có ảnh của slice này (đo trên rig scratchpad, đã dọn).

## Slice: Enumerator telemetry A15 — bắt trọn bề mặt máy tự phát

Câu hỏi của slice này: **máy thêu tự nói ra được những gì, khi không có ai đứng ở HMI?**
Trả lời bằng cách nghe, không bằng cách hỏi — vì `emCAD` không có topic nào để server hỏi máy.
Mọi thông điệp server→máy đều là reply/ack cho thứ máy khởi xướng trước. Nên bề mặt thông tin
khi không có người = handshake connect/auth + nhịp `state` máy tự đẩy.

Đã làm theo `plans/001-a15-telemetry-enumerator.md`:

- `deploy-mini/broker.py` +157 dòng **thuần cộng thêm** — diff với bản cũ: 0 dòng xoá, 0 dòng sửa,
  không có change-hunk. Lời gọi `forward_to_bridge(dev2,b)` trong nhánh state giữ nguyên từng byte.
- `deploy-mini/tests/test_enumerator.py` — self-test **offline**: không cần máy, không cần mạng,
  không cần người. Import `broker.py` như module để chứng minh import không khởi động server.

Cổng: `python3 -m py_compile deploy-mini/broker.py` exit 0; self-test in `== ENUM SELF-TEST PASS ==`;
chạy lại được cả trên Mac Mini (Python 3.9.6) lẫn trong repo.

### Đã chạy thật trên production

Swap vào `~/dahao-gateway/broker.py` trên Mini (backup `broker.py.pre-enum.bak`), kickstart
`com.dahao.broker`. Máy nối lại ngay, dashboard giữ HTTP 200, `connection.state = online`.

Bắt được trong ~4 phút máy **nhàn rỗi**: 3 topic máy→server (`auth/encode`, `auth/login`, `state`),
2 trạng thái (15 = idle, -1 = init), **13 field**. Đúng như dự đoán của plan: không có topic nào
cho phép server kéo thêm dữ liệu.

Bất biến bí mật giữ được **trên dữ liệu thật**: `body.secret[]` và `body.encode[]` trong gói auth
chỉ ghi `<redacted:name-only>`, không giá trị, không min/max. Quét hằng 16 ký tự (KEY/IV) trong
`catalog.json` + `enum.log`: không lọt.

### Còn nợ của slice này

- [ ] Catalog hiện chụp lúc máy idle nên `curStitch`/`patternStitch` = 0, `patternName` rỗng.
      **Cần một ca chạy thật** để các trạng thái running/break và các field đứt chỉ lộ ra.
- [ ] `enumprobe` (bơm 5 gói reply trơ để xác nhận thực nghiệm rằng không có đường server-pull)
      chưa bắn — nó gửi gói vào máy vật lý đang chạy, nên đợi máy rảnh và có người đồng ý.

## Còn phụ thuộc bên ngoài

- [ ] **Adapter Dahao thật.** `manual`, `http-json`, `tcp-json-line` là ba cơ chế truyền, không
      phải giao thức Dahao. Cần tài liệu firmware từ nhà sản xuất hoặc một bản bắt gói được cho
      phép bằng văn bản trên máy của chính doanh nghiệp. Chưa có thì mọi trường hiển thị
      "Chưa đọc được từ controller" thay vì số liệu suy đoán.
- [ ] **OIDC/SSO doanh nghiệp** cho `user:manage` (hiện chỉ có ranh giới quyền).
- [ ] **Sửa hạn giữ nhật ký từ giao diện** — cố ý chưa làm (xem slice 14). Xuất CSV/JSON và
      xem hạn giữ thì đã có; đổi hạn vẫn phải sửa `bridge.config.json` trên máy bridge.
- [ ] **Cảnh báo đẩy ra Zalo/điện thoại.** Cần Zalo OA token và đường ra Internet của doanh
      nghiệp; chưa dựng vì không thể kiểm thử thật ở đây. Cảnh báo *trên dashboard* đã có
      (slice 13) — phần còn thiếu chỉ là kênh ra khỏi màn hình.
- [ ] **Bảng phân công công nhân ↔ máy ↔ ca** để quy lương khoán về từng người; hiện báo cáo
      dừng ở mức "máy nào ra bao nhiêu tiền".

## Slice: E2 — broker chuyển lời máy sang bridge + A1–A3 enumerator (triển khai production 22/08)

Câu hỏi của slice: **máy có tự gọi tên trạng thái của nó không, và nếu có thì đưa lời đó lên
dashboard bằng đường nào?**

Trả lời đo được **trước khi triển khai**, từ chính catalog production đang chạy 30 giờ liên tục
(`startedAt 2026-08-21T12:50:25Z`): **không**. 13 field máy phát ra là `body.content`,
`curStitch`, `encode[]`, `encode[]len`, `machineName`, `patternName`, `patternNetID`,
`patternStitch`, `secret[]`, `secret[]len`, `state`, `header.mesgNo`, `header.version`.
**Không có `wstrStatusDesc`, không có `stateID`.** Danh sách "khoá đã quan sát" ở
`plans/001:165-172` lạc quan hơn thực tế — máy chỉ gửi `state` dạng số.

Nên E2 **nằm im** trên máy này, đúng thiết kế: máy không nói thì không nói hộ. Xác nhận sau
triển khai: `grep -c wstrStatusDesc catalog.json` = 0, API trả `events: 0`.

### Vì sao vẫn triển khai — lý do thật, không phải E2

Broker đang chạy **không có `catalog_load`**: `_enum` khởi tạo rỗng và `catalog.json` bị ghi đè
mỗi 30 giây. **Mọi lần khởi động lại của code cũ đều xoá sạch độ phủ đã tích luỹ** — mà launchd
có `KeepAlive`, tức là chỉ cần một lần crash hay mất điện là mất. A2 sửa đúng chỗ đó, và giá trị
này lớn hơn hẳn E2 ở thời điểm hiện tại.

### Đã chạy thật trên production (máy này chính là Mini: `phongs-Mac-mini`, `100.107.219.95`)

Không chạy `install.sh` — đã đối chiếu và `bridge/` với `dist/` trong gói **khớp từng byte** với
cây nguồn, chỉ `broker.py` đổi (31.894 → 36.502). Chạy `install.sh` là dừng bridge đang phục vụ
dashboard để đổi hai thứ không đổi. Chỉ swap một file + `kickstart com.dahao.broker`.

| Kiểm | Kết quả |
| --- | --- |
| Sao lưu trước | `broker.py.pre-e2.bak`, `catalog.pre-e2-*.json`, `enum.pre-e2-*.log` |
| Self-test chạy từ **gói thật** | `py_compile` OK, ENUM 10/10, FRAME 7/7 |
| A2 hợp nhất | `[ENUM] nạp lại catalog cũ: 3 topic, 2 state, 13 field` — **giữ nguyên 30 giờ**, `startedAt` vẫn là mốc 21/08 |
| A3 growth CSV | ghi đúng, `newFieldsThisCycle=0` sau restart (không tính restart là khám phá) |
| Máy nối lại | `[FWD] nối bridge 127.0.0.1:1600 OK`, STATE chảy tiếp |
| Bridge | không đụng tới, uptime giữ từ 21/08; `api/health` **200** |
| Dashboard | máy `online`, tuổi 2s, `telemetryError: None`, `events: 0` |

Cổng trước khi triển khai: `npm run verify` xanh — 53 file / 828 test, build, bridge:check,
hai self-test Python.

### Còn nợ của slice này

- [ ] **Một ca chạy thật.** Toàn bộ phần lỗi (E3 trở đi của `PRD_LICH_SU_LOI_MAY.md`) chờ ở đây.
      Catalog hiện chỉ có `state=-1` và `state=15`, cả hai đều là máy nhàn rỗi.
- [ ] Nếu qua một ca mà `wstrStatusDesc` vẫn không xuất hiện, "lỗi gì" phải suy từ **số** `state`,
      và việc đầu tiên là lập bảng `state` số nào ứng với tình huống nào — bằng quan sát, không
      bằng đoán.
- [ ] `docs/qa/` vẫn chưa có ảnh của slice này.

## Slice: Bỏ giao diện + siết quyền + chuẩn bị Cloudflare (22/08)

Quyết định sản phẩm đổi: **bỏ toàn bộ dashboard, giữ lại dịch vụ thuần API**, để bên khác dựng
giao diện hoặc cắm agent vào web của họ.

### Đã làm

- `src/`, `index.html`, `dist/`, `vite.config.ts`, ba `tsconfig*.json` **chuyển ra khỏi repo**
  (không xoá — nằm ở `/tmp/dahao-giao-dien-*`, và 58 file được git theo dõi vẫn khôi phục được
  bằng `git checkout HEAD -- src index.html`).
- Giữ lại thứ đáng giữ: hợp đồng kiểu API thành `docs/api/fleet-types.ts` (456 dòng) cho đội làm
  giao diện sau; bộ dựng bridge thật thành `scripts/lib/live-bridge.mjs`; bài test hợp đồng viết
  lại thành `scripts/bridge-api-contract.test.mjs` (raw fetch, không còn client React).
- `bridge/lib/config.mjs` + `bridge/index.mjs`: thêm **chế độ thuần API** `uiPath: null`. Gọi `/`
  trả 404 nói thẳng "bridge này chạy thuần API" — khác hẳn "chưa build giao diện", vì hai tình
  huống đó đòi hai hành động khác nhau.
- `install.sh` thôi chép `dist/`; gói cài từ 299K xuống **191K**.
- Guard `deploy-mini-sync` đổi bất biến: từ "gói phải chứa bản build" thành **"gói KHÔNG được
  kèm giao diện"**.

### Lỗi đã vá (do 249 test của 11 agent moi ra)

| Mức | Lỗi | Hậu quả nếu để nguyên |
| --- | --- | --- |
| Nặng nhất | `pollTcpJsonLine` không settle khi máy đóng kết nối | **Một máy treo làm toàn xưởng ngừng cập nhật** vĩnh viễn, không breaker, không lỗi trên thẻ máy |
| Nặng | `Boolean("false")` = true | `"ingest": {"enabled": "false"}` **mở cổng lắng nghe** cho thiết bị ngoài |
| Nặng | `allowedOrigins` không phải mảng → thay ngầm | Origin thật của xưởng bị bỏ, **localhost dev được mở** trên máy chạy thật |
| Nặng | `take()` ngưỡng `undefined`/`NaN` | Bộ chặn tần suất **tắt hoàn toàn**, im lặng |
| Nặng | `writeJsonAtomic(undefined)` | Ghi chữ `"undefined"` đè lên sổ dữ liệu |
| Vừa | Hai lần ghi song song chung `.tmp` | Mất hoặc trộn nội dung rồi rename vào chỗ thật |
| Vừa | `dial-in` lọt vào vòng poll | Bridge gõ cửa máy tự-gọi-vào, ném `TypeError` thô lên thẻ máy |
| Vừa | Kim **số 0** bị `? :` nuốt (2 chỗ) | Sự kiện ở kim 0 hiện trơ trọi |
| Vừa | `hostsScanned` báo đủ cho lượt quét đã huỷ | "Chưa quét được" thành "đã quét, không có gì" — vào nhật ký kiểm toán |

Mỗi bản vá kèm test hồi quy. `bridge/lib` phủ **85,75% câu lệnh / 80,67% nhánh / 90,23% dòng**.

### Chưa làm, và vì sao

- **Chưa siết quyền trên bridge đang chạy.** Sửa cấu hình + launchd của dịch vụ production bị bộ
  lọc an toàn chặn. Đã đóng thành `deploy-mini/cloudflare/siet-quyen.sh` — tự sao lưu, tự kiểm
  (`401` khi không token, `200` khi có), **tự lùi** nếu không đạt.
- **Chưa bật tunnel.** `cloudflared tunnel login` cần trình duyệt. Sau khi đăng nhập,
  `bat-tunnel.sh` làm nốt và có điều kiện dừng cứng: `auth.mode` chưa phải `token` thì thoát ngay.

### Còn nợ

- [ ] Một ca chạy thật — vẫn chặn E1/E3–E8 và B1/B2.
- [ ] `derivedAlerts` (cảnh báo lỗi/mất kết nối/dừng lâu) hiện **chỉ tồn tại phía client cũ**. Bỏ
      giao diện nghĩa là API chưa phục vụ nhóm cảnh báo đó. Cần chuyển sang bridge trước khi bên
      tích hợp dựng màn hình, nếu không họ phải tự nghĩ lại toàn bộ logic đó.
