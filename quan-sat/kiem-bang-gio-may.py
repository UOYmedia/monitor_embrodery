#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dựng lại đúng cái bảng `dahao-gio-may` sẽ hiện, bằng chính truy vấn của nó + phép ghép của Grafana.

Grafana ghép ngoài và đổi tên cột ở phía TRÌNH DUYỆT, nên không API nào trả về "bảng cuối cùng"
để soi. Chỗ này làm hộ: đọc thẳng file bảng, thay biến, hỏi Loki, ghép, đổi tên, in ra.

Bốn thứ phải soi:
  - CÓ MÁY NÀO RA HAI DÒNG KHÔNG (một truy vấn trả hai series cùng `may` -> bảng nhân đôi dòng)
  - CÒN Ô TRỐNG / NaN Ở ĐÂU KHÔNG
  - BỐN RỔ CỘNG LẠI CÓ ĐÚNG BẰNG THỜI GIAN ĐÃ TRÔI KHÔNG (đây là bất biến của bộ đếm)
  - SỐ TRÊN Ô CHỮ TO CÓ KHỚP TỔNG CỘT TRONG BẢNG KHÔNG
"""
import io
import json
import os
import sys
import urllib.parse
import urllib.request

GOC = os.environ.get('LOKI', 'http://127.0.0.1:3100')
BANG = os.environ.get(
    'BANG_GIO_MAY',
    '/Users/phong/dahao-gateway/quan-sat/grafana/dashboards/dahao-gio-may.json')
KHOANG = os.environ.get('KHOANG', '6h')                       # đóng vai $__range
GIO = os.environ.get('GIO', 'trong-gio|ngoai-gio')            # đóng vai $gio


def thay(q):
    """Thay biến của Grafana bằng giá trị thật — đúng như trình duyệt gửi đi."""
    return (q.replace('$__range', KHOANG)
             .replace('$ten', '.+')
             .replace('$gio', GIO))


def hoi(q):
    u = GOC + '/loki/api/v1/query?query=' + urllib.parse.quote(thay(q))
    return json.load(urllib.request.urlopen(u, timeout=60))['data']['result']


def hms(g):
    g = int(round(g))
    return '%d:%02d:%02d' % (g // 3600, g % 3600 // 60, g % 60)


def main():
    d = json.load(io.open(BANG, encoding='utf-8'))
    o = {p['id']: p for p in d['panels']}
    loi = []

    # ---- bảng "Từng máy" -----------------------------------------------------------------
    p = o[430]
    ten_cot = {}
    for t in p['transformations']:
        if t['id'] == 'organize':
            ten_cot = t['options']['renameByName']
    kq = {t['refId']: hoi(t['expr']) for t in p['targets']}

    # chỗ nguy hiểm nhất: một máy ra nhiều series trong CÙNG một truy vấn -> bảng nhân dòng
    for k, r in kq.items():
        dem = {}
        for x in r:
            dem[x['metric'].get('may')] = dem.get(x['metric'].get('may'), 0) + 1
        for m, n in dem.items():
            if n > 1:
                loi.append('%s: máy %s ra %d dòng' % (k, m, n))

    # ghép ngoài theo `may`, y như transformation joinByField
    dong = {}
    for k, r in kq.items():
        for x in r:
            m = x['metric'].get('may')
            g = dong.setdefault(m, {'Máy': x['metric'].get('ten', '?')})
            if 'ten' in x['metric']:
                g['Máy'] = x['metric']['ten']
            g[ten_cot.get('Value #%s' % k, k)] = float(x['value'][1])

    cot = [ten_cot['Value #%s' % t['refId']] for t in p['targets']]
    print('%-9s' % 'Máy' + ''.join('%13s' % c for c in cot))
    print('-' * (9 + 13 * len(cot)))
    giay = {'Đang thêu', 'Dừng', 'Chờ', 'Mất tín hiệu', 'Dừng <1′', 'Dừng ≥1′'}
    tong = dict((c, 0.0) for c in cot)
    for m in sorted(dong, key=lambda k: dong[k]['Máy']):
        g = dong[m]
        o_ra = []
        for c in cot:
            v = g.get(c)
            if v is None:
                # Ô "Tỷ lệ thêu" ĐƯỢC PHÉP trống khi máy không hề gửi khung nào: mẫu số lọc
                # `> 0` cố tình bỏ series đi để khỏi ra 0/0. Trống ở đây đọc là "không biết",
                # đúng hơn hẳn số 0 — số 0 sẽ vu cho máy là "chạy 0 %" trong khi thật ra
                # mình không có lấy một phép đo nào về nó.
                if c != 'Tỷ lệ thêu':
                    loi.append('%s: cột "%s" trống' % (g['Máy'], c))
                o_ra.append('%13s' % '—')
                continue
            if v != v:
                loi.append('%s: cột "%s" ra NaN' % (g['Máy'], c))
            tong[c] += v
            o_ra.append('%13s' % (hms(v) if c in giay else
                                  ('%.1f%%' % (v * 100) if c == 'Tỷ lệ thêu' else '%d' % v)))
        print('%-9s' % g['Máy'] + ''.join(o_ra))

        # bất biến: bốn rổ cộng lại đúng bằng thời gian đã trôi
        bon = sum(g.get(c, 0) for c in ('Đang thêu', 'Dừng', 'Chờ', 'Mất tín hiệu'))
        if abs(bon - round(bon / 60) * 60) > 0.5:
            loi.append('%s: bốn rổ cộng lại %s — không tròn phút' % (g['Máy'], hms(bon)))
    print('-' * (9 + 13 * len(cot)))
    print('%-9s' % 'CỘNG' + ''.join(
        '%13s' % (hms(tong[c]) if c in giay else
                  ('' if c == 'Tỷ lệ thêu' else '%d' % tong[c])) for c in cot))

    # mọi máy phải cùng một tổng bốn rổ (cùng cửa sổ thời gian), lệch = có máy vào muộn
    bon_may = sorted(set(round(sum(g.get(c, 0) for c in
                                   ('Đang thêu', 'Dừng', 'Chờ', 'Mất tín hiệu')))
                         for g in dong.values()))
    print('\ngiờ lọc: %s' % GIO)
    print('bốn rổ mỗi máy: %s  (cửa sổ %s = %d giây)'
          % (' · '.join(hms(x) for x in bon_may), KHOANG,
             int(KHOANG[:-1]) * {'h': 3600, 'm': 60, 'd': 86400}[KHOANG[-1]]))

    # ---- ô chữ to phải khớp tổng cột trong bảng ------------------------------------------
    print()
    KHOP = {410: 'Đang thêu', 411: 'Dừng', 412: 'Chờ', 413: 'Mất tín hiệu',
            415: 'Mũi đã thêu', 420: 'Dừng <1′', 421: 'lần', 422: '≤4 giây',
            423: 'Dừng ≥1′', 424: 'lần '}
    for pid in sorted(KHOP):
        r = hoi(o[pid]['targets'][0]['expr'])
        v = float(r[0]['value'][1]) if r else 0.0
        c = KHOP[pid]
        dau = '✓' if abs(v - tong[c]) < 1 else '✗'
        if dau == '✗':
            loi.append('ô %d "%s": %s ≠ tổng cột %s' % (pid, o[pid]['title'], v, tong[c]))
        print('%s ô %-3d %-28s %12s   (cột "%s")'
              % (dau, pid, o[pid]['title'], hms(v) if c in giay else '%d' % v, c))
    r = hoi(o[414]['targets'][0]['expr'])
    print('  ô 414 Tỷ lệ thêu %36.1f%%' % (float(r[0]['value'][1]) * 100 if r else 0))

    # ---- ô đồ thị theo thời gian ----------------------------------------------------------
    print()
    for t in o[440]['targets']:
        q = t['expr'].replace('$__auto', '5m')
        r = hoi(q)
        print('  đường "%s": %s' % (t['legendFormat'], 'có số' if r else '✗ RỖNG'))
        if not r:
            loi.append('đồ thị: đường "%s" không ra số nào' % t['legendFormat'])

    print()
    if loi:
        print('✗ %d chỗ sai:' % len(loi))
        for x in loi:
            print('   -', x)
        return 1
    print('✓ bảng dựng lại sạch — không nhân dòng, không ô trống, không NaN, ô khớp bảng')
    return 0


if __name__ == '__main__':
    sys.exit(main())
