# PRD / Prompt cho Claude — Dahao Command Read-only Fleet

[PRD]

## Vai trò và nguyên tắc làm việc

Bạn là kỹ sư full-stack chịu trách nhiệm đưa ứng dụng hiện có trong repository này thành **dashboard giám sát đội máy thêu Dahao dành cho doanh nghiệp**. Trước khi sửa, hãy đọc `README.md`, `src/types/machine.ts`, `src/App.tsx`, `src/components/BridgePanel.tsx` và toàn bộ `bridge/` để hiểu cấu trúc đang có.

Làm việc theo các nguyên tắc bắt buộc:

- Không bịa giao thức Dahao, không coi một IP/cổng TCP mở là máy Dahao và không tạo telemetry giả để UI trông có dữ liệu.
- Không làm tính năng điều khiển máy. Không Start/Stop/Pause, không đổi mẫu, không ghi cấu hình controller.
- Không làm bất cứ đường truyền/đẩy file DST nào. USB là quy trình nạp file thủ công. Không có endpoint upload, socket command, nút “gửi”, hàng đợi gửi, hay trạng thái transfer trong sản phẩm này.
- Khi firmware/protocol chưa đọc được một trường, hiển thị rõ `Chưa đọc được từ controller` thay vì suy luận từ IP, file local hay dữ liệu mẫu.
- Ưu tiên an toàn vận hành, khả năng truy vết, hiệu năng mạng LAN yếu và mở rộng cho nhiều xưởng/máy hơn hiệu ứng giao diện.

## Bối cảnh hiện trạng

Repository là React + TypeScript + Vite cho dashboard và Node.js LAN bridge. Bridge chạy trong mạng xưởng, lưu máy ghép tại `bridge-data/paired-machines.json`, quét TCP có giới hạn, polling theo adapter và phát REST/WebSocket. Đã có mô hình `MachineSnapshot` và phần `controller` tùy chọn. Hiện chưa có giao thức Dahao đã được xác thực; adapter `manual`, `http-json`, `tcp-json-line` chỉ là cơ chế tích hợp chung.

Máy Dahao nhiều khả năng chỉ dùng Wi-Fi 2.4 GHz. Máy chạy dashboard/bridge có thể ở 5 GHz **nếu** router đưa 2.4/5 GHz về cùng VLAN/subnet và không bật AP/client isolation. Đây là điều kiện hạ tầng, không phải chức năng dashboard phải tự sửa Wi-Fi/IP controller.

## Mục tiêu sản phẩm (MVP)

Cho quản đốc và kỹ thuật viên nhìn được tình trạng thật của toàn bộ máy đã được xác minh trong xưởng từ một dashboard:

1. Phát hiện host trong subnet do người dùng chỉ định, nhưng coi đó là **thiết bị chưa xác nhận**.
2. Ghép máy chỉ sau khi người dùng đối chiếu IP/MAC/model tại máy thật; ghi lại thông tin nhận diện để tránh nhầm máy.
3. Theo dõi read-only tình trạng online/offline, tên máy, khu vực/xưởng, IP/MAC, lỗi/cảnh báo, RPM, job/mẫu đang chạy, tiến độ, số mũi, kim/màu, tọa độ, bảo trì và thông tin màn hình controller khi adapter thực sự cung cấp.
4. Giúp doanh nghiệp xử lý ngoại lệ nhanh: máy mất kết nối, lỗi quan trọng, nguy cơ đứt chỉ, và bảo trì đến hạn phải thấy ngay trong fleet view.
5. Có nền tảng adapter/contract rõ ràng để sau này kết nối đúng firmware Dahao mà không phải thay dashboard.

## Ngoài phạm vi — phải loại bỏ/không triển khai

- Nạp, chọn file từ máy tính, preview/parse DST local, tải DST mẫu, canvas đường thêu và mọi UI liên quan file `.dst`.
- Upload/download/transfer DST, USB giả lập, Design Server, queue truyền file, tiến trình truyền, hoặc lệnh remote chọn mẫu.
- Điều khiển chuyển động/kim, thay đổi IP/mạng controller, Start/Stop/Pause/E-stop.
- Truy cập controller trực tiếp từ trình duyệt hoặc mở controller ra Internet.
- SaaS/cloud bắt buộc trong MVP. Dashboard phải hoạt động hoàn toàn trong LAN khi không có Internet.

## Người dùng và phân quyền doanh nghiệp

### Vai trò

