# Test với một máy thêu thật (máy trong ảnh chụp)

Không cần Deco, không cần router, không cần switch. Một sợi dây mạng là đủ.

## Mục tiêu của buổi test — nói trước để khỏi thất vọng

Buổi này **không** phải để thấy RPM và số mũi nhảy đẹp trên dashboard. Payload mà controller
Dahao đẩy ra **chưa ai giải mã được**, và PRD cấm bịa. Mục tiêu thật, theo đúng thứ tự:

1. Chứng minh máy **gọi được** tới bridge (có kết nối TCP từ `192.168.7.100`).
2. **Bắt được byte thô** mà máy gửi, ghi ra file để giải mã.
3. Dashboard lên, máy hiện đúng trạng thái kết nối, các ô telemetry ghi
   **"Chưa đọc được từ controller"**.

Bước 3 mà hiện "Chưa đọc được từ controller" là **thành công**, không phải lỗi. Ô đó chuyển
thành số thật chỉ sau khi giải mã xong bước 2.

---

## Đấu nối: nối thẳng Mac vào máy thêu

```
   ┌─────────────┐                          ┌──────────────────┐
   │  MacBook    │  ── dây mạng RJ45 ──     │  Controller Dahao│
   │ 192.168.7.10│                          │  192.168.7.100   │
   └─────────────┘                          └──────────────────┘
```

Không cần router vì cả hai đầu đều dùng IP tĩnh trong cùng `192.168.7.0/24`, và trong subnet
thì hai máy nói chuyện trực tiếp, không qua gateway. Card mạng đời nay đều tự đảo chân
(auto-MDIX) nên **dây thẳng bình thường là chạy**, không cần cáp chéo.

Mac không có cổng mạng thì dùng bộ chuyển USB-C → Ethernet. Có sẵn switch cùi thì cắm cả hai
vào cũng được, kết quả như nhau.

---

## 1. Đặt IP tĩnh cho Mac

**System Settings → Network → (cổng Ethernet) → Details → TCP/IP**

| Trường | Giá trị |
| --- | --- |
| Configure IPv4 | **Manually** |
| IP address | `192.168.7.10` |
| Subnet mask | `255.255.255.0` |
| Router | **để trống** |

