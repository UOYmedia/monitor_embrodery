# PRD — Đường LAN: dùng mã nguồn mở để lấy dữ liệu máy thêu trong xưởng

[PRD]

Tài liệu này đứng cạnh:

- `PRD_CLAUDE_READONLY_FLEET.md` — sản phẩm.
- `PRD_UI_MONITORING.md` — giao diện.
- `PRD_NGUON_DU_LIEU_MAY_THEU.md` — so sánh **bốn** đường lấy dữ liệu (A mạng / B đại lý / C cảm biến / D nhập tay).

Tài liệu này lấy **một** đường trong bốn đường đó — **đường LAN** — và đi đến cùng, dựa trên một đợt khảo
sát **mã nguồn mở tiếng Trung trên mọi nền tảng** (Gitee, GitHub, CSDN, 知乎, 博客园, App Store, tài liệu
hãng, tài liệu nhà tích hợp Trung Quốc). Khảo sát đó đổi vài kết luận của tài liệu trước; mục 1.2 ghi rõ
đổi cái gì.

---

## 0. Tài liệu này giải quyết việc gì

Câu hỏi: **dùng LAN thì làm được gì, và làm bằng mã nguồn mở nào?**

Câu trả lời ngắn, trước khi vào bằng chứng:

> **Đường LAN không chết. Nhưng đích của LAN không phải là "EmbNetServer" như tài liệu trước giả định —
> đích của nó là ĐÁM MÂY của Dahao.** Controller dòng này được thiết kế để *định kỳ đẩy trạng thái lên
> server đám mây*, không phải để mở cổng cho ai đó trong xưởng hỏi nó.

Từ đó, "dùng LAN" tách thành **ba tầng khác nhau hẳn về độ khả thi**, và phải gọi tên riêng, không được
trộn:

| Tầng | LAN dùng để làm gì | Khả thi | Ai làm được |
| --- | --- | --- | --- |
| **L1** | Chở **dữ liệu của chính mình** (cảm biến gắn ngoài, nhập tay, file `.DST` trên USB) về dashboard | **Làm được ngay, 100% mã nguồn mở** | Tôi làm được, không cần chạm máy thêu |
| **L2** | **Nghe máy tự khai** nó muốn gọi đi đâu (DNS + log), để biết sự thật thay vì đoán | **Rẻ, chưa ai thử, ưu tiên cao** | Cần một thiết bị nhỏ trong xưởng (ESP32 / Pi / PC cũ) |
| **L3** | **Giả lập đích** của máy để nhận telemetry gốc | **Thấp, và có lý do chính đáng để không cố** | Cần đại lý/Dahao, hoặc host Linux có sudo |

Phần còn lại của tài liệu: bằng chứng (mục 1), rồi yêu cầu kỹ thuật cho từng tầng (mục 3, 4, 5).

---

## 1. Bằng chứng mới từ khảo sát mã nguồn mở tiếng Trung

Toàn bộ mục này là thứ **đọc được trực tiếp** từ nguồn công khai, ngày 17/08/2026. Không suy đoán.
Danh sách URL đầy đủ ở mục 12.

### 1.1 Những gì tìm được

| Nguồn | Là gì | Đọc được điều gì |
| --- | --- | --- |
| `ignativs1/maya-embroidery-dahao-a15` (GitHub, tiếng Trung, tạo 14/08/2026) | Kho lưu **tham số xuất xưởng + định nghĩa chân cắm** của một máy 玛雅 1201 (1 đầu 12 kim) dùng điện khiển **BECS-A15** | Bảng `CN1`–`CN10` của **hộp điều khiển chính**: `CN1` = **encoder trục Y**, `CN2` = encoder trục X, `CN3` = encoder trục chính, `CN4/CN5` = limit Y/X, `CN6` = gốc trục chính, `CN7` = **CAN** (bo đầu máy / đổi màu), `CN8` = **HMI** (dây ra màn hình), `CN9/CN10` = motor Y/X. **Không có cổng Ethernet nào trong CN1–CN10 của hộp chính.** |
| `shannxiqiu/prototype` (GitHub, 2016) → `doc/上层软件需求与模块划分.doc` | Bản **đặc tả yêu cầu phần mềm tầng trên** cho máy thêu dùng điện khiển Dahao, viết bằng tiếng Trung | Mục **网络模块** (module mạng) có đúng 4 việc: (a) nâng cấp online cho cả bo trên và bo dưới, (b) **chẩn đoán thiết bị từ xa qua hệ thống đám mây**, (c) **"设备运行状态收集上报 — 定时将系统运行状态上报云端系统"** = *định kỳ đẩy trạng thái vận hành lên hệ thống đám mây*, (d) tải mẫu qua Internet. Mục **系统设置 → 网络** ghi: *"wifi/蓝牙/internet 相关配置"*. |
| Cùng kho trên → `doc/BEXT_Instruction_Manual_V1.0(E).pdf` | Sổ tay máy **Barudan** (hãng Nhật) — hãng khác, cùng bài toán | Cổng LAN của máy: *"This is for a LAN connection… **Optional Networking software is required to use this connection**"*, và phần mềm đó tên **LEM Server**. Có cả một Chương 10 "Network". |
| App Store `id1488277916` | App **大豪云** (Dahao Cloud), nhà phát hành *Beijing Dahao Technology Corporation Limited*, bundle `net.dahaoyun.iot`, ra 22/11/2019, bản 2.9.6 | Mô tả nêu các ứng dụng: giám sát thiết bị (sản lượng, trạng thái vận hành, trạng thái lỗi) xem trên web và app; chẩn đoán online; **"远程加解密，对设备设置使用期限，续费后延长使用期限"** = *khóa/mở máy từ xa, đặt thời hạn sử dụng cho thiết bị, gia hạn sau khi trả tiền*. |
| `dahaoyun.net` (tra DNS + HTTP, 17/08/2026) | Hạ tầng đám mây Dahao | Phân giải về `117.107.214.213`, phục vụ `main.iot.dahaoyun.net`, tiêu đề trang `<title>大豪云</title>`. Cổng **80 và 443 mở**; cổng MQTT chuẩn **1883/8883/8083/8084 đóng** trên host đó. |
| Tài liệu/bài báo Trung Quốc về **DH-NMS** | Hệ quản lý mạng máy thêu của Dahao | Dựa trên **TCP/IP**, làm dạng **trang web** để mọi thiết bị di động dùng được; chức năng: quản lý máy, quản lý đơn, quản lý công nhân thêu, dự báo sản lượng. |
| Ngành cải tạo thiết bị cũ ở Trung Quốc (CAXA 机床联网, 深控技术 "免点表" 工业网关, 羽帆物联网 经编机/织机) | Cách người Trung Quốc thực sự làm khi thiết bị không mở giao thức | Đồng thuận: **gateway không xâm nhập** (非侵入式), lấy tín hiệu vật lý từ **đèn báo / còi / công tắc tiệm cận**, đếm xung để ra sản lượng, biên (edge) tính trạng thái chạy–dừng, rồi đẩy lên nền tảng qua RJ45/433MHz. **Không sửa hệ điện, không chạm PLC lõi.** |
| `pyembroidery`, `Ink/Stitch` | Thư viện mã nguồn mở đọc/ghi file thêu | Đọc được `.DST`: `STITCH`, `JUMP`, `TRIM`, `STOP`, `COLOR_CHANGE`, `NEEDLE_SET`… ⇒ **tính được tổng mũi và số lần đổi màu từ chính file mẫu**, không cần hỏi controller. |

### 1.2 Những gì **không** tìm được — và đây cũng là kết quả

