# PRD — Nguồn dữ liệu cho dashboard máy thêu Dahao

[PRD]

Tài liệu này đứng cạnh `PRD_CLAUDE_READONLY_FLEET.md` (sản phẩm) và `PRD_UI_MONITORING.md` (giao diện).
Hai tài liệu đó giả định **đã có dữ liệu từ controller**. Tài liệu này xử lý đúng chỗ giả định đó đang sai.

## 0. Tài liệu này giải quyết việc gì

Phần mềm đã xong: dashboard chạy, bridge chạy, listener dial-in chạy, đã ghép máy thật.
Thứ còn thiếu **không phải code, mà là một nguồn dữ liệu**.

Câu hỏi phải trả lời: *cần gì để có một bảng dashboard xem thông tin máy, và đưa dữ liệu vào máy?*

Câu trả lời ngắn, trước khi vào chi tiết:

- **Xem thông tin máy qua mạng LAN**: cần một phần mềm đích tên **EmbNetServer** mà controller được thiết kế để gọi vào, hoặc phải giả lập được nó. Đúng con máy này (A15) **không nằm trong danh sách máy mà EmbNetServer hỗ trợ**, và sổ tay của chính nó ghi chức năng mạng là *tạm thời chưa dùng được*.
- **Đưa dữ liệu vào máy**: chỉ có một đường duy nhất được hãng thừa nhận trên con máy này — **USB**. Và chỉ là file mẫu, không phải lệnh điều khiển.

Phần còn lại của tài liệu là bằng chứng cho hai câu đó, bốn đường đi khả thi, và việc phải làm.

---

## 1. Hiện trạng đo được (không suy đoán)

### 1.1 Bằng chứng mạng — đo trực tiếp trên máy thật, 17/08/2026

| Phép đo | Kết quả | Suy ra được gì |
| --- | --- | --- |
| `ping 192.168.7.100` | mất 100% gói | **Không kết luận được gì.** Controller tắt ICMP echo. `ping` là thước đo sai cho con máy này. |
| `arp -an` | `192.168.7.100 → ec:30:8e:1d:1a:6a` | Máy **có mặt trên LAN**, MAC thật của nhà sản xuất. |
| Quét TCP **đủ 1–65535** | 0 cổng mở, xong trong **3 giây** | Máy trả `RST` tức thì cho từng cổng. Gói `RST` về được tới Mac ⇒ **đường IP hai chiều thông suốt**. Loại bỏ client isolation, loại bỏ tường lửa. Controller **không phục vụ gì cả** — nó chỉ có thể là bên gọi ra. |
| UDP: probe unicast + broadcast 15 magic string (Hi-Flying, USR-IOT, Lantronix, Digi, TP-Link, SSDP, SNMP…) | chỉ router `.254` trả lời | Không phải module serial-to-WiFi phổ thông. |
| Nghe thụ động 90 giây, 21 cổng broadcast | controller **không phát ra một gói nào** | Máy không tự quảng bá, không mDNS, không heartbeat broadcast. |
| OUI `ec:30:8e` | **Lierda Science & Technology Group** (Hàng Châu, đăng ký 06/2024) — hãng làm **module IoT** | Phần nối mạng của máy là **module IoT gắn thêm**, không phải card mạng của Dahao. Khớp với tem **HILCOM** trên thân máy. |
| `C44 = 192.168.7.102`, `C41 = 1600`, `C43`, `C45`, `C46 = 192.168.7.254`, `Z03 = no`, `Z02` thử cả `0.0.0.0` và IP gateway; tắt/bật nguồn nhiều lần | bridge đếm `connections: 0` sau hơn 50 phút | Controller **chưa một lần** mở kết nối ra. Đặt đúng tham số là **không đủ**. |
| Nhóm tham số trên máy | chỉ có **một** nhóm `Emb asst. Para`, 4 trang | **Không có công tắc "bật mạng" ẩn** ở nhóm khác. |
| Cổng vật lý | RJ45 **rỗng trên panel HMI**; `CN2` USB "Function extension interface" | Có cổng mạng có dây chưa dùng. **SỬA 18/08/2026:** trước đây bảng này ghi RJ45 đó là `CN1` — sai. Trên hộp điều khiển chính BECS-A15, `CN1` là **encoder trục Y**; cả `CN1`–`CN10` của hộp chính **không có cổng Ethernet nào**. Xem `PRD_LAN_MA_NGUON_MO.md` mục 1.1. |

Ràng buộc công cụ: máy Mac này không có sudo ⇒ **không sniff được gói** (`tcpdump` cần root) và không đặt được IP tĩnh.

### 1.2 Bằng chứng từ sổ tay chính hãng của **đúng** con máy này

Model plate: `A15-B104H-B (支持NB支架)`, serial `1010832DH21395748`.
Sổ tay `BECS-A15 Owner's Manual` (đã tải, 3849 dòng text):

- Thông số kỹ thuật: *"Supported method for data exchange: USB disk, network **(temporarily unavailable)**"*.
  Hãng tự ghi chức năng mạng **chưa dùng được** trong bản sổ tay này.
