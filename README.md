# Giám sát máy thêu Dahao — bảng điều khiển chỉ đọc

Hệ thống theo dõi **đội máy thêu Dahao** trong LAN nhà xưởng: một *bridge* chạy trong mạng
xưởng đọc telemetry từ controller, một dashboard web chỉ hiển thị. Thiết kế cho nhiều xưởng,
mỗi xưởng khoảng 100 máy, chạy được khi **không có Internet**.

Toàn bộ sản phẩm là **một chiều: đọc**. Không có lệnh nào đi từ dashboard xuống máy thêu.

## Sản phẩm này cố ý KHÔNG có

| Không có | Vì sao |
| --- | --- |
| Start / Stop / Pause / E-stop, đổi mẫu, ghi cấu hình controller | Điều khiển máy đang chạy kim từ trình duyệt là rủi ro an toàn lao động. Mọi thao tác điều khiển thực hiện tại bảng điều khiển của máy. |
| Mọi đường truyền file thiết kế (upload, download, hàng đợi, USB emulation, Design Server) | Không có API, không có nút, không có trạng thái truyền. Nạp mẫu vẫn là thao tác **USB thủ công tại máy**. `job.fileName` và `controller.designs` chỉ là *metadata do controller báo về*. |
| Đọc/parse/preview file `.dst` trong trình duyệt | Đã gỡ bỏ hoàn toàn cùng slice 1. |
| Trình duyệt gọi thẳng controller | Chỉ bridge nói chuyện với controller. |
| Dữ liệu mẫu, máy giả lập, số liệu demo | Màn hình trống kèm hướng dẫn còn an toàn hơn một con số bịa. Trường không đọc được luôn hiển thị **"Chưa đọc được từ controller"**. |
| Bắt buộc SaaS/cloud | Chạy trọn vẹn trong LAN. |

## Kiến trúc

```
  Máy thêu Dahao (VLAN thiết bị)        PC/Raspberry Pi gateway            Máy trạm / tablet xưởng
  ┌───────────────────────────┐         ┌──────────────────────┐           ┌─────────────────────┐
  │ controller + adapter đọc  │◀──poll──│  bridge (Node.js)    │◀──HTTP───▶│ dashboard (React)   │
  │ (http-json / tcp-json-line│  TCP    │  REST /api/v2        │   WS /ws  │ chỉ đọc, tiếng Việt │
  │  — xem docs/adapter-…)    │         │  store + audit log   │──────────▶│                     │
  └───────────────────────────┘         └──────────────────────┘           └─────────────────────┘
                                          ▲ chỉ bind IP LAN
                                          │ không NAT ra Internet
```

- Chỉ **bridge** chạm vào controller. Dashboard chỉ nói chuyện với bridge, cùng origin.
- Bridge tự phục vụ thư mục `dist`, nên không có vấn đề CORS/mixed-content trong xưởng.
- Truy cập từ xa: **VPN doanh nghiệp**, không mở port ra Internet (xem *Hardening*).

## Vai trò và quyền

| Quyền | viewer (quản đốc) | technician | admin |
| --- | :-: | :-: | :-: |
| `fleet:read`, `audit:read` | ✅ | ✅ | ✅ |
| `alert:acknowledge`, `maintenance:complete` | — | ✅ | ✅ |
| `scan:run`, `machine:pair`, `machine:update`, `machine:archive`, `machine:probe` | — | ✅ | ✅ |
| `site:manage`, `user:manage`, `retention:manage` | — | — | ✅ |

Mọi mutation đều có actor + bản ghi audit. Một mutation bị từ chối cũng được ghi audit
(`denied:<permission>`), vì lần thử cũng là bằng chứng.

**Chưa có đăng nhập thật, và cố ý không dựng đăng nhập giả.** Hai chế độ:

- `auth.mode = "single-admin"`: một người vận hành trên LAN tin cậy, actor lấy từ
  `auth.localActor`. Chỉ dùng khi bridge nằm sau lớp mạng đã kiểm soát truy cập.
- `auth.mode = "token"`: mỗi vai trò một access token đặt trong biến môi trường
  (`tokenEnv`), gửi qua `Authorization: Bearer …`. Token **chỉ nằm trong bộ nhớ tab trình
  duyệt**, không ghi `localStorage`, không ghi log.

TODO giai đoạn sau: OIDC/SSO doanh nghiệp (`user:manage` hiện chỉ là ranh giới quyền, chưa có
màn hình quản trị người dùng).

## Tab đang bật

Giao diện hiện chỉ bật **Tổng quan đội máy**. Bốn tab kia (*Sản lượng ca*, *Bảng andon*,
*Quét mạng & ghép máy*, *Nhật ký kiểm toán*) đã viết xong nhưng tạm tắt cho gọn màn hình.

Bật lại bằng đúng một dòng — mảng `tabs` trong `src/lib/urlState.ts`:

```ts
export const tabs: Tab[] = ['fleet', 'production', 'andon', 'pairing', 'audit']
```

Hai điều cần biết khi đang tắt:

- **Ghép máy mới phải bật lại tab `pairing`** (mục 9 bên dưới), hoặc gọi thẳng API. Không có
  đường nào khác để đưa một máy vào hệ thống từ giao diện.
- **Bảng andon treo TV vẫn chạy bình thường**: nó là địa chỉ riêng `?andon=1`, không phải một
  tab, nên tắt tab không ảnh hưởng màn hình trong xưởng.

Link cũ trỏ vào tab đã tắt (`?tab=audit`) mở ra Tổng quan đội máy, không phải màn hình trắng.

## Chạy để phát triển

```bash
npm install
npm run dev            # dashboard, cần một bridge đang chạy để có dữ liệu
npm run verify         # test + lint + build + kiểm tra cú pháp bridge (không cần mạng)
```

`npm run verify` = `vitest run` → `oxlint` → `tsc -b && vite build` → `scripts/check-bridge.mjs`.

## Triển khai LAN doanh nghiệp

> Xưởng dùng router mesh gia dụng (TP-Link Deco): xem
> **[`docs/mang-xuong-deco.md`](docs/mang-xuong-deco.md)** — quy trình lắp cụ thể, bản đồ IP,
> cách đặt `C43`/`C44`/`C41` trên bảng điều khiển, và những giới hạn Deco **không** đáp ứng
> được so với mục 5 và mục 6 bên dưới.

### 1. Chuẩn bị

- Một PC hoặc Raspberry Pi **cắm dây** vào switch của xưởng, IP tĩnh (hoặc DHCP reservation).
- Node.js 22+ trên máy đó. Không cần Internet sau khi đã `npm install`.
- Danh sách subnet của từng xưởng đã được IT phê duyệt để quét.

### 2. Cài đặt

```bash
git clone <repo> /opt/dahao-fleet && cd /opt/dahao-fleet
npm ci
cp bridge.config.example.json bridge.config.json    # sửa host, sites, allowedCidrs
cp .env.example .env                                 # đặt token nếu auth.mode = token
npm run build                                        # sinh dist/ để bridge phục vụ
npm run bridge
```

Sinh token: `openssl rand -base64 32` (tối thiểu 16 ký tự). `.env` và `bridge.config.json`
nằm trong `.gitignore` — đừng commit dải mạng nội bộ hay token.

### 3. Chạy như dịch vụ (systemd)

```ini
# /etc/systemd/system/dahao-bridge.service
[Unit]
Description=Dahao fleet bridge (LAN, read-only)
After=network-online.target

[Service]
WorkingDirectory=/opt/dahao-fleet
ExecStart=/usr/bin/node --env-file-if-exists=.env bridge/index.mjs
User=dahao
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/dahao-fleet/bridge-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now dahao-bridge && journalctl -u dahao-bridge -f
```

### 4. Cấu hình bridge

`bridge.config.json` (mẫu đầy đủ trong `bridge.config.example.json`):

| Khoá | Ý nghĩa |
| --- | --- |
| `host` | **Đặt IPv4 của card LAN**, không để `0.0.0.0`. Bridge chỉ nghe trên đúng card đó. |
| `sites[]` | `id`, `name`, `timeZone`, `allowedCidrs` (allowlist quét), `freshSeconds`, `staleSeconds`. |
| `poll` | `intervalMs`, `concurrency`, `jitterRatio`, `timeoutMs`, `backoffMs`, `maxBackoffMs`, `breakerFailures`, `breakerCooldownMs`. |
| `scan` | `concurrency`, `timeoutMs`, `maxPorts`, `maxHosts`, `allowLoopback`, `allowPublicRanges`. |
| `limits` | `maxMachines`, `maxBatchPairing`, `maxBodyBytes`, `scanPerMinute`, `mutationPerMinute`. |
| `auth` | `mode`, `localActor`, `tokens[]` (`tokenEnv`, không đặt token trong file). |
| `allowedOrigins` | CORS **mặc định deny**; liệt kê đúng origin của dashboard. |
| `dataPath`, `auditPath`, `uiPath` | Kho máy, nhật ký audit, thư mục `dist`. |

### 5. Firewall / VLAN

Tối thiểu ba luồng, không hơn:

| Từ | Đến | Cổng | Ghi chú |
| --- | --- | --- | --- |
| VLAN người dùng (tablet, PC quản đốc) | bridge | TCP 8787 | Chỉ HTTP/WS của dashboard. |
| bridge | VLAN thiết bị (máy thêu) | cổng adapter đã cấu hình | Một chiều, chỉ bridge khởi tạo. |
| VLAN thiết bị | bất kỳ | — | **Chặn**. Máy thêu không cần ra Internet, không cần gọi ngược lên bridge. |

