# Đưa bridge ra `https://redthread.phonh.io.vn` qua Cloudflare Tunnel

## 0. Điều phải đọc trước khi bấm bất cứ lệnh nào

Bridge trên Mini **đang chạy `auth.mode: single-admin`**. Chú thích trong chính config của nó ghi:
*"MOI client toi duoc coi la admin -> chi mo trong tailnet rieng"*.

Đưa nguyên trạng đó ra Internet là **giao quyền admin cho bất kỳ ai gõ đúng địa chỉ**: ghép máy,
lưu trữ máy, quét mạng, nhập số sản lượng (số đó ra tiền lương khoán). Vì vậy thứ tự dưới đây là
**siết quyền trước, mở cổng sau** — không được đảo.

## 1. Hiện trạng đã đo (22/08)

| Kiểm | Kết quả |
| --- | --- |
| `dig NS phonh.io.vn` | `sarah/razvan.ns.cloudflare.com` — tên miền **đã** ở Cloudflare |
| `curl https://redthread.phonh.io.vn/` | **HTTP 530** (Argo Tunnel error) — bản ghi tunnel **đã có sẵn**, chỉ thiếu tunnel đang chạy |
| `cloudflared` trên Mini | đã cài (`/opt/homebrew/bin/cloudflared`) |
| `~/.cloudflared/` | **chưa có chứng chỉ** — cần đăng nhập một lần |

Nghĩa là phần DNS coi như xong. Việc còn lại nằm trên Mini.

## 2. Token API — đã sinh sẵn

`~/dahao-gateway/bridge-tokens.env` (chmod 600), ba vai:

| Vai | Làm được gì |
| --- | --- |
| `viewer` | chỉ đọc đội máy, nhật ký, sản lượng |
| `technician` | thêm quyền quét mạng, ghép máy, xác nhận cảnh báo, nhập số tay |
| `admin` | thêm quyền lưu trữ máy |

Đưa cho bên tích hợp **token `viewer`** trừ khi họ thật sự cần ghi. Token là bí mật: ai có nó thì
có đúng quyền đó, không cần gì thêm.

## 3. Ba lệnh trên Mini

Toàn bộ đã được đóng thành script có **tự kiểm và tự lùi**. Thứ tự bắt buộc, không đảo.

```bash
cd ~/dashboarddahao/deploy-mini/cloudflare
```

### Bước 1 — đăng nhập Cloudflare (chỉ lần đầu, mở trình duyệt)

```bash
cloudflared tunnel login
```

Chọn vùng `phonh.io.vn`. Đây là bước duy nhất phải làm bằng tay: nó cần trình duyệt.

### Bước 2 — SIẾT QUYỀN (bắt buộc trước khi mở ra Internet)

```bash
./siet-quyen.sh
```

Script tự sao lưu cấu hình và plist, chuyển `auth.mode` sang `token`, bỏ `uiPath` (không còn
giao diện để phục vụ), nạp lại bridge, rồi **tự kiểm**:

| Kiểm | Phải ra |
| --- | --- |
| gọi `/api/v2/fleet` **không** token | `401` |
| gọi `/api/v2/fleet` **có** token viewer | `200` |

Không đạt cả hai ⇒ script **tự lùi về bản cũ** và thoát khác 0, kèm câu "KHÔNG được bật tunnel".

Địa chỉ Tailscale được **giữ nguyên** ở bước này — bạn không mất đường vào từ xa trong lúc
tunnel chưa chạy. Chuyển sang loopback chỉ nên làm sau khi tunnel đã ổn định.

### Bước 3 — bật tunnel

```bash
./bat-tunnel.sh
```

Script tạo tunnel (nếu chưa có), trỏ DNS, sinh `cloudflare-config.yml` với id thật, cài launchd
agent, rồi chờ tới khi `https://redthread.phonh.io.vn/api/health` trả `200`.

Nó có **điều kiện dừng cứng**: `auth.mode` chưa phải `token` thì thoát ngay, không mở gì cả.

## 4. Nên làm thêm (chưa bắt buộc)

- **Cloudflare Access** trước tunnel: thêm một lớp nữa, để token không phải hàng rào duy nhất.
- **WAF rate limiting** ở Cloudflare: bridge đã có bộ chặn riêng, nhưng chặn ở biên rẻ hơn.
- Xoay token định kỳ: sinh lại `bridge-tokens.env` rồi nạp lại bridge.

## 5. Điều KHÔNG làm

- **Không** bật tunnel khi `auth.mode` còn là `single-admin`. Đây là điều kiện DỪNG cứng.
- **Không** để `host` là IP Tailscale khi đã có tunnel: thành hai đường vào, hai bề mặt phải canh.
- **Không** commit `bridge-tokens.env` hay `~/.cloudflared/*.json` vào git.
- **Không** mở `ingest` (cổng máy tự gọi vào) ra ngoài loopback — máy thêu nói chuyện với broker
  ngay trên Mini, không có lý do gì để cổng đó ra khỏi máy.

## 6. Bốn cái bẫy đã sập thật (24/08)

Ghi lại vì cả bốn đều **hỏng câm** — không cái nào tự báo cho biết nguyên nhân.

### launchd không có `node` trong PATH
`chay-bridge.sh` từng viết `exec "$(command -v node)"`. launchd cho đúng
`PATH=/usr/bin:/bin:/usr/sbin:/sbin`; node ở `~/node/bin/node`. `command -v` trả **rỗng**,
`exec ""` chết bằng `exec: : not found`. Hệ quả: `siet-quyen.sh` tự kiểm nhận `000/000` rồi
tự lùi — đúng như thiết kế, nhưng thông điệp "không đạt" không hề nói vì sao.
Nay wrapper dò node theo đường dẫn tuyệt đối. `scripts/launchd-scripts.test.mjs` canh việc này
bằng cách chạy script thật dưới `env -i` với đúng PATH của launchd.

### Tunnel quản lý từ xa đè cấu hình cục bộ
Tunnel tạo trên **dashboard** Cloudflare là loại *remotely-managed*: ingress lấy từ dashboard,
`config.yml` cục bộ bị **bỏ qua hoàn toàn**. Triệu chứng: log tunnel ghi
`originService=http://localhost:3000` trong khi file cục bộ ghi `100.107.219.95:8790`, và
biên trả 502. Cách nhận ra: so `originService` trong `logs/tunnel.err` với file đã render.
Nay dùng tunnel **tạo bằng CLI** (`dahao-gateway`) để cấu hình nằm trong repo.

### `route dns` không tự ghi đè
Nếu hostname đang trỏ vào tunnel khác, `cloudflared tunnel route dns` chỉ in
`already configured to route to your tunnel` và **thoát 0**. Ta tưởng xong, thật ra vẫn phục vụ
bằng tunnel cũ. Phải có `--overwrite-dns`.

### Vòng chờ thiếu `sleep`
`for i in $(seq 1 60); do curl ...; done` không có `sleep` chạy hết 60 vòng trong ~2 giây.
"Chờ 60 lần" thành không chờ gì cả, và tunnel bị kết luận là hỏng khi nó mới đang bắt tay.

### Nhắc thêm: cập nhật bridge, đừng chỉ cập nhật broker
`install.sh` **sinh lại** `bridge.config.dahao-mqtt.json` với `single-admin` — chạy nó sau khi
siết quyền là lặng lẽ mở toang. Muốn cập nhật mã mà giữ config token thì chép có mục tiêu:
`rsync -a --delete bridge/ ~/dahao-gateway/bridge/` rồi nạp lại launchd.
