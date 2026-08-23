# Node cảm biến ngoài (L1) — firmware ESP32

Một hộp ESP32 dán bên ngoài máy thêu, đếm mũi và đọc đèn báo của chính máy, rồi trả JSON đúng
`docs/adapter-contract.md` cho bridge qua HTTP.

Đây là **tầng L1** trong `PRD_LAN_MA_NGUON_MO.md`: con đường duy nhất ra số thật mà không phụ
thuộc việc Dahao có mở giao thức hay không. Ba việc mạng chính thức của A15 (đưa mẫu vào máy,
Dahao bảo trì từ xa, khoá–mở máy trả góp) **không có** việc đẩy sản lượng ra server của xưởng.

## Node này KHÔNG làm gì

- Không nối vào bo điều khiển Dahao, không cắm vào CN1/CN2, không nối vào panel HMI.
- Không lấy điện từ máy. Nó dùng cục sạc 5 V riêng.
- Không gửi cho máy một byte nào. Không có endpoint ghi, không POST, không OTA.
- Không khoan, không cắt, không đấu vào dây nào của máy. **Máy còn bảo hành.**
- Không nói bất kỳ giao thức nào của Dahao. Nó chỉ là một cảm biến có WiFi.

## Đo được gì, và cố ý không gửi gì

| Trường contract | Node lấy từ đâu | Ghi chú |
| --- | --- | --- |
| `status` | có/không có xung trục chính, + đèn báo | `running` / `stopped` / `fault` / `unknown` |
| `rpm` | khoảng cách giữa các xung | 0 khi trục dừng; vắng mặt khi chưa có xung nào |
| `rpmHistory` | mẫu 10 s một lần, tối đa 24 mẫu | 4 phút gần nhất |
| `odometer` | `NODE_ODOMETER_BASE` + số xung node đếm | xem "Bộ đếm và mất điện" |
| `threadBreakWindow` | số lần đèn báo sáng / số mũi trong cửa sổ | chỉ gửi khi bạn đã xác nhận nghĩa của đèn |
| `job.*` | **không gửi** | cảm biến ngoài không biết đang thêu mẫu nào, kim nào, màu gì |
| `needlePosition` | **không gửi** | không thấy được toạ độ khung |
| `controller.*` | **không gửi** | node không phải controller; firmware/khung/danh sách mẫu/mạng của controller là của controller |
| `events[]` | **không gửi** | bridge đóng dấu mọi event là `source: 'controller'`; gửi lên thì suy đoán của node bị ghi thành lời của bo Dahao |

Nguyên tắc: **trường nào không đo được thì vắng mặt**, không gửi 0, không gửi giá trị cũ. Bridge
hiển thị trường vắng là "Chưa đọc được từ controller" — đó là câu đúng.

### `unknown` khác `stopped`

Trước khi nhận được **xung đầu tiên**, node không thể phân biệt "máy đang đứng" với "cảm biến lệch
/ rơi / chưa gắn". Nó báo `status: "unknown"` và **không gửi `odometer`** — nếu gửi, bridge sẽ thấy
bộ đếm không đổi và ghi vào sổ sản lượng là "máy chạy không, 0 mũi", tức là bịa ra một sự thật.
Sau xung đầu tiên, `stopped` mới có nghĩa là "trục không quay".

### `paused` không bao giờ được gửi

Không cảm biến ngoài nào phân biệt được máy tạm dừng và máy dừng hẳn. Contract có `paused`, node
này không dùng.

### `breaks` là "số lần đèn báo sáng", không phải "số lần đứt chỉ"

Node đếm số lần đèn báo của máy sáng lên. Đèn đó nghĩa là gì thì **chỉ máy của bạn trả lời được** —
repo này không có tài liệu firmware Dahao nào định nghĩa đèn báo. Vì vậy `NODE_LAMP_MEANS_STOP`
mặc định `0`, và khi nó là `0` thì node **không gửi `threadBreakWindow`** chứ không gửi `breaks: 0`.

Cách xác nhận (2 phút, không tháo gì): cho máy thêu, rút chỉ một kim cho nó đứt, xem đèn nào sáng
và có nháy không. Nếu đúng là đèn đó ⇒ bật `NODE_LAMP_MEANS_STOP 1`.

## Phần cứng

| Món | Ghi chú |
| --- | --- |
| ESP32 DevKit (WROOM-32) | bản nào cũng được, miễn có chân GPIO 26/27 |
| Cảm biến quang phản xạ có ngõ ra số, **chạy được ở 3,3 V** | ví dụ module TCRT5000 / cảm biến vật cản hồng ngoại |
| Băng dính phản quang (hoặc sơn bút trắng) | dán **một** vạch lên bánh đà / puly trục chính |
| Cảm biến sáng có ngõ ra số (module LM393 + quang điện trở) | tuỳ chọn, để đọc đèn báo |
| Ống co nhiệt / ống giấy đen | làm mũ che cảm biến sáng, chặn đèn xưởng |
| Cục sạc 5 V + cáp micro-USB/USB-C | **điện riêng, không lấy từ máy** |
| Dây rút, băng dính 2 mặt, đế từ | cố định. Không khoan. |