- **Không NAT/port-forward 8787 ra Internet.** Truy cập từ xa đi qua VPN doanh nghiệp, VPN
  đổ vào VLAN người dùng.
- `allowedCidrs` của mỗi site phải khớp đúng subnet thiết bị của xưởng đó. Bridge từ chối
  loopback, link-local, multicast, broadcast, dải public và prefix ngoài khoảng `/22`–`/30`
  — chống SSRF và chống quét nhầm mạng người khác.
- Đặt xưởng thứ hai vào `sites[]` thứ hai với `allowedCidrs` riêng; kỹ thuật viên chọn site
  trước khi quét, không có ô nhập subnet tự do.

### 6. Wi-Fi hai băng tần trên cùng một VLAN

Nhiều xưởng có controller chỉ bắt 2.4 GHz còn PC/tablet ở 5 GHz. Để cả hai nhìn thấy nhau:

1. Hai SSID (hoặc band-steering) phải **bridge vào cùng một VLAN/subnet**. Khác subnet thì
   bridge không quét được máy dù cùng một router.
2. **Tắt Client isolation / AP isolation / Guest mode** trên SSID có máy thêu.
3. Cố định kênh 2.4 GHz (1/6/11) và giảm số máy trên một AP; access point yếu là nguyên nhân
   phổ biến nhất của trạng thái `stale` ngắt quãng.
4. Ưu tiên **cắm dây** cho PC gateway. Gateway đi Wi-Fi làm mọi máy stale cùng lúc.
5. Đặt IP tĩnh/DHCP reservation cho controller: bản ghi ghép máy neo theo IP + bằng chứng
   MAC/serial, IP nhảy sẽ làm poll thất bại cho tới khi kỹ thuật viên cập nhật.

Bridge chỉ hiển thị được thông tin Wi-Fi mà **firmware của chính máy đó** trả về. Nếu firmware
không cung cấp, ô đó là "Chưa đọc được từ controller" — không suy đoán từ mạng của gateway.

### 7. Checklist hardening

- [ ] `host` = IP LAN cụ thể, không `0.0.0.0`; không port-forward, không reverse proxy công khai.
- [ ] `allowedOrigins` liệt kê đúng origin dashboard (CORS mặc định deny).
- [ ] `auth.mode = "token"` khi có nhiều hơn một người dùng; token sinh ngẫu nhiên ≥ 16 ký tự,
      để trong `.env`, xoay vòng khi có người nghỉ việc.
- [ ] Không có secret nào trong bundle frontend: Vite chỉ nhúng biến `VITE_*`, và dự án cố ý
      không dùng biến `VITE_*` nào. Không lưu mật khẩu Wi-Fi/credential controller ở bất cứ đâu.
- [ ] Log đã redact; audit ghi actor, action, target, before/after, thời gian, correlation ID.
- [ ] `allowedCidrs` đúng subnet được cấp; `allowPublicRanges: false`, `allowLoopback: false`.
- [ ] Rate limit: `scanPerMinute`, `mutationPerMinute`, `maxBodyBytes` phù hợp quy mô.
- [ ] `bridge-data/` thuộc user chạy dịch vụ, `chmod 700`; nằm trong lịch backup.
- [ ] `.env`, `bridge.config.json` không vào git.
- [ ] Đồng hồ hệ thống đồng bộ NTP — toàn bộ freshness dựa trên thời gian.

### 8. Cấu hình theo quy mô

Mốc thiết kế: 100 máy/xưởng, 10 xưởng logic, 100 dòng hiển thị không giật.

| Quy mô | `poll.intervalMs` | `poll.concurrency` | `scan.concurrency` | Ghi chú |
| --- | --- | --- | --- | --- |
| ≤ 30 máy, LAN dây | 15 000 | 8 | 12 | Mặc định thoải mái. |
| ~100 máy, Wi-Fi tốt | 30 000 | 8–12 | 8 | Cấu hình mẫu. |
| ~100 máy, Wi-Fi yếu | 45 000–60 000 | 4–6 | 4 | Tăng `poll.timeoutMs` lên 4 000. |

- `jitterRatio` (0.2) rải các lượt poll ra, để 100 máy không bị hỏi cùng một nhịp.
- Máy lỗi liên tiếp `breakerFailures` lần bị ngắt mạch `breakerCooldownMs`, tránh kéo cả lượt poll.
- WebSocket gửi **delta** (`machine_update`) kèm `revision` tăng dần; dashboard chỉ thay đúng
  máy thay đổi, hàng đã memo hoá nên không vẽ lại cả bảng.
- Ngưỡng tươi/cũ đặt theo site: mặc định ≤ 30s là `online`, 30–90s `stale`, quá 90s là
  `offline` hoặc `unknown` tuỳ máy còn mở cổng TCP hay không.

### 9. Đưa một máy thật vào hệ thống