| Vai trò | Quyền MVP |
| --- | --- |
| Viewer / quản đốc | Xem fleet, lọc, xem chi tiết và lịch sử cảnh báo; không sửa cấu hình. |
| Technician | Toàn bộ quyền Viewer, quét subnet được cấp, ghép/xóa-ghép, đổi tên máy, khu vực, adapter config. |
| Admin | Toàn bộ quyền Technician, quản lý site/khu vực, người dùng/role và retention/audit setting. |

Nếu đăng nhập/RBAC chưa có cơ chế xác thực an toàn trong repo, không dựng login giả. Hãy tạo lớp authorization/interface và cấu hình single-admin local rõ ràng, ghi TODO cho OIDC/SSO ở phase sau. Mọi mutation (ghép/xóa-ghép/sửa metadata/adapter) phải có actor và audit event; Viewer không được gọi được các API mutation.

## Luồng nghiệp vụ bắt buộc

### 1. Onboarding máy đáng tin cậy

1. Technician chọn đúng site/VLAN/subnet được phép quét và xác nhận cảnh báo quét LAN.
2. Bridge quét có timeout, concurrency và giới hạn dải IP/cổng; không quét toàn bộ `0.0.0.0/0` hay mạng không thuộc site.
3. Mỗi kết quả hiển thị `Thiết bị chưa xác nhận`, IP, MAC nếu đọc được, cổng mở và thời điểm phát hiện — **không** gắn nhãn Dahao.
4. Technician đối chiếu trên màn hình/nhãn máy, nhập tên chuẩn, mã tài sản, site, khu vực, model, serial (nếu có), rồi ghép.
5. Trước khi lưu phải chặn IP, MAC, serial hoặc asset tag trùng; mutation theo lô phải all-or-nothing, trả về lỗi có thể hiểu được.
6. Bản ghi máy phải có `verificationStatus`, `verifiedAt`, `verifiedBy`, và chứng cứ tối thiểu (MAC hoặc serial/asset tag). Máy chưa verified không được xuất hiện trong KPI sản xuất chính.

### 2. Fleet overview read-only

Màn hình chính ưu tiên phân loại hành động được ngay:

- KPI theo site/khu vực: tổng máy verified, running, idle/stopped, fault, offline/stale, số critical alerts và bảo trì đến hạn.
- Danh sách/table hỗ trợ lọc theo site, khu vực, trạng thái, adapter, mức cảnh báo và tìm theo tên/IP/asset tag.
- Mỗi hàng: tên, asset tag, zone, online/status, `lastSeenAt`, IP, job/mẫu hiện tại nếu có, tiến độ, RPM, lỗi cao nhất và tuổi dữ liệu.
- Sắp xếp mặc định critical/fault/offline trước; không dùng màu đơn thuần, luôn có nhãn/icon/text dễ đọc.
- Dữ liệu quá cũ phải mang trạng thái `stale`; kết nối WebSocket mất phải có banner toàn cục và thời điểm cập nhật cuối.
- Phân biệt rành mạch: `offline` (bridge không liên lạc được), `unknown` (chưa có adapter/protocol), `stale` (có dữ liệu nhưng quá hạn), `fault` (controller xác nhận lỗi). Không suy diễn `fault` từ mất TCP.

### 3. Chi tiết một máy

Màn hình chi tiết chỉ hiển thị dữ liệu bridge đã xác thực:

- Nhận diện: tên, asset tag, site, zone, model, serial, IP, MAC, verification status, adapter và last seen.
- Trạng thái vận hành: status, RPM, tiến độ job, elapsed time, current/total stitch, kim, màu chỉ, position, odometer — tất cả có timestamp/quality.
- Controller panel: tên mẫu/slot hiện đang được controller báo cáo, tổng mũi, số đổi màu, khung, bounds X/Y, Wi-Fi/Ethernet, băng tần/sóng nếu firmware gửi được. Không có danh sách file local và không có hành động đối với mẫu.
- Sự kiện/cảnh báo theo timeline, với severity, source, timestamp, acknowledged state (chỉ acknowledge ở dashboard, không gửi lệnh controller) và ghi audit.
- Bảo trì: khoảng bảo trì, odometer, due/overdue và lịch sử hoàn thành. Tạo sự kiện hoàn thành bảo trì là mutation dashboard có audit, không phải lệnh máy.

### 4. Tích hợp giao thức và contract