- **Không có** bất kỳ dự án mã nguồn mở nào dịch ngược giao thức mạng của Dahao, trên GitHub hay
  nền tảng Trung Quốc. Tra bằng chỉ mục mã nguồn (không phải qua search engine): GitHub chỉ có
  **1** kho chứa chữ "dahao" + "embroidery" (chính là kho tham số nói trên, không có dòng code nào),
  và tra `embroidery machine protocol` chỉ ra hai dự án của **hãng khác** (Brother Skitch PP1 qua BLE,
  Bernina Artista 180 qua serial).
- **Không có** bản mã nguồn mở hay tài liệu giao thức của `EmbNetServer` / `SemsServer`.
- **Không có** tài liệu API công khai của **大豪云**. Nền tảng có, cổng vào cho người thứ ba thì không công bố.
- **Chưa kết luận được về Gitee.** API tra cứu của Gitee trả `[]` **kể cả với từ khóa chắc chắn có kết quả**
  như `MES` và `modbus` (HTTP 200, mảng rỗng) ⇒ API đó chặn khách vô danh. **Không được viết "Gitee không
  có gì"** dựa trên phép thử này. Việc còn nợ: tra Gitee bằng đường web hoặc bằng token.

### 1.3 Ba điều tài liệu trước nói chưa đúng, nay sửa

| Tài liệu trước (`PRD_NGUON_DU_LIEU_MAY_THEU.md`) | Sửa lại |
| --- | --- |
| "Đích của `C44:C41` là **EmbNetServer**" | Đúng với **dòng cũ** (BECS-285A, 1x2/2x2/x9S/Ax8/Cx8…). Với **A15** thì đích được thiết kế là **đám mây** (`定时上报云端系统`), và DH-NMS đời sau là **web/TCP-IP**, không phải EmbNetServer. `C44:C41` trên A15 rất có thể là **di sản tham số** của dòng cũ — điều này giải thích vì sao đặt đúng `C44/C41` mà `connections` vẫn bằng 0. |
| "`CN1` RJ45 rỗng — có cổng mạng có dây chưa dùng, thử cắm cáp vào đó" | **Phải phân biệt hai hộp.** Trên **hộp điều khiển chính** BECS-A15, `CN1` là **encoder trục Y**. Cái RJ45 bạn chụp nằm trên **hộp điều khiển / panel HMI** — một dãy `CN` khác, đánh số riêng. ⇒ **Chỉ cắm cáp mạng vào RJ45 trên panel. Tuyệt đối không cắm vào hộp bạc trong tủ điện.** |
| "Giao thức đóng vì hãng không công bố" | Có lý do cụ thể hơn: **cùng đường dây đó khóa được máy** (`远程加解密，对设备设置使用期限`). Một kênh vừa báo sản lượng vừa bật/tắt quyền dùng máy thì **bắt buộc** phải có xác thực và **sẽ không bao giờ** được công bố. Đây là lý do kỹ thuật để **không** cố giả lập nó (mục 5). |

### 1.4 Cảnh báo an toàn về kho tham số vừa tìm được

Kho `maya-embroidery-dahao-a15` là máy **khác**: model `1201` một đầu 12 kim, điện khiển
`A15-T-GB-BH-4-211089#`, số máy `7202114`, hiệu chỉnh 08/01/2022. Máy của xưởng là
`A15-B104H-B`, serial `1010832DH21395748`.

> **Không được chép các giá trị tham số xuất xưởng trong kho đó vào máy của xưởng.** Đó là tham số
> cơ khí (tăng ích servo, tỉ số bánh răng điện tử, góc động khung, hành trình dao cắt) của một cơ cấu
> khác. Ghi sai nhóm tham số này làm hỏng cơ khí, không chỉ hỏng dữ liệu.
>
> Phần dùng được của kho đó, và **chỉ** phần đó: bảng định nghĩa chân `CN1`–`CN10` (mục 1.1) và quy
> trình thay pin CR2032 khi gặp lỗi `14` (mất bộ nhớ bo chính).

### 1.5 Đối chiếu tài liệu nghiên cứu bên ngoài (bạn gửi 17/08/2026)

Tài liệu `Nghiên_cứu_sâu_Kết_nối_máy_thêu_Yeshi_Dahao_A15_qua_LAN.md` **không phải bịa** — các trích dẫn
của nó kiểm được. Nhưng nó nói ngược tài liệu này ở hai điểm, nên phải tách rõ **cái gì đứng được, cái gì
chưa**. Đã kiểm từng khẳng định, ngày 17/08/2026:

| Khẳng định trong tài liệu đó | Kết quả kiểm | Kết luận |
| --- | --- | --- |
| A15 **có** chức năng tải mẫu không dây từ PC | **Đúng — và đây là chỗ tài liệu này đã sai.** Chính Dahao viết, bài 25/10/2024 trên site hãng: *"A15/A15Pro刺绣机电控系统… 基于WIFI的工业4.0智能互联技术，**支持在线分期付款加解密，支持远程运维，支持无线传输花样**"*. | **Nhận.** Câu *"network (temporarily unavailable)"* mà tài liệu này dựa vào là của sổ tay **bản 2018-01** — sổ tay tôi đang có. Hãng đã có bản **2020-04**, và một tài liệu **A15机型安装调试说明 v2.0 (2023)**. Kết luận cũ dựa trên bản 2018 là **quá cũ**. |
| Phần mềm PC tên **`DesignServer`** | **Không tìm thấy ở đâu.** Trung tâm tải của hãng (`en.dahaobj.com/service/download.html`, mục 刺绣机) liệt kê phần mềm PC là **`Setup_emCAD_2.7.0.8578`** (phát hành 06/02/2025). Không có mục nào tên DesignServer, tiếng Anh hay tiếng Trung. | **Bác.** Tên đúng gần như chắc chắn là **emCAD**. Dùng tên `DesignServer` khi hỏi đại lý sẽ làm họ không hiểu. |
| `Server Port` = **`3865`** | **Không có bằng chứng nào.** Sổ tay A15 bản 2018-01 dòng `C41 Server Port` ghi **mặc định `1600`, dải `1~9999`**. Tra riêng số `3865` trên chỉ mục web + tiếng Trung: không ra gì liên quan máy thêu. | **Chưa xác nhận.** Không đổi cấu hình theo số này. Việc kiểm mất **30 giây**: xem đúng dòng `C41` trên màn hình máy (mục 4.5, R-L2-4). |
| Hai video YouTube được dẫn | **Có thật**, đúng tiêu đề, đúng tác giả — cả hai là **đại lý bán máy**. | **Nhận** — và mở ra đường đi thực tế: xem R-L2-5. |
| PC chạy phần mềm, máy **gọi vào PC** (`Server IP` = IPv4 của PC) | Khớp với mô hình `C44/C41` của dòng cũ, và khớp với chiều "PC → máy" của việc **tải mẫu**. | **Nhận có điều kiện.** Nhưng lưu ý chiều dữ liệu: cái đó là **đưa mẫu vào máy**, không phải **máy báo sản lượng ra**. Xem đoạn dưới. |
| Không có bằng chứng điều khiển chuyển động qua LAN | Khớp hoàn toàn với tài liệu này. | **Nhận.** |

**Điều quan trọng nhất rút ra — và nó không đổi kết luận gốc của PRD này:** danh sách chính thức của hãng
có đúng ba việc mạng: **无线传输花样** (đưa mẫu vào máy), **远程运维** (Dahao bảo trì từ xa), **在线分期付款加解密**
(khóa/mở máy theo kỳ hạn). **Không có việc thứ tư nào tên "đẩy sản lượng ra server của khách".** Nghĩa là:

> Kể cả khi bạn dựng đúng emCAD và tải mẫu không dây chạy hoàn hảo, **cái đó vẫn không sinh ra dữ liệu cho
> dashboard.** Nó chứng minh ngăn xếp mạng của máy **sống** — rất đáng giá cho L2 — nhưng chiều dữ liệu
> vẫn là PC→máy, còn chiều máy→bạn thì vẫn phải đi qua L1 (cảm biến của mình) hoặc mục 10 (xin API).

### 1.6 Đo được gì trên bridge (17/08/2026)

Kiểm trực tiếp trên đĩa, không qua HTTP:

- `bridge-data/dial-in-capture.jsonl` **không tồn tại** ⇒ chưa **một khung tin nào** đến `192.168.7.102:1600`
  từ lúc bật capture. (`bridge/lib/dial-in.mjs:292` chỉ tạo file khi có dữ liệu thật.)
- Con số `rejections: {unknown_source: 1}` từng thấy **không chứng minh máy đã gọi vào**: bộ đếm đó nằm
  trong RAM (`bridge/lib/dial-in.mjs:103`), **không** ghi vào `audit-log.jsonl`, nên chính các phép thử kết
  nối của tôi vào cổng 1600 cũng sinh ra đúng con số đó. Trong `audit-log.jsonl` chỉ có **một** dòng chứa
  `192.168.7.100`, và đó là hành động `machine.pair` của tôi.
- **Mac đã ra khỏi LAN xưởng.** Hiện `en0 = 10.88.88.32/24`, gateway `10.88.88.1`; **không** còn địa chỉ
  `192.168.7.x` nào; `ping 192.168.7.100` mất 100% gói. Bridge (PID 60194) vẫn `LISTEN` trên
  `192.168.7.102:1600` nhưng đó là **socket chết** — địa chỉ đã bị rút khỏi interface.

> ⇒ **Mọi phép thử dial-in kể từ lúc Mac đổi mạng đều vô giá trị.** Trước khi kết luận bất cứ điều gì về
> `connections: 0`, phải đưa host chạy bridge trở lại `192.168.7.0/24` (R-INF-1).

---

## 2. Chọn tầng nào, theo thứ tự nào

```
                    ┌─────────────────────────────────────────────┐
  L1  LÀM NGAY      │  cảm biến / nhập tay / file .DST  ──► LAN   │──► bridge ──► dashboard
                    └─────────────────────────────────────────────┘        (đã có, không sửa)

  L2  LÀM SỚM       máy thêu ──DNS?──► máy nghe trong LAN ──► log   (biết máy muốn gọi đi đâu)

  L3  KHOAN ĐÃ      máy thêu ──telemetry gốc──► đích giả lập        (cần đại lý / sudo / pcap)
```

**Thứ tự đề nghị: L1 trước, L2 song song, L3 chỉ khi L2 cho tín hiệu dương hoặc đại lý mở đường.**

Lý do thứ tự này chứ không phải ngược lại: L1 cho dashboard **dữ liệu thật** trong vài ngày và không phụ
thuộc vào việc Dahao có mở giao thức hay không. L2 tốn khoảng 1 triệu đồng phần cứng và cho **kiến thức
chắc chắn** — nó sinh ra thông tin *bất kể máy có gọi ra hay không* (mục 4.3). L3 là cái duy nhất có thể
tốn hàng chục giờ mà về tay trắng.

---

## 3. L1 — LAN chở dữ liệu của chính mình (làm được ngay, toàn bộ mã nguồn mở)

### 3.1 Kiến trúc

```
  ┌── máy thêu (không chạm vào) ──┐
  │  đèn báo đứt chỉ ──► quang trở│
  │  trục chính      ──► cảm biến │        WiFi/LAN          HTTP GET mỗi 15s
  │                     tiệm cận  │──► ESP32 ──────────────► bridge ──► dashboard
  └───────────────────────────────┘      (http-json)         (đã có)     (đã có)

  USB rút từ máy ──► pyembroidery đọc .DST ──► tổng mũi, số lần đổi màu, khung X/Y
```

Ba nguồn dữ liệu, cùng đi qua **một** cửa: hợp đồng adapter đã có trong `docs/adapter-contract.md`.

### 3.2 Vật liệu mã nguồn mở (đã kiểm chứng số liệu ngày 17/08/2026)

| Thành phần | Vai trò trong L1 | Ngôn ngữ | ★ | Giấy phép | Có cần không |
| --- | --- | --- | --- | --- | --- |
| **ESPHome** `esphome/esphome` | Firmware ESP32 khai báo bằng YAML; có sẵn `pulse_counter`, `binary_sensor`, web server | C++ | 11.5k | (GitHub không nhận diện được) | **Nên** — thay vì tự viết C |
| **pyembroidery** `EmbroidePy/pyembroidery` | Đọc `.DST` → tổng mũi, đổi màu, khung | Python | 301 | MIT | **Có** — lấp `job.totalStitches` |
| **Ink/Stitch** `inkstitch/inkstitch` | Đối chiếu/kiểm tra file thêu | Python | 1.3k | GPL-3.0 | Tùy |
| **Mosquitto** `eclipse-mosquitto/mosquitto` | MQTT broker nhẹ, nếu sau này có nhiều node | C | 11.1k | (GitHub không nhận diện được) | **Chưa cần** |
| **EMQX** `emqx/emqx` | MQTT broker lớn | Erlang | 16.6k | (GitHub không nhận diện được) | Không |
| **Node-RED** `node-red/node-red` | Nối dây luồng dữ liệu bằng giao diện | JavaScript | 23.5k | Apache-2.0 | Không |
| **AdGuard Home** `AdguardTeam/AdGuardHome` | DNS có web console + **log truy vấn** | TypeScript/Go | 36.2k | GPL-3.0 | **Ở L2** |
| **dgiot** `dgiot/dgiot` | Nền tảng IIoT Trung Quốc, 300+ giao thức, triển khai 6 phút | Erlang | 4.8k | Apache-2.0 | Không |
| **JetLinks** `jetlinks/jetlinks-community` | Nền tảng IoT Trung Quốc (Java/Spring/Netty) | Java | 6.6k | Apache-2.0 | Không |
| **Neuron** `emqx/neuron` | Industrial connectivity server (Modbus/OPC-UA…) | C | 1.4k | LGPL-3.0 | Không |
| **Grafana / Apache IoTDB / Telegraf** | Đồ thị + lưu chuỗi thời gian | — | 76k / 6.4k / 17.8k | AGPL-3.0 / Apache-2.0 / MIT | Không |

**Quyết định cần ghi rõ (không phải chỗ để linh động):** repo này **đã là** dashboard và **đã có** tầng
adapter. **Không** thay nó bằng ThingsPanel / JetLinks / dgiot / FastBee. Lý do: những nền tảng đó giải
quyết bài toán *nhiều nghìn thiết bị nói giao thức chuẩn* — bài toán của xưởng là *một máy không nói giao
thức nào*. Đổi nền tảng không giải quyết được cái khó, chỉ dời chỗ nó và bỏ đi phần đã chạy.

Điều kiện duy nhất khiến việc đổi trở nên đúng: khi trong xưởng có **≥ 20 node cảm biến** và cần luật báo
động/lưu lịch sử dài hạn. Lúc đó thêm **Mosquitto + IoTDB** *bên dưới* bridge hiện tại, vẫn không thay
dashboard.

### 3.3 Yêu cầu

- **R-L1-1** Node cảm biến phục vụ **adapter `http-json`** đã có: ESP32 chạy HTTP server trả JSON đúng
  `docs/adapter-contract.md` mục 3; bridge poll mỗi 15 s. **Không sửa một dòng nào của bridge.**
  (`/api/v2/ingest` là **GET** báo trạng thái cổng dial-in — **không** phải endpoint nhận telemetry.)