1. Kỹ thuật viên mở tab **Quét mạng & ghép máy**, chọn site, tick xác nhận cảnh báo quét LAN.
2. Bridge quét trong `allowedCidrs`, giới hạn `maxHosts`/`maxPorts`/timeout.
3. Mỗi kết quả hiện **"Thiết bị chưa xác nhận"** kèm IP, MAC (nếu đọc được), cổng mở, thời điểm
   phát hiện. Cổng TCP mở **không** chứng minh đó là máy Dahao — hệ thống không tự gán nhãn.
4. Kỹ thuật viên **ra tận máy** đối chiếu màn hình/nhãn, nhập tên chuẩn, mã tài sản, site, zone,
   model, serial, chọn bằng chứng xác minh (`mac` | `serial` | `assetTag`) rồi ghép.
5. Trùng IP, MAC, serial hoặc mã tài sản bị chặn trước khi ghi; ghép lô là **all-or-nothing**.
6. Máy chưa xác minh **không** vào KPI sản xuất chính.

Máy mới ghép mặc định adapter `manual`: có trong sổ tài sản, mọi thông số là "Chưa đọc được từ
controller". Telemetry chỉ chạy sau khi cấu hình adapter đúng giao thức.

### 10. Tích hợp giao thức thật

Repo **không** chứa giao thức Dahao. Bốn adapter là bốn *cơ chế truyền*, không phải bốn cách
nói chuyện với controller Dahao:

- `manual` — chỉ đăng ký tài sản, không đọc gì.
- `http-json` — `GET` một endpoint JSON đúng hợp đồng.
- `tcp-json-line` — mở TCP, tuỳ chọn gửi một dòng lệnh, đọc một dòng JSON.
- `dial-in` — bridge **lắng nghe**, máy tự gọi vào và đẩy JSON từng dòng.

Để đọc máy Dahao thật cần **tài liệu giao thức từ nhà sản xuất** hoặc **một bản bắt gói được
cho phép bằng văn bản** trên máy của chính doanh nghiệp. Chi tiết hợp đồng, quy tắc `Reading`
(`value`, `observedAt`, `source`, `quality`), và cách viết adapter mới:
[`docs/adapter-contract.md`](docs/adapter-contract.md).

⚠️ Manual BECS của Dahao cho thấy controller được cấu hình **IP + cổng của server** (`C44`,
`C41`, mặc định cổng `1600`) rồi tự kết nối ra phần mềm `EmbNetServer` — tức là **máy là
client, PC là server**, ngược chiều với hai adapter hỏi vòng. Adapter `dial-in` dựng sẵn đúng
chiều đó: khối `ingest` trong config, **mặc định tắt**, chỉ nhận JSON đúng hợp đồng, **không
bao giờ ghi ngược một byte nào** xuống socket, nhận dạng máy theo địa chỉ nguồn, và byte lạ
chỉ được đếm/ghi hex để giải mã sau chứ không thành telemetry. Xem mục 1.1 trong
`docs/adapter-contract.md`. Nó là cái ống — vẫn chưa phải bộ giải mã giao thức Dahao.

`docs/fixtures/*.json` là **fixture phát triển**, dùng để chạy thử và viết test — không phải dữ
liệu từ máy thật, không bao giờ được hiển thị như telemetry sống.

Hai tài liệu để chạy thử với **thiết bị thật**:

- [`docs/test-mot-may-that.md`](docs/test-mot-may-that.md) — nối một máy thêu, bắt gói, xem
  controller thực sự đẩy ra cái gì. Đây là đường duy nhất để viết bộ giải mã Dahao.
- [`docs/test-may-in.md`](docs/test-may-in.md) — **chưa có máy thêu** thì dùng một máy in mạng
  (IPP) làm thiết bị thật để chạy thử vòng poll, timeout, bốn trạng thái kết nối, cảnh báo và
  audit. `scripts/printer-probe.mjs` phát đúng hợp đồng snapshot nên adapter `http-json` dùng
  được ngay, **không sửa gì trong `bridge/`**. Cấu hình xong thì `npm run may-in` bật cả bộ.
  Nó **không** chứng minh gì về giao thức Dahao hay chiều dial-in.

### 10.1 Ảnh mẫu trong ô máy — thư viện `.DST` của xưởng

Mỗi ô máy có một ô ảnh vuông hiện **hình mẫu đang thêu**, giống màn hình chọn mẫu trên
controller. Nhưng nguồn của ảnh thì khác hẳn, và chỗ này phải nói thẳng:

> **Ảnh không đọc từ máy thêu.** Controller chỉ báo lên **tên file** (`80_4127~.DST`). Bridge
> lấy tên đó đi tìm trong một thư mục `.DST` **của chính xưởng**, rồi tự dựng hình từ file đó.
> Không có ảnh nào đi từ máy về, và **không có file nào đi từ dashboard xuống máy** — nạp mẫu
> vẫn là cắm USB như cũ.