- Tốc độ cổng mạng: 100 Mbps.
- Thanh trạng thái có **ba** trạng thái mạng: mất kết nối → đã kết nối → **đăng ký thành công**.
- *"Only with (successful registration) displayed, can it be possible to transmit patterns by network."*
  ⇒ Có **cửa đăng ký**. Kết nối TCP không đủ; phải qua bắt tay đăng ký.
- Nhóm `Net Parameters`: `C41 Server Port` (mặc định **1600**, dải 1~9999), `C42 MAC Address`
  (mặc định `001122334455`), `C43 IP Address`, `C44 Server IP`, `C45 Subnet mask`, `C46 Gateway`,
  `C47 Machine Number` (1~245), `Z02 DNS Server`, `Z03 Start DHCP`.
  Mọi mô tả đều có cụm *"when it is connected to PC"*.
- **Sổ tay A15 có 4 phụ lục: Parameter List, U Disk Operation, Automatic Position Limitation, Quick Guide.
  KHÔNG có phụ lục mạng nào.**
- Chương `9.1 Statistics`: có màn hình thống kê dạng biểu đồ, xem chi tiết từng mẫu, **xoá** thống kê.
  Không có chức năng xuất thống kê ra USB.
- Phụ lục 2 (U Disk): USB dùng cho **file mẫu**, format FAT16/FAT32, tên DOS 8.3, 400 file/thư mục,
  hỗ trợ **cập nhật firmware**, hỗ trợ format USB. **Không có mục nào xuất dữ liệu sản xuất.**

**Kết luận mục 1:** máy sống, mạng thông, nhưng controller không mở cổng, không tự gọi ra, và sổ tay
của chính nó nói chức năng mạng chưa dùng được. Vấn đề **không nằm ở hạ tầng mạng của xưởng**.

---

## 2. Khảo sát cộng đồng

Đã tìm bằng cả tiếng Anh và tiếng Trung. Ghi lại cả cái tìm được và cái **không** tìm được — cái
không tìm được cũng là kết quả.

### 2.1 Tiếng Anh

**a) Sổ tay các dòng BECS cũ có phụ lục mạng mà A15 không có.**
`BECS-285A Owner's Manual` (bản 2016-01, tải được qua bản Butterfly BT1501, 7.4 MB) có
**"Appendix 4 Network Function of Embroidery Machine"** — đây là phần A15 bị thiếu. Nội dung then chốt,
dịch nguyên văn:

> **4.2 IP address of server** — Tham số này **phải là IP của máy PC đã cài EmbNetServer**. Địa chỉ này
> xem được trong cửa sổ hiển thị của EmbNetServer.
>
> **4.3 Server port No.** — Giá trị này là **số cổng mà EmbNetServer đang dùng**. Số này xem được trong
> cửa sổ hiển thị của EmbNetServer.

Cùng phụ lục còn cho biết:

- **`C42 MAC Address` bắt buộc hai ký tự đầu bằng 0** — *"When the first two digits of MAC address are
  not zero, some network equipments regards it as illegal MAC address, thus the equipment can't be
  linked to the network."* Mặc định `001122334455` đúng quy tắc này.
- Ba trạng thái mạng trên 285A ghi rõ hơn A15: **Disconnected → Connected → Successful Log-in**.
- Cách dựng mạng: PC ↔ máy thêu bằng **cáp crossover**, hoặc qua **HUB** bằng cáp thẳng. Có hướng dẫn
  bấm cáp tận từng chân. Đây là tài liệu thời hub và Windows XP.
- 285A ghi tốc độ cổng mạng **10 Mbps** và phương thức trao đổi dữ liệu gồm cả *network* — **không** có
  ngoặc "temporarily unavailable" như A15.

**b) Phần mềm đích có tên: `EmbNetServer` + `EmbNetClient`.**
Mô hình client–server. File thực thi: `SemsServer.exe`, `SemsServerWeb.exe`. Tác giả: DaHao.
Phiên bản phổ biến 1.0 và 1.1. Có `EmbNet Owner's Manual` 29 trang (bản xem trước trên Scribd; toàn văn
không mở được). Chức năng nêu trong bản xem trước: thêm máy vào mạng, nhập file mẫu, đặt trình tự đổi
màu, **phân phối mẫu ra nhiều máy trong mạng**.

**c) DH-NET — sản phẩm hiện đại của Dahao.**
"DH-NET Internet Intelligent Factory System (Ⅰ) Embroidery Machine Network Management". Dữ liệu hệ
này thu: bật/tắt nguồn, **đứt chỉ**, cảnh báo, tiến độ sản xuất, năng suất từng công nhân, trạng thái
chạy, sản lượng, **tính lương**, cảnh báo (sản lượng vượt mức, năng suất thấp, máy dừng). Xem được trên
PC, điện thoại, tablet. Đây chính là loại dashboard mà dự án này đang tự làm — nghĩa là dữ liệu **tồn
tại** trong controller; vấn đề là đường lấy ra.