- **R-L1-2** Trường nào không đo được thì **`null` hoặc bỏ hẳn khỏi payload**. Bridge không được thay bằng
  giá trị mặc định, giá trị cũ, hay giá trị suy diễn. Giao diện hiển thị `Chưa đọc được từ controller`.
- **R-L1-3** `status` là **bắt buộc** (`running|paused|stopped|fault|unknown`). Node suy ra từ xung trục
  chính: có xung → `running`; hết xung < 90 s → `paused`; hết xung ≥ 90 s → `stopped`; tín hiệu đứt chỉ →
  `fault`. Khi node không chắc → `unknown`, **không** đoán.
- **R-L1-4** Sai kiểu dữ liệu làm **chết cả gói** (`normalizeTelemetry()` ném `ContractError`, không trộn
  một phần). Node phải tự kiểm tra trước khi trả.
- **R-L1-5** `observedAt` là thời điểm **node đo được**, ISO 8601. `receivedAt` do bridge tự đóng dấu.
  Node phải có thời gian đúng (NTP trong LAN hoặc lấy từ bridge).
- **R-L1-6** Đường `.DST`: script dùng `pyembroidery` đọc file lấy từ USB, sinh `job.totalStitches`,
  số lần đổi màu, khung X/Y. Đây là **dữ liệu tĩnh của mẫu**, không phải tiến độ. Tiến độ
  (`job.currentStitch`) **chỉ** đến từ đếm xung hoặc nhập tay — không được nội suy từ tổng mũi.
- **R-L1-7** Gắn cảm biến: **kẹp/dán bên ngoài**. Không khoan, không cắt dây, không nối vào bo điều khiển,
  không lấy điện từ máy. Máy còn bảo hành.
- **R-L1-8** Kiểm thử **không cần phần cứng**:
  ```bash
  node scripts/fixture-controller.mjs 9101 docs/fixtures/telemetry-running.json
  ```
  (cần `scan.allowLoopback: true`). Firmware chỉ được coi là xong khi payload của nó đi qua bài này.

### 3.4 Tình trạng: firmware đã viết xong (17/08/2026)

Mã nguồn: **`firmware/esp32-stitch-node/`** — README ở đó là tài liệu lắp đặt cho thợ.
Fixture gói thật của node: `docs/fixtures/telemetry-node-cam-bien.json`.
Chạy test không cần ESP32:

```bash
npx vitest run firmware/esp32-stitch-node/test/stitch-logic.test.mjs bridge/lib/contract.test.mjs
```

Bài R-L1-8 đã chạy thật: gói của node đi qua `scripts/fixture-controller.mjs` rồi qua
`pollMachine()` (adapter `http-json` + `net-policy` + `normalizeTelemetry`) và ra đúng
`status: running`, `rpm 712`, `odometer 48210`, `threadBreakWindow {needle: null, breaks: 1,
stitches: 5000}`, còn `job`/`controller`/`needlePosition` **`null`**. Nửa còn lại của A-2 —
số đo từ máy thật — chưa làm, vì chưa có ESP32 và chưa gắn cảm biến lên máy.

Toàn bộ phần quyết định (`stitch_logic.h`) và phần sinh JSON (`telemetry_payload.h`) không include
Arduino, nên biên dịch được ngay trên Mac bằng `cc -std=c11 -Wall -Wextra -Werror`. Chuỗi JSON mà
test C khẳng định là **đúng từng byte** cũng được đẩy qua `normalizeTelemetry()` thật trong
`bridge/lib/contract.test.mjs`. Firmware và bridge không thể trôi khỏi nhau mà không có test đỏ.

**Ba chỗ bản thực hiện đi lệch khỏi PRD, và lý do:**

1. **Viết C thay vì ESPHome** (§3.2 khuyên ESPHome). ESPHome không phát được đúng hình dạng payload
   hợp đồng yêu cầu: trường không đo được phải **vắng mặt**, `status` phải là chuỗi trong tập cho
   trước, `threadBreakWindow` là object lồng. Quan trọng hơn: không có cách nào kiểm chuỗi JSON của
   ESPHome bằng test chạy trên Mac. Đổi lại, tự viết thì phải tự lo debounce và tràn số.
2. **Node không bao giờ gửi `paused`** (R-L1-3 cho phép). Một cảm biến kẹp ngoài máy không phân biệt
   được *thợ dừng máy để đổi chỉ* với *máy tắt hẳn* — cả hai đều là "không có xung". Gửi `paused`
   là bịa. Node gửi `running` khi có xung, `stopped` khi hết xung, `unknown` khi cảm biến chưa bao
   giờ nổ xung nào.
3. **Ngưỡng hết xung là 2,5 s, không phải 90 s.** 90 s làm biểu đồ `rpm` treo ở giá trị cũ suốt một
   phút rưỡi sau khi máy đã dừng — người xem dashboard đọc đó là máy đang chạy.

Còn nợ, cần quyết định riêng: node **không** gửi `events[]`, vì `contract.mjs` gán cứng
`source: 'controller'` cho mọi event, tức là suy luận của cảm biến sẽ bị ghi công cho bo Dahao.
Muốn node báo đứt chỉ vào trung tâm cảnh báo thì phải mở thêm `source` trong hợp đồng trước.

---

## 4. L2 — LAN để nghe máy tự khai (ưu tiên cao, chưa ai thử)

### 4.1 Ý tưởng, và vì sao nó là phép thử tốt nhất còn lại

Trên trang tham số của máy có **`Z02 DNS Server`**. Tham số đó tồn tại nghĩa là có lúc máy **cần phân giải
tên miền** — tức là đích của nó là một **tên**, không phải một IP. Và nếu đích là một tên, thì việc đầu
tiên máy làm khi bật ngăn xếp mạng lên là **gửi một truy vấn DNS**.

> Đặt `Z02 DNS Server` = IP của một máy trong LAN chạy DNS server có ghi log. Rồi đọc log.

Vì sao đây là phép thử tốt nhất còn lại:

- Nó **không sửa gì trên máy thêu** ngoài một trường IP, và **đảo lại được** trong 10 giây.
- Nó **chỉ đọc**. Không gửi gì vào máy.
- Nó sinh ra thông tin **dù kết quả là gì** (bảng 4.3) — khác với việc ngồi chờ `connections: 0` đổi số,
  việc đã làm hơn một giờ và không học được gì.
- `C44/C41` là đường **IP trực tiếp**, có thể là di sản của dòng cũ (mục 1.3). DNS là đường của **đời mới**.
  Ta chưa từng thử đường đời mới.

### 4.2 Cần thiết bị gì — **hóa ra là không cần gì thêm**

> **SỬA (17/08/2026, đo trực tiếp): Mac này BIND ĐƯỢC cổng 53.**
> Chạy `node scripts/dns-log.mjs` bằng user thường (`uid 501`, không sudo) trên Darwin 27: socket UDP
> lên `0.0.0.0:53` thành công và **nhận truy vấn thật** — `dig @127.0.0.1 main.iot.dahaoyun.net` trả về
> `status: NXDOMAIN` và log ghi đúng `verdict: dahao-cloud`. Câu "Mac không có sudo nên không bind được
> cổng 53" trong các bản trước của tài liệu này là **sai**; nó suy từ quy tắc cổng đặc quyền chứ không
> phải từ một lần thử. Cái thật sự cần root trên máy này là `tcpdump`, không phải bind UDP/53.
> Chưa thử: TCP/53, và các bản macOS/Linux khác — Linux thường vẫn cần root hoặc `CAP_NET_BIND_SERVICE`.
>
> Hệ quả: **phép thử `Z02` làm được ngay với cái Mac đang có**, không cần Pi, không cần PC Windows,
> không cần ESP32. Bảng ba lựa chọn dưới đây chỉ còn giá trị cho việc **chạy thường trực** (mục 6):
> Mac ngủ khi gập lại, được mang về nhà, và nhận IP theo DHCP — đủ để chẩn đoán 30 phút, không đủ để
> làm host cố định.

