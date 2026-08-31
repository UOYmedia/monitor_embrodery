#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dựng lại đúng cái bảng ô 7 sẽ hiện, bằng chính 7 truy vấn ấy + phép ghép ngoài của Grafana.

Grafana ghép và ánh xạ ở phía trình duyệt nên không API nào trả về "bảng cuối cùng" để mà xem.
Chỗ này làm hộ: chạy y hệt 7 truy vấn, ghép ngoài theo `may`, ánh xạ số sang chữ, rồi in ra.

Hai thứ phải soi:
  - CÓ MÁY NÀO RA HAI DÒNG KHÔNG (nhãn `mau`/`ten` đổi giữa cửa sổ -> bảng nhân đôi dòng)
  - CÒN CHỮ NaN Ở ĐÂU KHÔNG
"""
import json
import urllib.parse
import urllib.request

GOC = 'http://127.0.0.1:3100'
TT = '{job="tinh-trang", may=~".+"}'
VM = '{job="va-mau", may=~".+", viec=~"mo|dang"}'

Q = {
    'A': 'last_over_time(%s | json | unwrap mui [3m]) by (may)' % TT,
    'B': 'last_over_time(%s | json | unwrap tong [3m]) by (may)' % TT,
    'C': 'last_over_time(%s | json | unwrap ma [3m]) by (may)' % TT,
    'D': 'sum by (may, ten, mau) (count_over_time(%s [45s]))' % TT,
    'E': 'last_over_time(%s | json | unwrap giay [3m]) by (may)' % TT,
    'F': '(last_over_time(%s | json | unwrap mui [3m]) by (may)) / '
         '(last_over_time(%s | json | unwrap tong [3m]) by (may) > 0)' % (TT, TT),
    'G': '(last_over_time(%s | unwrap ma_nghi [1m]) by (may)) and on (may) '
         '(last_over_time(%s | json | unwrap ma [3m]) by (may) <= 1)' % (VM, TT),
}

# Bản chép tay THỨ TƯ của bảng mã — 27/08 đã lệch một lần (thiếu mã 7, mã 2 còn ghi
# "máy tắt" trong khi 185/185 lượt đo được là MẤT TÍN HIỆU chứ máy vẫn đang bật). Bộ kiểm
# mới `kiem-bang-bao-loi.py` đọc thẳng `mappings` từ file bảng nên không lệch được; ở đây
# vẫn chép tay vì script này hỏi Loki trực tiếp, không đi qua Grafana.
TINH_TRANG = {0: 'đang lỗi', 1: 'đang dừng', 2: 'mất tín hiệu',
              3: 'chưa rõ', 4: 'đã hoàn thành', 5: 'chờ việc',
              6: 'đang thêu', 7: 'máy tắt hẳn'}
VI_SAO = {0: 'nghi đứt chỉ — đang vá', 1: 'dừng hẳn, chưa chạy lại',
          2: 'dừng lâu, không lùi mũi', 3: 'dừng thoáng', 4: 'đổi mẫu',
          5: 'mất tin', 6: 'làm tấm mới'}


def hoi(q):
    u = GOC + '/loki/api/v1/query?query=' + urllib.parse.quote(q)
    return json.load(urllib.request.urlopen(u, timeout=20))['data']['result']


kq = {k: hoi(v) for k, v in Q.items()}

# --- chỗ nguy hiểm nhất: một máy ra nhiều series trong CÙNG một truy vấn -> bảng nhân dòng
loi = []
for k, r in kq.items():
    dem = {}
    for x in r:
        m = x['metric'].get('may')
        dem[m] = dem.get(m, 0) + 1
    for m, n in dem.items():
        if n > 1:
            loi.append('%s: may %s ra %d dong' % (k, m, n))
print('KIEM NHAN DOI DONG:', 'SACH' if not loi else 'CO VAN DE -> ' + '; '.join(loi))

bang = {}
for k, r in kq.items():
    for x in r:
        may = x['metric'].get('may')
        o = bang.setdefault(may, {})
        o[k] = x['value'][1]
        if k == 'D':
            o['ten'] = x['metric'].get('ten', '')
            o['mau'] = x['metric'].get('mau', '')


def so(v, lam=lambda x: '%d' % x):
    if v is None:
        return '—'
    f = float(v)
    if f != f:                       # NaN
        return '*** NaN ***'
    return lam(f)


print()
hd = ('Máy', 'Mã máy', 'Tình trạng', 'Vì sao dừng', 'Bao lâu', 'Mẫu', 'Mũi', 'Tổng', 'Xong')
dong = []
for may, o in bang.items():
    dong.append((
        o.get('ten', '—') or '—',
        may,
        TINH_TRANG.get(int(float(o['C'])), '?') if 'C' in o else '—',
        VI_SAO.get(int(float(o['G'])), '?') if 'G' in o else '—',
        so(o.get('E'), lambda x: '%.0fs' % x),
        (o.get('mau') or '—')[:24],
        so(o.get('A')), so(o.get('B')),
        so(o.get('F'), lambda x: '%.0f%%' % (x * 100)),
    ))
dong.sort(key=lambda r: list(TINH_TRANG.values()).index(r[2]) if r[2] in
          TINH_TRANG.values() else 99)

w = [max(len(str(r[i])) for r in [hd] + dong) for i in range(len(hd))]
print(' | '.join(str(hd[i]).ljust(w[i]) for i in range(len(hd))))
print('-+-'.join('-' * x for x in w))
for r in dong:
    print(' | '.join(str(r[i]).ljust(w[i]) for i in range(len(hd))))

print()
con = [r for r in dong if any('NaN' in str(c) for c in r)]
print('KIEM NaN:', 'SACH — khong con o nao' if not con else 'CON %d dong NaN' % len(con))
print('So dong bang:', len(dong))