**d) Giải pháp thương mại thực sự tồn tại và cộng đồng dùng — Wilcom EmbroideryConnect.**
Một cục cắm vào **cổng USB của máy thêu**, tự nối WiFi **2.4 GHz**, nhận file mẫu không dây từ PC chạy
EmbroideryHub. Giá **199 USD**. Có đèn LED và thông báo trạng thái, nhưng tài liệu kỹ thuật **chỉ nói về
gửi mẫu xuống máy**, không nói đọc dữ liệu sản xuất lên. Ràng buộc: *"The EmbroideryHub needs to remain
active at all times"*. Đây là bằng chứng quan trọng: **cách công nghiệp giải quyết chiều "vào máy" là
giả lập USB, không phải nói giao thức với controller.**

**e) Đường không cần giao thức: cảm biến gắn ngoài.**
Bằng sáng chế `US10179961` / `WO2016200927A1`, Conrad Industries Inc, ưu tiên 08/06/2015: hệ giám sát
sản xuất thêu bằng **cảm biến quang, nhiệt độ, tiệm cận, độ ẩm**, trong đó có một **"mimic light"** trùm
lên bóng đèn báo đứt chỉ của máy để đọc độ sáng. Điểm cốt lõi, dịch nguyên văn:

> *"hệ giám sát **không cần tương tác hay kết nối** với kiến trúc máy của máy thêu. Cụ thể, **không có
> kết nối dây nào, không sửa đổi gì** … hay hệ điều khiển điện tử của nó."*

Đo được: đếm mũi, đếm cắt chỉ, chọn kim, **đứt chỉ**, hành động của người vận hành, mốc thời gian từng
sự kiện.

**f) Phần mềm quản lý xưởng thêu thương mại** (ShopWorks OnSite, PriceIt, DecoNetwork, Melco SUMMIT
Manager, My.ZSK Cloud): đều theo dõi sản lượng/mũi ở tầng **đơn hàng và báo giá**, còn giám sát máy
thật thời gian thực thì **chỉ chạy với máy cùng hãng** (Melco với Melco, ZSK với ZSK). Không có sản phẩm
nào đọc được controller Dahao.

### 2.2 Tiếng Trung

**a) Bài chi tiết nhất tìm được — 缝纫客 (frk123.com): "兴大豪:刺绣机网络管理系统解决方案".**
Danh mục triển khai đầy đủ của hệ EmbNet:

- PC: **P4 CPU, 512 MB RAM, 10 GB ổ cứng**, hệ điều hành **Windows 2000 / XP / 2003**.
- Phần mềm: **EmbNetServer** (máy chủ) + **EmbNetClient** (máy trạm).
- Dây mạng, **hub**.
- **大豪网络连接转换器 — "bộ chuyển đổi kết nối mạng Dahao"**, kèm cáp cổng nối tiếp.
- Nhiều máy thêu điện tử Dahao.

Thứ tự làm: nối PC ↔ hub ↔ **bộ chuyển đổi Dahao** ↔ cổng nối tiếp *hoặc* cổng mạng của controller →
đặt IP cho PC → đặt IP máy, địa chỉ server, số cổng trên controller → chạy EmbNetServer → chạy EmbNetClient.

**Đây là mảnh ghép lớn nhất của toàn bộ khảo sát:** với dòng BECS cũ, đường mạng đi qua **một cục chuyển
đổi của chính hãng**, và với nhiều máy là qua **cổng nối tiếp**, không phải Ethernet trực tiếp.

**b) Danh sách máy EmbNet hỗ trợ:** `1x2, 2x2, 1x8, 2x8, xx6, 322, 328, x9S, Ax8, Cx8`.
**A15 không có trong danh sách.** Toàn bộ là dòng BECS đời cũ.

**c) 大豪 EMBMATE — nền tảng của chính A15.**
Theo tường thuật CISMA2021: Dahao trình diễn hệ điều khiển thêu thông minh **EMBMATE**, "hỗ trợ chức
năng nối mạng **WIFI, 4G, LAN**, cho phép liên thông các hệ điều khiển và hỗ trợ ứng dụng nối mạng
**nền tảng đám mây Dahao**". Báo cáo thường niên của 大豪科技 (mã 603025) mô tả hệ dịch vụ số hoá toàn
chuỗi gồm **nối mạng thiết bị, thu thập dữ liệu, quản lý sản xuất**, và hợp tác với nền tảng
công nghiệp 根云 / RootCloud.

⇒ A15 **có** nối mạng, nhưng theo mô hình **đám mây của hãng**, không phải LAN dial-in kiểu EmbNet.
Việc đó khớp chính xác với những gì đo được: module IoT Lierda gắn thêm, và `C41`–`C47` là tham số
**kế thừa từ dòng BECS cũ**, để lại trong firmware nhưng không phải đường đi thật của A15.

**d) Không tìm được, dù đã tìm có chủ đích:**