> **NHƯNG có một điều kiện bắt buộc, đo được cùng ngày: macOS đang chặn Node ra mạng nội bộ.**
> Cùng một shell, cách nhau một giây: `/usr/bin/curl` và `/usr/bin/nc` vào được `10.88.88.28:631`
> (trả về trang CUPS thật), còn `node` và `python3` nhận `EHOSTUNREACH` — TCP lẫn UDP, ép
> `localAddress` cũng vậy, tắt sandbox cũng vậy. Node vẫn ra Internet được (`1.1.1.1:443` OK), chỉ
> **địa chỉ trong LAN** là bị chặn. Khác nhau theo từng file chạy thì không thể là định tuyến: đó là
> quyền **Local Network** của macOS, và tiến trình chạy không có giao diện thì không bao giờ hiện hộp
> xin quyền nên mặc định bị từ chối.
>
> Vì sao điều này nguy hiểm hơn một lỗi thường: bảng 4.3 dưới đây ghi `no-query` nghĩa là *"ngăn xếp
> mạng của máy chưa hề bật"*. Rút kết luận đó từ một socket bị chặn, sau một chuyến đi xưởng, là sai
> lầm đắt nhất của cả dự án. Nên `scripts/lib/local-network.mjs` (18 test) gửi thử **một** datagram
> UDP trong subnet của chính mình trước khi đo, `dns-log` in `Mạng nội bộ : …` lúc khởi động, và log
> trắng trên host bị chặn thì kết luận là **`không-đo-được`**, không phải `no-query`.
>
> Phải làm **trước khi đi xưởng**, ở nhà, nơi thử lại được ngay: System Settings → Privacy & Security
> → Local Network → bật cho ứng dụng đang chạy Node, rồi **thoát hẳn** ứng dụng đó và mở lại (quyền
> chỉ áp cho tiến trình mới). Chạy `npm run dns:log` và phải thấy `Mạng nội bộ: vào được`.
> Chưa đo được: chiều **nhận** UDP từ LAN có bị chặn cùng lượt hay không.

> **Phần mềm đã viết xong (17/08/2026): `scripts/dns-log.mjs`.**
> DNS logger thuần Node, không phụ thuộc gói ngoài, chạy được trên **bất kỳ** host nào trong ba lựa chọn
> dưới đây — kể cả PC Windows chạy bằng *Run as administrator*. Vì thế **ESP32 không còn nằm trên đường
> tới hạn của L2 nữa**: trước đây ESP32 được chọn chỉ vì nó bind cổng nào cũng được, giờ vấn đề đó là
> vấn đề quyền OS trên host, không phải vấn đề thiếu thiết bị.
>
> ```bash
> sudo node scripts/dns-log.mjs                          # ghi log, trả NXDOMAIN cho mọi tên
> sudo node scripts/dns-log.mjs --upstream 192.168.7.254  # ghi log NHƯNG máy vẫn ra được Internet
> node scripts/dns-log.mjs --port 5354                    # tự thử, không cần quyền quản trị
> ```
>
> Logic wire-format nằm ở `scripts/lib/dns-frame.mjs`, có 25 test ở `dns-frame.test.mjs` — parse tên
> nén, chống vòng lặp con trỏ, dựng NXDOMAIN, và **phân loại tên miền theo đúng bảng 4.3 bên dưới**.
> Công cụ tự in kết luận lúc Ctrl-C, kể cả kết luận `no-query`.
>
> Chọn `NXDOMAIN` làm mặc định là cố ý: `SERVFAIL` khiến client thử lại **cùng một tên** và đi tìm DNS
> khác — mà `Z02` chỉ có một ô nên không có chỗ nào để đi, log sẽ đầy một tên lặp lại. `NXDOMAIN` được
> hiểu là dứt điểm, client chuyển sang tên tiếp theo, nhờ đó log gom được **cả danh sách tên** máy muốn
> gọi. Liệt kê được danh sách đó chính là mục đích.
>
> Dùng `--upstream` khi muốn biết chuyện gì xảy ra **sau khi** phân giải xong: máy ra được Internet
> thật, nên xem được icon cloud trên chính máy có sáng lên không. Chỉ chuyển tiếp cho nguồn trong dải
> LAN riêng — công cụ chẩn đoán không được vô tình thành open resolver.

DNS chạy ở **cổng 53**, cổng < 1024. Nếu host nào không bind được (Linux, hoặc Windows chưa nâng quyền)
thì ba lựa chọn dưới đây vẫn là các host chạy được — và mục 6 đằng nào cũng cần một host thường trực:

| Cách | Chi phí | Ưu | Nhược |
| --- | --- | --- | --- |
| **ESP32 làm DNS logger** | ~100k₫ | ESP32 **bind cổng nào cũng được, không có khái niệm quyền OS**; cùng con dùng lại cho L1 | Phải nạp firmware; log giữ trong RAM/serial. **Từ 17/08/2026 không còn cần cho việc này** — xem hộp trên |
| **Raspberry Pi / mini PC Linux + AdGuard Home** | ~1–1.5tr₫ | Có web console, log truy vấn đẹp, sau này làm luôn **host thường trực cho bridge** (mục 6) | Tốn tiền, phải dựng |
| **PC Windows cũ + DNS server nhẹ** | 0₫ nếu có sẵn | Nhanh nhất nếu xưởng đã có PC | Phải để máy luôn bật |

**Đề nghị: Raspberry Pi / mini PC.** Không phải vì nó rẻ nhất, mà vì mục 6 **đằng nào cũng cần** một host
thường trực trong LAN cho bridge; gộp hai việc vào một thiết bị.

### 4.3 Đọc kết quả — bảng sự thật

| Log DNS cho thấy | Kết luận | Việc tiếp theo |
| --- | --- | --- |
| **Không có truy vấn nào**, kể cả sau khi tắt/bật nguồn và chờ 30 phút | Ngăn xếp mạng của máy **không hề được bật**. Đây là chuyện firmware/khóa tính năng, không phải chuyện mạng. | Hết đường tự làm. Chuyển sang mục 10 (hỏi đại lý). **Đừng đổ thêm giờ vào LAN.** |
| Truy vấn tên miền dưới **`*.dahaoyun.net`** (hoặc `dahaobj.com`) | **Xác nhận đường đám mây.** Ta biết chính xác tên miền máy muốn gọi. | Sang 4.4 |
| Truy vấn `pool.ntp.org` / tên miền thời gian | Ngăn xếp mạng **có sống**, nhưng đang ở bước đồng bộ giờ | Tốt — máy sống. Chờ tiếp, và sang 4.4 để bắt tên miền chính |
| Truy vấn một tên miền **lạ** (module HILCOM / Lierda / nhà tích hợp khác) | Manh mối mới, **quan trọng hơn cả Dahao** — đúng cái module IoT đo được qua OUI `ec:30:8e` | Tra tên miền đó, rồi sang 4.4 |
| Có gói tới cổng 53 nhưng **không phải DNS** | Phát hiện riêng: máy đang dùng `Z02` cho việc khác, hoặc nói một giao thức khác trên cổng đó | `dns-log.mjs` ghi nguyên hex. Đọc hex, **không đoán giao thức** — đối chiếu máy thật rồi mới kết luận |

### 4.4 Bước hai: cho tên miền đó trỏ về LAN, và ghi lại byte đầu tiên

