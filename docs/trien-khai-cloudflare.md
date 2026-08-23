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
