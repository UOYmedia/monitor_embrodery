#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Thử thật tài khoản `xem`: đọc được bảng, và KHÔNG sửa được gì.

Không đủ nếu chỉ thấy API trả 200 lúc tạo — phải đăng nhập bằng chính mật khẩu vừa sinh, qua
CẢ đường công khai (Cloudflare) lẫn đường tailnet, rồi thử một thao tác ghi để chắc nó bị chặn.
"""
import base64
import io
import json
import os
import urllib.error
import urllib.request

NHA = os.path.expanduser('~/dahao-gateway/quan-sat')


def doc_env(duong):
    kq = {}
    for d in io.open(duong, encoding='utf-8'):
        d = d.strip()
        if d and not d.startswith('#') and '=' in d:
            k, v = d.split('=', 1)
            kq[k.strip()] = v.strip().strip('"').strip("'")
    return kq


def goi(goc, duong, u, m, cach='GET', than=None):
    req = urllib.request.Request(goc + duong, method=cach)
    req.add_header('User-Agent', 'dahao-quan-sat/1.0')
    req.add_header('Authorization', 'Basic ' + base64.b64encode(
        ('%s:%s' % (u, m)).encode('utf-8')).decode('ascii'))
    if than is not None:
        req.add_header('Content-Type', 'application/json')
        than = json.dumps(than).encode('utf-8')
    try:
        with urllib.request.urlopen(req, than, timeout=20) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except Exception as e:
        return 0, str(e)


def main():
    v = doc_env(os.path.join(NHA, 'grafana-viewer.env'))
    u, m = v['GRAFANA_VIEWER_USER'], v['GRAFANA_VIEWER_PASSWORD']

    for ten, goc in [('tailnet ', 'http://100.107.219.95:3000'),
                     ('cong khai', 'https://grafana.phonh.io.vn')]:
        ma, than = goi(goc, '/api/user', u, m)
        vai = ''
        if ma == 200:
            d = json.loads(than)
            vai = 'login=%s isGrafanaAdmin=%s' % (d.get('login'), d.get('isGrafanaAdmin'))
        print('%s  dang nhap: %-3s  %s' % (ten, ma, vai))

        ma, than = goi(goc, '/api/dashboards/uid/dahao-xem-nhanh', u, m)
        so_o = len(json.loads(than)['dashboard']['panels']) if ma == 200 else '-'
        print('%s  doc bang xem-nhanh: %-3s (%s o)' % (ten, ma, so_o))

    goc = 'http://100.107.219.95:3000'
    ma, than = goi(goc, '/api/user/preferences', u, m)
    print('bang chu cua tai khoan: %s %s' % (ma, than[:120]))

    # Thao tac GHI phai bi chan. Gui bang rong co uid da ton tai — neu 403 thi dung nhu mong doi.
    ma, than = goi(goc, '/api/dashboards/db', u, m, 'POST',
                   {'dashboard': {'uid': 'dahao-xem-nhanh', 'title': 'thu-ghi', 'panels': []},
                    'overwrite': True})
    print('THU GHI DE BANG: %s -> %s' % (ma, 'BI CHAN, dung' if ma in (403, 401)
                                         else '!!! GHI DUOC, SAI ROI: ' + than[:200]))

    ma, than = goi(goc, '/api/admin/users', u, m)
    print('THU GOI API ADMIN: %s -> %s' % (ma, 'BI CHAN, dung' if ma in (403, 401)
                                           else '!!! VAO DUOC, SAI ROI'))


if __name__ == '__main__':
    main()
