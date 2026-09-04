# -*- coding: utf-8 -*-
"""Ghi vào README hai ô mới theo từng máy."""
import io, sys
P = '/Users/phong/dashboarddahao/quan-sat/README.md'
s = io.open(P, encoding='utf-8').read()
if 'Bốn ô nhìn theo TỪNG MÁY' in s:
    print('đã có, bỏ qua'); sys.exit(0)

MOC = '### ⚠ Bẫy: `broker.log` KHÔNG xếp đúng thứ tự giờ, chốt sớm là mất số IM LẶNG'
assert MOC in s, 'không thấy neo'

THEM = '''### Bốn ô nhìn theo TỪNG MÁY

Câu "máy **đó** chạy bao lâu" được trả lời ở bốn chỗ, mỗi chỗ hợp một kiểu người xem:

| ô | kiểu | trả lời |
|---|---|---|
| 430 `Từng máy — một ngày trôi đi đâu` | bảng | 19 dòng × 12 cột — số chính xác, cộng chân bảng |
| 450 `Từng máy chạy bao lâu — xếp cạnh nhau` | thanh ngang | so bằng mắt, mỗi máy một thanh chia bốn khúc màu |
| 460 `Từng máy thêu vào những giờ nào` | cột chồng theo giờ | máy nào thêu vào lúc nào; cột **Total** ở chú giải = tổng giờ thêu của từng máy |
| ô `Máy` trên đầu bảng | bộ lọc | chọn một máy thì **mọi ô** phía trên cũng chỉ tính máy ấy |

Ô 450 xếp máy **theo số**, không xếp theo giá trị — để lần nào mở cũng tìm được máy của mình ở
đúng chỗ cũ. Thanh của mọi máy **dài bằng nhau** (đúng bằng khoảng đang xem) vì bất biến bốn rổ;
cái đáng nhìn là **tỷ lệ màu**, không phải độ dài.

Ô 460 chỉ vẽ rổ `chay`, xếp chồng — chiều cao cả cột là giây thêu của cả xưởng, mỗi dải là một
máy. Cả cột tụt = cả xưởng cùng nghỉ; **một** dải biến mất trong khi các dải khác vẫn dày = riêng
máy ấy có chuyện.

> Máy 17/18/19 hiện đọc **100 % “mất tín hiệu”** — đã khai trong `may.json` nhưng chưa hề gửi
> khung nào. Đó là sự thật của xưởng, không phải ô hỏng; ô “Tỷ lệ thêu” của ba máy ấy để **trống**
> (mẫu số lọc `> 0`) vì "không biết" đúng hơn số 0.

'''
s = s.replace(MOC, THEM + MOC, 1)
io.open(P, 'w', encoding='utf-8').write(s)
print('README: +%d dòng' % len(THEM.splitlines()))