Khi đã biết tên miền: cấu hình DNS trong LAN trả về **IP của bridge**, rồi lắng nghe trên 80 và 443, ghi
lại byte đầu tiên nhận được.

- Nếu là **HTTP thường** → đọc được định dạng bản tin. Đây là kịch bản tốt nhất có thể xảy ra.
- Nếu là **TLS** → **dừng lại ở đây.**

> **Quy tắc, không phải gợi ý: không tìm cách phá mã hóa, không dựng chứng chỉ giả, không MITM TLS của
> máy.** Hai lý do. Một: chính đường dây đó mang được lệnh **khóa máy theo thời hạn** (mục 1.1) — can
> thiệp vào nó là rủi ro thật với một cái máy đang chạy sản xuất và còn bảo hành. Hai: cái ta cần là
> **dữ liệu**, và mục 3 đã cho dữ liệu mà không cần chạm vào kênh đó. Khi gặp TLS, việc đúng là mục 10:
> hỏi Dahao xin API.

### 4.5 Việc phải làm tại máy (2 phút, cần bạn đứng ở máy)

- **R-L2-1** Tìm màn hình **`系统设置 → 网络`** (Cài đặt hệ thống → Mạng), **không phải** nhóm tham số
  `Emb asst. Para`. Bản đặc tả 2016 của chính họ nói module này có *"wifi/蓝牙/internet 相关配置"* —
  tức trong họ phần mềm này **có** một màn hình chọn WiFi/SSID riêng, tách khỏi các tham số `C4x`.
  Nếu tìm ra màn hình đó và nối được WiFi ở đó, toàn bộ bài toán đổi khác.
- **R-L2-2** Cắm cáp mạng: từ **RJ45 trên panel điều khiển** (cái đang rỗng) sang cổng LAN rỗng của Deco.
  **Không cắm vào hộp bạc BECS-A15 trong tủ điện** — `CN1` ở đó là encoder trục Y (mục 1.3). Sau khi cắm,
  tắt/bật nguồn máy.
- **R-L2-3** Ghi lại **có/không** cho từng việc trên. Việc nào chưa làm thì ghi "chưa làm", không ghi
  "không có tác dụng". Lần trước watcher CN1 chạy 35 phút mà không ai xác nhận đã cắm cáp — 35 phút đó
  không kết luận được gì.
- **R-L2-4** (30 giây) Vào lại `Emb asst. Para` trang 2/4, đọc **đúng dòng `C41 Server Port`** và ghi lại
  **cả giá trị lẫn dải cho phép** hiện trên máy. Sổ tay 2018-01 ghi `1600` / `1~9999`; tài liệu bên ngoài
  nói `3865`. Máy thật là trọng tài duy nhất (mục 1.5).
- **R-L2-5** Xin **bộ cài + hướng dẫn PDF** của phần mềm PC. Có hai đường, đường nào cũng rẻ hơn dò khung tin:
  - **Đại lý demo trên YouTube** — Sally Pan, Shenzhen Yunfu Equipment Co., Ltd, WhatsApp/WeChat
    `+86 13477097821`, `sally@yunfuemb.com`. Phần mô tả video của họ ghi thẳng: *"For installment file and
    PDF file guide, please write me on whatsapp… so i can share with you."*
  - **Trung tâm tải của hãng** — `en.dahaobj.com/service/download.html`, mục **刺绣机**, có
    `Setup_emCAD_2.7.0.8578` (06/02/2025) và `A15 Installation and commissioning manual v2.0` (25/05/2023).
    Trang `BECS-A15` của hãng còn liệt kê **`BECS-A15 单头机 操作手册-通用部分（版本号：2020-04）`** — bản
    **mới hơn** bản 2018-01 tôi đang dùng. **Từ mạng ở đây link tải trả về `HTTP 567 — Restricted Access`
    (Tencent EdgeOne chặn),** nên phải tải từ mạng khác hoặc nhờ đại lý gửi.

> ⚠️ `Setup_emCAD_*.exe` là **file thực thi**. Tôi không tải và không chạy file exe lấy từ web. Nếu cần cài,
> bạn lấy trực tiếp từ trang hãng hoặc từ đại lý, và cài trên **PC Windows**, không phải trên máy thêu.

---

## 5. L3 — giả lập đích của máy (khoan làm, và đây là lý do)

Để làm được L3 cần đủ **cả bốn** thứ: (1) máy chịu gọi ra — hiện `connections: 0`; (2) một host Linux
**có sudo** để `tcpdump` — Mac này không có; (3) giải mã được bắt tay "successful registration" trên một
giao thức **chưa ai trên thế giới công khai dịch ngược**; (4) không vướng mã hóa.

Xác suất thành công thấp, và có một lý do **kỹ thuật** để không cố: kênh đó mang lệnh khóa máy (mục 1.3).

**Phiên bản hợp pháp và đúng đắn của L3 là mục 10: xin đường vào chính thức.** Nếu Dahao/đại lý cung cấp
DH-NMS bản chạy trong xưởng, hoặc API của 大豪云, thì *đó chính là* câu trả lời cho "dùng LAN" — và nó
đến từ một cuộc gọi điện, không phải từ hàng chục giờ dò khung tin.

- **R-L3-1** Nếu bất kỳ lúc nào bridge nhận được kết nối vào `192.168.7.102:1600`, **ghi khung thô ra file
  ngay** (chế độ capture đã bật trong `bridge.config.may-that-102.json`) và **không** trả về một byte nào.
  Sản phẩm là **chỉ đọc** theo thiết kế; bridge không được ghi ngược vào socket dial-in.
- **R-L3-2** Không thêm bất kỳ đường ghi nào vào máy thêu, ở bất kỳ tầng nào, kể cả khi giải mã được
  giao thức. `controller.transfer` đã bị hợp đồng adapter **từ chối thẳng**; giữ nguyên.

---

## 6. Hạ tầng LAN bắt buộc (áp cho cả L1 và L2)

- **R-INF-1** Một **host thường trực** trong LAN chạy bridge, IP tĩnh **`192.168.7.10`**. Hiện bridge chạy
  trên Mac — Mac ngủ là mất dữ liệu. Đây là điều kiện tiên quyết của cả L1 và L2.
- **R-INF-2** Đặt **DHCP reservation** cho host đó và thu hẹp dải DHCP của Deco về `.200`–`.250`, để dải
  `.10`–`.199` dành cho thiết bị cố định. Việc này **chỉ làm được trong app Deco trên điện thoại** —
  web admin của Deco BE25 chỉ có Status và System.
- **R-INF-3** **Không bao giờ** đặt máy thêu hay node cảm biến vào **Guest Network**. Guest isolation sẽ
  chặn bridge với triệu chứng trông y như máy hỏng.
- **R-INF-4** **Không bấm Reset trên Deco** tại xưởng: reset về xuất xưởng cần Internet để cấu hình lại.
- **R-INF-5** Mật khẩu WiFi thật **chỉ ghi trên giấy**. Không viết vào bất kỳ file nào trong repo, không
  gửi qua chat công việc.

---

## 7. Ranh giới (giữ nguyên, không đàm phán)

1. **Chỉ đọc.** Không có đường nào từ dashboard điều khiển được máy. Bridge không ghi một byte nào vào
   socket dial-in.
2. **Không phá mã hóa**, không chứng chỉ giả, không MITM TLS (mục 4.4).
3. **Không chạm phần cứng máy**: không khoan, không cắt dây, không nối vào bo điều khiển, không lấy điện
   từ máy.
4. **Không chép tham số xuất xưởng của máy khác vào máy này** (mục 1.4).
5. **Không bịa dữ liệu.** Trường chưa đọc được thì hiển thị `Chưa đọc được từ controller`, không dùng giá
   trị mặc định, không nội suy.