- Không có dự án dịch ngược giao thức Dahao nào trên GitHub, tiếng Anh hoặc tiếng Trung.
- Không có bài 知乎 / CSDN / 贴吧 / diễn đàn nào mô tả khung tin (frame format) của giao thức này.
- Không có mã nguồn mở nào đóng vai EmbNetServer.
- Không có hướng dẫn DIY nào kiểu "tự làm hệ giám sát máy thêu bằng Raspberry Pi".
- Không tìm được tài liệu HILCOM nào — cái tem trên thân máy không có dấu vết công khai.
- Không tìm được số model của 大豪网络连接转换器.

### 2.3 Kết luận từ khảo sát

1. **Đích của `C44:C41` có tên thật: EmbNetServer.** Không còn là ẩn số.
2. **Giao thức là đóng và chưa ai công khai dịch ngược.** Sẽ không có tài liệu để đọc; nếu muốn nói được
   giao thức thì phải tự bắt gói và tự giải mã.
3. **A15 gần như chắc chắn không nói EmbNet.** Ba bằng chứng độc lập cùng chỉ một hướng: sổ tay A15
   không có phụ lục mạng, ghi network *temporarily unavailable*; A15 không có trong danh sách máy EmbNet
   hỗ trợ; nền tảng EMBMATE của A15 hướng tới đám mây hãng. Cộng thêm đo được: `connections: 0`.
4. **Chiều "vào máy" trong thực tế công nghiệp = giả lập USB**, không phải giao thức điều khiển.
5. **Có một đường hoàn toàn bỏ qua controller: cảm biến gắn ngoài**, đã được bằng sáng chế mô tả và có
   sản phẩm thương mại.

---

## 3. Bốn đường đi, và đường nào nên đi

| | Đường | Lấy được gì | Cần gì | Chi phí | Rủi ro | Bao lâu |
| --- | --- | --- | --- | --- | --- | --- |
| **A** | Bridge giả lập EmbNetServer | Toàn bộ dữ liệu controller — nếu thành công | Bắt được gói thật; máy phải chịu gọi ra | Thấp tiền, **rất cao** công | **Rất cao.** Có thể A15 không bao giờ gọi. Chưa ai làm được. | Không xác định |
| **B** | Mua đúng đồ chính hãng (module/DH-NET/đám mây Dahao) qua đại lý | Đúng thứ hãng thiết kế, có bảo hành | Liên hệ đại lý; có thể phải mua module + phí nền tảng | Trung bình–cao tiền | Thấp về kỹ thuật. Rủi ro: **dữ liệu ra đám mây hãng**, và có thể không có API cho dashboard riêng | Vài tuần |
| **C** | Cảm biến gắn ngoài | Chạy/dừng, đếm mũi, đứt chỉ, thời gian dừng, ca — **không** có tên mẫu/số kim | Cảm biến + vi điều khiển + gá lắp | Thấp–trung bình | **Thấp nhất.** Không phụ thuộc hãng, không phụ thuộc giao thức | 1–2 tuần/máy đầu |
| **D** | Nhập tay có kỷ luật + USB cho chiều vào | Sản lượng theo ca, lý do dừng, mẫu đang chạy | Không cần gì mới | ~0 | Không có rủi ro kỹ thuật. Rủi ro: người quên nhập | **Hôm nay** |

### Khuyến nghị, theo thứ tự

1. **Làm D ngay.** Dashboard phải có dữ liệu thật, dù là người nhập, thay vì đứng chờ giao thức. Bridge
   đã có adapter `manual` — dùng đúng nó.
2. **Chạy B song song.** Gọi đại lý bán con máy này, hỏi đúng bộ câu ở mục 14. Đây là đường có xác suất
   thành công cao nhất trên một đơn vị công bỏ ra, và câu trả lời của họ quyết định A có đáng làm không.
3. **Chỉ làm A khi có đủ hai điều kiện:** đại lý xác nhận A15 nói được LAN, **và** có một máy Linux có
   sudo để `tcpdump`. Không có bắt gói thì không có giải mã; không có giải mã thì không có adapter.
4. **Làm C nếu B trả lời "phải mua nền tảng đám mây của hãng"** và xưởng không muốn đưa dữ liệu ra ngoài.
   C cho khoảng 70% giá trị của dashboard (chạy/dừng, sản lượng, đứt chỉ, hiệu suất ca) mà không phụ
   thuộc ai.

---

## 4. Yêu cầu — Đường A: bridge giả lập EmbNetServer

Chỉ mở việc này sau khi có xác nhận ở mục 3. Nếu làm:

1. **Bắt gói là bắt buộc, không thương lượng.** Cần một host Linux (Raspberry Pi / mini PC) có sudo,
   cùng LAN, chạy `tcpdump -i any -w dahao.pcap host 192.168.7.100`. Không có pcap thì dừng — mọi
   suy luận về khung tin không có pcap đều là bịa, và PRD gốc cấm bịa giao thức.
