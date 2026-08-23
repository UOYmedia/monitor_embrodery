# Test bằng máy in trên mạng (trước khi có máy thêu)

Chưa mang được máy thêu ra thì vẫn chạy thử được **gần hết** hệ thống, bằng một thiết bị mạng
thật mà bạn cắm/rút/làm kẹt giấy được ngay trên bàn: một máy in.

## Nói trước: nó chứng minh cái gì, và KHÔNG chứng minh cái gì

Máy in **không** phải máy thêu, và rig này **không** phải giả lập Dahao. Nó có ích vì phần
lớn thứ dễ hỏng trong hệ thống nằm ở chỗ khác chứ không nằm ở giao thức.

**Chứng minh được — bằng thiết bị thật, không phải fixture:**

- Vòng poll: nhịp, jitter, timeout, ngắt mạch (breaker) khi máy im lâu.
- Bốn trạng thái kết nối `online → stale → offline` và đường quay lại, đo bằng đồng hồ thật.
- Một lượt đọc **thất bại** được ghi nhận là thất bại, không âm thầm giữ lại snapshot cũ.
- Cảnh báo có thật: mở nắp máy, rút khay giấy → sự kiện lên dashboard, bấm xác nhận, vào audit.
- Trường không đọc được hiện **"Chưa đọc được từ controller"** — với khoảng trống thật chứ
  không phải khoảng trống do mình cố tình chừa ra trong file fixture.
- WebSocket delta, revision, panel chi tiết, ô vuông, bộ lọc, nhật ký kiểm toán.

**KHÔNG chứng minh được — vẫn phải đợi máy thêu:**

- Giao thức Dahao. Không một byte nào ở đây giống với thứ controller BECS đẩy ra.
- Kiểu vận chuyển **dial-in**: máy thêu **tự gọi vào** bridge (`C44 Server IP` / `C41 Server
  Port`), còn máy in thì bridge phải đi hỏi. Hai chiều ngược nhau, và chiều dial-in chỉ test
  được bằng `docs/test-mot-may-that.md`.
- Mọi thứ mang nghĩa thêu: mũi, kim, đứt chỉ, khung.

---

## Đấu nối

```
  ┌──────────────┐  IPP/HTTP   ┌───────────────┐   USB   ┌──────────┐
  │ printer-probe│ ──────────► │ Máy chủ in    │ ──────► │  Máy in  │
  │  :9110       │             │ (CUPS / Pi)   │         │          │
  └──────┬───────┘             └───────────────┘         └──────────┘
         │ HTTP JSON (contract)
         ▼
  ┌──────────────┐   WebSocket   ┌───────────┐
  │    bridge    │ ────────────► │ dashboard │
  └──────────────┘               └───────────┘
```

`printer-probe` đọc máy in bằng IPP rồi phát ra **đúng contract** trong
`docs/adapter-contract.md`. Bridge poll nó bằng adapter `http-json` có sẵn — **không phải sửa
một dòng nào trong `bridge/`**. Máy in có Ethernet/Wi-Fi thẳng thì bỏ ô "Máy chủ in", trỏ
probe vào chính nó.

---

## 1. Tìm địa chỉ IPP của máy in

Máy in cắm USB vào một máy khác và chia sẻ qua CUPS (rất phổ biến với Raspberry Pi):

```bash
lpstat -v                       # xem máy in đã cài trên Mac, tìm tên máy chủ
ping -c1 raspberrypi.local      # đổi tên .local ra IP
curl -s http://<IP>:631/printers/ | grep -o 'printers/[A-Za-z0-9_-]*' | sort -u
```

Ghép lại thành URI: `ipp://<IP>:631/printers/<tên-hàng-đợi>`.

## 2. Xem máy in báo được những gì (chưa đụng tới bridge)

```bash
npm run probe:may-in -- --printer=ipp://10.88.88.28:631/printers/May_In --once --raw
```

In ra toàn bộ thuộc tính IPP đọc được, snapshot sẽ gửi cho bridge, và **danh sách trường máy
in này không báo**. Chạy bước này trước để biết trước dashboard sẽ trống chỗ nào.