Bật bằng một dòng trong `bridge.config.json`:

```jsonc
"designLibrary": {
  "path": "/opt/dahao-fleet/mau-theu",   // chép file .DST của xưởng vào đây
  "maxFiles": 5000,
  "maxFileBytes": 8388608
}
```

Để `null` (mặc định) là tắt — ô ảnh ghi "Chưa bật" chứ không im lặng biến mất.

Bốn điều cần biết trước khi dùng:

- **Không có màu.** File DST không chứa màu chỉ — màu trên màn hình controller là do máy gán
  kim → chỉ. Nên hình ở đây là **nét một màu**. Tô bảy màu cho giống ảnh chụp là bịa số liệu.
- **Tên rút gọn có thể trùng.** Controller báo tên DOS 8.3, `80_4127_LogoAnhChi.DST` và
  `80_4127_LogoAnhHai.DST` đều thành `80_4127~.DST`. Bridge **không đoán**: ô ghi "Trùng tên"
  và liệt kê các mẫu trùng trong panel chi tiết. Hiện nhầm ảnh mẫu khác thì người đứng máy
  không có cách nào biết là nhầm — tệ hơn hẳn không có ảnh. Cách sửa: đặt tên mẫu khác nhau
  **trong 8 ký tự đầu**.
- **Ảnh nói về cái tên, không nói về sợi chỉ.** Ai đó nạp mẫu khác bằng USB mà trùng tên file
  thì ô vẫn hiện ảnh cũ. Ô ảnh là gợi ý nhận dạng, không phải bằng chứng.
- **Chỉ đọc.** Bridge liệt kê thư mục, đọc file, dựng SVG. Không ghi, không sửa, không xoá,
  không gửi đi đâu. Trình duyệt chỉ gửi lên một **cái tên**, và bridge chỉ mở những file đã có
  trong bảng liệt kê của chính nó — tên có `../` hay dấu `/` bị từ chối thẳng.

### 11. Backup, restore, rollback

Bridge ghi hai file trong `bridge-data/`:

| File | Nội dung | Cách ghi |
| --- | --- | --- |
| `fleet-store.json` | Sổ máy, verification, zone/site, kế hoạch bảo trì | Ghi tạm → `fsync` → `rename`; bản trước giữ lại thành `fleet-store.json.bak` |
| `audit-log.jsonl` | Nhật ký append-only | Nối dòng JSON, không sửa, không xoá ngầm |

```bash
# Backup (cron hằng ngày, giữ 30 bản)
systemctl stop dahao-bridge       # hoặc backup nóng: file luôn ở trạng thái hợp lệ nhờ rename atomic
tar czf /backup/dahao-$(date +%F).tar.gz bridge-data bridge.config.json
systemctl start dahao-bridge

# Restore
systemctl stop dahao-bridge
tar xzf /backup/dahao-2026-08-14.tar.gz -C /opt/dahao-fleet
systemctl start dahao-bridge      # store được validate lúc khởi động

# Rollback bản mã nguồn
git checkout <tag-cũ> && npm ci && npm run build && systemctl restart dahao-bridge
```

Khi khởi động, bridge validate từng bản ghi. Bản ghi hỏng không làm sập dịch vụ: nó bị
**cách ly (quarantine)** và hiện thành cảnh báo migration trên đầu dashboard, phần còn lại chạy
bình thường. Nếu `fleet-store.json` không đọc được, bridge tự dùng `.bak`.

## API và giao thức

- REST: `/api/v2/…`. Phân trang/định danh xem bảng route trong `bridge/index.mjs`.
- `/api/health` — **liveness không cần xác thực**: chỉ `status`, `schemaVersion`, `startedAt`,
  `serverTime`. Cố ý không có tên site, subnet hay số lượng máy.
- `/api/v2/health` — cần `fleet:read`: cấu hình site, ngưỡng, số máy, cảnh báo migration.
- `/api/v2/session` — endpoint duy nhất caller ẩn danh đọc được, cho biết token có quyền gì.
- `GET /api/v2/production?from=&to=&siteId=&machineId=` — cần `fleet:read`. Sản lượng theo
  ngày/ca/máy và tiền khoán. Chỉ đọc, không có mutation nào ở đây (xem *Sản lượng ca*).
- WebSocket `/ws`: `hello` → `fleet_state` → `machine_update` / `machine_removed`, kèm
  `revision` tăng dần. Trình duyệt gửi token qua `Sec-WebSocket-Protocol: bearer, <token>`
  (không dùng query string vì query string lọt vào access log của proxy).
- Socket là **một chiều**: message từ client bị bỏ qua có chủ đích, không tồn tại kênh lệnh.

### Migration v1 → v2