---

## 8. Tiêu chí nghiệm thu

| # | Tiêu chí | Đo bằng |
| --- | --- | --- |
| A-1 | Bridge chạy trên host thường trực `192.168.7.10`, sống qua đêm | Uptime ≥ 24 h liên tục |
| A-2 | Một node L1 đẩy được `status` + `rpm` + `odometer` thật vào dashboard | Payload đi qua `fixture-controller.mjs` **(đã đạt 17/08/2026, xem §3.4)** rồi qua máy thật **(chưa)** |
| A-3 | `job.totalStitches` của mẫu đang chạy khớp giữa `pyembroidery` đọc `.DST` và số hiện trên màn hình máy | So sánh tay, 3 mẫu khác nhau |
| A-4 | Trường không đo được hiện đúng `Chưa đọc được từ controller`, **không** hiện `0` | Kiểm tra bằng mắt trên giao diện |
| A-5 | Log DNS của L2 có kết luận rõ ràng theo bảng 4.3 (kể cả kết luận "không có truy vấn nào") | File log + một dòng kết luận ghi vào `execution-notes.md` |
| A-6 | Ba việc ở mục 4.5 đều được ghi **đã làm / chưa làm**, không để trống | `execution-notes.md` |

---

## 9. Nợ kỹ thuật liên quan tới đường LAN

| # | Nợ | Ảnh hưởng | Đề nghị |
| --- | --- | --- | --- |
| N-1 | `probePort` trong `bridge/lib/network.mjs:10` gộp `ECONNREFUSED` (máy **sống**, chủ động từ chối) vào cùng kết quả với timeout (máy **không có mặt**) | Với đúng con máy này — trả `RST` cho mọi cổng — đây là chỗ dễ chẩn đoán sai nhất | Tách hai trạng thái. **Chờ bạn đồng ý** |
| N-2 | Máy `dial-in` không bao giờ được probe (`bridge/lib/bridge-service.mjs:589`) | Không biết máy có mặt trên LAN hay không | Cho phép probe *hiện diện* và gắn nhãn **"Máy có mặt trên mạng"**, tuyệt đối không phải "đang chạy". **Chờ bạn đồng ý** |
| ~~N-3~~ | ~~`docs/mang-xuong-deco.md` viết sai: nói Deco không có web admin, và ghi LAN gateway là `.1` trong khi thực tế là `.254`~~ | ~~Ai đọc tài liệu đó sẽ cấu hình sai gateway~~ | **ĐÃ SỬA 18/08/2026.** Ba chỗ: mục 0.5 ghi rõ BE25 *có* web admin nhưng chỉ Status + System; bảng địa chỉ mục 3 thêm dòng `.254` là router thật; ô `Router` trong hướng dẫn đặt IP tĩnh cho Mac đổi sang `.254` kèm triệu chứng nếu gõ sai. Thêm: bảng "hiện trạng" đầu tài liệu đã dán nhãn `C44`/`C41` là giá trị xuất xưởng, không phải giá trị đang nằm trên máy |
| N-4 | 105 máy fixture còn sót, `breakersOpen: 32`, làm ngập log | Khó đọc log khi chẩn đoán L2 | **Không tự xóa** (là dữ liệu của bạn). Chờ bạn quyết |

---

## 10. Hỏi đại lý / Dahao — chép nguyên văn để gửi

Đây là phần có giá trị cao nhất trong tài liệu, và là **phiên bản đúng đắn** của "dùng LAN". Bảy câu, tiếng
Trung, gửi thẳng cho đại lý hoặc hỗ trợ kỹ thuật Dahao:

```
1. A15-B104H-B（序列号 1010832DH21395748）的网络功能需要哪个固件版本才能启用？
   目前说明书写的是"network (temporarily unavailable)"，请问是否需要升级固件或购买授权？

2. 这台机器的网络功能是否必须连接大豪云（*.dahaoyun.net）？
   能否在工厂局域网内部署服务端（离线、不连外网）？

3. DH-NMS 绣花机网络管理系统是否有可在本地服务器部署的版本？
   如果有，服务端的最低要求、端口、以及机器端需要设置哪些参数？

4. 参数 C41 服务器端口 / C44 服务器 IP 在 A15 上是否仍然有效？
   还是这两个参数只适用于旧机型（EmbNetServer 系列）？

5. A15 的网络接口在操作箱面板的 RJ45 上，还是需要另外的网络模块？
   机身上的 HILCOM 标签和 MAC 前缀 ec:30:8e（利尔达）对应哪个模块？

6. 大豪云平台是否提供对外 API（获取产量、运行状态、断线报警）？
   如果提供，申请流程和文档在哪里？

7. 机器是否支持把生产统计数据导出到 U 盘（CSV/文本）？
   说明书附录 2 只提到花样导入导出，没有提到生产数据。

8. 无线传输花样用的电脑端软件是 emCAD 吗（官网下载中心的 Setup_emCAD_2.7.0.8578）？
   还是另有专门的传输服务端程序？该程序监听哪个 TCP 端口，机器端 C41 服务器端口应设为多少？

9. 请发一份《BECS-A15 单头机 操作手册-通用部分（版本号 2020-04）》和《A15 机型安装调试说明 v2.0》。
   官网下载链接在我们这边返回 567 Restricted Access，无法下载。
```

Bản tiếng Việt để bạn hiểu mình đang hỏi gì:

1. Cần firmware phiên bản nào để **bật** được chức năng mạng trên A15? Có cần mua giấy phép?
2. Chức năng mạng có **bắt buộc** phải nối đám mây `*.dahaoyun.net`, hay dựng được server **trong LAN
   xưởng, không cần Internet**?
3. DH-NMS có bản **triển khai trên server nội bộ** không? Nếu có: yêu cầu tối thiểu, cổng nào, máy phải
   đặt tham số gì?
4. `C41`/`C44` **còn hiệu lực** trên A15 không, hay chỉ dành cho dòng cũ (EmbNetServer)?
5. Cổng mạng của A15 nằm trên RJ45 của panel, hay cần thêm module? Tem **HILCOM** và MAC `ec:30:8e`
   (Lierda) ứng với module nào?
6. 大豪云 có **API** cho bên thứ ba (sản lượng, trạng thái, báo đứt chỉ) không? Thủ tục xin ở đâu?
7. Máy có **xuất thống kê sản xuất ra USB** (CSV/text) được không? Phụ lục 2 của sổ tay chỉ nói tới file
   mẫu, không nói tới dữ liệu sản xuất.
8. Phần mềm PC để **tải mẫu không dây** có phải là **emCAD** không? Nó lắng nghe **cổng TCP nào**, và
   `C41` phải đặt bao nhiêu?
9. Xin **sổ tay A15 bản 2020-04** và **A15机型安装调试说明 v2.0** — link tải trên web hãng trả
   `567 Restricted Access` từ mạng của xưởng.

---

## 11. Không làm (non-goals)

- Không thay dashboard/bridge hiện tại bằng ThingsPanel / JetLinks / dgiot / FastBee (lý do ở 3.2).
- Không dựng MQTT broker, time-series DB, hay Grafana khi trong xưởng còn **dưới 20** node.
- Không dịch ngược giao thức Dahao khi chưa có (a) pcap thật và (b) host Linux có sudo.
- Không mở bất kỳ đường ghi nào vào máy thêu.
- Không mua thiết bị mạng thêm cho tới khi bảng 4.3 có kết luận — mua sớm là mua trước khi biết mình cần gì.

---

## 12. Nguồn

**Mã nguồn mở / kho mã (tra trực tiếp qua API chỉ mục, 17/08/2026)**

