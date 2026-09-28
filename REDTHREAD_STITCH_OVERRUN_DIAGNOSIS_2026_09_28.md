---
title: "RedThread — chẩn đoán bộ đếm mũi vượt tổng ngày 2026-09-28"
tags: [redthread, dahao, incident, telemetry]
status: active
created: 2026-09-28
---

# Kết luận

Đã SSH kiểm tra VPS RedThread và Mac mini gateway. Lỗi trong ảnh được xác nhận trên **Máy 05, 06, 07, 08, 15**: máy tiếp tục phát số mũi qua MQTT, nhưng bridge loại toàn bộ telemetry khi `currentStitch > totalStitches`. Dữ liệu hợp lệ cuối cùng bị giữ lại ở 3.912/3.912, dần thành `connection=unknown`; trang xem suy từ số cũ rằng mẫu đã xong và hiển thị **THỢ TẮT MÁY**. Nhãn này không phản ánh các bản tin máy đang gửi.

Phạm vi nhiệm vụ hiện tại là kiểm tra. Chưa sửa code, restart, deploy, sửa DB hoặc điều khiển máy; không có branch code cần merge.

## Bằng chứng trực tiếp

Kiểm tra 2026-09-28 khoảng **10:37–10:41 giờ Việt Nam** (03:37–03:41 UTC).

- VPS `157.230.46.171`: app green, PostgreSQL, Redis đều healthy; disk root 24% dùng, RAM available khoảng 3 GB. Đây là snapshot sức khỏe hiện tại, không phải kết luận mọi chức năng VPS đều đúng.
- Gateway `phong@100.105.80.93`: GET `http://100.105.80.93:8790/api/health` trả `status=ok`; bridge startedAt `2026-09-24T01:55:00.461Z`.
- GET `/api/v2/fleet` bằng viewer credential có sẵn, lúc `2026-09-28T03:40:01Z`: 5 máy dưới đây đều `connection.state=unknown`, `telemetryError.kind=contract`, field `job.currentStitch`; snapshot job cũ đều 3.912/3.912.
- Log broker chứng minh máy vẫn gửi bản tin khoảng 2 giây/lần, và số mũi tăng giữa các bản tin.
- `/Users/phong/dahao-gateway/connector-redthread/data/state.json`, đọc khoảng 03:41 UTC: `statuses` cho 5, 6, 7, 8, 15 đều là `OFFLINE`. Đây là bằng chứng trạng thái connector; chưa truy vấn DB sản xuất để định lượng ảnh hưởng báo cáo.

| Máy | Mũi thô gần 10:40 VN | Tổng thô | Snapshot hợp lệ cuối, giờ VN |
|---|---:|---:|---|
| 05 | 34.628 | 3.912 | 09:32:21 |
| 06 | 30.675 | 3.912 | 09:42:52 |
| 07 | 29.358 | 3.912 | 09:50:58 |
| 08 | 41.476 | 3.912 | 09:30:13 |
| 15 | 20.363 | 3.912 | 10:04:32 |

Nguồn số thô: `/Users/phong/dahao-gateway/logs/broker.out` (STATE lines `2026-09-28T03:39:59Z` và `03:40:00Z`). Máy 05/06 có patternName đầy đủ `4182912019_1_Front1.DST`; 07/08/15 báo tên rút gọn `4182~.DST`. Không đủ căn cứ coi mọi tên rút gọn là cùng một file.

Nguồn lỗi: `/Users/phong/dahao-gateway/logs/bridge.out`, ví dụ 03:38:59–03:39:01 UTC: `Khung dial-in không hợp lệ.` với reason `job.currentStitch không thể lớn hơn job.totalStitches.`

## Chuỗi gây lỗi đã đối chiếu code chạy thật

1. `/Users/phong/dahao-gateway/broker.py:385` (`build_frame`): chuyển trực tiếp `curStitch → currentStitch`, `patternStitch → totalStitches`; không kẹp hay sửa hai số. `state_to_status:306` suy running khi số mũi tăng trên cùng tên mẫu.
2. `bridge/lib/contract.mjs:264`: ném lỗi khi số mũi hiện tại lớn hơn tổng.
3. `bridge/lib/bridge-service.mjs:890` (`acceptDialIn`): lỗi normalize chỉ cập nhật telemetryErrors; không ingest snapshot mới và không cập nhật freshness từ gói đó.
4. `bridge/lib/freshness.mjs`: snapshot cũ quá ngưỡng trong khi reachable còn true → unknown.
5. **Bản đang deploy** `/Users/phong/dahao-gateway/xem/index.html:803–820`: xử lý connection không online/stale trước telemetryError. Job cũ đã xong → `tat-may`. Vị trí tương ứng bản local là `deploy-mini/xem/index.html:716–733`; hash cả file UI khác bản live nên đã đọc trực tiếp đoạn live trước khi kết luận.
6. `connector-redthread/lib/mapping.mjs`: unknown/stale/offline đều map OFFLINE. Cần xem cả tuyến này khi sửa, nếu chỉ bỏ guard ở bridge thì heartbeat có thể gửi số vượt tổng tới guard tiếp theo ở RedThread.
7. RedThread `backend/internal/handlers/lan_agent.go:106` cũng chặn `currentStitch > totalStitches`.