> ⚠ **Chỉ dùng module cấp được nguồn 3,3 V từ chân 3V3 của ESP32.** Module cấp 5 V thường xuất ra
> 5 V ở chân OUT và GPIO của ESP32 chịu tối đa 3,6 V. Nếu buộc phải dùng module 5 V thì phải có
> mạch chia áp — nhưng cách rẻ và an toàn hơn là mua module chạy 3,3 V.
>
> ⚠ Nếu chọn cảm biến tiệm cận công nghiệp 12 V: **chỉ loại NPN (hở cực góp, ăn dòng)**. Loại PNP
> đẩy 12 V vào chân ESP32 và làm chết chip.

## Gắn ở đâu

**Xung đếm mũi.** Dán một vạch băng phản quang lên bánh đà (puly trục chính) — chỗ quay tròn nhưng
không chạm vào chỉ, kim, khung hay tay người. Kẹp cảm biến quang cách vạch 3–10 mm, hướng vào mặt
puly, cố định bằng đế từ hoặc dây rút vào một thanh có sẵn. Mỗi vòng puly = 1 xung = 1 mũi.

Không dán nam châm lên puly quay: nó bay ra là tai nạn. Băng phản quang bong ra thì vô hại.

**Đèn báo.** Cắm cảm biến sáng vào ống co nhiệt cho thành cái mũ, dán bằng băng 2 mặt sát mặt đèn
báo (đèn tháp hoặc đèn báo trên panel), hướng thẳng vào đèn. Ống che để đèn trần xưởng không làm
nó báo bừa.

Node bỏ trong hộp nhựa, dán ngoài thân máy hoặc treo vào giá; cục sạc cắm vào ổ điện tường
**không** phải ổ trên máy — mất điện máy thì node cũng nên còn sống để báo là máy đang tắt.

## Nối dây

Chỉ có 4 dây, tất cả về ESP32. Không có dây nào chạm vào máy thêu.

| ESP32 | Cảm biến xung | Cảm biến đèn |
| --- | --- | --- |
| `3V3` | VCC | VCC |
| `GND` | GND | GND |
| `GPIO 27` | OUT | — |
| `GPIO 26` | — | OUT |

## Nạp firmware

1. Arduino IDE → *Boards Manager* → cài **esp32 by Espressif Systems** (core 3.x).
2. Mở `firmware/esp32-stitch-node/esp32-stitch-node.ino`.
3. Tạo `config.h`:
   ```bash
   cp firmware/esp32-stitch-node/config.example.h firmware/esp32-stitch-node/config.h
   ```
4. Sửa `config.h`: SSID, **mật khẩu WiFi tự gõ vào** (file này đã bị `.gitignore` chặn — mật khẩu
   không bao giờ vào repo, không gửi qua chat công việc, ghi trên giấy là đủ), cổng, chân GPIO.
5. Board *ESP32 Dev Module*, chọn cổng COM/tty, Upload.
6. Serial Monitor 115200 để xem IP nó lấy được.

## Kiểm tra khi lắp (dùng điện thoại cùng WiFi)

Mở `http://<ip-node>:8080/health`. Đây là dữ liệu **chẩn đoán**, không phải contract; bridge không
bao giờ đọc đường này.

1. **Cảm biến có ăn không**: quay puly bằng tay từng vòng, `stitchesCounted` phải tăng đúng 1 mỗi
   vòng. Tăng 2–3 ⇒ tăng `NODE_PULSE_DEBOUNCE_US`, hoặc vạch phản quang quá rộng.
2. **Có đếm dư không**: `rejectedPulses` tăng nhanh ⇒ nhiễu hoặc dội, chỉnh lại khoảng cách/độ nhạy.
3. **Đếm đúng không**: thêu một mẫu biết trước tổng mũi, so `stitchesCounted` với số mũi trên màn
   hình máy. Lệch quá 0,5% thì đừng dùng số đó cho tiền công.
4. **Tốc độ**: `rpm` phải khớp con số mũi/phút máy hiện.
5. **Đèn**: che rồi soi đèn vào cảm biến sáng, xem `lampPinHigh` đổi; nếu ngược thì sửa
   `NODE_LAMP_ACTIVE_LOW`.
6. **Giờ**: `timeSynced: false` là bình thường khi LAN không ra Internet — node sẽ bỏ `observedAt`
   và bridge tự đóng dấu giờ nhận.