> **Nếu ra `fetch failed (EHOSTUNREACH)` mà `curl` ở mục 1 vẫn vào được máy in: không phải máy in.**
> Đó là quyền **Local Network** của macOS — `curl` được phép ra LAN, `node` thì chưa (đo trên Darwin 27,
> 17/08/2026). Sửa: System Settings → Privacy & Security → Local Network → bật cho ứng dụng đang chạy
> Node (Terminal / iTerm / Claude / `node`), rồi **thoát hẳn** ứng dụng đó và mở lại — quyền chỉ có hiệu
> lực với tiến trình mới. Probe tự in cách sửa này khi gặp đúng mã lỗi đó; xem
> `scripts/lib/local-network.mjs`.
>
> **Chưa bật kịp thì rig vẫn chạy được.** Probe tự chuyển sang gửi IPP qua `/usr/bin/curl` (cờ tay:
> `--via-curl`) và nói ra một lần rằng nó đang đi vòng. Nhưng đó chỉ là để thử ở nhà: **bridge chạy
> ngoài xưởng chỉ dùng `fetch`**, nên máy nào chạy bridge thật thì vẫn phải có quyền ra mạng nội bộ.
> Và `scripts/dns-log.mjs` thì không có đường vòng nào — nó phải *nhận* gói UDP, curl không làm hộ được.

## Bật cả bộ bằng một lệnh

Cấu hình xong một lần rồi (mục 3–5 bên dưới) thì từ đó về sau chỉ cần:

```bash
npm run may-in
```

Lệnh này bật **probe + bridge cùng lúc**, in ra địa chỉ bảng điều khiển, và **Ctrl-C tắt cả
hai**. Địa chỉ máy in lấy từ khối `_printer` trong `bridge.config.may-in.json` chứ không viết
cứng trong code. Một cái chết thì cái kia tự tắt theo: một probe còn sống trong khi bridge đã
tắt là trạng thái sinh ra số liệu gây hiểu nhầm.

Ba mục dưới đây là để cấu hình lần đầu, hoặc khi cần chạy tay từng phần.

## 3. Chạy probe

```bash
npm run probe:may-in -- \
  --printer=ipp://10.88.88.28:631/printers/May_In \
  --bind=10.88.88.32 --port=9110
```

`--bind` phải là **IP LAN của máy chạy probe**, không phải `127.0.0.1`: bridge từ chối gọi
loopback (chống SSRF) trừ khi bật `scan.allowLoopback`. Đây là rig thử nghiệm — **tắt khi thử
xong**.

## 4. Cấu hình bridge

Tạo `bridge.config.may-in.json` (file `bridge.config.*.json` nằm trong `.gitignore`):

```json
{
  "_printer": {
    "uri": "ipp://10.88.88.28:631/printers/May_In",
    "bind": "10.88.88.32", "port": 9110, "timeoutMs": 4000
  },
  "host": "127.0.0.1",
  "port": 8790,
  "logLevel": "debug",
  "sites": [{
    "id": "nha", "name": "Bàn thử nghiệm", "timeZone": "Asia/Ho_Chi_Minh",
    "allowedCidrs": ["10.88.88.0/24"], "freshSeconds": 30, "staleSeconds": 90
  }],
  "poll": { "intervalMs": 15000, "concurrency": 4, "timeoutMs": 4000 },
  "ingest": { "enabled": false },
  "auth": { "mode": "single-admin", "localActor": "test-may-in" },
  "allowedOrigins": ["http://127.0.0.1:8790"],
  "dataPath": "./bridge-data/may-in-store.json",
  "auditPath": "./bridge-data/may-in-audit.jsonl",
  "productionPath": "./bridge-data/may-in-production.json",
  "uiPath": "./dist"
}
```

`allowedCidrs` phải chứa IP của **probe**, vì đó mới là địa chỉ bridge gọi tới.

```bash
npm run build
npm run bridge:may-in
```

## 5. Ghép máy in vào

Mở `http://127.0.0.1:8790/` → tab *Quét mạng & ghép máy* (bật lại tab `pairing` trong
`src/lib/urlState.ts` nếu đang tắt), hoặc gọi thẳng API:

```bash
curl -s -X POST http://127.0.0.1:8790/api/v2/machines \
 -H 'content-type: application/json' -H 'origin: http://127.0.0.1:8790' \
 -d '{"machines":[{
   "name":"MÁY IN TEST (không phải máy thêu)",
   "assetTag":"TEST-PRINTER-01",
   "siteId":"nha", "zone":"Bàn thử nghiệm",
   "ipAddress":"10.88.88.32",
   "adapter":"http-json",
   "adapterConfig":{"port":9110,"path":"/","timeoutMs":4000},
   "model":"Brother HL-L2320D qua CUPS/IPP",
   "verification":{"status":"verified","evidence":"serial",
                   "verifiedBy":"test-may-in","verifiedAt":"2026-08-15T03:00:00Z"}
 }]}'
```

