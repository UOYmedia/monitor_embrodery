---
title: "Bàn giao sửa trạng thái máy khi bộ đếm vượt tổng"
tags: [redthread, telemetry, review, handoff]
status: active
created: 2026-09-28
---

# Kết luận review

**PASS cho bản sửa code, sẵn sàng để Vu review và merge.** Chưa merge/push/PR/deploy, chưa khôi phục lịch sử production.

- Repo: /Users/nguyenvu/Desktop/go/uoy-thread-factory/monitor_embrodery
- Worktree: /Users/nguyenvu/Desktop/go/monitor_embrodery-worktrees/diagnose-stitch-overrun-20260928
- Branch: `vu/stitch-overrun-telemetry`
- Base HEAD, origin/main và merge-base đã pin tại review: `dadfe39ea8ab3d4e7036f55373ae04358bca0b17`.
- Implementation/test: phiên implement_overrun của CodexAstra; review độc lập diff/bằng chứng và kiểm Chrome: phiên điều phối CodexAstra.
- Duyệt sửa: event `acfd3709c4181215eaff8157e92e37b81506411703de4b5a7933a452ed639a46`; tiêu chí đã công bố tại `1781c5bc8474a2cdbb6a5fd239b9320f704efacf38c08fc116cebbd38a48b31a`.
- Thread: `d69c13dfee99b045a834a446c81b6826a1fab65f75fd2f89eca35611816ac82b`, channel `f493dd90-ab85-45b2-931f-4805c48c98de`.

## Tiêu chí và kết quả

1. Bản tin có số nguyên không âm vượt tổng vẫn cập nhật trạng thái/RPM/freshness; giữ số thô và thêm cảnh báo. Sai kiểu/âm/phân số vẫn bị từ chối. PASS.
2. Xem, quan-sat, React/Andon không suy hoàn thành, phần trăm/ETA hoặc thợ tắt máy từ số bất nhất; xoá bằng chứng hoàn thành đã cache. Nhãn mất kết nối thật vẫn hoạt động. PASS.
3. Connector cập nhật trạng thái nhưng không đưa cặp số bất nhất qua guard RedThread. Reset baseline bền qua restart, lỗi mạng và partial rejection; chỉ hoàn tất khi đúng máy được API xác nhận. Tổng thiếu không làm mất current hợp lệ. PASS.
4. Không cộng sản lượng nghi vấn hoặc bước nhảy qua khoảng lỗi. OFFLINE phục hồi dùng thời điểm nhận lại, không ghi lùi theo statusSince cũ. PASS.
5. Build, toàn suite package, ca dưới/bằng/vượt tổng, tổng 0/thiếu, reset/đổi mẫu/mất mạng và gói cài đồng bộ. PASS trong phạm vi kiểm cục bộ dưới đây; các kiểm live chưa chạy được ghi riêng.

## Bằng chứng gắn với trạng thái code

Các suite chạy khi HEAD còn là base trên và working tree chứa bản sửa. SHA256 của `git diff --binary` cho **33 file tracked code/test/package/doc** tại cuối kiểm và lúc reviewer đối chiếu:
`08279be7b7fa4ebf7de428c8b798baf5a00db7183cef958f03e83732f9ef8110`.

Ba tài liệu root của task được thêm sau; không thay code đã kiểm. Commit bàn giao được ghi trong tin Buzz. Reviewer đọc lại diff, kiểm contract phía RedThread, negative controls, diff whitespace và tái dùng suite của implementer; không chạy lại suite chỉ vì đổi người.

Môi trường: macOS local, Node v22.22.2, Python 3.14.0; venv riêng `/Users/nguyenvu/.buzz/.scratch/stitch-overrun-venv`, pycryptodome 3.23.0. Dependencies từ lockfile bằng `npm ci --ignore-scripts`. Dùng AES giả lập 16 byte trong file ignored `deploy-mini/broker_secrets.py`, đã xoá sau kiểm; không dùng credentials thật.

| Lệnh/kiểm | Kết quả |
|---|---|
| `PATH=/Users/nguyenvu/.buzz/.scratch/stitch-overrun-venv/bin:$PATH PYTHONDONTWRITEBYTECODE=1 npm test` | 81 files, 1.554 tests PASS; 3,33s ở lượt cuối |
| `npm run test:connector` | 26/26 PASS |
| `npm run lint` | PASS |
| `npm run build` | TypeScript + Vite PASS, JS 358,89kB / gzip 106,95kB |
| `npm run bridge:check` | 50 module, 0 lỗi |
| `PATH=/Users/nguyenvu/.buzz/.scratch/stitch-overrun-venv/bin:$PATH DAHAO_CHO_PHEP_GIET=0 DAHAO_LOG=/Users/nguyenvu/.buzz/.scratch/nonexistent-overrun-live-log npm run test:enum` | Các kiểm offline PASS; 2/11 bài live bỏ qua có chủ ý |
| `sh deploy-mini/dong_goi.sh` + `./node_modules/.bin/vitest run scripts/deploy-mini-sync.test.mjs` | Gói đồng bộ; 7/7 PASS |
| `git diff --check` | PASS |

