# -*- coding: utf-8 -*-
"""Vá hai ô đếm máy im trên Grafana cho khớp thang bằng chứng.

Cùng một lỗ với ô "Máy off" trên trang vận hành: hai ô này viết hồi máy im chỉ có hai mã (2, 7).
Từ 28/08 máy im tách thành năm mã, nên phần lớn máy im rơi ra ngoài cả hai ô — cả xưởng cúp điện
mà ô đọc 0.

Hai ô KHÔNG sửa giống nhau, vì hai bảng trả lời hai câu khác nhau:

· `dahao-tinh-trang` là bảng TOÀN CẢNH — hỏi "có bao nhiêu máy đang không nói gì". Đếm cả năm mã
  (2, 7, 8, 9, 10). Ban đêm ô này đọc 13 là ĐÚNG, không phải báo động: bảng dòng thời gian ngay
  dưới nói rõ 13 máy ấy đang im vì lý do gì.

· `dahao-can-xu-ly` là bảng VIỆC CẦN LÀM — hỏi "có gì phải ra tay không". Chỉ đếm mã im nào mức
  ≥ 1: 2 (mất tín hiệu giữa lúc thêu dở), 7 (bridge gọi không ai nhấc), 9 (cả xưởng cùng im).
  KHÔNG đếm 8 (ngoài giờ) và 10 (thợ tắt máy xong tấm) — hai cái đó `dong-bo-tinh-trang.py` cho
  mức 0 đúng vì chúng là chuyện bình thường; kéo vào đây thì đêm nào bảng cũng đỏ 13 và người ta
  thôi nhìn nó.

Sửa THẲNG VÀO FILE. Grafana đọc file mỗi 30 giây; POST qua API sẽ bị chính nó ghi đè lại.
"""
import io, json, os, sys

D = '/Users/phong/dahao-gateway/quan-sat/grafana/dashboards'

def cau(ma_list, cua_so):
    """`count((… == a) or (… == b) …) or vector(0)` — đúng lối viết đang có, không đổi kiểu."""
    mot = ('last_over_time({job="tinh-trang", may=~"$may"} | json | unwrap ma [%s]) by (may)'
           % cua_so)
    ve = ' or '.join('(%s == %d)' % (mot, m) for m in ma_list)
    return 'count(%s) or vector(0)' % ve

VIEC = [
    # (file, id, mã mới, cửa sổ, tiêu đề mới hoặc None, mô tả mới hoặc None)
    ('dahao-tinh-trang.json', 4, [2, 7, 8, 9, 10], '2m', 'Máy im',
     'Máy không còn đẩy dữ liệu về. Gộp cả NĂM lý do, vì câu hỏi của ô này là "có bao nhiêu máy '
     'đang không nói gì", không phải "có bao nhiêu máy hỏng":\n\n'
     '· mã 2 — mất tín hiệu giữa lúc đang thêu dở (đây mới là cái đáng lo)\n'
     '· mã 7 — bridge gọi không ai nhấc, máy tắt hẳn\n'
     '· mã 8 — ngoài giờ làm (cửa 06:00–19:00), máy tắt sau ca là bình thường\n'
     '· mã 9 — CẢ XƯỞNG cùng im: cúp điện hoặc đứt mạng\n'
     '· mã 10 — thợ tắt máy sau khi thêu xong tấm\n\n'
     'Ban đêm ô này đọc gần bằng tổng số máy là ĐÚNG, không phải báo động — xem bảng dòng thời '
     'gian ngay dưới để biết từng máy im vì lý do nào. Muốn đếm riêng cái đáng ra tay thì xem '
     'bảng "Cần xử lý".\n\n'
     'Vì sao phải gộp: máy A15 cắm điện thì đẩy khung mỗi 2 giây suốt 24/7 kể cả lúc rảnh (đo '
     '1.799 khung/giờ suốt đêm). Nên máy im KHÔNG BAO GIỜ nghĩa là "máy rảnh".'),
    ('dahao-can-xu-ly.json', 102, [0, 2, 7, 9], '3m', None,
     'Máy không còn gửi tin VÀ đó là chuyện cần ra tay: mất tín hiệu giữa lúc thêu dở (mã 2), '
     'bridge gọi không ai nhấc (mã 7), cả xưởng cùng im vì cúp điện hoặc đứt mạng (mã 9), hoặc '
     'chính đường đo hỏng (mã 0). Xem cột "Bridge nói gì" ở bảng dưới.\n\n'
     'CỐ Ý KHÔNG đếm: máy tắt ngoài giờ làm (mã 8) và thợ tắt máy sau khi thêu xong tấm (mã 10). '
     'Hai cái đó là chuyện bình thường; kéo vào đây thì đêm nào bảng cũng đỏ và người ta thôi '
     'nhìn nó. Muốn đếm đủ mọi máy đang im thì xem ô "Máy im" bên bảng Tình trạng.'),
]

dem = 0
for ten, pid, ma, cs, tieu_de, mo_ta in VIEC:
    p = os.path.join(D, ten)
    d = json.load(io.open(p, encoding='utf-8'))
    thay = None
    for pn in d.get('panels', []):
        if pn.get('id') == pid:
            thay = pn
            break
    if thay is None:
        sys.stderr.write('KHONG thay panel %d trong %s\n' % (pid, ten)); raise SystemExit(1)
    tg = thay.get('targets') or []
    if len(tg) != 1:
        sys.stderr.write('panel %d co %d target, cho 1\n' % (pid, len(tg))); raise SystemExit(1)
    moi = cau(ma, cs)
    if tg[0].get('expr') == moi and (tieu_de is None or thay.get('title') == tieu_de):
        print('  bo qua %s#%d — da dung' % (ten, pid)); continue
    tg[0]['expr'] = moi
    if tieu_de: thay['title'] = tieu_de
    if mo_ta: thay['description'] = mo_ta
    io.open(p, 'w', encoding='utf-8').write(
        json.dumps(d, ensure_ascii=False, indent=2) + '\n')
    print('  va %s#%d -> ma %s' % (ten, pid, ma))
    dem += 1
print('xong: %d o' % dem)
