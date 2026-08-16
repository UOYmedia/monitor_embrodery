# Lắp mạng xưởng với TP-Link Deco

Quy trình cho đúng hiện trạng xưởng này, không phải hướng dẫn Deco chung chung.

**Hiện trạng đã biết** (đọc trực tiếp từ màn hình controller, trang `Emb asst. Para 2/4`):

| Tham số | Giá trị hiện tại | Nghĩa |
| --- | --- | --- |
| `C43 IP Address` | `192.168.7.100` | Máy mang IP tĩnh, **gõ tay trên bảng điều khiển** |
| `C45 Subnet mask` | `255.255.255.0` | LAN xưởng là `192.168.7.0/24` |
| `C44 Server IP` | `0.0.0.0` | Máy biết tự gọi ra một server, chưa trỏ về đâu |
| `C41 Server Port` | `1` (hợp lệ `<1,3865>`) | **Cổng phải ≤ 3865** — đây là ràng buộc của firmware, không phải của bridge |

Một dữ kiện chi phối toàn bộ tài liệu này: **IP máy thêu và IP bridge đều nằm trong đầu người,
gõ tay trên từng bảng điều khiển.** Đổi dải mạng = đi bộ tới từng máy, leo lên gõ lại 4 con số,
nhân với số máy. Vì vậy nguyên tắc số một:

> **Giữ nguyên `192.168.7.0/24`. Deco phải thích nghi với xưởng, không phải ngược lại.**

Deco mặc định phát dải `192.168.68.0/24`. Nếu cắm Deco lên làm router mà bỏ qua bước đổi dải,
máy thêu ở `192.168.7.100` **biến mất khỏi mạng hoàn toàn** — không chậm, không chập chờn, là
không tồn tại — và không có cách nào sửa từ xa.

---

## 0. Trước khi mở hộp: xác định xưởng đang có router nào

Cắm Mac vào mạng xưởng bằng dây (hoặc Wi-Fi hiện tại) rồi chạy:

```bash
ipconfig getifaddr en0 || ipconfig getifaddr en1   # IP Mac đang nhận
netstat -rn -f inet | grep default                 # gateway = router hiện tại
arp -a | grep '192\.168\.7\.'                      # ai đang sống trong dải xưởng
```

Kết quả rẽ thành hai nhánh:

| Kết quả | Nhánh | Deco chạy chế độ |
| --- | --- | --- |
| Có gateway `192.168.7.1` (hoặc `.254`), Mac nhận IP `192.168.7.x` | **A** | **Access Point** |
| Không có gì, hoặc gateway thuộc dải khác (`192.168.1.1`, `192.168.68.1`…) | **B** | **Router**, đổi LAN sang `192.168.7.1` |

Nhánh A an toàn hơn hẳn: không đụng đến bất kỳ máy thêu nào. Chỉ chọn nhánh B khi xưởng thật sự
chưa có router, hoặc router cũ hỏng và bạn muốn Deco thay hẳn.

> Deco cần Internet và app điện thoại ở lần cài đầu tiên, kể cả khi sau này chạy AP mode.
> Không có Internet thì app không hoàn tất được bước khởi tạo. Sau khi cài xong, dashboard
> và bridge chạy hoàn toàn offline — nhưng bản thân cái Deco thì cần Internet để cấu hình.

---

## 0.5. Cấu hình sẵn tại nhà — tới xưởng chỉ việc cắm điện

Deco **chỉ cấu hình được bằng app Deco trên điện thoại**, gắn với TP-Link ID. Phần lớn model
không có web admin, không SSH, không telnet, không API cục bộ; lần cài đầu tiên còn phải ghép
Bluetooth giữa điện thoại và cục Deco. Không có cách nào cấu hình nó từ máy tính hay từ dòng lệnh.

Vì vậy làm hết ở nhà, nơi có Internet ổn định. Đây không chỉ là cho tiện: **mang một cục Deco
mới tinh tới xưởng chưa có Internet thì không cài xong được**, app sẽ kẹt ở bước khởi tạo.