- <https://github.com/ignativs1/maya-embroidery-dahao-a15> — 玛雅绣花机_大豪A15_出厂参数设定表 + bảng `CN1`–`CN10`
- <https://github.com/shannxiqiu/prototype> — 绣花机项目上层应用原型系统 (2016); `doc/上层软件需求与模块划分.doc`; `doc/BEXT_Instruction_Manual_V1.0(E).pdf`; `doc/BECS-285 单头机 操作手册`
- <https://github.com/EmbroidePy/pyembroidery> · <https://github.com/inkstitch/inkstitch>
- <https://github.com/esphome/esphome> · <https://github.com/AdguardTeam/AdGuardHome>
- <https://github.com/emqx/emqx> · <https://github.com/eclipse-mosquitto/mosquitto> · <https://github.com/emqx/neuron>
- <https://gitee.com/dgiiot> · <https://github.com/dgiot/dgiot> · <https://github.com/jetlinks/jetlinks-community>
- <https://github.com/node-red/node-red> · <https://github.com/apache/iotdb> · <https://github.com/grafana/grafana> · <https://github.com/influxdata/telegraf>
- <https://github.com/freeleepm/LiteMES> · <https://gitee.com/ricefish/industry4.0-mes> · <https://gitee.com/explore/topic/MES>
- Đối chiếu hãng khác: <https://github.com/bradenriggins/brother-pp1-ble> (Brother PP1 qua BLE) · <https://github.com/Ylianst/EMB-Serial> (Bernina qua serial)

**Hãng và nền tảng**

- 大豪云 trên App Store: <https://apps.apple.com/uz/app/大豪云/id1488277916> — bundle `net.dahaoyun.iot`
- <http://main.iot.dahaoyun.net/> (từ `dahaoyun.net`) · <https://www.dahaobj.com/>
- Báo cáo thường niên Dahao 603025: <https://static.cninfo.com.cn/finalpage/2025-03-21/1222857240.PDF>

**Nguồn hãng kiểm ngày 17/08/2026 — dùng cho mục 1.5** (site chính thức là `dahaobj.com`; `dahao.com.cn`
và `dahaotech.com` **là tên miền đang bán**, không phải của hãng)

- <https://www.dahaobj.com/content/details16_55951.html> — 【保存+收藏】一篇文章帮你搞懂大豪刺绣机电控（2024修订版），
  25/10/2024: *"A15/A15Pro… 基于WIFI的工业4.0智能互联技术，支持在线分期付款加解密，支持远程运维，支持无线传输花样"*
- <https://www.dahaobj.com/content/details89_508.html> — trang sản phẩm BECS-A15; liệt kê
  `BECS-A15 单头机 操作手册-通用部分（版本号：2020-04）`, `A15机型安装调试说明v2.0`, `A15电控快速指南`
- <https://en.dahaobj.com/service/download.html> — Download Center mục 刺绣机: `Setup_emCAD_2.7.0.8578`
  (06/02/2025), `A15 Installation and commissioning manual v2.0` (25/05/2023). Link tải file trả
  **`HTTP 567 Restricted Access`** (Tencent Cloud EdgeOne) từ mạng của xưởng.
- Video đại lý (kiểm bằng oEmbed + phần mô tả): <https://www.youtube.com/watch?v=ZPcZbcmfY0g> —
  *"Dahao A15 function: Wireless Design Upload"*, Sally Pan-YunFu (Shenzhen Yunfu Equipment Co., Ltd) ·
  <https://www.youtube.com/live/JV99fzIq1bI> — *"lastest A15 transfer design from computer to Embroidery
  Machine A15 无线传输花样"*, FUWEI
- Host tài liệu Dahao còn tải được từ đây: <http://www.voltexsew.com/Uploads/202105/60b0473d448fc.pdf>
  (*A15 Photo Embroidery Function Instructions* — đã tải, **không** có nội dung mạng)
- Bị chặn từ mạng này: `manualslib.com` (ECONNREFUSED), `overlock.com.ua` (403), `cabolisan.com` (timeout),
  `pdfcoffee.com` (ECONNRESET) ⇒ **chưa đọc được** Appendix IV "Network Connection of Embroidery Machines"
  của sổ tay **BECS-A18** — đây là nguồn hứa hẹn nhất còn nợ, vì A18 cùng đời với A15 và **có** phụ lục mạng.

**Ngành cải tạo thiết bị cũ (tiếng Trung)**

- <https://www.caxa.com/new/2026113858.html> — 机床联网方案，让老旧设备焕发新生
- <https://zhuanlan.zhihu.com/p/1952319122680557734> — 老旧注塑机"免点表"工业网关 IO 采集
- <https://www.gannz.cn/news/2512/10/> — 经编机联网数据采集方案
- <https://www.yufanlink.com/news/2501/250123-5/> — 织机效率计算方法
- <https://blog.csdn.net/weixin_36794508/article/details/146031186> — 工业设备数据采集方案汇总

**Kỹ thuật DNS nội bộ (tiếng Trung)**

- <https://zhuanlan.zhihu.com/p/584851257> · <https://cloud.tencent.com/developer/article/2384504> · <https://www.cnblogs.com/xututu6/p/18070399>

**Nền tảng IoT mã nguồn mở, tổng hợp tiếng Trung**

- <https://blog.csdn.net/m0_57298417/article/details/144348439> — IOT 开源物联网平台整理汇总
- <https://zhuanlan.zhihu.com/p/709382934> — 六款开源物联网平台
- <https://blog.csdn.net/vividea/article/details/144814528> — ThingsPanel
- <https://gitee.com/explore/iot> · <https://gitee.com/explore/topic/数据采集>

**Sổ tay đã tải và dùng làm bằng chứng**

- `BECS-A15 Owner's Manual` (3849 dòng text) — 4 phụ lục, **không** có phụ lục mạng
- `BECS-285A / Butterfly BT1501 Owner's Manual`, Appendix 4 "Network Function of Embroidery Machine" §4.2–4.3 — <https://www.theembroiderywarehouse.com/butterflyemb/dahao-embroidery-machine-manual/documents/BT1501%20OPERATION%20MANUAL.pdf>

**Giới hạn của khảo sát này** — phải ghi để người sau không tin quá mức:

- API tra cứu của Gitee **chặn khách vô danh** (trả `[]` cả với `MES`/`modbus`) ⇒ chưa quét được Gitee.
- Chưa tra được: 恩山无线论坛, 缝纫客 (frk123.com), 联科绣花网 (6xiu.com) phần diễn đàn, Bilibili, Douyin,
  百度贴吧 — search engine liên tục trả nhầm sang từ đồng âm (大华 DVR, 帝豪 xe hơi).
- Kho `maya-embroidery-dahao-a15` là dữ liệu cộng đồng, 0 star, không giấy phép, tạo 14/08/2026, **chưa
  được kiểm chứng độc lập**. Dùng bảng `CN1`–`CN10` của nó như **giả thuyết mạnh**, không như sự thật đã
  xác nhận — và tuyệt đối không dùng phần tham số (mục 1.4).
- **Sổ tay tôi đang dựa vào là bản 2018-01.** Hãng đã có bản **2020-04** và tài liệu cài đặt **2023**. Mọi
  câu trong tài liệu này trích từ sổ tay — kể cả câu *"network (temporarily unavailable)"* — đều phải hiểu
  là **của bản 2018-01**, và phải kiểm lại khi có bản mới (R-L2-5).
- **Không tra được số `3865`** ở bất kỳ nguồn nào; cũng **không tra được tên `DesignServer`**. Việc kết luận
  hai thứ đó là **sai** hay chỉ là **chưa tìm thấy** phụ thuộc vào R-L2-4 và R-L2-5.