API v1 đã bị **loại bỏ, không shim**, vì payload của nó hàm ý một tính năng truyền file.
Mọi đường dẫn v1 (`/api/machines`, `/api/pair`, `/api/scan`, `/api/upload`, `/api/transfer`, …)
trả **410 Gone** kèm thông báo trỏ về mục này.

| v1 | v2 | Khác biệt |
| --- | --- | --- |
| `GET /api/machines` | `GET /api/v2/fleet` | Trả `MachineView` có `identity` / `telemetry` / `connection` / `thresholds`; mọi giá trị là `Reading` có `observedAt`, `source`, `quality`. |
| `POST /api/pair` | `POST /api/v2/machines` | Bắt buộc `assetTag`, `siteId`, và `verification` có bằng chứng; ghép lô all-or-nothing. |
| `POST /api/unpair` | `POST /api/v2/machines/:id/archive` | Soft-delete có audit, không xoá vĩnh viễn. |
| `POST /api/scan` | `POST /api/v2/scan` | Bắt buộc `siteId` + `acknowledgeScanWarning: true`; CIDR phải nằm trong allowlist của site. |
| `GET /api/health` | `GET /api/v2/health` | Bản không phiên bản còn lại nhưng chỉ là liveness. |
| `snapshot` / `fleet_snapshot` qua WS | `fleet_state` + `machine_update` | Gửi delta có `revision` thay vì phát lại toàn bộ đội máy. |
| `controller.transfer` | *(đã xoá)* | Không có API thay thế: sản phẩm không truyền file. Payload còn trường này bị **từ chối**. |

**Dữ liệu cũ tự migrate.** Nếu tồn tại `bridge-data/paired-machines.json` (v1, mảng thuần),
bridge đọc, chuyển sang schema v2, sinh `assetTag` `MIGRATED-n` khi thiếu, gán site mặc định và
đặt `verification.status = "unverified"` — máy cũ phải được kỹ thuật viên xác minh lại trước khi
vào KPI sản xuất. File gốc **không bị xoá**; sao lưu nó trước khi nâng cấp.

## Trạng thái hiển thị

| Trạng thái | Nghĩa | Không bao giờ nghĩa là |
| --- | --- | --- |
| `online` | Telemetry mới hơn `freshSeconds`. | |
| `stale` | Có telemetry thật nhưng đã cũ. | Không phải máy hỏng. |
| `offline` | Bridge không mở được cổng tới máy. | **Không** phải `fault`. |
| `unknown` | Chưa có giao thức, hoặc host trả lời nhưng không có dữ liệu dùng được. | Không phải "máy đang chạy bình thường". |
| `fault` | **Chỉ khi controller tự báo lỗi.** | Không bao giờ suy ra từ mất kết nối TCP. |

Màu không bao giờ là kênh thông tin duy nhất: mỗi trạng thái đều có nhãn chữ, lý do và mốc thời
gian. API dùng ISO 8601 UTC; dashboard đổi sang múi giờ của site khi hiển thị.

## Sản lượng ca & lương khoán

Số mũi **không** do dashboard ước lượng. Bridge đọc bộ đếm tổng (odometer) của controller mỗi
lượt poll và cộng phần **chênh lệch giữa hai lần đọc** vào đúng ca. Máy không báo được odometer
thì không có dòng nào — bảng để trống thay vì đoán.

### Khai báo ca

Trong `bridge.config.json`, mỗi site có mảng `shifts`:

```json
"shifts": [
  { "id": "ca-1", "name": "Ca ngày", "start": "06:00", "end": "18:00" },
  { "id": "ca-2", "name": "Ca đêm",  "start": "18:00", "end": "06:00" }
]
```

- Giờ là **giờ địa phương của site** (`timeZone`), không phải giờ server. Server chạy UTC vẫn
  chia ca đúng.
- **Ca qua đêm tính vào ngày bắt đầu**: ca đêm 18:00 ngày 14 → 06:00 ngày 15 nằm trọn trong ngày
  công 14. Nửa đêm UTC không cắt ca làm đôi.
- **Ca không được chồng lấn** (kể cả bắc qua nửa đêm) — bridge từ chối khởi động, vì ca chồng
  nhau nghĩa là một số mũi được trả lương hai lần.
- Giờ không thuộc ca nào rơi vào nhóm **"Ngoài ca"** (`ngoai-ca`) và hiện rõ trên báo cáo. Không
  có mũi nào bị bỏ im lặng. Bridge cảnh báo lúc khởi động nếu site có khoảng trống như vậy.
- Không khai `shifts` = một ca "Cả ngày" 24h duy nhất — thà gộp thật còn hơn đoán hai ca 12h.
- Tối đa 6 ca mỗi site.

### Đơn giá khoán

- Đơn giá tính bằng **VND cho 1.000 mũi**. Thành tiền = `round(số mũi / 1000 × đơn giá)`.
- Thứ tự ưu tiên: đơn giá riêng của máy → `pricePer1000Stitches` của site → **không có** thì cột
  tiền để trống kèm chữ "Chưa đặt đơn giá", không bao giờ hiện `0 đ`.