2. **Biến còn thiếu là CÁI KÍCH, không phải giao diện mạng.** Không cần cáp, không cần mua gì.

   Đặt `C44 Server IP` = IP của máy chạy `lang-nghe`, `C41 Server Port` = cổng nó đang nghe, tắt/bật
   nguồn, **rồi bấm lệnh tải mẫu qua mạng trên HMI**. Bước cuối là bước quyết định: A15 không có chức
   năng tự đẩy sản lượng ra (ba việc mạng chính thức chỉ là *đưa mẫu vào máy* / bảo trì từ xa / khoá-mở
   máy trả góp), nên ngồi chờ máy tự khai là chờ một việc nó không làm — đúng cái đã tiêu cả chiều
   18/08/2026 để ra 0 byte. `scripts/lang-nghe.mjs` đã ghi cảnh báo này vào phần hướng dẫn của nó.

   > ⛔ **KHÔNG cắm cáp mạng vào hộp bạc BECS-A15 trong tủ điện.** `CN1` ở hộp đó là **encoder trục Y**,
   > `CN2`/`CN3` là encoder trục X / trục chính. Cả dãy `CN1`–`CN10` của hộp chính **không có cổng
   > Ethernet nào**. Cắm cáp mạng vào một cổng encoder servo là làm hỏng cơ khí, không phải hỏng mạng.
   > Bản trước của mục này ghi "cắm cáp từ `CN1`" — **câu đó sai và đã bị xoá 18/08/2026.**

   **Giả thuyết cũ "`C41`–`C46` chỉ điều khiển NIC có dây" đã bị rút 18/08/2026.** Nó từng là lý do đề
   xuất kéo cáp; hai dữ kiện có sẵn từ trước bác bỏ nó:

   - `.100` là số **gõ tay vào `C43`**, và `.100` trả lời ARP bằng đúng MAC WiFi `ec:30:8e:1d:1a:6a` —
     cùng MAC với `.200` do DHCP của Deco cấp. Một giao diện, hai địa chỉ. ⇒ **`C43` đã có hiệu lực trên
     chính giao diện WiFi**, nên `C44`/`C41` cùng khối không có lý gì trơ.
   - Chỗ `C42 MAC` không khớp tự giải thích được: dải hợp lệ trong sổ tay là
     `000000000000`–`00FFFFFFFFFF`, tức **byte đầu luôn `00`**, nên `C42` *không thể nào* biểu diễn một
     MAC bắt đầu bằng `ec`. Đó là trường di sản module bỏ qua, không phải dấu hiệu có NIC thứ hai.
3. **Ghi khung thô trước, giải mã sau.** Bridge đã có `capture: true` → `bridge-data/dial-in-capture.jsonl`.
   Quy trình giải mã: chụp hai lần, mỗi lần đổi **đúng một** biến (`C47 Machine Number`, số mũi, tên mẫu),
   rồi so hai khung. Đã ghi trong `docs/test-mot-may-that.md`.
4. **Cửa đăng ký là quyết định thiết kế, không phải sửa code lặng lẽ.**
   Sổ tay nói phải "đăng ký thành công" mới truyền được. Đăng ký nghĩa là **server phải trả lời**. Nhưng
   bridge hiện tại **cố ý không ghi một byte nào** trở lại socket dial-in — đó là lý do không đường nào
   trong sản phẩm điều khiển được máy. Nếu phải bắt tay, việc đó **phải được ghi thành một quyết định có
   chủ**, giới hạn ở đúng byte của thủ tục đăng ký, và có test chứng minh không byte nào khác đi ra.
   Tuyệt đối không mở kênh ghi tự do "để thử".
5. **Chưa giải mã được trường nào thì hiển thị `Chưa đọc được từ controller`.** Không suy ra từ IP, không
   dùng dữ liệu mẫu.

## 5. Yêu cầu — Đường B: mua đúng đồ chính hãng

1. Hỏi đại lý theo đúng danh sách ở mục 14. Ghi lại câu trả lời vào `docs/`.
2. **Điều kiện chấp nhận cho dashboard này:** module/nền tảng phải cho ít nhất một trong ba:
   một socket LAN đọc được, một REST/MQTT API, hoặc một file xuất định kỳ. Nếu hãng chỉ cho app của họ
   và không có API — thì B là một sản phẩm giám sát khác, **không phải nguồn dữ liệu cho dashboard này**,
   và phải nói thẳng như vậy với xưởng trước khi trả tiền.
3. Nếu có API đám mây: bridge lấy dữ liệu qua adapter mới `dahao-cloud`, **vẫn giữ nguyên tắc chỉ đọc**.
   Dashboard vẫn phải chạy được khi mất Internet (hiển thị dữ liệu cuối + nhãn cũ), theo đúng
   `PRD_CLAUDE_READONLY_FLEET.md`.

## 6. Yêu cầu — Đường C: cảm biến gắn ngoài

Kiến trúc đã được bằng sáng chế `US10179961` xác nhận là khả thi và **không cần chạm vào hệ điều khiển**.