- Chuẩn hóa versioned contract giữa adapter/bridge/UI. Bổ sung ít nhất `schemaVersion`, `observedAt`, `source`, `quality` (verified/unknown/stale) cho snapshot/trường quan trọng; migration phải backwards-compatible.
- Adapter chỉ xuất các trường nó thật sự đọc được. Validate payload trước khi broadcast; response sai kiểu/thiếu trường thiết yếu không được trộn vào snapshot cũ mà không báo lỗi.
- Chỉ bridge được nói chuyện với controller. React gọi bridge cùng origin hoặc URL bridge đã allowlist; browser không scan TCP hoặc gọi IP máy trực tiếp.
- Giữ adapter `manual` ở trạng thái `unknown`/unavailable rõ ràng. Tạo README hướng dẫn adapter thật cần tài liệu firmware hoặc capture được phép, kèm fixture JSON contract để phát triển mà không giả là dữ liệu live.
- Có backoff, per-machine timeout, poll concurrency, jitter và circuit breaker ngắn hạn để một máy lỗi không làm nghẽn Wi-Fi hay toàn fleet.

## Yêu cầu phi chức năng cho doanh nghiệp

### Hiệu năng và quy mô

- Mục tiêu MVP: 100 máy/site, 10 site logical, dashboard hiển thị được 100 machine cards/table không lag rõ rệt trên laptop thông thường.
- Không poll đồng loạt cùng một nhịp. Giới hạn concurrency cấu hình được, jitter, exponential backoff và retry có cap; mặc định ưu tiên an toàn mạng hơn tần suất cao.
- Chỉ gửi qua WebSocket phần thay đổi hoặc snapshot có version/timestamp; UI tránh render lại cả fleet khi một máy thay đổi.
- Xác định SLA hiển thị: telemetry mới hơn 30 giây là fresh; 30–90 giây stale; quá 90 giây offline/unknown tùy kết quả reachability. Các ngưỡng phải cấu hình được theo site.

### Tin cậy và dữ liệu

- Lưu cấu hình/máy ghép/metadata/audit bền vững, có atomic write/backup an toàn và validation khi khởi động.
- Không mất toàn bộ dashboard khi một adapter, controller hay payload lỗi. Có error boundaries, retry UI và log có correlation ID.
- Clock/timestamp dùng ISO 8601 UTC trong API, UI quy đổi múi giờ site/browser. Không dùng chuỗi thời gian mơ hồ làm khóa dữ liệu.
- Không xóa audit log âm thầm. Có chính sách retention cấu hình được và export read-only CSV/JSON ở phase sau.

### Bảo mật

- Bridge mặc định chỉ bind LAN/cấu hình rõ interface; không public Internet. Document VPN doanh nghiệp cho truy cập từ xa.
- Không lưu password Wi‑Fi, secret controller hay credential trong frontend, localStorage hoặc log. Dùng biến môi trường/file config ngoài git và redact log.
- Validate toàn bộ input IP/CIDR, port, tên máy, metadata và adapter config. Chống SSRF: allowlist subnet/site, cấm loopback/link-local/multicast/broadcast và endpoint ngoài scope được cấp.
- API mutation có authorization, CSRF/origin policy nếu dùng cookie, request size limit và rate limit scan/pairing. CORS default deny.
- Audit log phải ghi actor, action, target, before/after đã redact, thời gian và request/correlation ID.

### UX vận hành

- Tiếng Việt là ngôn ngữ mặc định, thuật ngữ mạng giữ rõ ràng. Responsive cho tablet tại xưởng nhưng desktop/tablet là ưu tiên.
- Không dùng số liệu demo làm giao diện mặc định. Empty state phải hướng dẫn kết nối bridge/ghép máy thật.
- Mọi trạng thái không chắc chắn phải biểu đạt bằng text, timestamp và nguyên nhân; màu sắc không phải kênh thông tin duy nhất.
- Các action mutation đều có confirmation hợp lý, kết quả thành công/thất bại rõ, và không xóa máy vĩnh viễn nếu soft-delete/archive đủ dùng.

## Thay đổi cụ thể cần thực hiện trong repository

1. Gỡ tất cả UI/code/docs/test/public asset liên quan local DST upload, DST sample, parser/preview nếu không còn dùng ở bất cứ luồng read-only nào. Chỉ giữ metadata `job.fileName`/`controller.designs` được bridge đọc từ controller.
2. Gỡ trường `controller.transfer` và toàn bộ wording/trạng thái transfer khỏi TypeScript contract, bridge validation, UI, fixtures và README. Không thay bằng API chuyển file.
3. Refactor domain model để phân biệt immutable controller telemetry với metadata doanh nghiệp do dashboard quản lý. Không để UI selection làm thay đổi giả vờ state controller.
4. Bổ sung identification/verification/audit, machine freshness/connection state và model site/zone/asset tag theo yêu cầu trên. Migration từ `paired-machines.json` hiện tại phải bảo toàn máy đang ghép và gán safe defaults có thể hiển thị được.
5. Bảo toàn REST/WebSocket compatibility có versioning. Nếu phá vỡ được API, ghi migration note thật rõ trong README.
6. Cải thiện scanner/pairing đúng scope: không gọi host TCP-open là Dahao; có network permission/allowlist; limit scan; mutation theo lô atomic; nhận diện trùng.
7. Cập nhật README theo hướng deploy trong LAN doanh nghiệp, dual-band cùng VLAN, hardening/network checklist, cấu hình capacity, cách tích hợp protocol thật, backup/restore và troubleshooting.