- Đặt đơn giá máy ở tab *Tổng quan đội máy* → chọn máy → **Đặt đơn giá khoán**. Cần quyền
  `machine:update` và được ghi audit như mọi mutation khác.
- Tiền được tính **lúc truy vấn**, theo đơn giá đang đặt. Đổi đơn giá là cả kỳ được tính lại,
  nên **xuất file CSV khi đã chốt lương** — file xuất ra mới là bản ghi của kỳ đó.

### Số nào bị loại khỏi tổng

| Tình huống | Bridge làm gì |
| --- | --- |
| Lần đọc đầu tiên của một máy | Lấy làm mốc, không tính mũi (không có "trước" để trừ) |
| Bộ đếm nhỏ hơn lần trước (reset/thay bo) | Đếm là `resets`, lấy mốc mới, **không** tính âm |
| Nhảy quá `maxStitchesPerMinute` × thời gian trôi | Đếm là `anomalies`, **không** tính tiền, hiện trên KPI "Bộ đếm bất thường" |
| Máy chưa được kỹ thuật viên xác minh | Vẫn hiện dòng, nhưng **không vào tổng** và có banner nói rõ |
| Máy đã lưu trữ (archive) | Giữ nguyên các dòng lịch sử — lương kỳ trước không biến mất |

"Giờ máy chạy" chỉ cộng khi controller báo `running`, và mỗi khoảng chỉ cộng tối đa
`maxRunGapSeconds` (mặc định 120s) để một lần mất kết nối dài không biến thành ca chạy 8 tiếng.

### Lưu trữ và xuất file

- Sổ nằm ở `productionPath` (mặc định `bridge-data/production.json`), ghi xuống đĩa mỗi
  `flushIntervalMs` (mặc định 60s) bằng ghi nguyên tử có `.bak`. Mất điện giữa chừng thì máy đó
  chỉ lấy mốc lại — **không nhân đôi** sản lượng.
- `production.retentionDays` (mặc định 120) xoá các ngày công cũ hơn ngưỡng lúc khởi động.
  Muốn giữ lương cả năm thì đặt 400 và sao lưu file này cùng `fleet-store.json`.
- Nút **Xuất Excel (CSV)** tạo file ngay trong trình duyệt: UTF-8 có BOM, phân cách bằng dấu
  `;`, mở thẳng bằng Excel bản tiếng Việt. Ô bắt đầu bằng `=`, `+`, `-`, `@` bị thêm dấu nháy để
  Excel không chạy như công thức. **Không có gì rời khỏi LAN.**

## Bảng andon treo tường

Tab *Bảng andon* là màn hình cho TV treo giữa xưởng: ô lớn, một máy một ô, xếp máy **cần người
xử lý lên trước**. Địa chỉ dành riêng cho TV:

```
http://IP-BRIDGE:8787/?andon=1
```

Trang `?andon=1` chỉ có bảng andon — không tab, không bộ lọc đội máy, không lối vào màn hình
ghép máy, để người đi ngang bấm nhầm cũng không sang được chỗ khác. Nút **Toàn màn hình** dùng
fullscreen của trình duyệt; trình duyệt TV nên bật chế độ kiosk và tắt sleep.

- Bảng dùng lại đúng WebSocket của dashboard: treo thêm một TV **không** làm bridge poll thêm
  lần nào. Mỗi phút nó hỏi thêm một lần `/api/v2/production` cho số mũi trong ca.
- Quá nhiều máy so với số ô mỗi trang thì bảng **tự chuyển trang mỗi 15 giây** (tắt được).
- Thứ tự ưu tiên hiển thị: `LỖI MÁY` → `MẤT KẾT NỐI` → `CẢNH BÁO` → `DỮ LIỆU CŨ` → `CHƯA RÕ` →
  `DỪNG` → `ĐANG CHẠY`. Trong cùng một nhóm thì xếp theo tên, để ô không nhảy chỗ mỗi nhịp.
- Máy bridge không đọc được **không bao giờ** hiển thị là "đang chạy" — nó nằm ở nhóm cần chú ý.
  Bảng im lặng nghĩa là "không biết", và trên tường thì "không biết" phải nhìn thấy được.
- Mỗi ô có chữ + ký hiệu (`✕ ○ ▲ ◐ ? ■ ▶`) chứ không chỉ có màu.
- Bảng vẫn **chỉ đọc**: không có nút nào tác động tới máy, kể cả xác nhận cảnh báo.

## Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
| --- | --- | --- |
| Dashboard trống, báo "chưa liên lạc được bridge" | Bridge chưa chạy, sai host/port, firewall chặn 8787 | `curl http://IP-BRIDGE:8787/api/health` → phải thấy `status: "ok"`. |
| "Chưa có quyền xem đội máy" | Token thiếu `fleet:read` hoặc chưa nhập | Nhập access token ở góc trên bên phải; token không được lưu vào trình duyệt. |
| 403 khi mở dashboard từ máy khác | Origin không nằm trong `allowedOrigins` | Thêm đúng `http://IP:PORT` vào `allowedOrigins` rồi khởi động lại. |
| 410 Gone | Client cũ còn gọi API v1 | Xem *Migration v1 → v2*. |
| Quét không ra máy nào | Máy khác VLAN/subnet, hoặc bật AP isolation | Đối chiếu mục *Wi-Fi hai băng tần*; kiểm tra `allowedCidrs`. |
| Quét bị từ chối trước khi phát gói | CIDR ngoài allowlist, prefix quá rộng/hẹp, dải cấm | Chọn đúng site; prefix trong khoảng `/22`–`/30`. |
| 429 | Vượt `scanPerMinute` / `mutationPerMinute` | Chờ, hoặc chỉnh `limits` nếu xưởng thực sự lớn hơn. |
| Máy hiện "Chưa đọc được từ controller" | Adapter `manual`, hoặc firmware không cung cấp trường đó | Đúng như thiết kế. Cấu hình adapter thật khi đã có tài liệu giao thức. |
| Máy chuyển `stale` rồi `offline` theo chu kỳ | Wi-Fi yếu, AP quá tải, timeout ngắn | Tăng `poll.timeoutMs`, giảm `poll.concurrency`, xem mục Wi-Fi. |
| Banner "Adapter trả payload sai hợp đồng" | Endpoint trả sai kiểu/thiếu trường bắt buộc | Bridge **giữ ảnh chụp tốt trước đó** và không hợp nhất gói lỗi. Sửa adapter theo `docs/adapter-contract.md`. |
| Banner migration trên đầu trang | Có bản ghi bị quarantine lúc khởi động | Đọc lý do trong banner và `journalctl -u dahao-bridge`; sửa hoặc ghép lại máy đó. |
| Mất WebSocket | Mạng chập chờn, bridge restart | Banner toàn cục hiện thời điểm cập nhật cuối; dashboard tự kết nối lại. |
| Tab *Sản lượng ca* trống trơn | Máy dùng adapter `manual`, hoặc firmware không trả odometer | Đúng như thiết kế: không có bộ đếm thì không có sản lượng. Xem `docs/adapter-contract.md`. |
| Sản lượng dồn hết vào ca "Cả ngày" | Site chưa khai `shifts` | Khai ca trong `bridge.config.json` rồi khởi động lại; các ngày cũ vẫn giữ nhóm ca lúc ghi. |
| Có dòng "Ngoài ca" | Có khoảng giờ không thuộc ca nào | Đọc cảnh báo lúc khởi động; nới giờ ca hoặc chấp nhận nhóm này. |
| Bridge không khởi động, báo ca chồng lấn | Hai ca phủ lên nhau | Sửa `shifts`. Cố ý chặn: ca chồng nhau sẽ trả lương hai lần cho cùng số mũi. |
| KPI "Bộ đếm bất thường" tăng | Bộ đếm nhảy quá `maxStitchesPerMinute`, hoặc controller đổi bo | Khoảng đó **không** được tính tiền. Kiểm tra máy trước khi nới trần. |
| TV andon ngủ hoặc hiện tab khác | Trình duyệt TV chưa ở chế độ kiosk | Mở `?andon=1`, bật kiosk, tắt screensaver/sleep của TV. |

Mọi phản hồi lỗi kèm `correlationId`; tìm đúng dòng log bằng
`journalctl -u dahao-bridge | grep <correlationId>`.

## Khoảng trống đã biết

- **Chưa có adapter Dahao thật.** Cần tài liệu giao thức hoặc bản bắt gói được cho phép. Cho tới
  lúc đó mọi máy `manual` hiển thị "Chưa đọc được từ controller" thay vì số liệu suy đoán.
- **Chưa có OIDC/SSO.** Hiện là single-admin hoặc token theo vai trò.
- **Chưa có xuất CSV/JSON** cho audit (sản lượng thì đã có; audit để giai đoạn sau, ranh giới
  quyền `retention:manage` đã sẵn).
- **Chưa có cảnh báo đẩy ra Zalo/điện thoại.** Cần Zalo OA token và đường ra Internet của doanh
  nghiệp nên chưa dựng; hiện cảnh báo chỉ nằm trên dashboard và bảng andon.
- **Lương khoán tính theo máy, chưa theo người.** Chưa có bảng phân công công nhân ↔ máy ↔ ca,
  nên báo cáo trả lời "máy nào ra bao nhiêu tiền", còn ghép sang người vẫn làm thủ công.
- **Chưa có màn hình quản trị người dùng/site**; site khai báo trong `bridge.config.json`.