| Đo cái gì | Bằng gì | Ra trường nào trong `MachineSnapshot` |
| --- | --- | --- |
| Máy đang chạy / đang dừng | cảm biến tiệm cận hoặc quang trên trục chính | `status` chạy/dừng, thời gian dừng |
| Số mũi | đếm xung mỗi vòng trục chính | `stitchCount`, RPM |
| Đứt chỉ | cảm biến quang trùm đèn báo đứt chỉ (đúng cách "mimic light" của bằng sáng chế) | `threadBreak` |
| Ca / người vận hành | nhập tay hoặc quẹt thẻ | metadata ca |

Ràng buộc bắt buộc:

- **Không** khoan, không cắt dây, không nối vào bảng điều khiển. Chỉ kẹp/dán bên ngoài. Máy còn bảo hành.
- Vi điều khiển dùng **adapter `http-json`** đã có: ESP32 chạy HTTP server trả JSON đúng
  `docs/adapter-contract.md` mục 3, bridge poll mỗi 15 s. **Không sửa một dòng nào của bridge.**
  (Lưu ý: `/api/v2/ingest` là **GET** báo trạng thái cổng dial-in — không phải endpoint nhận telemetry.)
- UI phải nói rõ nguồn là **cảm biến ngoài**, và các trường mà cảm biến không biết (tên mẫu, số kim,
  toạ độ, tiến độ %) phải hiện `Chưa đọc được từ controller` — **không** được đoán.
- Không suy ra "đang thêu mẫu X" từ số mũi. Đó là bịa.

## 7. Yêu cầu — Đường D: nhập tay có kỷ luật (làm được ngay)

Đây là việc nên bắt đầu **hôm nay**, không phải phương án hạng hai.

1. Dùng adapter `manual` đã có. Bridge vẫn probe TCP để biết máy **có mặt trên mạng**.
2. Kỹ thuật viên/quản đốc nhập cuối mỗi ca: số mũi trên màn hình controller (màn hình `9.1 Statistics`
   đọc được tại máy), mẫu đang chạy, số lần đứt chỉ, tổng thời gian dừng và lý do.
3. Dashboard hiển thị đúng những gì được nhập, có **dấu thời gian và người nhập** (audit đã có sẵn).
   Nhãn phải là "Nhập tay lúc HH:mm", không được trông giống telemetry thật.
4. Giá trị thật: sau 2–4 tuần, xưởng có số liệu để biết máy nào chậm, ca nào mất giờ. Đó là toàn bộ mục
   tiêu kinh doanh của dashboard — và nó **không cần giao thức nào cả**.

## 8. Về "đưa dữ liệu vào máy" — ranh giới

Người dùng đã hỏi thẳng chiều "input vào máy". Trả lời thẳng:

**Được, và đây là cách duy nhất trên con máy này:** copy file `.DST` vào USB (FAT16/FAT32, tên DOS 8.3,
tối đa 400 file/thư mục), cắm vào `CN2`, nạp mẫu tại màn hình máy. Nếu muốn không dây, thiết bị kiểu
**Wilcom EmbroideryConnect** (199 USD, WiFi 2.4 GHz) làm đúng việc đó bằng cách **giả lập USB** — nhưng
nó chỉ hỗ trợ các hãng máy "USB-supported" và **chưa có bằng chứng nó nói được với A15**; phải thử mới biết.

**Không được, và sẽ không làm trong sản phẩm này:**

- Start / Stop / Pause / E-stop từ dashboard.
- Đổi mẫu đang chạy, đổi trình tự màu, đổi tham số controller từ xa.
- Bất kỳ endpoint upload, socket lệnh, hàng đợi truyền file, hay trạng thái "đang gửi" nào trong sản phẩm.

Lý do không phải là khó làm. Lý do là: một máy thêu có kim chạy 1000 vòng/phút và có người đứng cạnh nó.
Một cái nút trên trình duyệt, cách máy hai lớp mạng, không có ai nhìn thấy khung thêu, **không được phép**
làm máy chuyển động. Đó là quyết định đã ghi trong `PRD_CLAUDE_READONLY_FLEET.md` và tài liệu này giữ nguyên.

Nếu xưởng muốn nạp mẫu không dây, đó là **một sản phẩm khác** — một cục giả lập USB — và nó phải được
đánh giá riêng, không được nhét vào dashboard giám sát.

## 9. Hạ tầng bắt buộc dù đi đường nào

1. **Một host bridge chạy 24/7 tại `192.168.7.10`.** MacBook không thể là bridge thường trú: nó ngủ, nó
   đi theo người, nó không có sudo. Mini PC hoặc Raspberry Pi. Có sudo ⇒ mở luôn được đường bắt gói cho A.
2. **Đặt IP cố định cho host bridge và cho từng máy thêu.** Hiện phải né bằng
   `bridge.config.may-that-102.json` vì `192.168.7.10` không có trên Mac. Việc thu hẹp dải DHCP của Deco
   về `.200`–`.250` và đặt trước `.10` **chỉ làm được trong app điện thoại Deco** — web admin của Deco
   chỉ có Status và System.