## Kế hoạch triển khai đề xuất

Thực hiện theo các lát cắt nhỏ, mỗi lát có test và không được thay đổi hành vi live không liên quan:

1. **Audit & removal:** map mọi DST/file-transfer wording/code, gỡ an toàn, cập nhật type/contract/test/documentation.
2. **Data foundation:** versioned contracts; metadata máy/site; verification; freshness; migration store an toàn; audit log append-only.
3. **Bridge hardening:** policy quét/allowlist, SSRF validation, rate/concurrency/backoff, structured logs/correlation IDs, health/readiness metrics.
4. **Fleet UX:** KPI/filters/sorting/stale/offline semantics, empty/error/reconnect states; tối ưu render danh sách 100 máy.
5. **Machine detail:** telemetry provenance/timestamp, controller data chỉ đọc, timeline alert/maintenance, acknowledgement/audit.
6. **Auth readiness & documentation:** local roles/authorization boundary, deployment runbook, backup/restore, future OIDC/SSO integration points.

Sau mỗi lát cắt: mô tả file thay đổi, rủi ro, test đã chạy; không âm thầm mở rộng sang điều khiển máy hay transfer file.

## Tiêu chí nghiệm thu

### Bắt buộc

- Không còn bất kỳ button, route, API, WebSocket command, parser/preview local, sample asset hoặc tài liệu nào cho nạp/gửi/transfer DST; tìm kiếm repository với `rg -i 'upload|transfer|send.*dst|\.dst'` phải chỉ còn các tham chiếu telemetry filename hợp lệ hoặc tài liệu lịch sử được bỏ hẳn.
- Một kết quả scan TCP-open được gắn `unverified`, không có tên/mẫu Dahao bịa. Chỉ máy đã được technician xác minh mới vào fleet KPI.
- Dashboard dùng được khi Internet tắt nếu bridge và thiết bị cùng LAN.
- Một machine manual không có protocol hiển thị “Chưa đọc được từ controller/unknown”, không có RPM/job/lỗi giả.
- Dữ liệu cũ/mất WebSocket/một adapter fail hiện đúng fresh/stale/offline/unknown, không làm hỏng các máy khác.
- Tất cả mutation ghép/xóa-ghép/đổi metadata/acknowledge/maintenance có authorization boundary và audit event.
- Scan không thể bị dùng để chạm địa chỉ ngoài allowlist/site; input không hợp lệ bị từ chối trước khi network call.
- UI có thể lọc/tìm/sắp xếp 100 máy; update một máy không gây update toàn màn hình không cần thiết.
- Tất cả UI tiếng Việt, accessible keyboard cơ bản, color contrast/nhãn trạng thái rõ.

### Quality gate phải chạy trước khi bàn giao

```bash
npm run verify
```

Ngoài ra, Claude phải tự kiểm tra bằng trình duyệt local ít nhất các luồng: empty state, scan result unverified, batch pairing atomic, conflict duplicate, offline/stale transition, adapter malformed payload, Viewer bị chặn mutation, Technician mutation tạo audit log, filter/sort fleet 100 máy, và không còn UI/file action DST.

Nếu test/browser cho thấy lỗi có sẵn không liên quan, phải nêu rõ bằng chứng và không che giấu bằng cách bỏ test. Bổ sung unit/integration tests có ý nghĩa cho contract validation, store migration/atomicity, authorization, scan policy, freshness semantics và UI state quan trọng.

## Đầu ra Claude phải trả

1. Code hoàn chỉnh, có migration an toàn và không có tính năng truyền file/điều khiển máy.
2. Danh sách file đã đổi và giải thích ngắn gọn từng nhóm thay đổi.
3. Kết quả chính xác của `npm run verify` và browser QA.
4. Các giả định/gap còn lại về protocol Dahao, tuyệt đối không trình bày chúng như đã kết nối được máy thật.
5. Hướng dẫn triển khai LAN doanh nghiệp ngắn gọn: topology, firewall/VLAN, dual-band Wi-Fi, backup và cách rollback.

[/PRD]
