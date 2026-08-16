# Hợp đồng dữ liệu adapter → bridge → dashboard

`schemaVersion: 2`

## 1. Điều quan trọng nhất: chưa có adapter Dahao thật

Repo này **không** chứa giao thức Dahao. Bốn adapter hiện có là bốn *cơ chế truyền*, không
phải bốn cách nói chuyện với controller Dahao:

| Adapter | Là gì | Không phải gì |
| --- | --- | --- |
| `manual` | Đăng ký máy vào sổ tài sản. Không đọc gì. | Không phải nguồn telemetry. Mọi thông số luôn là "Chưa đọc được từ controller". |
| `http-json` | Bridge `GET` một endpoint HTTP trả JSON theo hợp đồng dưới đây. | Không tự hiểu giao diện web của controller. |
| `tcp-json-line` | Bridge mở TCP, tuỳ chọn gửi một dòng lệnh, đọc một dòng JSON. | Không phải giải mã giao thức nhị phân của Dahao. |
| `dial-in` | Bridge **lắng nghe**; máy tự gọi vào và đẩy JSON từng dòng. Bridge không hỏi máy. | Không phải bộ giải mã khung Dahao. Byte lạ bị đếm là "chưa giải mã được", không thành telemetry. |

Để đọc được một máy Dahao thật cần **một trong hai**:

1. Tài liệu giao thức từ nhà sản xuất/nhà phân phối (đặc tả thanh ghi, khung lệnh, mã lỗi), hoặc
2. Một bản bắt gói **được cho phép bằng văn bản** trên máy của chính doanh nghiệp, kèm quyền
   thử nghiệm ngoài giờ sản xuất.

Cho tới khi có một trong hai, đừng suy đoán khung dữ liệu. Một adapter đoán mò sẽ hiển thị số
sai trên màn hình xưởng — nguy hiểm hơn hẳn so với ô trống ghi "Chưa đọc được từ controller".

Khi đã có tài liệu, viết adapter mới trong `bridge/lib/adapters.mjs`, trả về JSON đúng hợp
đồng dưới đây rồi để `normalizeTelemetry()` kiểm tra. Không bỏ qua bước kiểm tra.

### Cảnh báo kiến trúc: Dahao dùng mô hình đẩy, không phải hỏi vòng

Phụ lục "Network Connection of Embroidery Machines" trong manual BECS (528, A18, D56, 285A…)
cho thấy controller được cấu hình **IP của server** và **số cổng của server**, rồi *tự kết nối
ra* phần mềm PC của Dahao (`EmbNetServer` / `EmbClient`). Nghĩa là trong mạng gốc, **máy là
client, PC là server** — ngược chiều với hai adapter `http-json` và `tcp-json-line` hiện có,
vốn giả định bridge chủ động hỏi máy.

Hệ quả khi làm adapter Dahao thật:

- Phải có **adapter kiểu listener**. Đã hiện thực: adapter `dial-in` (mục 1.1 dưới đây).
- Manual cũng xác nhận **MAC do người vận hành đặt tay** trên controller
  (`000000000000`–`00FFFFFFFFFF`), nên MAC là bằng chứng xác minh *hợp lệ nhưng có thể trùng
  nếu đặt sai* — quy tắc chặn trùng MAC khi ghép máy vì thế là cần thiết, không thừa.
- Manual yêu cầu máy và PC **cùng một subnet** (chỉ đặt gateway khi ở hai subnet khác nhau),
  khớp với hướng dẫn Wi-Fi hai băng tần cùng VLAN trong README.
- Chức năng gốc của mạng Dahao bao gồm cả "batch download" mẫu thêu. **Sản phẩm này cố ý chỉ
  lấy phần giám sát trạng thái và bỏ toàn bộ phần truyền mẫu.** Khi viết adapter thật, không
  hiện thực hoá phần truyền file dù giao thức có hỗ trợ.

Giao thức giữa controller và `EmbNetServer` **không được công bố**; chưa tìm thấy đặc tả công
khai hay bản hiện thực mã nguồn mở nào. Vẫn phải đi qua đúng hai con đường ở trên.

### 1.1. Adapter `dial-in`: bridge lắng nghe, máy gọi vào

`bridge/lib/dial-in.mjs` mở đúng một cổng TCP để nhận kết nối *từ* máy — đúng chiều mà manual
BECS-528 mô tả (`C44 Server IP` trỏ về bridge, `C41 Server Port` mặc định `1600`).