3. **Máy thêu phải ở cùng subnet với bridge, không bao giờ ở Guest Network.** Guest isolation sẽ phá
   bridge với triệu chứng trông y hệt máy hỏng.
4. **Không bấm Reset trên Deco tại xưởng** — factory reset cần Internet để cấu hình lại.
5. Mật khẩu WiFi thật ghi ra giấy. **Không** ghi vào bất kỳ file nào trong repo, không gửi qua chat công việc.

## 10. Nợ kỹ thuật đã phát hiện, phải xử lý

| # | Vấn đề | Vị trí | Việc |
| --- | --- | --- | --- |
| 1 | `probePort` gộp `ECONNREFUSED` (máy **sống**) vào cùng một kết quả với timeout (máy **không có**) | `bridge/lib/network.mjs:10` | Phân biệt hai trường hợp. Đây đúng là lỗi đã làm mất hàng giờ chẩn đoán với `ping` — cùng một loại lỗi, nằm trong code. |
| 2 | Máy `dial-in` không bao giờ được probe, nên không biết nó có mặt trên LAN hay không | `bridge/lib/bridge-service.mjs:589` | Cho phép probe **chỉ để biết có mặt**, nhãn phải là `Máy có mặt trên mạng`, **không** phải `đang chạy`. Cần user đồng ý vì nó chạm vào quyết định "không knock vào máy dial-in". |
| 3 | `docs/mang-xuong-deco.md` ghi sai: nói Deco không có web admin, và chỉ định LAN `.1` trong khi `C46` của máy là `.254` | `docs/mang-xuong-deco.md:332` vùng lân cận | Sửa lại theo thực tế đo được. |
| 4 | 105 máy fixture cũ (`mch-hn-*`, `mch-bd-*` ở `127.0.0.x`, `192.168.50.x`) làm log ngập cảnh báo "nằm ngoài dải mạng", `breakersOpen: 32` | `bridge-data/fleet-store.json` | Cho phép archive theo lô, hoặc lọc log. **Không tự xoá** — là dữ liệu của người dùng. |

## 11. Tiêu chí nghiệm thu

Tài liệu này coi là hoàn thành khi:

1. Dashboard hiển thị **dữ liệu thật của ít nhất một máy** — từ bất kỳ đường A/B/C/D nào — với nhãn
   nguồn dữ liệu rõ ràng và dấu thời gian.
2. Mọi trường chưa có nguồn hiển thị đúng chuỗi `Chưa đọc được từ controller`. Không có số nào bịa.
3. Đại lý đã trả lời (hoặc từ chối trả lời) toàn bộ danh sách ở mục 12, và câu trả lời được ghi vào `docs/`.
4. Không có endpoint nào ghi được vào máy thêu. Có test chứng minh.
5. Bridge chạy trên host thường trú, không phải MacBook.

## 12. Câu cần hỏi đại lý — in ra, mang đi

Đây là phần có giá trị cao nhất trong tài liệu này. Hỏi đúng, tiết kiệm được vài tuần.

1. Con `A15-B104H-B`, serial `1010832DH21395748` này **có nói được với EmbNetServer** qua LAN không, hay
   tham số `C41`–`C47` chỉ là kế thừa từ dòng BECS cũ và không hoạt động trên A15?
2. Sổ tay A15 ghi *"network (temporarily unavailable)"*. **Bản firmware nào bật được chức năng mạng?**
   Máy này đang chạy bản nào?
3. Cổng **RJ45 trên panel HMI** có hoạt động không? Nó có phải là giao diện mà khối tham số
   `C41`–`C46` điều khiển không (vì `C42 MAC` mặc định không khớp MAC của module WiFi)? Có cần
   **大豪网络连接转换器** (bộ chuyển đổi kết nối mạng Dahao) như dòng BECS cũ không? Nếu có thì
   **model gì, mua ở đâu, bao nhiêu tiền?**
4. Tem **HILCOM** trên thân máy là module gì? MAC quan sát được là `ec:30:8e:1d:1a:6a`
   (OUI của **Lierda**, Hàng Châu). Module này nối vào đâu, và **có tài liệu/API nào không?**
5. Máy này có nối được vào **DH-NET** hoặc **nền tảng đám mây Dahao / EMBMATE** không? Nếu có:
   - Cần thêm phần cứng gì?
   - Chi phí một lần và chi phí hằng năm?
   - **Có API (REST/MQTT) để xưởng tự lấy dữ liệu về hệ của mình không**, hay chỉ xem được trong app của hãng?
   - Dữ liệu chạy qua server ở đâu?
6. Xin **bản EmbNetServer/EmbNetClient** và **EmbNet Owner's Manual** (29 trang) — có phải đĩa kèm máy không?
7. Có tài liệu giao thức nào cho khách hàng doanh nghiệp không? (Khả năng cao là không, nhưng câu trả lời
   "không" cũng chốt được đường A.)

