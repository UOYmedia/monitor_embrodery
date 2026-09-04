#!/usr/bin/env python3
"""Ô "Dừng dưới 1 phút" / "Dừng từ 1 phút trở lên" phải đọc ra SỐ LẦN, không phải thời gian.

Con số to nhất trên ô là thứ người ta nhớ. Quản đốc hỏi "hôm nay máy dừng bao nhiêu lần",
chứ không hỏi "cộng lại mất mấy giây" — nên đảo vai: đếm lên làm tiêu đề, thời gian lùi
xuống ô phụ ngay bên cạnh. Không mất thông tin nào, chỉ đổi chỗ.
"""
import io, re, sys, pathlib

P = pathlib.Path('/Users/phong/dashboarddahao/quan-sat/tao-bang-gio-may.py')
s = P.read_text(encoding='utf-8')

CU_420 = '''            o(420, "Dừng dưới 1 phút", "Cộng thời gian của những lần dừng NGẮN (< 60 giây). "
                    "Phần lớn là cắt chỉ, đổi màu, chỉnh khung — vụn nhưng cộng lại rất tốn.",
              tong('ngan'), 0, 11, w=5, mau="orange"),
            o(421, "bao nhiêu lần", "Số lần dừng ngắn đã KHÉP LẠI (máy dừng rồi chạy tiếp) trong "
                    "khoảng đang xem. Lần dừng được tính vào phút mà nó KẾT THÚC.",
              tong('so_ngan'), 5, 11, w=4, don_vi="short"),'''

MOI_420 = '''            o(420, "Dừng dưới 1 phút", "SỐ LẦN máy dừng ngắn (< 60 giây) đã KHÉP LẠI — dừng rồi "
                    "chạy tiếp. Lần dừng được tính vào phút mà nó KẾT THÚC.\\n\\nPhần lớn là cắt "
                    "chỉ, đổi màu, chỉnh khung: vụn nhưng cộng lại rất tốn — thời gian nằm ở ô "
                    "“mất bao lâu” ngay bên cạnh.",
              tong('so_ngan'), 0, 11, w=5, don_vi="short", mau="orange"),
            o(421, "mất bao lâu", "Cộng THỜI GIAN của đúng những lần dừng ngắn đã đếm ở ô bên "
                    "trái.", tong('ngan'), 5, 11, w=4),'''

CU_423 = '''            o(423, "Dừng từ 1 phút trở lên", "Cộng thời gian của những lần dừng DÀI (≥ 60 giây). "
                    "Đây mới là thứ đáng đi hỏi: hết chỉ không ai thay, kẹt khung, thợ bỏ máy.",
              tong('dai'), 14, 11, w=5, mau="red"),
            o(424, "bao nhiêu lần", "Số lần dừng dài đã khép lại trong khoảng đang xem.",
              tong('so_dai'), 19, 11, w=5, don_vi="short"),'''

MOI_423 = '''            o(423, "Dừng từ 1 phút trở lên", "SỐ LẦN máy dừng dài (≥ 60 giây) đã khép lại trong "
                    "khoảng đang xem.\\n\\nĐây mới là thứ đáng đi hỏi: hết chỉ không ai thay, kẹt "
                    "khung, thợ bỏ máy.",
              tong('so_dai'), 14, 11, w=5, don_vi="short", mau="red"),
            o(424, "mất bao lâu", "Cộng THỜI GIAN của đúng những lần dừng dài đã đếm ở ô bên "
                    "trái.", tong('dai'), 19, 11, w=5),'''

CU_422 = '"thời gian vẫn được cộng đủ vào ô bên trái, tách ra đây để cột “bao nhiêu lần” "\n                    "không bị nó lấp mất.'
MOI_422 = '"thời gian vẫn được cộng đủ vào ô “mất bao lâu” bên trái, tách ra đây để ô đếm "\n                    "“Dừng dưới 1 phút” không bị nó lấp mất.'

CU_VER = '    "version": 2,'
MOI_VER = '    "version": 3,'

for cu, moi, ten in ((CU_420, MOI_420, '420/421'), (CU_423, MOI_423, '423/424'),
                     (CU_422, MOI_422, 'mô tả 422'), (CU_VER, MOI_VER, 'version')):
    if cu not in s:
        sys.exit('❌ không tìm thấy đoạn %s — tệp đã đổi, dừng lại chứ không đoán' % ten)
    if s.count(cu) != 1:
        sys.exit('❌ đoạn %s xuất hiện %d lần' % (ten, s.count(cu)))
    s = s.replace(cu, moi)
    print('✅ %s' % ten)

P.write_text(s, encoding='utf-8')
print('Đã ghi', P)
