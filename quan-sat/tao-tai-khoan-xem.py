#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tạo tài khoản Grafana chỉ-xem cho xưởng.

Quy tắc của dự án: **mật khẩu sinh trên Mini, ghi thẳng vào file chmod 600, không bao giờ in ra
màn hình / không bao giờ lọt vào bản ghi hội thoại.** Script này chỉ in tên đăng nhập, vai trò,
và đường dẫn file.

Đi thẳng cổng 3000 trong tailnet chứ không qua tên miền công khai — vừa khỏi vướng Cloudflare chặn
User-Agent Python, vừa không đẩy mật khẩu admin ra đường công khai.
"""
import base64
import io
import json
import os
import secrets
import string
import sys
import urllib.error
import urllib.request

# Grafana chi lang nghe tren dia chi tailnet (grafana.ini `http_addr`), KHONG mo 127.0.0.1.
GOC = 'http://100.107.219.95:3000'
NHA = os.path.expanduser('~/dahao-gateway/quan-sat')
F_ADMIN = os.path.join(NHA, 'grafana-admin.env')
F_XEM = os.path.join(NHA, 'grafana-viewer.env')

DANG_NHAP = 'xem'
TEN_HIEN = 'Người xem xưởng'
THU = 'xem@dahao.local'
BANG_NHA = 'dahao-xem-nhanh'


def doc_env(duong):
    kq = {}
    for d in io.open(duong, encoding='utf-8'):
        d = d.strip()
        if not d or d.startswith('#') or '=' not in d:
            continue
        k, v = d.split('=', 1)
        kq[k.strip()] = v.strip().strip('"').strip("'")
    return kq


def goi(duong, u, m, cach='GET', than=None):
    req = urllib.request.Request(GOC + duong, method=cach)
    req.add_header('User-Agent', 'dahao-quan-sat/1.0')
    req.add_header('Authorization', 'Basic ' + base64.b64encode(
        ('%s:%s' % (u, m)).encode('utf-8')).decode('ascii'))
    if than is not None:
        req.add_header('Content-Type', 'application/json')
        than = json.dumps(than).encode('utf-8')
    try:
        with urllib.request.urlopen(req, than, timeout=15) as r:
            return r.status, json.loads(r.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as e:
        noi = e.read().decode('utf-8', 'replace')
        try:
            return e.code, json.loads(noi or '{}')
        except ValueError:
            return e.code, {'message': noi[:200]}


def mat_khau_moi():
    # Bỏ ký tự dễ nhìn nhầm (0/O, 1/l/I) vì thợ sẽ phải gõ tay trên điện thoại.
    bang = ''.join(c for c in string.ascii_letters + string.digits if c not in '0O1lI')
    return '-'.join(''.join(secrets.choice(bang) for _ in range(5)) for _ in range(4))


def main():
    ad = doc_env(F_ADMIN)
    au, am = ad['GF_SECURITY_ADMIN_USER'], ad['GF_SECURITY_ADMIN_PASSWORD']

    ma, thong = goi('/api/health', au, am)
    if ma != 200:
        raise SystemExit('grafana khong tra loi: %s' % ma)

    ma, cu = goi('/api/users/lookup?loginOrEmail=' + DANG_NHAP, au, am)
    if ma == 200 and cu.get('id'):
        uid = cu['id']
        moi = False
        print('tai khoan "%s" da co san (id=%s) — chi dat lai mat khau + vai tro' % (DANG_NHAP, uid))
    else:
        moi = True
        uid = None

    mk = mat_khau_moi()

    if moi:
        ma, kq = goi('/api/admin/users', au, am, 'POST',
                     {'name': TEN_HIEN, 'email': THU, 'login': DANG_NHAP, 'password': mk})
        if ma != 200:
            raise SystemExit('tao that bai (%s): %s' % (ma, kq.get('message')))
        uid = kq['id']
        print('da tao tai khoan id=%s' % uid)
    else:
        ma, kq = goi('/api/admin/users/%s/password' % uid, au, am, 'PUT', {'password': mk})
        if ma != 200:
            raise SystemExit('doi mat khau that bai (%s): %s' % (ma, kq.get('message')))

    # Chốt chặn: ép vai trò Viewer, đừng tin mặc định `auto_assign_org_role` của cấu hình.
    ma, kq = goi('/api/orgs/1/users/%s' % uid, au, am, 'PATCH', {'role': 'Viewer'})
    print('dat vai tro Viewer: %s %s' % (ma, kq.get('message', '')))

    # Không cho sửa gì thêm: bảo đảm KHÔNG phải admin toàn cục.
    goi('/api/admin/users/%s/permissions' % uid, au, am, 'PUT', {'isGrafanaAdmin': False})

    # Vào là thấy ngay bảng gọn, khỏi phải mò menu.
    ma, kq = goi('/api/user/preferences', DANG_NHAP, mk, 'PUT',
                 {'theme': '', 'timezone': 'browser', 'homeDashboardUID': BANG_NHA})
    print('dat bang chu: %s %s' % (ma, kq.get('message', '')))

    noi = (u'# Tai khoan Grafana CHI XEM cho xuong — sinh tu dong, khong in ra man hinh.\n'
           u'# Vai tro: Viewer (khong sua duoc bang, khong xem duoc file cau hinh).\n'
           u'# Vao bang: https://grafana.phonh.io.vn  (hoac http://100.107.219.95:3000 trong tailnet)\n'
           u'GRAFANA_VIEWER_USER=%s\n'
           u'GRAFANA_VIEWER_PASSWORD=%s\n' % (DANG_NHAP, mk))
    with io.open(F_XEM, 'w', encoding='utf-8') as f:
        f.write(noi)
    os.chmod(F_XEM, 0o600)

    ma, ds = goi('/api/orgs/1/users', au, am)
    print('--- nguoi dung trong to chuc:')
    for u in ds:
        print('   %-10s %-8s %s' % (u.get('login'), u.get('role'), u.get('email')))
    print('--- mat khau da ghi vao: %s (chmod 600)' % F_XEM)


if __name__ == '__main__':
    main()
