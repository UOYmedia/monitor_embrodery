# Bảng mã lỗi Dahao BECS — 83 mã

**Nguồn:** *Appendix III — Error List*, sổ tay chủ máy BECS-A68/A88 bản 2021-01 (tr. 167–168), đối
chiếu với sổ tay BECS-A18/A58/A98 — **hai sổ tay độc lập cho ra đúng 30 mã EC giống hệt nhau**.

⚠ **Sổ tay A15 KHÔNG có phụ lục lỗi.** Phụ lục của A15 chỉ có: 1 Parameter List, 2 U Disk
Operation, 3 Automatic Position Limitation, 4 Quick Guide. Bảng dưới đây là của dòng anh em cùng
hãng cùng họ BECS; **rất có thể giống A15 nhưng chưa xác nhận được trên chính máy A15 ở xưởng**.
Đừng ghi số mã lên màn hình như thể máy tự khai — xem phần "Vì sao bảng này chưa dùng được" ở cuối.

---

## Lỗi tầng dưới — bo mạch máy (30 mã `EC`)

Đây mới là **lỗi cơ khí/điện thật sự của máy thêu**. Máy hiện lên màn hình HMI của nó.

| Mã | Nguyên văn | Tạm dịch |
|---|---|---|
| EC05 | THE HOOK IS NOT OK | Ổ móc không ổn |
| EC07 | HOOKING TIME IS OUT | Quá giờ móc chỉ |
| EC08 | NOT SET (E. SET) | Chưa đặt điểm bắt đầu thêu |
| EC09 | CANNOT RETURN | Không lùi được |
| EC10 | CANNOT RETURN | Không lùi được |
| EC11 | DESIGN NOT EXIST | Không có mẫu |
| EC12 | STOP POSITION ERR | Sai vị trí dừng kim |
| EC13 | FRAME OVER LIMIT | Khung vượt giới hạn |
| EC14 | CONTROL MEMORY LOST | Mất bộ nhớ điều khiển |
| EC16 | STEP MOTOR ERR | Lỗi động cơ bước |
| EC17 | CHANGE CLR OVERTIME | Đổi màu quá giờ |
| EC18 | HALF RETURN ERR | Lỗi lùi nửa chừng |
| EC19 | NEEDLE POSTION ERR | Sai vị trí kim |
| EC20 | MAIN MOTOR OVERTIME | Motor chính quá giờ |
| EC21 | CHANGE CLR OVERLIMIT | Đổi màu vượt giới hạn |
| EC22 | MAIN MOTOR REVERSE | Motor chính quay ngược |
| EC23 | CANNOT EMBROIDER | Không thêu được |
| EC24 | CANNOT FRAME BACK | Không lùi khung được |
| EC26 | CAN NOT TRIM | Không cắt chỉ được |
| EC36 | SEQUIN IS ON | Đang bật kim sequin |
| EC37 | PULL BAR ERROR | Lỗi cần gạt |
| EC38 | SPE. EMB. OVERTIME | Thêu đặc biệt quá giờ |
| EC41 | FILE NOT EXIST | Không có file |
| EC42 | FILE DIRECTORY FULL | Đầy thư mục |
| EC43 | MEMORY SPACE FULL | Đầy bộ nhớ |
| EC44 | FILE FAT ERR | Lỗi bảng FAT |
| EC45 | FILE DIRECTORY ERR | Lỗi thư mục |
| EC46 | HAS BAD SECTORS | Có sector hỏng |
| **EC95** | **Thread is broken, press key** | **ĐỨT CHỈ — bấm phím để tiếp** |
| EC101 | Transfer CRC Error | Lỗi CRC khi truyền |

**EC95 chính là cái xưởng gặp nhiều nhất** — và cũng là cái bộ dò `soi-lan-dung.py` đang đoán ra
bằng thao tác lùi khung. Đây là chỗ duy nhất hai đường gặp nhau.

## Lỗi tầng trên — phần mềm điều khiển (53 mã, đánh số 01–56)

Phần lớn là lỗi thao tác file/USB/mẫu, không phải hỏng máy. Trích những mã hay gặp:

| Mã | Nguyên văn | Tạm dịch |
|---|---|---|
| 01 | Operation Fail | Thao tác thất bại |
| 02 | Operation Break | Thao tác bị ngắt |
| 03 | Machine Communication Error | Lỗi truyền thông với máy |
| 06 | Not set ZERO point | Chưa đặt gốc |
| 07 | Fail to set ZERO point | Đặt gốc thất bại |
| 08 | No design start point | Không có điểm bắt đầu mẫu |
| 09 | No software range | Ngoài vùng cho phép |
| 12 | Emb. design not existed! | Không có mẫu để thêu |
| 34 | File corrupt | File hỏng |
| 41 | Error design data | Dữ liệu mẫu sai |
| 47 | Stitch number too large | Quá nhiều mũi |
| 49 | Error design, or communication fail | Mẫu lỗi hoặc rớt truyền thông |
| 53 | Design is too big. Can't process. | Mẫu quá lớn |

(Không dùng: 04, 05, 50.)

---

## ⚠ Vì sao bảng này CHƯA dùng được trên dashboard

**Máy không đẩy mã lỗi ra mạng.** Đã đếm từng tên trường trên **280.017 khung của 14 máy**: mọi
khung trạng thái đúng **8 trường**, không khung nào từng mang thêm trường lạ, và 54 topic gom đúng
4 họ — không họ nào là alarm/fault. `netstat` cho thấy 13 máy chỉ nối đúng cổng 3865, không có
kênh thứ hai. Chi tiết: `quan-sat/README.md`, mục "Lỗi MÁY và lỗi TUYẾN ĐO".

Nên bảng 83 mã này sống ở **màn hình HMI của máy**, không sống trên mạng. Muốn đưa lên dashboard
thì phải chọn một trong ba đường:

1. **Thợ bấm xác nhận** — `src/components/ManualReadingForm.tsx` đã viết sẵn, chưa nối. Bảng này
   chính là danh sách để thợ chọn. Rẻ nhất, chính xác nhất, nhưng phụ thuộc người.
2. **Cảm biến ngoài** — firmware ESP32-C3 đã có trong `firmware/`. Bắt được đứt chỉ (EC95) và rung
   động, không bắt được mã cụ thể.
3. **Đọc HMI** — chưa có đường vào.

Tới lúc đó, thứ gần nhất mà mạng cho biết là suy luận từ số mũi (`soi-lan-dung.py`): "có người lùi
khung rồi cho chạy tiếp" ≈ EC95. **Đừng ghi mã EC lên màn hình như thể máy tự khai** — đó là nói
hộ máy, và sẽ đẩy thợ đi tìm một cái lỗi máy chưa từng báo.