Bỏ trống Router là cố ý: buổi test không cần Internet ở cổng này, và để trống thì Mac vẫn dùng
Wi-Fi cho Internet bình thường. `192.168.7.10` là địa chỉ bridge trong
[bản đồ IP](mang-xuong-deco.md#3-bản-đồ-ip-cố-định-cho-xưởng) — chọn đúng ngay từ buổi test để
sau này không phải gõ lại `C44` trên máy.

Kiểm tra:

```bash
ipconfig getifaddr en12          # hoặc tên cổng Ethernet của bạn, xem bằng: networksetup -listallhardwareports
ping -c 3 192.168.7.100          # máy thêu phải trả lời
```

Ping không tới thì dừng lại ở đây, chưa chạy bridge. Nguyên nhân hay gặp: máy thêu chưa bật,
dây lỏng, hoặc `C43`/`C45` trên máy khác với `192.168.7.100` / `255.255.255.0`.

---

## 2. Chạy bridge với cấu hình test

```bash
npm ci
npm run build                    # sinh dist/ để bridge phục vụ dashboard
npm run bridge:may-that
```

`bridge.config.may-that.json` khác cấu hình xưởng ở ba điểm, đều có chủ ý:

| Khoá | Giá trị test | Vì sao |
| --- | --- | --- |
| `ingest.capture` | `true` | Cả buổi test là để bắt byte thô. **Tắt sau khi giải mã xong.** |
| `auth.mode` | `single-admin` | Một người, dây nối thẳng. Ra xưởng nhiều người thì đổi sang `token`. |
| `logLevel` | `debug` | Cần thấy từng kết nối vào ra. |

Log khởi động phải in ra `http://192.168.7.10:8787` và cổng dial-in `192.168.7.10:1600`.
Nếu nó in `127.0.0.1` thì đang chạy nhầm file cấu hình.

---

## 3. Ghép máy TRƯỚC khi bật `C44` — bắt buộc

Đây là bước dễ bỏ sót nhất và nó làm hỏng cả buổi test.

Bridge nhận diện máy gọi vào **bằng địa chỉ nguồn**, đối chiếu với danh sách máy đã ghép. Máy
chưa ghép thì kết nối bị đóng ngay với lý do `unknown_source` — máy thêu sẽ báo kết nối thất bại
và bạn sẽ đi tìm lỗi ở dây mạng trong khi dây không có tội gì.

Ghép bằng dashboard (`http://192.168.7.10:8787` → tab **Quét mạng & ghép máy**), hoặc nhanh hơn
bằng dòng lệnh:

```bash
curl -sS -X POST http://192.168.7.10:8787/api/v2/machines \
  -H 'Content-Type: application/json' \
  -d '{
    "machines": [{
      "assetTag": "MAY-01",
      "name": "Máy thêu 01",
      "siteId": "xuong-1",
      "zone": "Chuyền A",
      "model": "Dahao",
      "ipAddress": "192.168.7.100",
      "adapter": "dial-in",
      "verification": { "confirmed": true, "evidence": "assetTag" }
    }]
  }' | python3 -m json.tool
```

**`"adapter": "dial-in"` là bắt buộc.** Bridge chỉ chấp nhận kết nối gọi vào từ máy có adapter
đúng loại này; để `manual` hay `http-json` thì cũng bị từ chối `unknown_source`.

`verification.confirmed: true` chỉ điền khi bạn **đang đứng cạnh máy** và đối chiếu được nhãn
`MAY-01` trên thân máy. Không đứng cạnh máy thì bỏ trường đó đi — máy vào hệ thống ở trạng thái
"Chưa xác minh", đúng như nó là.

---

## 4. Gõ trên bảng điều khiển Dahao

Trang `Emb asst. Para 2/4`:

| Tham số | Đang là | Đổi thành |
| --- | --- | --- |
| `C43 IP Address` | `192.168.7.100` | giữ nguyên |
| `C45 Subnet mask` | `255.255.255.0` | giữ nguyên |
| `C44 Server IP` | `0.0.0.0` | **`192.168.7.10`** |
| `C41 Server Port` | `1` | **`1600`** |

`C41` có dải hợp lệ `<1,3865>` in ngay trên màn hình, nên `1600` hợp lệ. Đừng thử `8787` —
firmware sẽ từ chối.

Lưu tham số theo cách của máy (thường phải thoát ra khỏi trang tham số mới ghi). Một số firmware
cần **tắt bật lại nguồn** thì mới bắt đầu gọi ra.

---

## 5. Xem có gì xảy ra không

Trên terminal đang chạy bridge, thứ cần thấy:

```
Máy gọi vào bridge.  { machineId: 'mch-may-01', remote: '192.168.7.100' }
```

Kiểm tra bằng API — `dialIn` trong health cho biết chính xác đang ở đâu:

```bash
curl -sS http://192.168.7.10:8787/api/v2/health | python3 -m json.tool
```

| Thấy gì trong `dialIn` | Nghĩa là |
| --- | --- |
| `connections: 0` | Máy chưa gọi ra. `C44`/`C41` chưa lưu, hoặc cần tắt bật nguồn máy. |
| `connections > 0`, `framesAccepted > 0` | May mắn hiếm: máy nói JSON. Dashboard có số thật luôn. |
| `connections > 0`, `framesUndecoded > 0` | **Trường hợp mong đợi.** Có byte, chưa đọc được — sang bước 6. |
| `rejections: { unknown_source: n }` | Chưa ghép máy, hoặc ghép sai `adapter`. Quay lại bước 3. |
| `connections > 0` nhưng cả hai bộ đếm = 0 | Máy mở kết nối rồi im. Xem khung cảnh báo cuối trang. |

Mở `http://192.168.7.10:8787` trên trình duyệt: máy phải hiện trong bảng, cột kết nối chuyển
`online`, các ô RPM / mẫu / tiến độ ghi **"Chưa đọc được từ controller"**.

---

## 6. Đọc byte đã bắt được

```bash
npm run capture:xem
npm run capture:xem -- --full            # xem tất cả khung, không chỉ 12 khung đầu
```

Công cụ in hex dump kèm cột ASCII, phân bố độ dài khung, tiền tố/hậu tố lặp giữa các khung, và
vài quan sát. Nó **chỉ mô tả, không kết luận** giao thức là gì — vì một suy đoán sai ở tầng này
sẽ thành con số sai trên bảng lương khoán.

### Cách giải mã thật sự hiệu quả

Không có tài liệu giao thức thì chỉ còn một cách chắc chắn: **thay đổi đúng một thứ, so hai lần bắt.**

```bash
# lần 1: máy đang dừng
mv bridge-data/dial-in-capture.jsonl bridge-data/cap-may-dung.jsonl

# cho máy chạy 2 phút, rồi:
mv bridge-data/dial-in-capture.jsonl bridge-data/cap-may-chay.jsonl

node scripts/xem-capture.mjs bridge-data/cap-may-dung.jsonl --full > /tmp/dung.txt
node scripts/xem-capture.mjs bridge-data/cap-may-chay.jsonl --full > /tmp/chay.txt
diff /tmp/dung.txt /tmp/chay.txt
```

Byte nào đổi theo trạng thái máy chính là trường đó. Làm lần lượt với: dừng ↔ chạy, đổi mẫu
thêu, để chạy thêm đúng 1.000 mũi, đổi tốc độ. Mỗi lần đổi **một thứ**, ghi lại vào sổ.

Có kết quả thì gửi tôi hai file capture, tôi viết adapter giải mã trong `bridge/lib/`.

---

## 7. Dọn dẹp trước khi mang ra xưởng

- [ ] `ingest.capture` → `false` (file capture phình theo thời gian và không còn tác dụng gì)
- [ ] `auth.mode` → `"token"`, sinh token bằng `openssl rand -base64 32`, để trong `.env`
- [ ] `logLevel` → `"info"`
- [ ] Dùng cấu hình xưởng ở [`mang-xuong-deco.md` mục 7](mang-xuong-deco.md#7-cấu-hình-bridge-cho-xưởng),
      không dùng lại `bridge.config.may-that.json`
- [ ] Trả cổng Ethernet của Mac về DHCP nếu mượn máy làm việc khác

---

## Bảng sự cố

| Triệu chứng | Nguyên nhân |
| --- | --- |
| `ping 192.168.7.100` không tới | Dây, nguồn máy, hoặc `C43`/`C45` khác với `192.168.7.100/24` |
| Bridge in `127.0.0.1` lúc khởi động | Chạy nhầm cấu hình — phải là `npm run bridge:may-that` |
| `rejections: { unknown_source }` | Chưa ghép máy, hoặc ghép với `adapter` khác `dial-in` |
| `rejections: { ambiguous_source }` | Hai bản ghi máy cùng IP `192.168.7.100` — xoá bớt một |
| Máy báo lỗi kết nối, bridge không thấy gì | `C41` đặt > 3865 (firmware từ chối), hoặc chưa tắt bật nguồn máy |
| `EADDRINUSE` khi khởi động | Còn bridge cũ đang chạy: `pkill -f "bridge/index.mjs"` |
| Dashboard không mở được | Tường lửa macOS chặn `node` — cho phép trong System Settings → Network → Firewall |

> **Nếu máy mở kết nối rồi im, không gửi byte nào:** nhiều khả năng giao thức yêu cầu server
> chào trước, hoặc trả lời một gói handshake. Bridge **cố ý không bao giờ ghi ngược một byte
> nào** xuống socket — đó là ràng buộc chỉ-đọc của cả sản phẩm, để không có đường nào điều
> khiển được máy từ dashboard. Trường hợp này cần đọc tài liệu module API **HILCOM** (tem trên
> thân máy) trước, rồi mới quyết định có nới ràng buộc đó không — và nếu nới thì phải là một
> quyết định có ghi chép, không phải một dòng code lặng lẽ.
