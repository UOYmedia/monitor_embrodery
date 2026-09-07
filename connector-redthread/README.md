# RedThread connector

Service một chiều đọc trạng thái máy từ Dahao Bridge rồi đẩy snapshot và timeline lên RedThread.
Connector chỉ dùng token bridge quyền `viewer`; không gửi lệnh xuống máy thêu.

## Cấu hình

Yêu cầu Node.js 22 trở lên. Sao chép `.env.example` thành `.env`, điền bốn giá trị bắt buộc và giữ
file này ngoài Git:

- `BRIDGE_URL`: URL gốc bridge, hiện là `http://100.105.80.93:8790`.
- `BRIDGE_TOKEN_VIEWER`: token bridge quyền viewer.
- `REDTHREAD_URL`: URL gốc RedThread.
- `REDTHREAD_LAN_API_KEY`: key `mac-mini-a15`, scope workspace VietNam.
- `HEARTBEAT_INTERVAL_MS`: mặc định 30000 ms.

`machine-map.json` cho phép map ngoại lệ theo dạng `{ "bridge-machine-id": 20 }`. Nếu không có
override, connector đọc tên `Máy N` thành `externalMachineId=N`. Máy không map được chỉ bị bỏ qua và
cảnh báo một lần; các máy còn lại vẫn tiếp tục chạy.

Không đưa token/key vào plist hoặc command line. Connector không log bí mật.

## Chạy và kiểm tra

```bash
npm run test:connector
npm run connector:redthread
```

Kiểm tra nhanh sau khi chạy:

```bash
tail -f /Users/phong/dahao-gateway/logs/redthread-connector.log
launchctl print system/com.dahao.redthread-connector
```

Log có một dòng tổng hợp mỗi phút (`machines`, `posts_ok`, `posts_fail`) và một dòng riêng khi máy
đổi trạng thái. Event gửi lỗi được ghi tuần tự vào `data/queue.jsonl` và tự replay; heartbeat lỗi
không được queue vì RedThread dùng thời gian nhận ở server. `data/state.json` giữ trạng thái gần nhất
để vá đoạn timeline bị hở nếu service ngừng quá năm phút.

## Cài launchd trên mac-mini

1. Đặt thư mục này tại `/Users/phong/dahao-gateway/connector-redthread` và chạy `npm install` ở root
   repo. Tạo `.env` với quyền chỉ owner đọc: `chmod 600 connector-redthread/.env`.
2. Kiểm tra đường Node bằng `command -v node`. Nếu khác `/opt/homebrew/bin/node`, sửa đối số đầu trong
   plist mẫu.
3. Tạo thư mục log, chép plist và nạp service:

```bash
mkdir -p /Users/phong/dahao-gateway/logs
sudo cp connector-redthread/com.dahao.redthread-connector.plist /Library/LaunchDaemons/
sudo chown root:wheel /Library/LaunchDaemons/com.dahao.redthread-connector.plist
sudo chmod 644 /Library/LaunchDaemons/com.dahao.redthread-connector.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/com.dahao.redthread-connector.plist
```

Gỡ service bằng `sudo launchctl bootout system/com.dahao.redthread-connector`. Trước khi bật service,
RedThread phải có Machine ID 1–20 tương ứng M1_VN–M20_VN; M20 chưa có nguồn bridge nên giữ Offline.
