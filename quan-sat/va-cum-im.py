# -*- coding: utf-8 -*-
"""Bỏ bớt phần khẳng định quá tay trong nhãn `cum-im`.

Đo thật lần đầu nhãn này nổ trên xưởng (28/08, 10:29–10:36Z = 17:29–17:36 VN): **9 máy im rải
trong 7 PHÚT**, không cùng lúc. Cúp điện thì 13 máy tắt cùng một giây. Rải bảy phút giống thợ tắt
máy lần lượt rồi về hơn. Đường đo KHÔNG phân biệt được hai chuyện đó, nên nhãn không được chọn
sẵn một chuyện.

Giữ nguyên mức 1 (cả xưởng im vẫn là thứ phải có người biết) và giữ nguyên mã 9. Chỉ sửa CÂU CHỮ.
"""
import io, json, os, sys

VA_PY = [(
  "        t = ('Cả %d máy cùng im một lúc — mất điện, đứt mạng, hoặc chính bộ ghi hỏng. '\n"
  "             'Chưa quy được cho máy nào.' % (dan.get('tong') if dan else 0))",
  "        # KHÔNG chọn sẵn một nguyên nhân. Đo lần đầu nhãn này nổ thật (28/08, 17:29–17:36 VN):\n"
  "        # 9 máy im rải trong BẢY PHÚT. Cúp điện thì 13 máy tắt cùng một giây; rải bảy phút\n"
  "        # giống thợ tắt máy lần lượt rồi về hơn. Đường đo không tách được hai cái, nên câu\n"
  "        # này chỉ được nói đúng cái nó biết: cả xưởng đang im.\n"
  "        t = ('Cả %d máy cùng im — mất điện, đứt mạng, hết ca cùng tắt máy, hoặc chính bộ ghi '\n"
  "             'hỏng. Chưa quy được cho máy nào.' % (dan.get('tong') if dan else 0))",
)]

NHAN_MOI = 'Cả xưởng cùng im — chưa biết vì đâu (điện, mạng, hết ca, hay bộ ghi)'
NHAN_CU  = 'Cả xưởng cùng im — mất điện hoặc đứt mạng'

for p, cap in [('/Users/phong/dahao-gateway/quan-sat/dong-bo-tinh-trang.py', VA_PY),
               ('/Users/phong/dashboarddahao/quan-sat/dong-bo-tinh-trang.py', VA_PY)]:
    s = io.open(p, encoding='utf-8').read()
    n = 0
    for cu, moi in cap:
        if s.count(cu) == 1:
            s = s.replace(cu, moi); n += 1
    if n: io.open(p, 'w', encoding='utf-8').write(s)
    print('%s: %d cho' % (p, n))

# `them-ma-phan-biet.py` là chỗ SINH ra nhãn — sửa cả đấy, không thì chạy lại nó là dán nhãn cũ về.
for p in ['/Users/phong/dahao-gateway/quan-sat/them-ma-phan-biet.py',
          '/Users/phong/dashboarddahao/quan-sat/them-ma-phan-biet.py']:
    s = io.open(p, encoding='utf-8').read()
    if NHAN_CU in s:
        io.open(p, 'w', encoding='utf-8').write(s.replace(NHAN_CU, NHAN_MOI))
        print('%s: doi nhan' % p)

for p in ['/Users/phong/dahao-gateway/quan-sat/grafana/dashboards/dahao-tinh-trang.json',
          '/Users/phong/dashboarddahao/quan-sat/grafana/dashboards/dahao-tinh-trang.json']:
    d = json.load(io.open(p, encoding='utf-8'))
    doi = 0
    def di(x):
        global doi
        if isinstance(x, dict):
            for k, v in x.items():
                if k == 'text' and v == NHAN_CU:
                    x[k] = NHAN_MOI; doi += 1
                else: di(v)
        elif isinstance(x, list):
            for v in x: di(v)
    di(d)
    if doi:
        io.open(p, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
    print('%s: %d nhan' % (os.path.basename(p), doi))