**Đặt tên có chữ "MÁY IN TEST".** Sổ máy này rồi sẽ có máy thêu thật; một dòng tên chung chung
là cách người sau nhìn nhầm số của máy in thành sản lượng của xưởng.

---

## Bảng ánh xạ: máy in nói gì → dashboard hiểu gì

| Dashboard | Đọc từ IPP | Ghi chú |
| --- | --- | --- |
| `status = running` | `printer-state = processing` | đang có giấy chạy |
| `status = stopped` | `printer-state = idle` | rảnh, chờ việc |
| `status = paused` | `printer-state = stopped` + reason `paused` | người bấm tạm dừng |
| `status = fault` | `printer-state = stopped`, reason khác | kẹt giấy, hết mực… |
| `status = unknown` | không đọc được `printer-state` | |
| cảnh báo | `printer-state-reasons` | `media-jam` → nghiêm trọng, `toner-low` → thông tin |
| tên sản phẩm | `job-name` của việc đang chạy | việc còn xếp hàng không tính |
| tiến độ | `job-media-sheets-completed / job-media-sheets` | **trang**, hiển thị dưới nhãn "mũi" |
| odometer | `printer-impressions-completed` | máy in nào có bộ đếm đời máy thì mới có |
| **RPM** | **không ánh xạ — luôn null** | xem bên dưới |

Hai chỗ cố tình để trống, và đó là điểm cần hiểu đúng:

- **RPM luôn trống.** IPP có `pages-per-minute`, nhưng đó là thông số catalogue in trên tờ
  rơi, không phải tốc độ đang chạy. Lấy nó làm RPM chính là kiểu bịa telemetry mà PRD cấm.
  Dashboard ghi "RPM chưa đọc" ở máy này là **đúng**.
- **Tiến độ chỉ có khi máy in tự đếm trang.** Nhiều driver (brlaser trong Brother HL-L2320D
  chẳng hạn) không đếm. Lúc đó ô ghi "Chưa có số mũi để tính tiến độ" thay vì vẽ một thanh
  dựng từ con số tự nghĩ ra. Muốn thấy thanh tiến độ chạy thì cần máy in có báo
  `job-media-sheets`.

Ánh xạ này được khoá bằng test: `scripts/lib/printer-ipp.test.mjs` chạy snapshot qua đúng
`normalizeTelemetry` của bridge, nên contract siết thêm luật là test vỡ ở đây chứ không vỡ ở
xưởng.

---

## Kịch bản nên thử

| Làm gì ở máy in | Dashboard phải hiện |
| --- | --- |
| In một tài liệu nhiều trang | `Đang chạy`, tên file lên dòng to nhất của ô vuông |
| Rút khay giấy | cảnh báo `media-empty` — *Hết giấy trong khay* |
| Mở nắp máy | cảnh báo `cover-open`, trạng thái `Lỗi máy` |
| Kẹt giấy | cảnh báo **nghiêm trọng** `media-jam`, ô đỏ, lên đầu bảng ưu tiên |
| Tạm dừng hàng đợi (`cupsdisable`) | `Tạm dừng` — **không** phải `Lỗi máy` |
| Rút dây mạng máy chủ in | sau 30s → `Dữ liệu cũ`, sau 90s → `Mất kết nối`, kèm lý do |
| Cắm lại | quay về `Đang kết nối` trong một nhịp poll |
| Bấm xác nhận một cảnh báo | biến mất khỏi "Cần xử lý", còn lại trong *Nhật ký kiểm toán* |

Chuyển trạng thái đã đo thật một lần: `online` → `stale` ở 49 giây → `offline` ở 92 giây, kèm
câu *"Mất liên lạc 92s, lần cuối bridge còn gọi được máy này."*

## Dọn dẹp

Ctrl-C ở cửa sổ đang chạy `npm run may-in` là tắt cả probe lẫn bridge. Xoá luôn dữ liệu buổi
test:

```bash
rm -f bridge-data/may-in-*.json bridge-data/may-in-*.jsonl
```

Sổ máy của buổi test nằm riêng trong `bridge-data/may-in-store.json`, không lẫn vào sổ máy
xưởng — nên xoá là sạch, và "MÁY IN TEST" không bao giờ đi theo vào cấu hình thật.