Nếu đại lý không trả lời được, hỏi Dahao qua kênh chính thức. Có model plate và serial ⇒ họ tra được cấu hình xuất xưởng.

## 13. Cố tình KHÔNG làm, và vì sao

- **Không đoán khung tin giao thức Dahao khi chưa có pcap.** Không có tài liệu công khai, không có dự án
  dịch ngược nào tồn tại. Đoán sẽ tạo ra một adapter "trông như chạy" và sai âm thầm — tệ hơn là không có gì.
- **Không mở đường ghi vào máy** để "thử bắt tay đăng ký" mà chưa có quyết định thành văn và test chặn.
- **Không tạo telemetry giả để dashboard trông có dữ liệu.** Nếu chưa có nguồn thì hiển thị là chưa có.
- **Không tự xoá 105 máy fixture.** Là dữ liệu của người dùng.
- **Không đưa máy thêu ra Internet.** Không port forward, không đường controller ↔ trình duyệt.
- **Không kết luận "máy hỏng" hay "mạng hỏng".** Đã đo: máy sống, mạng thông. Vấn đề nằm ở firmware
  và ở việc thiếu phần mềm đích.

## 14. Nguồn

Tài liệu chính hãng:

- `BECS-A15 Owner's Manual` — bản đã tải, dùng cho mọi kết luận về đúng con máy này.
- [BECS-285A Owner's Manual (bản Butterfly BT1501) — chứa "Appendix 4 Network Function of Embroidery Machine"](https://www.theembroiderywarehouse.com/butterflyemb/dahao-embroidery-machine-manual/documents/BT1501%20OPERATION%20MANUAL.pdf)
- [DAHAO BECS-A18 Owner's Manual — "Appendix Ⅳ Network Connection Of Embroidery Machines"](https://www.manualslib.com/manual/1284993/Dahao-Becs-A18.html?page=174)
- [BECS-A18/A58/A98 Owner's Manual (PDF)](https://overlock.com.ua/wa-data/public/site/Manuals/Dahao-a18-a58-a98_compressed.pdf)
- [emCAD — 大豪科技 trang sản phẩm điện khống thêu](https://www.dahaobj.com/content/details91_2401.html)
- [北京大豪科技 báo cáo bán niên 2026 (mã 603025)](http://file.finance.sina.com.cn/211.154.219.97:9494/MRGG/CNSESH_STOCK/2026/2026-8/2026-08-14/12491797.PDF)

Tiếng Trung — cộng đồng và ngành:

- [兴大豪: 刺绣机网络管理系统解决方案（三）— 缝纫客](http://www.frk123.com/cj-show-52255.html) — danh mục triển khai EmbNet đầy đủ
- [兴大豪电脑绣花机电控 BECS 系列维修（三）— 缝纫客](http://www.frk123.com/cj-show-55150.html)
- [CISMA2021 — EMBMATE hỗ trợ WIFI/4G/LAN và nền tảng đám mây Dahao](https://www.shifair.com/informationDetails/37970.html)
- [刺绣工厂管理软件有哪些 — 简道云](https://www.jiandaoyun.com/blog/article/2255545/)
- [联科绣花网 (6xiu.com) — tài liệu đào tạo vận hành máy thêu](https://www.6xiu.com/d/file/embfile/free/soft/6xiucom.pdf)

Tiếng Anh — cộng đồng và sản phẩm:

- [DH-NET Internet Intelligent Factory System — Beijing Dahao Tech](https://www.facebook.com/BEIJING.DAHAO.TECH/posts/dh-net-internet-intelligent-factory-system-%E2%85%A0embroidery-machine-network-managemen/893146534164056/)
- [EmbNetServer — Software Informer (nhà phát triển, phiên bản, file thực thi)](https://embnetserver.software.informer.com/)
- [EmbNetClient 1.00.0000 by DaHao](https://www.advanceduninstaller.com/EmbNetClient-00f653d8de3a460a46027df792ad4b67-application.htm)
- [EmbNet Owner's Manual (29 trang, chỉ xem trước)](https://www.scribd.com/document/647661085/EmbNet-Owner-s-Manual)
- [Wilcom EmbroideryConnect — giả lập USB qua WiFi 2.4 GHz, 199 USD](https://wilcom.com/embroideryconnect)
- [EmbroideryConnect setup — tài liệu kỹ thuật Wilcom](https://docs.wilcom.com/embroiderystudio/e4/en/MainHelp/Production/network/EmbroideryConnect_setup.htm)
- [WO2016200927A1 / US10179961 — Embroidery production monitoring system (Conrad Industries)](https://patents.google.com/patent/WO2016200927A1/en)
- [Melco SUMMIT Manager — giám sát sản xuất, chỉ với máy cùng hãng](https://impressionsmagazine.com/category-products/melco-debuts-summit-manager-embroidery-production-management-software/167640)
- [ShopWorks OnSite — quản lý xưởng thêu ở tầng đơn hàng](https://www.shopworx.com/industries/embroidery-software/)