**Tái hiện cục bộ, không tác động dịch vụ:** gọi normalizeTelemetry bằng Node với total=3912: current=3912 được nhận; current=3913 và 34628 đều trả đúng lỗi trong ảnh. Cho snapshot 02:32:21 vào freshness tại 03:40:01 → unknown, ageSeconds=4060; mapMachine → OFFLINE. Đây là reproduction chẩn đoán, không phải suite test bản sửa.

Repo nguồn sạch trước điều tra: `/Users/nguyenvu/Desktop/go/uoy-thread-factory/monitor_embrodery`, HEAD và origin/main sau fetch cùng `dadfe39ea8ab3d4e7036f55373ae04358bca0b17`.

SHA-256 local **khớp bản triển khai** của các file quyết định backend/connector:

| File | SHA-256 |
|---|---|
| bridge/lib/contract.mjs | 9bfb735e5fce313e65db83c0555c1c1ab4cd2a8383750b940d4a363c5092f712 |
| bridge/lib/bridge-service.mjs | cab2c826a31c8721ce8306a70a092943ec999e283199be77926609b3c225e444 |
| bridge/lib/freshness.mjs | 240c398a57963fc6d124d9a31b9ad52e1e14e430621b5aa53336b8d249c105ba |
| connector-redthread/lib/mapping.mjs | 7c0c9b18d5e0a885656c1ee1bc6bc2191fa2a055977fad7f424da4092f3f7eb5 |

## Phần chưa thể kết luận

Nguyên nhân **hiển thị sai và mất cập nhật** đã rõ. Nguyên nhân controller báo cặp số vượt tổng chưa rõ: chưa có bằng chứng để gọi là sai header DST, lỗi firmware, mẫu lặp, hoặc bộ đếm cộng dồn. Cần đối chiếu HMI/chế độ mẫu và bản tin gốc nếu muốn sửa cách hiểu số liệu. Không tự đổi tổng thành số hiện tại, chia modulo hoặc kẹp current về 3912.

Log cho thấy lần vượt ngưỡng đầu hôm nay của 05/06/07/08 đi qua 3912 → 3914. Máy 15 có lần đổi tên mẫu làm tổng đổi từ 15271 xuống 3918 trong khi current vẫn 8124. Đây là dấu hiệu cần kiểm hành vi đổi mẫu; chưa đủ để suy một nguyên nhân chung cho 5 máy.

## Phương án sửa đề xuất để anh duyệt

1. Tách cảnh báo bộ đếm vượt tổng khỏi lỗi làm rơi toàn bộ trạng thái: tiếp nhận và giữ provenance các trường đáng tin, hiện cảnh báo số liệu bất nhất; không biến bộ đếm thành mất tín hiệu hoặc kết luận máy tắt.
2. Sửa ưu tiên nhãn trên trang xem và nơi sao chép cùng logic (quan-sat), để lỗi telemetry không bị suy thành “THỢ TẮT MÁY”. Không tính % hoàn thành/ETA khi cặp số chưa đáng tin.
3. Kiểm cả connector và hợp đồng RedThread: giữ hoạt động cập nhật trạng thái, gửi null cho số liệu không còn đủ nghĩa nếu chọn phương án đó; bảo đảm không tạo heartbeat 400 và không cộng số mũi bất thường vào báo cáo.
4. Kiểm các ca: dưới/bằng/vượt tổng, tổng=0/thiếu, đổi mẫu/reset số, mất mạng thật; đối chiếu nhãn UI và connector. Chạy build và suite package bị sửa theo quy định. Replay dữ liệu chẩn đoán trong môi trường cách ly, không phát lại vào hệ thống sản xuất.

Không cần restart để chẩn đoán; restart không giải quyết được guard vẫn từ chối cùng dữ liệu. Deploy cần chỉ thị riêng theo quy tắc hiện hành.

## Nguồn yêu cầu và vị trí bàn giao

- Yêu cầu kiểm tra: buzz://message?channel=f493dd90-ab85-45b2-931f-4805c48c98de&id=d69c13dfee99b045a834a446c81b6826a1fab65f75fd2f89eca35611816ac82b&thread=d69c13dfee99b045a834a446c81b6826a1fab65f75fd2f89eca35611816ac82b
- Báo cáo ở gốc worktree chỉ phục vụ điều tra (detached HEAD, không commit code): `/Users/nguyenvu/Desktop/go/monitor_embrodery-worktrees/diagnose-stitch-overrun-20260928/REDTHREAD_STITCH_OVERRUN_DIAGNOSIS_2026_09_28.md`.
- Không push/PR/merge; main của anh giữ nguyên.

## Cập nhật sau chẩn đoán

Vu đã duyệt sửa tại event `acfd3709c4181215eaff8157e92e37b81506411703de4b5a7933a452ed639a46`. Phần mô tả chưa sửa phía trên là snapshot lúc chẩn đoán 10:44 VN. Bản sửa code và kết quả review mới nhất nằm ở `REDTHREAD_STITCH_OVERRUN_HANDOFF_2026_09_28.md`; chưa triển khai hay ghi bù production.
