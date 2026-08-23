> Nguồn: truy 7 hướng song song 21/08/2026 (workflow 15 agent, mỗi kết luận có 1 agent phản biện),
> đối chiếu với chính văn bản sổ tay đã tải ở `docs/so-tay-dahao/`. Bản checklist mang-đi (đẹp, xem
> trên điện thoại) được xuất riêng thành Artifact. Xem thêm memory `dahao-duong-vao-may`.

# Tổng hợp: đường nào lấy được số mũi ra khỏi máy BECS-A15

*Lưu ý về phạm vi: bản tóm tắt này dựng trên 5 hướng đọc được đầy đủ (hilcom/Wilcom, lierda, emcad/EmbNet, sotay, dahaoyun). Hai hướng còn lại trong bộ 7 không có trong dữ liệu bàn giao — **chưa kiểm được**, đừng coi bảng dưới là đã vét hết. Khi bản đầu và bản phản biện mâu thuẫn, dưới đây luôn lấy bản phản biện.*

---

## 1. Bảng xếp hạng đường vào

Xếp theo (khả năng ÷ chi phí) giảm dần.

| # | Đường vào | Khả năng | Chi phí thật (tiền + giờ + thiết bị) | Rủi ro | Việc đầu tiên phải làm |
|---|---|---|---|---|---|
| 1 | **Màn hình `10.1 Statistics` sẵn có trên HMI + xuất USB** — mục lục sổ tay A15 bản 2020-04 có `10.1 Statistics ... 76` (http://web.archive.org/web/20250119060002if_/https://www.cabolisan.com/wp-content/uploads/2021/01/BECS-A15-User-Manual-Version-2020-04.pdf). Máy có thể đã tự đếm sản lượng sẵn. | **Vừa–cao** (mục lục có thật; nội dung mục 10.1 **chưa kiểm được** vì thân sách bản 2020-04 chưa tải được) | 0đ · 10 phút · 1 USB | Bằng 0 nếu chỉ xem và chụp | Bấm vào chương 10 trên HMI, chụp màn hình, tìm nút xuất ra U đĩa |
| 2 | **Nhập tay / bán tự động** — repo đã có sẵn `src/components/ManualReadingForm.tsx` + `bridge/lib/manual-entry.mjs` | **Cao** (chắc chắn chạy được) | 0đ · vài giờ code (đã viết phần lớn) · không thiết bị | Bằng 0 về kỹ thuật; rủi ro là sai số người nhập | Chốt quy trình ghi số đầu ca / cuối ca; đây là lưới an toàn để dashboard không rỗng trong lúc các hướng khác chạy |
| 3 | **Phép thử DNS** — repo đã có `scripts/dns-log.mjs`, bind UDP/53 không cần sudo trên Darwin 27 (đã đo tại chỗ, uid 501) | **Vừa** — kết luận được **dù kết quả ra sao** | 0đ · ~60 phút · Mac + app Deco | Thấp; nếu tắt DHCP máy có thể rơi khỏi mạng, bật lại là xong | Trỏ DNS về IP Mac (ưu tiên trỏ ở router Deco cho riêng MAC `ec:30:8e:1d:1a:6a`, **không đụng máy**), chạy `node scripts/dns-log.mjs` từ Terminal.app |
| 4 | **Tài khoản 大豪云 qua đại lý** — hãng tự khai đám mây giám sát **sản lượng** thời gian thực (https://itunes.apple.com/lookup?id=1488277916&country=cn) | **Vừa** | Giá **chưa kiểm được** (không có bảng giá công khai) · 1–3 ngày chờ · có thể phải mua hộp 数采 | Trung bình–cao: kênh này mang lệnh 分期付款远程加解密 (khoá máy trả góp) — chính hãng khai trên App Store | Nhắn đại lý xin `集团/工厂代码` + tài khoản, và hỏi máy chạy chế độ `数采` hay chỉ `人工` |
| 5 | **Đọc nhãn module WiFi Lierda + quét SSID SoftAP** — OUI `EC:30:8E` = Lierda, xác nhận từ sổ IEEE (https://standards-oui.ieee.org/oui/oui.csv) | **Thấp–vừa** | 0đ · ~1 giờ · tuốc-nơ-vít + điện thoại có app hiện BSSID | Vừa: phải mở hộp điện (rút điện trước), có thể đụng tem niêm phong | Rút điện, chụp nhãn module (model + `CMIIT ID`), rồi quét SSID 2 chu kỳ tắt/bật |
| 6 | **Cảm biến gắn ngoài (đếm mũi không chạm controller)** — repo đã có khung `firmware/esp32-stitch-node/` và fixture `docs/fixtures/telemetry-node-cam-bien.json` | **Cao về nguyên lý**, nhưng **chưa có báo cáo nào điều tra** ⇒ chi tiết **chưa kiểm được** | Vài trăm nghìn đến ~1 triệu đ/máy (ước, **chưa kiểm được**) · nhiều ngày | Vừa: gắn thêm vật lý lên máy đang chạy | Chỉ mở khi hướng 1 và 3 đều thất bại |
| 7 | **Wilcom EmbroideryConnect** | **Thấp cho mục tiêu chính** — tài liệu chính hãng grep sạch: 0 lần `stitch count`, `production data`, `machine status` (https://docs.wilcom.com/embroiderystudio/27/en/downloads/EmbroideryConnectSupplement.pdf) | USD 399 (KM 199) + **"Available in the USA only"** + bắt buộc bản quyền EmbroideryStudio + 1 PC Windows bật 24/7 (https://wilcom.com/embroideryconnect) | Rủi ro **mất tiền**: 3 cửa ải độc lập (chỉ bán ở Mỹ / chỉ Windows / router phải WPA-WPA2, không WPA3) | **Đừng chi.** Nếu vẫn muốn, mở app Deco xem đang WPA3 hay không — chỉ 2 phút và nó phủ quyết cả khoản chi |

---

## 2. Việc làm được NGAY hôm nay (không mua gì, không ra xưởng)

1. **Trỏ DNS ở router Deco** cho riêng MAC `ec:30:8e:1d:1a:6a` về IP của Mac — làm trong app điện thoại, không đụng vào máy thêu chút nào. Đây là biến thể an toàn nhất của phép thử DNS (`scripts/dns-log.mjs`).
2. **Mở app Deco → Wi-Fi → xem chế độ bảo mật.** Nếu là WPA3 hoặc WPA2/WPA3 mixed thì loại thẳng hướng EmbroideryConnect trước khi tốn đồng nào (https://docs.wilcom.com/embroiderystudio/27/en/downloads/EmbroideryConnectSupplement.pdf: *"The WiFi router must use one of the standard security protocols: WEP or WPA/WPA2 Personal … The EC device will not connect to a WiFi router using the 5 Ghz band."*).
3. **Soạn và gửi tin nhắn tiếng Trung cho đại lý** (bản mẫu ở mục 4). Đây là việc chờ lâu nhất nên phải gửi sớm nhất.
4. **Thử tải lại trọn vẹn sổ tay A15 bản 2020-04.** Hai file trong scratchpad đúng 1.048.576 byte và 5.242.880 byte — tròn 1 MiB và 5 MiB ⇒ bị **cắt cụt do giới hạn tải**, không phải bị chặn. Bản khôi phục được mục lục đang nằm ở `/Users/admin/Documents/ChatGPT/dashboarddahao/docs/so-tay-dahao/BECS-A15_2020-04_recovered-text.txt`. Thân sách vẫn chưa lấy được (cabolisan.com timeout 443; wayback chỉ có đúng 1 snapshot và bị cắt).
5. **Tra tham số trên manualslib** — nguồn này **còn sống**, curl trần trả HTTP 200, 361 KB (https://www.manualslib.com/manual/1624034/Dahao-Becs-A15.html?page=120). Nhưng đó là bản 129 trang đời giữa, **không có** chương WiFi và **không có** mục Statistics — dùng để tra tham số thì được, tìm WiFi thì vô ích.
6. **Hoàn thiện đường nhập tay** (`ManualReadingForm.tsx` + `manual-entry.mjs`) để dashboard có số ngay tuần này, không phụ thuộc kết quả các phép thử.

---

## 3. Danh sách kiểm KHI Ở XƯỞNG

Làm đúng thứ tự. Mục 1–3 **không sửa gì**, chỉ nhìn và chụp.

**□ 1. Sao lưu tham số TRƯỚC MỌI THỨ**
- HMI: vào mục **`9.5 Machine Debugging`** → `Parameters Export/Import` → `Export machine parameters` ra U đĩa.
- ⚠️ Tên mục là **"Machine Debugging"**, không phải "Parameters Export" (mục lục sổ tay A15 2018-01: http://www.voltexsew.com/Uploads/202105/60b045ce28586.pdf). Ngay cạnh đó là `Parameter Initialization` và `Boot Loader Upgrade` — **không bấm nhầm**.
- ✅ Thành công: trên USB xuất hiện file tham số. ❌ Thất bại: không có file → dừng, đừng sửa tham số nào.

**□ 2. Mở chương 10 → `10.1 Statistics` — việc quan trọng nhất**
- HMI: tìm chương "Other Functions" → Statistics (theo mục lục bản 2020-04, trang 76).
- Chụp toàn bộ màn hình. Tìm: có con số tổng mũi / sản lượng theo ca không? Có nút xuất ra U đĩa không?
- ✅ **Thành công quan sát được**: màn hình hiện số mũi, và/hoặc USB nhận được một file sau khi bấm xuất.
- ❌ Thất bại: HMI không có chương này (tức firmware là đời cũ hơn bản 2020-04).

**□ 3. Mở `9.2 WiFi Netword Configuration`** (tên có lỗi chính tả "Netword" là nguyên văn của Dahao, mục lục bản 2020-04)
- Chụp: có danh sách SSID không, có ô nhập địa chỉ server không, có nút đăng ký không.
- ✅ Thành công: nhìn thấy màn hình đó ⇒ WiFi của A15 **không** cấu hình bằng nhóm `C4x`, và ta biết chính xác nó trỏ đi đâu.
- ❌ Thất bại: không có mục nào như vậy.

**□ 4. Đọc đúng hai biểu tượng mạng ở thanh trên cùng — đừng nhìn nhầm**
- Bản 2020-04 có **HAI** icon tách rời: `Network Status` (3 trạng thái: disconnected / connected / **successful registration**) và `WiFi Connection Status` (chỉ 2 trạng thái, **không** có registration).
- ✅ Nếu `Network Status` đang ở **connected mà không lên successful registration** ⇒ bằng chứng máy CÓ nói chuyện nhưng bị từ chối đăng ký.
- ⚠️ Cái "biểu tượng đám mây gạch chéo" mà xưởng vẫn nhìn có thể chỉ là icon WiFi, không phải trạng thái đăng ký.

**□ 5. Chụp bảng tham số nhóm `Z` (nếu có)**
- Toàn bộ ghi chép về `Z02 DNS` / `Z03 Start DHCP` hiện **chưa có nguồn nào**: grep `\bZ[0-9]{2}\b` trên cả 3 sổ tay đã tải (A15 2018-01, A18/A58/A98, A68/A88 2021-01) ra **0 kết quả**.
- ✅ Thành công: có ảnh chụp thật ô `Z02`. ❌ Không tìm thấy ⇒ phép thử DNS phải làm ở router Deco chứ không ở máy.

**□ 6. Phép thử DNS**
- Trên Mac, **mở từ Terminal.app** (bắt buộc — memory `mac-chan-node-ra-lan`): `node scripts/dns-log.mjs`. Không cần sudo.
- Biến thể A (an toàn nhất): trỏ DNS ở app Deco cho MAC `ec:30:8e:1d:1a:6a` về IP Mac. Biến thể B: nếu HMI có `Z02`, đặt `Z02` = IP Mac **và tắt `Z03` DHCP** — nếu để DHCP bật, module gần như chắc chắn dùng DNS của Deco và bỏ qua Z02, phép thử thành phép thử rỗng.
- Mỗi biến thể nghe 10 phút; trong lúc nghe, bấm chức năng tải mẫu không dây trên HMI để ép máy phân giải tên.
- ✅ **Thành công**: log hiện bất kỳ truy vấn A/AAAA nào — đặc biệt `*.dahaoyun.net`. Đó là giao thức đầu tiên bám được.
- ❌ **Thất bại (cũng là kết luận)**: 0 truy vấn sau cả hai biến thể ⇒ ngăn xếp mạng chưa bật, xin được tài khoản đám mây cũng vô dụng → chuyển sang hướng 6 (cảm biến ngoài).
- Xong thì **hoàn nguyên** Z02/Z03 về giá trị gốc.

**□ 7. (Tuỳ chọn, cuối buổi) Quét SSID lạ + đọc nhãn module**
- Quét SSID phải làm **2 chu kỳ tắt/bật**, mỗi trạng thái là hợp của 5 lần quét — đã đo trên chính Mac này: chạy 2 lần cách nhau 20 giây mà không tắt gì, danh sách vẫn nhảy 13→16 SSID ⇒ so sánh 1 lần là dương tính giả.
- ✅ Thành công: một SSID chỉ xuất hiện khi máy có điện, **ở cả hai chu kỳ**, và BSSID bắt đầu bằng `ec:30:8e` / `a0:c6:a5` / `30:1b:97` (cả 3 khối MA-L của Lierda, https://standards-oui.ieee.org/oui/oui.csv). macOS không in BSSID ⇒ phải xem bằng app trên điện thoại.
- Nhãn module: chụp model in lụa + `CMIIT ID`. Mã có 12 ký tự `AABCCDDDEEEE`, `AA` = năm nộp hồ sơ; hậu tố `(M)` = module rời không hoạt động độc lập — nhìn là biết, không cần tra ở đâu. Muốn tra thêm thì dùng https://ythzxfw.miit.gov.cn/jgcx/index.html (trả HTTP 200 từ mạng ở đây, nhưng có captcha ⇒ **người** phải tự gõ); `cmiitid.cn` trả 403.
- ⚠️ **Đừng** kết luận "thấy chip AIC8800 là hướng chết" — không tài liệu nào của Lierda nói dòng đó thiếu MCU/AT/SoftAP; grep trang sản phẩm DB6L ra 0 lần `AT指令`, 0 lần `SoftAP` (https://www.lierda.com/iot-module/90).

---

## 4. Việc phải hỏi / mua của người khác

### 4a. Tin nhắn gửi đại lý (gửi nguyên văn, tiếng Trung)

> 您好。我们工厂有一台大豪 BECS-A15 单头绣花机，通过外接 WiFi 模块联网（模块 MAC：ec:30:8e:1d:1a:6a），机器已连上厂里的 WiFi，但屏幕上的云图标是打叉的。机器已全款付清。
>
> 想请教四件事：
>
> 一、这台 A15 能不能接入**大豪云**？需要额外买网关或数采盒子吗，还是现有 WiFi 模块就够？接入后是**机器数采**模式还是只能**人工**报工？
>
> 二、如果可以接入，请帮我们开通工厂账号，并提供**集团/工厂代码**、**用户名**、**登录密码**（以及需要的话：激活码、4位工厂验证码）。请务必把**主账号**开在我们公司名下。
>
> 三、请书面确认：本机**不启用分期付款远程加解密**功能。
>
> 四、请发我们两份资料：《BECS-A15 使用说明书（通用部分）**版本 2020-04**》全本，特别是 **第9.2节 WiFi 网络配置（第72页）** 和 **第10.1节 统计（第76页）**；以及《A15机型安装调试说明》。我们手上只有 2018-01 版（105页）和129页版，这两版都没有 WiFi 配置章节。
>
> 另外：现在的固件里，C41 服务器端口的取值范围是 1..3865，而手册写的是 1~9999——请问 C41–C47 这组网络参数在这个固件上还有效吗，还是网络功能已经全部走大豪云？

**Vì sao hỏi đại lý trước, không hỏi hãng trước:** mã nguồn web app cho thấy chỉ **đại lý** mới nộp được `开通工厂申请`, và đại lý có **hạn ngạch** số xưởng (`开通工厂申请数量已达上限！`) — http://main.iot.dahaoyun.net/p__system__agent__applyFor.7387c5ef.async.js. Hỏi hãng trước sẽ bị đẩy về đại lý.

**Kênh dự phòng của hãng** (lấy từ chính trang 用户协议 do app phục vụ, http://main.iot.dahaoyun.net/p__protocol.2fba5cc0.async.js): `dahaoyun@dahaobj.com`, +86-10-59248888, T2–T6 8:30–17:30 giờ Bắc Kinh, 北京市朝阳区酒仙桥东路1号.

### 4b. Thứ đáng mua

| Món | Giá | Đánh giá |
|---|---|---|
| Cảm biến đếm mũi gắn ngoài | **chưa kiểm được** (không báo cáo nào khảo giá) | Đáng cân nhắc **sau khi** phép thử DNS thất bại; khung firmware đã có sẵn trong repo |
| Tài khoản 大豪云 / hộp 数采 | **chưa kiểm được** — không có bảng giá công khai, chuỗi `注册`/`开通`/`试用` đều 0 lần trong web app | Chỉ chi sau khi đại lý xác nhận A15 chạy được chế độ `机器数采` |
| Wilcom EmbroideryConnect | USD 399 (KM USD 199), *"Available in the USA only"* (https://wilcom.com/embroideryconnect) | **Không đáng mua cho mục tiêu này** — nó chỉ thay việc cắm USB tay bằng đẩy mẫu qua WiFi, mà xưởng vốn đã cắm USB tay được |
| emCAD | USD 600 + dongle USB (https://isewworld.com/) | **Không mua.** Không nguồn nào mô tả cơ chế mạng của nó; nó là phần mềm **chế bản**, và dù chạy cũng chỉ **đẩy mẫu vào**, không **đọc sản lượng ra** |

---

## 5. Đường đã chết — đừng đi lại

- ~~**Dựng EmbNetServer / bộ NET-X5 cho A15**~~ — tài liệu chính hãng Dahao liệt kê đích danh dòng máy hỗ trợ EmbNet: `1x2, 2x2, 1x8, 2x8, xx6, 322, 528, x9S, Ax8, Cx8` — **không có A15** (https://www.theembroiderywarehouse.com/butterflyemb/dahao-embroidery-machine-manual/documents/BUTTERFLY%20MULTI-HEAD%20EMBROIDERY%20MACHINES%20OPERATION%20MANUAL.pdf). Cộng thêm: chuỗi `EmbNet` xuất hiện **0 lần** trong toàn bộ sổ tay A15.
- ~~**EmbNet qua WiFi**~~ — EmbNet bắt buộc đi dây: hoặc cổng serial 232 + hộp NET-03, hoặc RJ45 cáp chéo (cùng nguồn trên). Máy của xưởng không có đường vật lý nào trong hai đường đó.
- ~~**Menu "auxiliary function setting → trang cuối → ② connect the machine to the internet"**~~ — A15 **không có** menu đó; chương 8 của A15 chỉ có Frame Selection / Clear XY Displacement / Positioning Idling. Đừng bắt thợ đi mò menu không tồn tại.
- ~~**Wilcom Embroidery Web API**~~ — là API đám mây trên AWS chỉ xử lý file mẫu, không endpoint nào chạm tới máy (https://apiguide.wilcom.com/documents/api-developer-guide/).
- ~~**"HILCOM" như một công ty/thương hiệu**~~ — tra 5 thứ tiếng, trắng. Giả thuyết mạnh nhất: tem đọc nhầm **W**ILCOM thành **H**ILCOM. Chỉ mở lại khi có **ảnh macro cái tem**.
- ~~**Sửa `C42` MAC Address**~~ — sổ tay: *"the first two digits of MAC address must be zero"* (http://web.archive.org/web/20240807161139if_/https://overlock.com.ua/wa-data/public/site/Manuals/Dahao-a18-a58-a98_compressed.pdf). MAC thật là `ec:30:8e:...` ⇒ module WiFi **không dùng** C42, nó có MAC riêng. Thêm bằng chứng nhóm C4x thuộc về card Ethernet đời cũ.
- ~~**Dò cổng/probe UDP kiểu USR-IOT / Hi-Flying**~~ — Lierda không có dòng serial-to-WiFi 透传 trong danh mục hiện tại; hạng mục 透传 của họ được đặt tên thẳng là `BLE透传模组` (https://www.lierda.com/iot-module?kw=%E9%80%8F%E4%BC%A0). Khớp với kết quả đo 0 cổng mở.
- ~~**Tìm SDK / mã nguồn / cổng dev**~~ — `gitee.com/lierda_ciot` ghi `暂无仓库`; `open./developer./api./doc.dahaobj.com` đều NXDOMAIN, và `dahaobj.com` **không có wildcard DNS** (tên bịa cũng NXDOMAIN) ⇒ đây là bằng chứng phủ định chắc chắn, không phải phỏng đoán.
- ~~**Vòng qua bot-check của dahaobj.com / frk123.com**~~ — trả 567 EdgeOne / 468 SafeLine. Không được lập trình vòng qua; chỉ mở bằng trình duyệt người thật.
- ~~**Máy ảo Windows chạy SQL Server 2008 R2**~~ — Mac này là Apple Silicon (arm64), bộ NET-X5 cần `SQLEXPR_x86.exe` 32-bit; kể cả có chạy được cũng vô nghĩa vì A15 không nằm trong danh sách EmbNet.

**Đính chính hai thứ trước đây bị coi là bằng chứng nhưng đã bị bác:**
- Câu *"network (temporarily unavailable)"* **chỉ có ở bản sổ tay 2018-01**; bản 2020-04 đã xoá cụm đó. Không dùng nó để giải thích hành vi của máy đời 2024 nữa.
- Hàng `Dahao | A15` trong danh sách Wilcom: cột **Controller Model bỏ trống**, chữ `BECS` không có trên trang, và tiêu chí của bảng chỉ là *"if the embroidery machine has a native USB port"* ⇒ nó chỉ lặp lại điều xưởng đã biết.

---

## 6. Ba điều nguy hiểm nhất nếu làm sai

- **Ghép máy vào 大豪云 mà không có văn bản xác nhận tắt `分期付款远程加解密`.** Hãng tự quảng cáo tính năng đặt hạn sử dụng cho thiết bị, hết hạn thì khoá, đóng tiền mới mở (https://itunes.apple.com/lookup?id=1488277916&country=cn). Máy đã trả đủ tiền — ghép vào đám mây là tự đưa máy vào tầm với của cơ chế đó. Đồng thời phải bắt buộc `主账号` đứng tên công ty xưởng, không để đại lý đứng tên (web app có chức năng `工厂切换`, một tài khoản đại lý quản được nhiều xưởng).
- **Bấm nhầm trong menu `9.5 Machine Debugging`.** `Parameter Initialization` và `Boot Loader Upgrade` nằm ngay cạnh `Parameters Export`. Xoá tham số hoặc hỏng bootloader trên một máy mà kênh mạng gắn với cơ chế khoá trả góp là biến vấn đề dữ liệu thành vấn đề pháp lý với bên bán. Tuyệt đối không cắm USB-UART vào chân nạp module, không đọc/ghi firmware.
- **Đóng nhầm một hướng còn sống, hoặc đổ tiền vào một hướng đã chết.** Hai lỗi này đã suýt xảy ra: (a) suýt bỏ nửa ngày dựng EmbNetServer cho một dòng máy mà tài liệu chính hãng nói rõ không hỗ trợ; (b) suýt chi ~8 triệu cho EmbroideryConnect vì hiểu nhầm một hàng trong bảng tương thích. Nguyên tắc: **chỉ đóng hướng khi có câu chữ trong tài liệu chính hãng hoặc câu trả lời của đại lý, không đóng vì suy luận**; và **chỉ chi tiền sau khi phép thử 0đ đã cho kết quả**.