Cấu hình trong `bridge.config.json`, khối `ingest`. **Mặc định `enabled: false`**: mở một cổng
lắng nghe cho thiết bị ngoài phải là quyết định có chủ ý, và bridge sẽ in cảnh báo khi nó bật.

```json
"ingest": {
  "enabled": true,
  "host": "192.168.10.5",
  "port": 1600,
  "maxConnections": 64,
  "maxFrameBytes": 65536,
  "idleTimeoutMs": 120000,
  "maxFramesPerMinute": 240,
  "capture": false,
  "captureMaxBytes": 262144
}
```

Ghép máy: đặt `adapter: "dial-in"` và `ipAddress` bằng địa chỉ máy sẽ gọi vào. **Không khai
`adapterConfig.port`** — bridge không gọi máy nên không có cổng đích để đặt; khai vào sẽ bị
từ chối. Máy `dial-in` bị loại khỏi vòng poll và không bị `probe` chạm tới.

Ranh giới đã đóng cứng trong code:

- **Bridge không ghi một byte nào xuống socket.** Không ack, không keepalive, không handshake.
  Một socket bridge ghi được là một kênh lệnh chờ bị phát hiện, mà sản phẩm này không có lệnh.
  Có bài test khoá điều này lại (`dial-in.test.mjs`).
- **Nhận dạng theo địa chỉ nguồn.** Khung có thể mang `machineId`, nhưng nó bị *đối chiếu* với
  máy đã ghép ở địa chỉ đó chứ không được tin: ai mở được TCP cũng không được phép khai mình
  là máy khác. Hai máy trùng địa chỉ ⇒ `ambiguous_source`, từ chối cả hai.
- **Allowlist được kiểm lại ở mỗi kết nối**, nên thu hẹp `allowedCidrs` của site có hiệu lực
  ngay, không cần ghép lại máy.
- **Byte không phải JSON hợp đồng thì không thành telemetry.** Chúng được đếm, hiện thành lỗi
  trên máy đó ("Máy gửi dữ liệu chưa giải mã được…"), và nếu bật `capture` thì ghi hex ra
  `capturePath` để giải mã sau. Ảnh chụp tốt trước đó giữ nguyên rồi tự già đi thành
  stale/offline.
- **Giới hạn**: `maxFramesPerMinute` mỗi máy, khung quá `maxFrameBytes` bị cắt, vi phạm thì
  đóng kết nối và cấm kết nối lại trong 30 giây.

Đếm và trạng thái cổng nằm ở `GET /api/v2/health` → `ingest`.

Điều này **vẫn chưa phải adapter Dahao thật**: nó là cái ống. Muốn máy Dahao gốc nói chuyện
được qua ống này thì vẫn cần một trong hai con đường ở mục 1 — tài liệu giao thức, hoặc bản
bắt gói có phép. `capture` tồn tại đúng cho việc thứ hai.

## 2. Nguyên tắc của hợp đồng

1. **Trường không đọc được thì bỏ trống (`null`) hoặc không gửi.** Bridge không thay bằng giá
   trị mặc định, giá trị cũ hay giá trị suy diễn. Dashboard sẽ hiển thị
   "Chưa đọc được từ controller".
2. **Sai kiểu là hỏng cả gói.** `normalizeTelemetry()` ném `ContractError`; bridge giữ nguyên
   ảnh chụp tốt trước đó và hiển thị lỗi kèm thời điểm. Không bao giờ hợp nhất một phần gói lỗi.
3. **`status` là bắt buộc.** Adapter chưa đọc được trạng thái thì phải gửi `"unknown"`, không
   được im lặng.
4. **Thời gian luôn ISO 8601.** `observedAt` là lúc controller *quan sát*; `receivedAt` do bridge
   đóng dấu. Cả hai đi kèm mọi giá trị dưới dạng `Reading`.
5. **Không có trạng thái truyền file.** `controller.transfer` bị từ chối thẳng: sản phẩm này
   không có đường nạp mẫu qua mạng. Nạp mẫu vẫn là thao tác USB thủ công tại máy.
6. **Không có lệnh.** Hợp đồng chỉ có chiều đọc. Không có trường lệnh, không có kênh ghi.

## 3. Cấu trúc payload