### Làm tại nhà (30 phút)

1. Cài đặt lần đầu bằng app + Wi-Fi nhà, để nó chạy **router mode** như mặc định.
2. **Cập nhật firmware cho xong tại nhà.** Ở xưởng có thể không có Internet để tải.
3. Đặt **SSID và mật khẩu WPA2 sẽ dùng ở xưởng** ngay bây giờ — quyết định một lần, ghi vào sổ
   giấy. Không ghi vào file trong repo, không nhắn qua chat công việc.
4. **More → Advanced → LAN IP**: `192.168.7.1` / `255.255.255.0`.
5. **More → Advanced → DHCP Server**: dải `192.168.7.200` – `192.168.7.250`.
6. **More → IoT Network** (nếu model có): bật, 2.4 GHz only, WPA2-PSK (AES), SSID `XUONG-MAY`.
7. Siết bảo mật ngay: **UPnP tắt**, Port Forwarding rỗng, DMZ tắt, TP-Link ID bật **2FA**
   (chi tiết ở [mục 8](#8-siết-deco-bắt-buộc-làm-ngay-sau-khi-lắp)).
8. Ghi lại vào sổ: model Deco, số unit, SSID, mật khẩu, LAN IP.

Cấu hình theo **nhánh B** kể cả khi chưa biết xưởng thuộc nhánh nào. Lý do: đổi LAN IP là việc
khó làm ở xưởng, còn chuyển sang AP mode chỉ là một cái gạt. Chuẩn bị cho cái khó, để lại cái dễ.

### Tới xưởng

| Hiện trạng xưởng (kết quả mục 0) | Việc phải làm |
| --- | --- |
| **Không có router** (nhánh B) | Cắm điện, cắm WAN vào modem ISP nếu có. Xong — cấu hình đã đúng sẵn. |
| **Có router cũ ở `192.168.7.1`** (nhánh A) | **Chuyển AP mode TRƯỚC khi cắm dây vào router cũ** |

Thứ tự ở nhánh A rất quan trọng. Deco đang mang LAN IP `192.168.7.1`, đúng bằng địa chỉ router
cũ. Cắm thẳng hai cái vào nhau là **đụng IP**: mạng xưởng loạn, và bạn mất luôn đường vào app để
sửa. Đúng quy trình: nối điện thoại vào Wi-Fi của Deco → app → **More → Advanced → Operation
Mode → Access Point** → chờ đèn xanh cố định → *rồi mới* cắm dây từ router cũ sang.

> ⛔ **Đừng bấm Reset ở xưởng.** Factory reset xoá sạch mọi thứ trên và bắt buộc phải có Internet
> để cài lại từ đầu. Nếu có trục trặc ở xưởng, mang cục Deco về nhà sửa, đừng reset tại chỗ.

---

## 1. Nhánh A — Deco làm Access Point (khuyến nghị)

Router cũ tiếp tục cấp IP và giữ dải `192.168.7.0/24`; Deco chỉ làm sóng Wi-Fi và mesh.

1. Cài Deco bình thường theo app (nó sẽ tự chạy router mode).
2. App Deco → **More → Advanced → Operation Mode → Access Point → Save → Reboot**.
   Chờ tới khi đèn xanh cố định (~2 phút).
3. Cắm dây từ **LAN của router cũ** vào **cổng bất kỳ của Deco chính**.
4. Các Deco phụ: **ưu tiên nối bằng dây LAN (ethernet backhaul)**. Xưởng thêu đầy khung kim
   loại và biến tần — backhaul không dây là nguồn gốc của những đợt `stale` không giải thích được.

**Cái mất khi ở AP mode:** Deco không còn cấp DHCP, không còn mục *Address Reservation*, không
còn *LAN IP*. Toàn bộ việc cấp phát và đặt chỗ IP làm trên **router cũ**. Đây là điều bình thường
và không ảnh hưởng gì tới hệ thống này, vì máy thêu và bridge đều dùng IP tĩnh.

Sau đó nhảy tới [mục 3 — bản đồ IP](#3-bản-đồ-ip-cố-định-cho-xưởng).

---

## 2. Nhánh B — Deco làm router, đổi dải về 192.168.7.0/24

Thứ tự ở đây quan trọng. Làm sai thứ tự thì phải reset và làm lại.

1. Cài Deco theo app, **chưa cắm máy thêu nào vào**.
2. App Deco → **More → Advanced → LAN IP**:
   - IP address: `192.168.7.1`
   - Subnet mask: `255.255.255.0`
   - Save → Continue. Deco khởi động lại, điện thoại phải nối lại Wi-Fi.
3. **Thu hẹp dải DHCP** (More → Advanced → DHCP Server):
   - Bắt đầu: `192.168.7.200`
   - Kết thúc: `192.168.7.250`

   Bước 3 không phải để cho gọn. Để nguyên dải mặc định `.100–.199` thì một cái điện thoại
   sẽ được cấp `192.168.7.100` — trùng đúng IP máy thêu số 1. Hai thiết bị cùng IP: máy rớt
   khỏi dashboard, điện thoại mạng chập chờn, và không ai nghĩ tới nguyên nhân này trong ba
   ngày. Đây là lỗi kinh điển của IP tĩnh gõ tay.
4. Chỉ sau khi ba bước trên xong mới cắm máy thêu và bridge vào.

---

## 3. Bản đồ IP cố định cho xưởng

Ghi bảng này ra giấy, dán vào tủ điện cạnh switch. Nó là thứ duy nhất giữ cho mạng không loạn
sau sáu tháng.

| Dải | Dùng cho | Cách cấp |
| --- | --- | --- |
| `192.168.7.1` | Router (Deco ở nhánh B, hoặc router cũ ở nhánh A) | Cố định |
| `.2` – `.9` | Hạ tầng: các Deco unit, switch | Cố định / reservation |
| **`.10`** | **Máy chạy bridge** | **Tĩnh, không bao giờ đổi** |
| `.11` – `.49` | Màn andon treo tường, máy in tem, dự phòng | Reservation |
| `.100` – `.199` | Máy thêu — IP tĩnh gõ ở `C43` | Gõ tay tại máy |
| `.200` – `.250` | Điện thoại, tablet, laptop xem dashboard | DHCP |

Đánh số máy thêu theo thân máy, không theo thứ tự cắm dây: máy 01 = `.101`, máy 02 = `.102`…
Máy hiện tại đang ở `.100` — **cứ để nguyên**, đặt nó là máy 00 hoặc đổi thành `.101` lúc nào
tiện đi qua. Không có lý do gì để leo lên một cái máy đang chạy được chỉ vì con số cho đẹp.

### Vì sao bridge phải là `.10` và phải chọn ngay bây giờ

`C44 Server IP` trên **từng** bảng điều khiển sẽ trỏ về IP này. Mỗi lần IP bridge đổi là một
vòng đi bộ quanh xưởng gõ lại `C44` trên mọi máy. Chọn `.10` từ hôm nay, và giữ nó kể cả khi
sau này thay phần cứng chạy bridge — chỉ cần gán `.10` cho máy mới.

---

## 4. Máy thêu nối mạng bằng gì: **cắm dây**

Khuyến nghị dứt khoát: **toàn bộ máy thêu cắm dây LAN qua switch.** Wi-Fi để dành cho tablet
và điện thoại xem dashboard.

Lý do không phải là tốc độ — telemetry mỗi máy chỉ vài trăm byte mỗi 30 giây, Wi-Fi thừa sức.
Lý do là **độ tin cậy của thông tin**: khung máy kim loại chắn sóng, biến tần và servo phát
nhiễu ngay dải 2.4 GHz, và máy thêu rung liên tục. Wi-Fi rớt 40 giây là dashboard chuyển máy
sang `stale`, rớt 90 giây là `offline`. Khi bảng andon báo đỏ mà ra tận nơi thấy máy vẫn đang
chạy ngon lành, quản đốc sẽ ngừng tin cái bảng — và một cái bảng không ai tin thì không đáng
tiền điện.

### Nếu bắt buộc phải có vài máy đi Wi-Fi

Module Wi-Fi công nghiệp thường chỉ chạy **2.4 GHz, 802.11 b/g/n, WPA2-PSK (AES)**. Deco mặc
định gộp 2.4 và 5 GHz vào **một SSID** và bật WPA3 — nhiều module cũ không vào được, hoặc vào
rồi rớt liên tục. Cách xử lý trên Deco:

1. **More → Wi-Fi Settings**: tắt băng 2.4 GHz của SSID chính (SSID chính còn 5 GHz).
2. **More → IoT Network**: bật, đặt **2.4 GHz only**, bảo mật **WPA2-PSK (AES)**, SSID riêng
   ví dụ `XUONG-MAY`.
3. Cho máy thêu vào SSID `XUONG-MAY`.

Điểm mấu chốt: **IoT Network của Deco dùng SSID riêng nhưng KHÔNG cô lập khỏi mạng chính** —
đúng thứ cần, vì bridge phải nhìn thấy máy. Ngược lại, **Guest Network thì có cô lập**:

> ⛔ **Tuyệt đối không cho máy thêu vào Guest Network.** Thiết bị trên guest bị chặn khỏi LAN
> chính. Bridge sẽ không bao giờ thấy máy, máy sẽ không bao giờ gọi được về bridge, và triệu
> chứng trông y hệt "máy hỏng mạng" nên rất tốn thời gian truy.

Model Deco đời cũ không có mục *IoT Network*: dùng một access point 2.4 GHz rời cắm dây vào
switch, hoặc chấp nhận cắm dây cho những máy đó.

---

## 5. Máy chạy bridge: mini-PC không quạt, cắm dây, 24/7

Chốt: **một mini-PC nhỏ để cố định trong xưởng**, không phải cái Mac đang dùng.

| Hạng mục | Khuyến nghị |
| --- | --- |
| Phần cứng | Mini-PC fanless Intel N100/N150, 8–16 GB RAM, SSD 256 GB |
| Hệ điều hành | Debian 12 hoặc Ubuntu Server LTS, Node.js 22+ |
| Mạng | **Cắm dây**, IP tĩnh `192.168.7.10` |
| Nguồn | UPS nhỏ (~500 VA) |
| Chạy dịch vụ | systemd, xem `README.md` mục *Triển khai LAN doanh nghiệp* |

Vì sao không phải cái Mac: máy Mac ngủ khi gập lại, được mang về nhà, và nhận IP theo DHCP nên
địa chỉ đổi. Ba tính chất đó lần lượt gây ra: mất toàn bộ telemetry của ca đêm, mất toàn bộ
telemetry của ngày hôm đó, và mọi máy thêu đẩy dữ liệu vào một địa chỉ không còn ai nghe. Bridge
là nơi cộng dồn sản lượng ca để tính lương khoán — nó tắt thì con số của ca đó không tái tạo lại
được từ đâu cả, vì controller không lưu lịch sử.

Vì sao có UPS: bridge đệm sản lượng và ghi xuống đĩa mỗi `flushIntervalMs` (mặc định 60 000 ms).
Mất điện đột ngột làm mất tối đa một phút dữ liệu — chấp nhận được — nhưng mất điện lặp lại nhiều
lần mỗi ngày thì thành mất tin cậy có hệ thống.

### Chạy tạm trên Mac trong lúc chờ mini-PC

Được, với một điều kiện: **đặt Mac ở đúng `192.168.7.10`** ngay từ đầu.

System Settings → Network → Ethernet → Details → TCP/IP → Configure IPv4: **Manually**
- IP address `192.168.7.10`
- Subnet mask `255.255.255.0`
- Router `192.168.7.1`

Nhờ vậy khi mini-PC về, bạn chỉ chuyển `.10` sang máy mới và **không phải đụng vào `C44` của
bất kỳ máy thêu nào**. Nhớ mở tường lửa macOS cho `node`, hoặc tắt tường lửa trong thời gian
chạy thử trên mạng xưởng tin cậy.

---

## 6. Cài đặt trên từng bảng điều khiển Dahao

Làm một lần cho mỗi máy, trang `Emb asst. Para 2/4`:

| Tham số | Đặt thành | Ghi chú |
| --- | --- | --- |
| `C43 IP Address` | `192.168.7.1xx` | Theo bản đồ IP mục 3, mỗi máy một số |
| `C45 Subnet mask` | `255.255.255.0` | Giữ nguyên |
| Gateway (nếu có mục) | **`0.0.0.0`** hoặc bỏ trống | Xem khung dưới |
| `C44 Server IP` | `192.168.7.10` | IP bridge, giống nhau trên mọi máy |
| `C41 Server Port` | `1600` | **Phải ≤ 3865** theo giới hạn firmware. Không dùng 8787. |

> **Không đặt gateway cho máy thêu.** Một thiết bị không có default gateway thì về mặt vật lý
> chỉ nói chuyện được trong subnet của chính nó — nó vẫn gặp bridge ở `192.168.7.10`, nhưng
> không có đường nào ra Internet. Deco là thiết bị gia dụng, **không làm được VLAN thật**, nên
> đây là cách chặn máy thêu ra Internet hiệu quả nhất mà không cần thiết bị mạng đắt tiền.
> Nếu màn hình bắt buộc phải điền, điền chính IP của máy đó.

Ghi lại vào sổ: số máy ↔ IP ↔ serial ↔ MAC. Dashboard neo bản ghi ghép máy theo IP kèm bằng
chứng MAC/serial; không có sổ thì lần thay bo mạch nào cũng thành một buổi truy IP.

---

## 7. Cấu hình bridge cho xưởng

`bridge.config.json` hiện tại trong repo là **cấu hình QA cục bộ** (`127.0.0.1`, `allowLoopback:
true`, token nằm thẳng trong file) — **không dùng ở xưởng**. Cấu hình xưởng:

```json
{
  "host": "192.168.7.10",
  "port": 8787,
  "logLevel": "info",

  "sites": [
    {
      "id": "xuong-1",
      "name": "Xưởng chính",
      "timeZone": "Asia/Ho_Chi_Minh",
      "allowedCidrs": ["192.168.7.0/24"],
      "freshSeconds": 30,
      "staleSeconds": 90,
      "shifts": [
        { "id": "ca-1", "name": "Ca ngày", "start": "07:00", "end": "19:00" },
        { "id": "ca-2", "name": "Ca đêm", "start": "19:00", "end": "07:00" }
      ],
      "pricePer1000Stitches": 1200
    }
  ],

  "poll": { "intervalMs": 15000, "concurrency": 8, "timeoutMs": 2500 },
  "scan": { "allowLoopback": false, "allowPublicRanges": false, "maxHosts": 256 },

  "ingest": {
    "enabled": true,
    "host": "192.168.7.10",
    "port": 1600,
    "capture": false
  },

  "auth": {
    "mode": "token",
    "tokens": [
      { "id": "t-viewer", "actor": "quan-doc",  "role": "viewer",     "tokenEnv": "BRIDGE_TOKEN_VIEWER" },
      { "id": "t-tech",   "actor": "ky-thuat",  "role": "technician", "tokenEnv": "BRIDGE_TOKEN_TECH" },
      { "id": "t-admin",  "actor": "chu-xuong", "role": "admin",      "tokenEnv": "BRIDGE_TOKEN_ADMIN" }
    ]
  },

  "allowedOrigins": ["http://192.168.7.10:8787"],

  "dataPath": "./bridge-data/fleet-store.json",
  "auditPath": "./bridge-data/audit-log.jsonl",
  "productionPath": "./bridge-data/production.json",
  "capturePath": "./bridge-data/dial-in-capture.jsonl",
  "uiPath": "./dist"
}
```

Token đặt trong `.env` (`openssl rand -base64 32`), không đặt trong file config.

`ingest.capture` để `false`. Payload mà controller Dahao đẩy ra vẫn **chưa giải mã được** — khi
nào ngồi dò giao thức thì bật `capture: true` để ghi khung thô ra `capturePath`, giải mã xong
thì **tắt lại**. Trường nào chưa đọc được vẫn hiển thị "Chưa đọc được từ controller"; không suy
đoán, không lấy số mẫu.

---

## 8. Siết Deco (bắt buộc, làm ngay sau khi lắp)

Trong app Deco, **More → Advanced**:

- [ ] **UPnP: TẮT.** UPnP cho phép một ứng dụng bất kỳ trong LAN tự mở cổng ra Internet mà không
      ai bấm nút nào. Bridge không dùng UPnP, nên tắt là mất mát bằng không.
- [ ] **Port Forwarding / Virtual Server: rỗng.** Không mở 8787, không mở 1600, không mở gì cả.
- [ ] **DMZ: tắt.**
- [ ] Firmware: bật cập nhật tự động.
- [ ] Tài khoản TP-Link ID: mật khẩu riêng, **bật 2FA**. Tài khoản này điều khiển được router
      của xưởng từ bất cứ đâu — nó là chìa khoá thật, không phải chi tiết phụ.
- [ ] Wi-Fi SSID chính: WPA2/WPA3 mixed. SSID IoT (nếu dùng): WPA2-PSK (AES).
- [ ] Mật khẩu Wi-Fi **không** ghi vào bất kỳ file nào trong repo, không nhắn qua chat công việc.

**Truy cập từ xa:** không port-forward. Deco đời mới có mục **VPN Server (WireGuard/OpenVPN)** —
nếu model của bạn có thì bật cái đó và nối vào bằng VPN rồi mở dashboard như đang ở trong xưởng.
Model không có thì dựng WireGuard ngay trên mini-PC chạy bridge.

### Điều Deco không làm được — nói thẳng

`README.md` mục *Firewall / VLAN* khuyến nghị tách máy thêu sang VLAN riêng và chặn chiều ra
Internet của VLAN đó. **Deco không làm được điều này** — nó là thiết bị gia đình, không có VLAN
802.1Q, không có firewall theo chiều giữa các subnet nội bộ. Trong phạm vi Deco, biện pháp thay
thế là ba lớp ở trên: máy thêu **không có gateway** (mục 6), **không port-forward/UPnP** (mục 8),
và bridge chỉ **nghe trên đúng `192.168.7.10`** chứ không phải `0.0.0.0` (mục 7).

Nếu sau này cần tách mạng thật — nhiều xưởng, hoặc audit an ninh yêu cầu — thì cần switch quản lý
được VLAN và một router có firewall theo VLAN (pfSense/OPNsense/MikroTik/UniFi). Đó là lần nâng
cấp khác, không phải việc của hôm nay.

---

## 9. Nghiệm thu — chạy đủ, đừng bỏ bước nào

Từ máy chạy bridge:

```bash
# 1. Đúng IP chưa
ipconfig getifaddr en0                      # macOS  → phải là 192.168.7.10
ip -4 addr show                             # Linux

# 2. Thấy máy thêu chưa
ping -c 3 192.168.7.100
arp -a | grep '192\.168\.7\.'               # liệt kê thiết bị đang sống trong dải

# 3. Bridge chỉ nghe trên LAN, không nghe trên 0.0.0.0
sudo lsof -nP -iTCP -sTCP:LISTEN | grep node
#    Kỳ vọng: 192.168.7.10:8787 và 192.168.7.10:1600 — KHÔNG được thấy *:8787

# 4. Đồng hồ đúng — toàn bộ trạng thái online/stale/offline dựa trên thời gian
date
```

Từ tablet/điện thoại đang ở Wi-Fi:

```
Mở http://192.168.7.10:8787/  → dashboard phải lên
```

Nếu dùng SSID IoT cho máy thêu, kiểm tra chéo **một lần** rằng nó thật sự không bị cô lập: nối
điện thoại vào SSID IoT rồi mở `http://192.168.7.10:8787/`. Mở được nghĩa là IoT ↔ LAN chính
thông; không mở được thì Deco đang cô lập SSID đó và máy thêu sẽ không bao giờ báo về.

Sau cùng, trên dashboard: tab **Quét mạng & ghép máy** → chọn site `xuong-1` → quét
`192.168.7.0/24`. Kết quả hiện ra là **"Thiết bị chưa xác nhận"**; cổng TCP mở **không** chứng
minh đó là máy Dahao. Ra tận máy đối chiếu tên/serial rồi mới ghép.

---

## 10. Bảng tra sự cố

| Triệu chứng | Nguyên nhân hay gặp nhất |
| --- | --- |
| Toàn bộ máy `offline` sau khi lắp Deco | Deco đang ở router mode với dải `192.168.68.x` — quay lại mục 1 hoặc 2 |
| Một máy `offline`, ping không tới | Trùng IP với thiết bị DHCP: kiểm tra dải DHCP đã thu về `.200–.250` chưa (mục 2 bước 3) |
| Máy Wi-Fi vào được mạng nhưng dashboard không thấy | Máy đang ở **Guest Network** (bị cô lập) — chuyển sang IoT Network |
| Máy Wi-Fi không vào nổi SSID | Module chỉ 2.4 GHz / WPA2; SSID chính đang gộp băng tần hoặc bật WPA3 — mục 4 |
| Cả xưởng `stale` cùng lúc | Máy chạy bridge đi Wi-Fi, hoặc ngủ, hoặc backhaul Deco không dây yếu |
| Dashboard mở được, mọi máy `unknown` | `C44 Server IP` chưa trỏ về `192.168.7.10`, hoặc `C41` đặt cổng > 3865 nên firmware từ chối |
| Sau mất điện, sản lượng ca thiếu vài phút | Bình thường trong giới hạn `flushIntervalMs`; nếu lặp lại thì lắp UPS |

---

## 11. Deco còn dùng được vào việc gì

### Dùng được ngay cho hệ thống này

**1. VPN Server — xem dashboard từ nhà, không cần mở cổng ra Internet.** Đây là giá trị lớn nhất.
PRD yêu cầu truy cập từ xa phải qua VPN doanh nghiệp chứ không port-forward, và Deco đời mới làm
được đúng việc đó: `More → Advanced → VPN Server`, chọn **WireGuard** (nhanh và nhẹ hơn OpenVPN),
quét QR bằng app WireGuard trên điện thoại. Từ đó mở `http://192.168.7.10:8787` ở bất cứ đâu như
đang đứng trong xưởng.

> ⚠️ **VPN Server chỉ chạy khi Deco làm router (nhánh B).** Ở Access Point mode (nhánh A) Deco
> không định tuyến nên mục này biến mất. Chọn nhánh A thì dựng WireGuard ngay trên mini-PC chạy
> bridge — vẫn đúng yêu cầu, chỉ là làm ở chỗ khác.

WireGuard có trên XE75, X50, X55 và dòng BE trở lên, một số model phải cập nhật firmware mới có.
Model cũ hơn thì còn OpenVPN. Kiểm tra bằng cách mở đúng menu đó trên máy bạn.

**2. Mỗi cục Deco là một switch nhỏ.** Mỗi unit có 2 cổng Ethernet trở lên. Đặt một cục ở đầu mỗi
chuyền, cắm dây máy thêu gần đó vào — vừa làm backhaul có dây cho mesh, vừa đỡ phải kéo dây dài
về một chỗ. Với khuyến nghị "máy thêu cắm dây" ở mục 4 thì đây là cách rẻ nhất để có cổng mạng
rải khắp xưởng.

**3. Guest Network cho khách và thợ ngoài.** Ở mục 4 guest là cái bẫy; ở đây nó đúng chỗ. Khách
đến xưởng, thợ sửa máy bên thứ ba, tài xế giao hàng — cho vào Guest Network thì họ có Internet
mà **không thấy được máy thêu lẫn bridge**. Chính cái tính năng cô lập gây hại ở mục 4 lại là
thứ cần ở đây.

**4. Address Reservation cho tablet và màn andon treo tường** (chỉ có ở router mode). Màn andon
nên luôn nhận cùng một IP để bookmark và cấu hình kiosk không hỏng sau mỗi lần mất điện.

**5. Danh sách thiết bị + thông báo có thiết bị lạ vào mạng.** Thô sơ so với công cụ doanh nghiệp,
nhưng LAN xưởng vốn không nên có thiết bị nào ngoài danh sách — điện thoại lạ xuất hiện là đáng
hỏi. Đây là thứ giám sát duy nhất Deco cho, tận dụng đi.

**6. Mesh roaming.** Quản đốc cầm tablet đi khắp xưởng xem bảng andon mà không rớt kết nối khi
chuyển vùng phủ sóng. Đây đúng là việc mesh sinh ra để làm.

### Không làm được — đừng trông đợi

| Thiếu | Hệ quả với hệ thống này |
| --- | --- |
| **VLAN 802.1Q** | Không tách mạng máy thêu thật sự được. Bù bằng ba lớp ở [mục 8](#8-siết-deco-bắt-buộc-làm-ngay-sau-khi-lắp). |
| **SNMP / syslog export** | Không giám sát được sức khoẻ mạng bằng công cụ ngoài. Chỉ còn nhìn trạng thái máy trên dashboard. |
| **Port mirroring** | Không dùng Deco để bắt gói giao thức Dahao. Muốn bắt thì nối thẳng Mac vào máy — xem [`test-mot-may-that.md`](test-mot-may-that.md). |
| **PoE** | Màn andon treo tường phải có ổ điện riêng. Tính vào lúc chọn vị trí treo. |
| **Firewall theo chiều giữa các subnet nội bộ** | Không chặn được máy thêu gọi ra ngoài bằng luật. Bù bằng cách **không đặt gateway** cho máy ([mục 6](#6-cài-đặt-trên-từng-bảng-điều-khiển-dahao)). |

---

## Tóm tắt ba quyết định

1. **Deco chạy Access Point sau router cũ** (nhánh A). Không có router cũ thì Deco làm router
   nhưng đổi LAN về `192.168.7.1/24` **trước khi cắm máy**. Cả hai đường đều giữ nguyên
   `192.168.7.0/24` để không phải đụng vào bảng điều khiển máy nào.
2. **Máy thêu cắm dây.** Wi-Fi chỉ cho người xem dashboard. Máy nào buộc phải Wi-Fi thì dùng
   IoT Network 2.4 GHz + WPA2, tuyệt đối không dùng Guest Network.
3. **Bridge chạy trên mini-PC không quạt, cắm dây, IP tĩnh `192.168.7.10`, 24/7.** Chạy tạm trên
   Mac cũng được, miễn là đặt đúng `.10` ngay từ hôm nay để sau này không phải gõ lại `C44`.

Nguồn tham khảo về Deco: [Deco Access Point Mode Setup](https://www.tp-link.com/us/support/faq/1842/) ·
[Deco IP Address: How to Change Your Default LAN IP](https://www.tp-link.com/us/support/faq/2331/) ·
[Does Deco support separate 2.4GHz and 5GHz SSIDs?](https://community.tp-link.com/en/home/forum/topic/541930)
