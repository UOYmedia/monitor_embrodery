---
title: "Khả năng khôi phục dữ liệu 5 máy sau lỗi vượt tổng mũi"
tags: [redthread, recovery, telemetry]
status: draft
created: 2026-09-28
---

# Phạm vi đã kiểm

Yêu cầu bổ sung của Vu: “sau đó có cập nhật lại data của các máy đó được không?”, event `cd4247ab03c698301d75c2b74c10d07697acb1d3bc2c98dc7523809351c7d0e8`, cùng thread lỗi bộ đếm.

**Dữ liệu hiện tại:** có thể tự nhận lại sau khi sửa và triển khai bridge + connector. Trước triển khai bản sửa, máy 07/08 đã tự trở lại dữ liệu hợp lệ khi bộ đếm reset; điều này chứng minh luồng cập nhật còn hoạt động, không chứng minh lỗi gốc đã được sửa.

**Lịch sử hoạt động:** còn log để dựng lại khoảng có bằng chứng. Chưa ghi dữ liệu sản xuất trong task này. Cần kế hoạch thay thế đúng những đoạn sai, bảo toàn dữ liệu đã đúng, và tính lại rollup. **Sản lượng mũi:** chưa đủ cơ sở khẳng định bộ đếm vượt tổng còn đúng nghĩa sản lượng; không cộng bù hoặc đoán tổng từ các số này.

## Độ phủ log đã đo

Nguồn: `phong@100.105.80.93:/Users/phong/dahao-gateway/logs/broker.out`, chỉ đọc dòng STATE của đúng 5 serial đã map. Cửa sổ `2026-09-28T02:00:00Z → 03:50:44Z` = **09:00–10:50:44 VN**.

| Máy | Mẫu log | Mẫu vượt tổng | Khoảng cách lớn nhất | Khoảng cách >10s |
|---|---:|---:|---:|---:|
| 05 | 3459 | 2475 | 3s | 0 |
| 06 | 3399 | 2104 | 3s | 0 |
| 07 | 3403 | 2047 | 65s | 1 |
| 08 | 3423 | 2507 | 3s | 0 |
| 15 | 3380 | 1432 | 3s | 0 |

10s ở bảng là ngưỡng **sàng lọc độ phủ cho điều tra**, không phải thay đổi ngưỡng freshness của sản phẩm. Khoảng 65s không được tự lấp bằng RUNNING hay đoán sản lượng. Cần dùng ngưỡng cấu hình triển khai khi dựng timeline chính thức.

Bản tin có timestamp tới giây; không thể dựng thứ tự chính xác hơn giây khi nhiều bản tin cùng mốc nếu không giữ thứ tự dòng gốc. Tên mẫu rút gọn không đủ phân biệt mọi thiết kế; phải giữ provenance và không suy cùng tên thành cùng file tuyệt đối.

## Đối chiếu RedThread qua API được cấp quyền

GET `/api/v1/lan/machines/{5,6,7,8,15}/timeline?from=...&to=...&limit=500` bằng đúng LAN credential và Node runtime của connector, lúc khoảng **10:53 VN**, trả thành công. Chỉ GET, không gọi heartbeat/event POST hoặc DB trực tiếp.

- 05/06/15 còn snapshot OFFLINE, current=total=3912.
- 07 snapshot IDLE, current=0, total=3912.
- 08 snapshot RUNNING, current=995, total=3912.
- Snapshot GET là hiện tại; query from/to chỉ lọc events, không biến snapshot thành trạng thái lịch sử.
- Timeline 08 còn event OFFLINE→PAUSED gắn mốc **09:30:13 VN**, trong khi bản tin hợp lệ quay lại gần **10:51 VN**: nguồn statusSince cũ bị mang vào sự kiện phục hồi. Đã đưa ca này vào phạm vi sửa connector để không tiếp tục ghi lùi thời gian khi kết nối trở lại.
- Tổng event trong cửa sổ đọc lần lượt 25, 15, 39, 21, 17; đây là số tại thời điểm đọc, sẽ thay đổi nếu hệ thống còn bổ sung event gắn giờ cũ.

Lần thử bằng Python urllib trả HTTP 403 / Cloudflare 1010; đọc bằng chính Node runtime hiện hữu của connector thành công, không đổi credential, firewall hay quyền truy cập.

## Vì sao không phát lại lịch sử vào API hiện tại

Nguồn code RedThread checkout `/Users/nguyenvu/Desktop/go/uoy-thread-factory`, HEAD tại kiểm tra `d69e6a9356b1050e55965c8277d7cc913f60b7be`:

- `backend/internal/services/machine_status_events.go:358` / `RecordMachineStatusEvent` kẹp event cũ lên event mới nhất và có gửi cảnh báo thay đổi nguồn điện. Đẩy sự kiện cũ qua endpoint này không giữ được mốc lịch sử và có thể phát cảnh báo không đúng lúc.
- `backend/internal/handlers/lan_agent.go`: heartbeat dùng thời gian server nhận, tính delta mũi từ snapshot hiện tại. Phát lại heartbeat cũ có thể làm sai snapshot/sản lượng.
- `backend/internal/services/machine_heartbeat_backfill.go` là bản khôi phục riêng cho lỗi heartbeat bị từ chối 404 ngày 25–28/9. Nó dựa trên payload server từng nhận, trong đó dữ liệu bridge của sự cố hiện tại đã bị đóng băng. Không reset marker hoặc chạy lại script đó để xử lý lỗi này.
- `backend/internal/services/machine_activity.go` dựng thống kê từ timeline; sửa nguồn rồi cần dựng lại đúng ngày ảnh hưởng, không chỉ đổi con số tổng trên dashboard.

## Kế hoạch áp dụng khi triển khai/khôi phục được giao

1. Chốt thời điểm hết lỗi sau triển khai; bảo toàn log raw cả khoảng ảnh hưởng, identity map, hash file và timezone. Lưu bản trước của đúng timeline/statistics cần thay đổi.
2. Dựng bản xem trước: đúng 5 máy và các khoảng telemetry bị loại; giữ interval ngoài phạm vi, khoảng thiếu bằng chứng và lịch sử nguồn. Không dùng tên mẫu rút gọn để tự cộng mũi.
3. Đối chiếu bản xem trước với dữ liệu RedThread hiện hành, kể cả event có cùng timestamp và event đã được backfill từ sự cố 404 trước đó.
4. Nếu được giao cập nhật lịch sử: dùng đường sửa dữ liệu chuyên biệt, transaction và marker/hash chống chạy trùng; không gọi endpoint live, không phát cảnh báo nguồn điện và không đổi snapshot live mới hơn.
5. Dựng lại thống kê ngày bị tác động; đối chiếu trước/sau cho thời gian chạy/dừng/mất tín hiệu. Mũi sản lượng chỉ sửa phần được chứng minh bằng nguồn độc lập hoặc nghĩa bộ đếm đã được xác nhận.
6. Chạy lần hai phải không thay đổi số liệu; xác nhận các máy ngoài phạm vi không đổi.

Báo cáo này là **khảo sát khả năng + phương án**, không phải xác nhận đã khôi phục lịch sử. Bản sửa code được bàn giao để review; chưa có quyền merge/push/deploy mặc định.