## Ghép vào bridge

Node là adapter `http-json` chuẩn: bridge **gọi vào** node theo chu kỳ (`GET /telemetry`), node
không tự đẩy. IP của node phải nằm trong `allowedCidrs` của site trong `bridge.config.json`.

```bash
curl -sS -X POST http://192.168.7.10:8787/api/v2/machines \
  -H 'content-type: application/json' \
  -d '{"machines":[{
    "assetTag":"MAY-01",
    "name":"Máy thêu 01 (số liệu từ node cảm biến)",
    "siteId":"xuong-1",
    "zone":"Chuyền A",
    "model":"Dahao BECS-A15",
    "ipAddress":"192.168.7.31",
    "macAddress":"<MAC đọc ở /health>",
    "adapter":"http-json",
    "adapterConfig":{"port":8080,"path":"/telemetry","timeoutMs":4000},
    "note":"Số mũi và tốc độ do node cảm biến ngoài đếm, KHÔNG đọc từ controller Dahao.",
    "verification":{"confirmed":true,"evidence":"assetTag"}
  }]}'
```

Đặt tên và `note` như trên. Người xem dashboard sáu tháng sau phải biết ngay con số đó ở đâu ra;
một dòng tên chung chung là cách để sau này nhìn số của cảm biến thành số của controller.

Nói cho rõ một chỗ nhoè: bản ghi này mang tên máy thêu, nhưng `ipAddress` và `macAddress` trong đó
là **của node**, không phải của bo Dahao. Vì vậy chứng cứ xác minh là `assetTag` — cái nhãn trên
thân máy mà bạn đọc khi đang đứng cạnh nó — chứ không phải MAC.

## Bộ đếm và mất điện

Node ghi bộ đếm vào NVS mỗi `NODE_PERSIST_EVERY_STITCHES` mũi (mặc định 5000, khoảng 5 phút ở
1000 mũi/phút) **và** một lần nữa mỗi khi máy dừng. Nên tắt máy lúc nghỉ không mất gì.

Giá trị đã lưu luôn **thấp hơn** số thật. Mất điện đúng lúc đang chạy thì mất số mũi từ lần ghi
cuối; sau khi khởi động lại `odometer` thấp hơn giá trị bridge thấy lần trước, bridge ghi
`counter-reset` và **không cộng** khoảng đó vào sản lượng. Đây là lựa chọn có chủ ý: thà mất một
khoảng có ghi log còn hơn làm tròn bộ đếm lên rồi cộng khống sản lượng.

`NODE_ODOMETER_BASE` để 0 thì `odometer` nghĩa là "số mũi kể từ lúc gắn node". Sản lượng theo ca
vẫn đúng vì bridge tính theo **hiệu số**. Muốn `odometer` là tổng của cả đời máy thì đọc số tổng
mũi trên màn hình máy rồi điền vào `NODE_ODOMETER_BASE`.

## Test không cần phần cứng

Toàn bộ phần ra quyết định (xung → rpm, cửa sổ đứt chỉ, ánh xạ trạng thái) và phần sinh JSON nằm
trong `stitch_logic.h` + `telemetry_payload.h`, không phụ thuộc Arduino, nên chạy test được ngay
trên máy tính:

```bash
cc -std=c11 -Wall -Wextra -Werror -o /tmp/sl firmware/esp32-stitch-node/test/stitch_logic_test.c && /tmp/sl
```

`npm test` cũng chạy đúng bài đó (`test/stitch-logic.test.mjs`), và
`bridge/lib/contract.test.mjs` kiểm gói JSON **nguyên văn** mà firmware sinh ra đi qua được
`normalizeTelemetry`. Hai chỗ dùng chung một chuỗi ký tự, nên firmware đổi output mà quên sửa test
thì test đỏ.

Chạy thử cả đường bridge → adapter bằng fixture, không cần ESP32:

```bash
node scripts/fixture-controller.mjs 9101 docs/fixtures/telemetry-node-cam-bien.json --spm=700
```

Script chỉ nghe `127.0.0.1`; muốn ghép máy trỏ vào nó thì bật `scan.allowLoopback: true` trong
`bridge.config.json` — chỉ trên máy phát triển, không bao giờ ở xưởng.

## Việc còn nợ

- `events[]`: node có thông tin "đèn vừa sáng lúc mấy giờ" nhưng không gửi, vì
  `bridge/lib/contract.mjs` đóng dấu cứng `source: 'controller'` cho mọi event. Muốn có event của
  node thì phải mở contract cho một nguồn `sensor` trước — đó là sửa contract, không phải sửa
  firmware, và cần bàn riêng.
- Chưa đo trên máy thật. Mọi con số ở trên là của firmware và test, không phải của máy A15 ở xưởng.
