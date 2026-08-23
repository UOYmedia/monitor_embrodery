/*
 * Mẫu cấu hình cho node cảm biến. Cách dùng:
 *
 *   cp firmware/esp32-stitch-node/config.example.h firmware/esp32-stitch-node/config.h
 *
 * rồi sửa `config.h`. File `config.h` đã bị .gitignore chặn: **mật khẩu WiFi không bao giờ được
 * nằm trong repo này, không gửi qua chat công việc, ghi trên giấy là đủ.**
 */
#ifndef NODE_CONFIG_H
#define NODE_CONFIG_H

/* ------------------------------------------------------------------ mạng */

#define NODE_WIFI_SSID "XUONG-THEU"
#define NODE_WIFI_PASSWORD "tu-go-vao-day-khong-commit"
#define NODE_HOSTNAME "node-theu-01"

/* Máy chủ NTP. Nếu LAN xưởng không ra Internet, để nguyên cũng được: node sẽ không đồng bộ được
   giờ và khi đó nó **bỏ hẳn** trường `observedAt`, để bridge tự đóng dấu `receivedAt`. Đúng hơn là
   gửi một cái đồng hồ sai. Có router làm NTP thì điền IP router vào đây. */
#define NODE_NTP_SERVER "pool.ntp.org"

/* IP tĩnh (tuỳ chọn). Bỏ comment cả 4 dòng nếu muốn node có địa chỉ cố định.
   Cách gọn hơn: để DHCP và đặt "reserve IP" cho MAC của node trên Deco — bridge cần IP ổn định
   để poll, nhưng đặt chỗ trên router thì không phải sửa firmware khi đổi dải mạng.
   IP phải nằm trong dải LAN xưởng (192.168.7.0/24) và trong `allowedCidrs` của bridge. */
/* #define NODE_STATIC_IP "192.168.7.31" */
/* #define NODE_GATEWAY   "192.168.7.254" */
/* #define NODE_SUBNET    "255.255.255.0" */
/* #define NODE_DNS       "192.168.7.254" */

/* Cổng và đường dẫn phải khớp `adapterConfig` khi ghép máy trong bridge:
   "adapter": "http-json", "adapterConfig": { "port": 8080, "path": "/telemetry" } */
#define NODE_HTTP_PORT 8080
#define NODE_TELEMETRY_PATH "/telemetry"

/* Hiện ở `/health` để biết cái node trên máy nào đang chạy bản nào. */
#define NODE_FIRMWARE_ID "node-theu-1.0.0"

/* ------------------------------------------------------------------ cảm biến đếm mũi */

/* Chân đọc xung: 1 xung = 1 vòng trục chính = 1 mũi. GPIO 27 không phải chân strapping,
   không dùng khi boot, nên an toàn. */
#define NODE_PULSE_PIN 27

/* Cảm biến NPN hở cực góp (hoặc module quang có cực góp hở) cần điện trở kéo lên: để 1.
   Module đã có ngõ ra đẩy-kéo 3V3 thì để 0. */
#define NODE_PULSE_PULLUP 1

/* Đếm theo sườn nào cũng được — mỗi vòng vẫn đúng 1 xung, chỉ lệch pha. RISING hoặc FALLING. */
#define NODE_PULSE_EDGE FALLING

/* Chống dội. 4000 µs chặn dội cơ khí mà vẫn cho tới 15.000 mũi/phút.
   Cách kiểm: cho máy chạy một mẫu đã biết số mũi, so `stitchesCounted` ở `/health` với số mũi
   trên màn hình máy. Đếm dư ⇒ tăng số này. Đếm thiếu ⇒ giảm, hoặc chỉnh lại cảm biến. */
#define NODE_PULSE_DEBOUNCE_US 4000

/* Bao lâu không có xung thì coi là trục đã dừng. 2500 ms ⇒ dưới ~24 mũi/phút bị coi là dừng. */
#define NODE_RUNNING_TIMEOUT_MS 2500

/* Khoảng lấy mẫu cho `rpmHistory`. 10 s × 24 ô = 4 phút gần nhất. */
#define NODE_HISTORY_PERIOD_MS 10000

/* Bề rộng cửa sổ đếm đứt chỉ, tính bằng mũi. */
#define NODE_BREAK_WINDOW_STITCHES 5000

/* ------------------------------------------------------------------ cảm biến đèn báo */

/* 0 = không gắn cảm biến đèn. Khi đó node chỉ báo running/stopped/unknown và **không** gửi
   `threadBreakWindow` — không có thông tin thì không gửi trường đó, chứ không gửi số 0. */
#define NODE_LAMP_ENABLED 0

#define NODE_LAMP_PIN 26
#define NODE_LAMP_PULLUP 1

/* Phần lớn module cảm biến sáng kéo ngõ ra xuống LOW khi thấy sáng ⇒ để 1.
   Cách kiểm: mở `/health`, che rồi soi đèn vào cảm biến, xem `lampPinHigh` đổi thế nào. */
#define NODE_LAMP_ACTIVE_LOW 1

/* Mức đèn phải giữ ổn định bao lâu mới được tính. Đèn nhấp nháy là chuyện thường. */
#define NODE_LAMP_DEBOUNCE_MS 200

/* Đèn nháy liên tục vẫn chỉ tính là **một** lần báo trong khoảng này. */
#define NODE_LAMP_HOLDOFF_MS 5000

/* Sau một lần báo, giữ trạng thái `fault` trong khoảng này, để một cú nháy tối giữa hai lần
   bridge poll không làm mất trạng thái lỗi. */
#define NODE_LAMP_LATCH_MS 15000

/* ⚠ CHỈ bật khi bạn đã tự xác nhận trên máy của mình rằng đèn đó sáng nghĩa là máy dừng vì
   đứt chỉ (thử: rút chỉ ra cho máy dừng, xem đèn). Bật khi chưa xác nhận thì `breaks` chỉ là
   phỏng đoán — đúng nghĩa là bịa số. Repo này không có bảng tra "đèn nào nghĩa là gì" vì không
   có tài liệu firmware nào của Dahao nói vậy. */
#define NODE_LAMP_MEANS_STOP 0

/* ------------------------------------------------------------------ bộ đếm */

/* Số mũi khởi điểm. Để 0 thì `odometer` nghĩa là "số mũi kể từ lúc gắn node" — sản lượng theo ca
   vẫn đúng vì bridge tính theo hiệu số. Nếu máy có màn hình tổng số mũi, đọc và điền vào đây thì
   `odometer` mới là tổng của cả đời máy. */
#define NODE_ODOMETER_BASE 0ULL

/* Bao nhiêu mũi thì ghi bộ đếm vào NVS. 5000 mũi ≈ 5 phút ở 1000 mũi/phút. Node còn ghi thêm một
   lần nữa mỗi khi máy dừng, nên chỉ mất số mũi khi **mất điện giữa lúc đang chạy** — xem README. */
#define NODE_PERSIST_EVERY_STITCHES 5000

#endif /* NODE_CONFIG_H */