Vitest bao gồm Python self-check **74/74**, ma trận Python ↔ JavaScript thật **3.154 ca** và harness màn hình; không cộng các ca subprocess thành số Vitest riêng.

**Giới hạn rõ ràng:** chưa chạy bài cần log live và bài giết/restart tiến trình production; phần đọc hai file DST thật không có fixture, phần DST tổng hợp PASS. Không gọi các phần bỏ qua là PASS. Lượt đầu có test/fixture và lỗi TypeScript do nullable percent, đã sửa rồi chạy lại kiểm bị ảnh hưởng; log lỗi cũ được giữ, không đổi nhãn thành thành công.

Log tạm để đối chiếu: `/Users/nguyenvu/.buzz/.scratch/overrun-vitest-final.log`, `overrun-checks-final.log` (connector/lint đạt, build cũ lỗi), `overrun-build-enum-final.log` (build/bridge/enum cuối), `overrun-package-final.log`. Kết quả bền được tổng hợp ở tài liệu này vì .scratch có thể bị dọn.

Packaging khôi phục đúng hai config không chứa secret từ archive baseline (dùng tokenEnv), không sửa giá trị; đóng gói chính thức rồi xoá bản config tạm. Kiểm archive không có broker_secrets, báo cáo task hay pycache. Loại metadata macOS `._*` khỏi archive.

## Kiểm trình duyệt bằng fixture cách ly

Chrome mở loopback `http://127.0.0.1:18791`, HTML thật `deploy-mini/xem/index.html`; HTTP/WS fixture dùng normalizeTelemetry thật, không nối tới RedThread hoặc máy mini.

HTML SHA256: `d21c53bfd73a2a76dd7b83af8259da4da8722798ed9d6a0fe1bdf01ab638c5d9`. Kiểm lại sau delta bỏ 100% của lỗi legacy vào 11:08–11:09 VN:

- 05 running 34628/3912: ĐANG CHẠY, cảnh báo vượt tổng, không %/thanh hoàn thành.
- 06 stopped 30675/3912: CHƯA RÕ, cảnh báo, không suy hoàn thành.
- 07 unknown với lỗi contract cũ và 3912/3912: CHƯA RÕ, không THỢ TẮT MÁY, không 100%.
- 08 stopped 3912/3912 hợp lệ: HOÀN THÀNH 100%.
- 09 mất kết nối thật: TẮT HẲN, số cũ có nhãn giải thích.
- 15 running 17/0: ĐANG CHẠY kèm cảnh báo, không phần trăm.
- Bố cục 6 thẻ trên Chrome không bị tràn/chồng chữ. Đây là dữ liệu giả lập, không phải xác nhận hệ thống production đã sửa.

## Dữ liệu và bước sau merge

Xem `REDTHREAD_DATA_RECOVERY_ASSESSMENT_2026_09_28.md`: dữ liệu hiện tại sẽ nhận lại sau triển khai. Lịch sử hoạt động có log để dựng khoảng có bằng chứng, nhưng chưa ghi bù; sản lượng mũi chưa đủ cơ sở khôi phục.

**Khi được giao deploy:** broker.py và xem/index.html đang live có khác biệt từ trước so với main. Phải đối chiếu/preserve các delta live trước khi cập nhật, không giải nén cả archive đè nguyên cây. Triển khai bridge + connector + UI theo một mốc, giữ credential/config/data, xác nhận hash đang chạy và heartbeat từng máy. Bản báo cáo này không cấp quyền deploy.

**Khi được giao sửa lịch sử:** tạo preview có phạm vi + backup/transaction/marker chống trùng, bảo toàn snapshot mới, không phát lại vào endpoint live; không gửi lại thông báo nguồn điện cũ. Khoảng thiếu log không tự lấp, bộ đếm chưa rõ nghĩa không tự cộng bù.

Nguyên nhân controller báo tổng 3912 chưa được chứng minh; bản sửa loại lỗi đánh rơi telemetry và suy nhãn sai, không đoán lại tổng thiết kế.

## Lệnh dành cho Vu

```bash
# 1. Review
cd /Users/nguyenvu/Desktop/go/uoy-thread-factory/monitor_embrodery
git log --oneline main..vu/stitch-overrun-telemetry
git diff main...vu/stitch-overrun-telemetry

# 2. Merge sau review
git checkout main && git merge --no-ff vu/stitch-overrun-telemetry

# 3. Push khi anh thấy ổn
git push origin main
```

Đo thời gian: từ duyệt sửa 10:46:27 VN tới chốt code/review khoảng 11:11 VN, xấp xỉ 25 phút; không chờ ACK/gate nối tiếp. Các lượt chạy lại do lỗi thực hoặc code/fixture đổi, không có suite lặp chỉ để xác nhận lại. Chưa có dữ liệu lỗi lọt sau bàn giao.
