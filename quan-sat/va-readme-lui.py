"""Trỏ README sang tài liệu mới về lùi mũi."""
import io, sys
P = '/Users/phong/dashboarddahao/quan-sat/README.md'
s = io.open(P, encoding='utf-8').read()

MOC = ('| `dahao-gio-may` | **chủ xưởng, kế toán** | **một ngày trôi đi đâu: '
       'thêu / dừng / chờ** | 1m | hôm nay |\n')
assert MOC in s, 'không thấy dòng bảng dahao-gio-may'
if 'docs/lui-mui.md' in s:
    print('README: đã có, bỏ qua'); sys.exit(0)

THEM = MOC + (
    '\n> Con số **"lùi N mũi"** của `dahao-dut-chi` là **suy đoán**, không phải máy báo — máy A15\n'
    '> không có trường lỗi nào. Cách suy, bằng chứng đo thật, và **chỗ nó đang đọc cao gấp ~4 lần\n'
    '> vì trận dồn khung**: [`docs/lui-mui.md`](../docs/lui-mui.md).\n')
s = s.replace(MOC, THEM, 1)
io.open(P, 'w', encoding='utf-8').write(s)
print('README: +%d dòng' % (len(THEM.splitlines()) - 1))
