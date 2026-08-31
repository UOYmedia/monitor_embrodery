# -*- coding: utf-8 -*-
import io, sys
P = '/Users/phong/dashboarddahao/quan-sat/README.md'
s = io.open(P, encoding='utf-8').read()

MOC = '### Kiểm lại\n'
if s.count(MOC) != 1:
    sys.stderr.write('khong thay moc\n'); raise SystemExit(1)

THEM = u"""### ⚠ Bẫy đã cắn: ô ĐẾM chỉ biết mã cũ thì lặng lẽ đọc 0

Tách năm mã im xong, ba chỗ **đếm** vẫn hỏi theo bảng cũ (`tt === 'off'`, hoặc `ma == 2 or
ma == 7`). Hậu quả: phần lớn máy im rơi ra ngoài mọi ô — **cả xưởng cúp điện mà ô đọc 0, đúng
vào lúc cần nó nhất**. Đo trên production lúc vá (28/08, 17:40 VN): **11/13 máy đang im**, ô cũ
đọc **3**.

Ba ô đã vá, và chúng **cố ý không giống nhau** vì trả lời ba câu khác nhau:

| Chỗ | Đếm gì | Vì sao |
|---|---|---|
| `xem/index.html` → `veTong()` ô "Máy off" | mọi mã trong bảng **`TT_IM`** | Đếm bằng chính bảng mà `chuLau()`/`theMay()` đang dùng ⇒ thêm mã im mới là ô tự đúng theo, không phải nhớ sửa hai chỗ |
| Grafana `dahao-tinh-trang` ô 4 — đổi tên **"Mất tín hiệu" → "Máy im"** | cả 5 mã: 2, 7, 8, 9, 10 | Bảng toàn cảnh hỏi *"có bao nhiêu máy đang không nói gì"*. Ban đêm ô này đọc gần bằng tổng số máy là ĐÚNG; dòng thời gian ngay dưới nói rõ từng máy im vì lý do nào |
| Grafana `dahao-can-xu-ly` ô 102 "Mất tín hiệu" | chỉ mã mức ≥ 1: 0, 2, 7, 9 | Bảng việc-cần-làm. **Cố ý bỏ 8 (ngoài giờ) và 10 (thợ tắt máy)** — hai cái đó mức 0 vì là chuyện bình thường; kéo vào thì đêm nào bảng cũng đỏ và người ta thôi nhìn nó |

Đừng "đồng bộ hoá" ba ô này thành một con số. Chúng không phải ba phần của một cái bánh.

Vá bằng `quan-sat/va-o-off.py` (trang) và `quan-sat/va-o-im.py` (Grafana) — cả hai sửa **thẳng
vào file**, chạy lại lần nữa thì báo `bỏ qua — đã đúng`. Grafana đọc file mỗi 30 giây; POST qua
API sẽ bị chính nó ghi đè lại.

### ⚠ Bẫy thứ hai: bài thử đo đúng chữ mà không đo con số

`scripts/xem-tu-vung.mjs` có một ca tên *"đồng hồ đếm từ bản tin CUỐI CÙNG, không từ
statusSince"* — nhưng hàm dựng máy của nó luôn đặt `lastTelemetryAt = bây giờ`, mà `tuoiGiay()`
đọc đúng trường ấy. Nên ca đó xưa nay chạy trên tuổi = 0 và chỉ so được **chữ đứng trước số**.
Đã thêm tham số `im` (giây đã im) và ghim luôn con số, kèm `tu: 99999` đặt lệch hẳn để nếu đồng
hồ lỡ đếm nhầm nguồn thì bài thử đỏ ngay thay vì im lặng đo sai.

Cùng lớp với chuyện ghim đồng hồ: `gioVN(g)` đẩy `lechDongHo`, **phải trả về 0 ngay sau đó** —
không trả thì mọi bài đo TUỔI phía dưới lệch đúng bằng chỗ đã đẩy, và trang đúng mà bài thử đỏ.

"""

s = s.replace(MOC, THEM + MOC)
io.open(P, 'w', encoding='utf-8').write(s)
print('da them 2 muc vao README')