```jsonc
{
  "schemaVersion": 2,                 // tuỳ chọn; lớn hơn bridge => từ chối
  "observedAt": "2026-08-14T07:00:00Z",
  "status": "running",                // running | paused | stopped | fault | unknown (BẮT BUỘC)
  "rpm": 720,                         // hoặc { "value": 720, "observedAt": "..." }
  "rpmHistory": [700, 710, 720],      // tối đa 24 mẫu gần nhất
  "odometer": 12750000,               // tổng mũi tích luỹ, số nguyên
  "needlePosition": { "x": 12.5, "y": -40.0 },
  "threadBreakWindow": { "needle": 3, "breaks": 2, "stitches": 5000 },

  "job": {
    "fileName": "LOGO-A.dst",         // TÊN mẫu controller đang báo, chỉ là chuỗi metadata
    "product": "Áo polo NV",
    "needle": 3,
    "threadColor": "Đỏ",
    "currentStitch": 4200,
    "totalStitches": 51000,
    "elapsedSeconds": 640
  },

  "controller": {
    "observedAt": "2026-08-14T07:00:00Z",
    "firmware": "DH-A18-2.14",
    "hoopName": "Khung 500x400",
    "frame": { "width": 500, "height": 400 },
    "designCount": 12,
    "selectedDesign": {
      "id": "slot-04", "name": "LOGO-A", "slot": 4,
      "totalStitches": 51000, "colorChanges": 6,
      "bounds": { "minX": -120, "maxX": 120, "minY": -90, "maxY": 90 }
    },
    "designs": [ /* tối đa 200 mục, cùng shape với selectedDesign */ ],
    "network": {
      "transport": "wifi",            // wifi | ethernet
      "band": "5 GHz",                // chỉ hợp lệ khi transport = wifi
      "signalPercent": 74,
      "ssid": "XUONG-THEU-5G"
    }
  },

  "events": [
    {
      "id": "evt-1", "code": "EC12", "severity": "warning",
      "occurredAt": "2026-08-14T06:59:12Z",
      "message": "Chuỗi controller trả về nguyên văn",
      "needle": 3
    }
  ]
}
```

### Về `job.fileName`

Đây là **tên** mẫu controller báo cáo — một chuỗi metadata, không phải file. Dashboard không
đọc, không phân tích, không tải và không gửi bất kỳ file `.dst` nào. Chuỗi có thể kết thúc
bằng `.dst` đơn giản vì controller đặt tên như vậy.

### Về mã lỗi (`events[].code`)

Dashboard hiển thị **nguyên văn** mã và mô tả controller gửi. Repo cố tình không có bảng tra
"EC12 = đứt chỉ": bảng đó cần tài liệu firmware. Khi có tài liệu, thêm bảng tra ở tầng hiển
thị và ghi rõ nguồn tài liệu, phiên bản firmware áp dụng.

## 4. Fixture phát triển

`docs/fixtures/*.json` là **dữ liệu mẫu để phát triển và kiểm thử**, không phải dữ liệu máy
thật và không bao giờ được nạp vào giao diện như thể là dữ liệu trực tiếp.

| File | Dùng để |
| --- | --- |
| `telemetry-running.json` | Gói đầy đủ hợp lệ: máy đang chạy, có mẫu, có mạng Wi-Fi 5 GHz. |
| `telemetry-fault.json` | Controller tự báo `fault` kèm sự kiện nghiêm trọng. |
| `telemetry-partial.json` | Adapter chỉ đọc được `status`; mọi trường khác vắng mặt. |
| `telemetry-malformed.json` | Sai kiểu (`rpm` là chuỗi) — bridge phải từ chối cả gói. |

Chạy thử với máy giả lập cục bộ:

```bash
node scripts/fixture-controller.mjs 9101 docs/fixtures/telemetry-running.json
```

Script này chỉ nghe trên `127.0.0.1`. Muốn ghép máy trỏ tới nó, bật `scan.allowLoopback: true`
trong `bridge.config.json` — bridge sẽ in cảnh báo khởi động, và cảnh báo đó là cố ý: cấu hình
này chỉ dành cho máy phát triển, không bao giờ cho xưởng.

## 5. Kiểm thử một adapter mới

1. Viết fixture mô tả đúng dữ liệu máy thật trả về.
2. Thêm case vào `bridge/lib/contract.test.mjs`: một gói hợp lệ, một gói thiếu trường, một gói
   sai kiểu.
3. Xác nhận trường chưa đọc được vẫn là `null` sau khi chuẩn hoá — không được có giá trị mặc định.
4. Xác nhận gói sai kiểu không làm thay đổi ảnh chụp trước đó
   (`bridge/lib/bridge-service.test.mjs` đã có case này).
