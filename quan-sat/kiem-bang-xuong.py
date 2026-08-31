#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Kiểm ba bảng mới bằng dữ liệu THẬT, không tin file JSON.

Ba việc, theo đúng thứ tự nghiêm ngặt dần:
  1. Tự dựng lại tình trạng đội máy từ Loki (nguồn sự thật), độc lập với Grafana.
  2. Chạy TỪNG target của TỪNG ô vào Loki, xem nó trả về đúng những máy nào.
  3. Bắt lỗi "rò rỉ outer-join": `joinByField` ghép kiểu union, nên chỉ cần MỘT target
     quên chặn là máy lạ vẫn hiện thành hàng trong bảng. Đây là kiểu hỏng IM LẶNG —
     bảng vẫn vẽ đẹp, chỉ sai nội dung — nên phải soi từng target chứ không soi bảng.
  4. Hỏi lại Grafana xem bảng đã nạp thật chưa (`allowUiUpdates: true` khiến provisioner
     có thể ÂM THẦM bỏ qua file, không log, không báo lỗi).
"""
import base64
import io
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

LOKI = 'http://127.0.0.1:3100'
GRAFANA = 'http://100.107.219.95:3000'
NHA = os.path.expanduser('~/dahao-gateway/quan-sat')
BANG = os.path.join(NHA, 'grafana/dashboards')

MA_TT = {0: 'lỗi', 1: 'dừng', 2: 'mất tín hiệu', 3: 'chưa rõ',
         4: 'hoàn thành', 5: 'chờ việc', 6: 'đang thêu', 7: 'tắt hẳn'}
NHOM_MONG = {
    '🟠': [1], '🔴': [0, 2, 7], '⚪': [3, 4, 5], '🟢': [6],
}


def doc_env(duong):
    kq = {}
    for d in io.open(duong, encoding='utf-8'):
        d = d.strip()
        if d and not d.startswith('#') and '=' in d:
            k, v = d.split('=', 1)
            kq[k.strip()] = v.strip().strip('"').strip("'")
    return kq


def hoi_loki(q, khoang=None):
    """`khoang` != None ⇒ hỏi kiểu range. Ô log và ô đồ thị KHÔNG chạy được kiểu instant
    (Loki trả 400 "log queries are not supported as an instant query type") — hỏi nhầm kiểu
    là ra lỗi giả, tưởng bảng hỏng."""
    if khoang:
        u = LOKI + '/loki/api/v1/query_range?' + urllib.parse.urlencode(
            {'query': q, 'since': khoang, 'limit': 500, 'step': '60s'})
    else:
        u = LOKI + '/loki/api/v1/query?' + urllib.parse.urlencode({'query': q})
    req = urllib.request.Request(u)
    req.add_header('User-Agent', 'dahao-quan-sat/1.0')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode('utf-8')), None
    except urllib.error.HTTPError as e:
        return None, '%s %s' % (e.code, e.read().decode('utf-8', 'replace')[:200])
    except Exception as e:
        return None, str(e)


def hoi_grafana(duong):
    ad = doc_env(os.path.join(NHA, 'grafana-admin.env'))
    req = urllib.request.Request(GRAFANA + duong)
    req.add_header('User-Agent', 'dahao-quan-sat/1.0')
    req.add_header('Authorization', 'Basic ' + base64.b64encode(
        ('%s:%s' % (ad['GF_SECURITY_ADMIN_USER'],
                    ad['GF_SECURITY_ADMIN_PASSWORD'])).encode('utf-8')).decode('ascii'))
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return e.code, {}


def thay_bien(q, khoang):
    q = q.replace('$may', '.+')
    q = q.replace('$__range', khoang).replace('$__interval', '1m')
    q = re.sub(r'\$\{?__[a-zA-Z_]+\}?', '1m', q)
    return q


def may_cua(kq):
    """Rút tập mã máy từ kết quả Loki; ô đếm không có nhãn `may` thì trả None."""
    d = (kq or {}).get('data', {}).get('result') or []
    ten = set()
    co_nhan = False
    for r in d:
        m = (r.get('metric') or {}).get('may')
        if m:
            co_nhan = True
            ten.add(m)
    return (ten if co_nhan else None), len(d)


def dau_van(ps):
    """Dấu vân tay của một danh sách ô: đủ để biết Grafana đang phục vụ đúng cái file mô tả."""
    return set((p['id'], p['type'], p.get('title', ''),
                tuple(sorted((t.get('expr') or '') for t in p.get('targets', []))))
               for p in ps)


def su_that():
    """Tình trạng mới nhất của từng máy — dựng thẳng từ Loki, không qua Grafana."""
    kq, loi = hoi_loki('last_over_time({job="tinh-trang"} | json | unwrap ma [5m]) by (may)')
    if loi:
        raise SystemExit('loki khong tra loi: %s' % loi)
    ra = {}
    for r in kq['data']['result']:
        ra[r['metric']['may']] = int(float(r['value'][1]))
    kq2, _ = hoi_loki('last_over_time({job="tinh-trang"} | json | unwrap giay [5m]) by (may, ten)')
    ten = {r['metric']['may']: r['metric'].get('ten', '') for r in (kq2 or {}).get('data', {}).get('result', [])}
    return ra, ten


def main():
    that, ten = su_that()
    print('=== SU THAT TU LOKI: %d may ===' % len(that))
    dem = {}
    for m, v in sorted(that.items(), key=lambda x: (x[1], x[0])):
        dem[v] = dem.get(v, 0) + 1
        print('   %-14s ma=%s  %-14s %s' % (m, v, MA_TT.get(v, '?'), ten.get(m, '')))
    print('   --- dem theo ma: %s' % {MA_TT.get(k, k): v for k, v in sorted(dem.items())})

    tong_loi = 0
    for tep, khoang in [('dahao-can-xu-ly.json', '1h'),
                        ('dahao-dut-chi.json', '24h'),
                        ('dahao-mot-may.json', '12h')]:
        d = json.load(io.open(os.path.join(BANG, tep), encoding='utf-8'))
        print('\n=== %s (%s) v%s ===' % (d['uid'], d['title'], d['version']))
        # Panel nằm trong hàng gấp lại (`collapsed: true`) KHÔNG ở tầng ngoài — quên trải phẳng
        # là bỏ sót nửa số ô mà bộ kiểm vẫn báo xanh.
        phang = []
        for p in d['panels']:
            phang.append(p)
            phang.extend(p.get('panels', []))
        for p in sorted(phang, key=lambda x: (x['gridPos']['y'], x['gridPos']['x'])):
            nhom = next((k for k in NHOM_MONG if k in p['title']), None)
            mong = set(m for m, v in that.items() if v in NHOM_MONG[nhom]) if nhom else None
            # Ô log / đồ thị vẽ theo trục thời gian ⇒ phải hỏi kiểu range mới đúng cách Grafana gọi.
            kieu_range = khoang if p['type'] in ('logs', 'timeseries', 'state-timeline') else None
            dong = []
            for t in p.get('targets', []):
                q = thay_bien(t['expr'], khoang)
                kq, loi = hoi_loki(q, kieu_range)
                if loi:
                    tong_loi += 1
                    dong.append('%s=LOI(%s)' % (t['refId'], loi[:60]))
                    continue
                loai = kq['data'].get('resultType')
                if loai in ('streams', 'matrix'):
                    diem = sum(len(r.get('values') or []) for r in kq['data']['result'])
                    if diem == 0:
                        tong_loi += 1
                    dong.append('%s=%d %s/%d loat %s' % (
                        t['refId'], diem, 'dong' if loai == 'streams' else 'diem',
                        len(kq['data']['result']), '' if diem else '⚠RONG'))
                    continue
                tap, so = may_cua(kq)
                if tap is None:
                    gt = kq['data']['result'][0]['value'][1] if kq['data']['result'] else 'rong'
                    dong.append('%s=%s' % (t['refId'], gt))
                    continue
                du = tap - mong if mong is not None else set()
                if du:
                    tong_loi += 1
                    dong.append('%s=%d ⚠RO_RI:%s' % (t['refId'], len(tap), ','.join(sorted(du))))
                else:
                    dong.append('%s=%d' % (t['refId'], len(tap)))
            print('   id=%-4s %-14s %s' % (p['id'], p['type'], p['title'][:52]))
            print('        %s' % '  '.join(dong))
            if mong is not None:
                print('        mong doi %d may: %s' % (len(mong), ','.join(sorted(mong)) or '(khong co)'))

        ma, thong = hoi_grafana('/api/dashboards/uid/' + d['uid'])
        if ma != 200:
            tong_loi += 1
            print('   ⚠ GRAFANA CHUA NAP: %s' % ma)
        else:
            # So NỘI DUNG, đừng so số hiệu `version`: Grafana không tăng version khi nội dung y
            # hệt, nên "DB v1 vs file v2" có thể vẫn là khớp. Cái cần bắt là bảng THẬT khác file
            # (dấu hiệu `allowUiUpdates` đã lặng lẽ bỏ qua file).
            g = thong['dashboard']
            gp = []
            for x in g['panels']:
                gp.append(x)
                gp.extend(x.get('panels', []))
            khop = dau_van(gp) == dau_van(phang)
            print('   grafana: ver=%s (file v%s)  %d o (file %d o)  %s'
                  % (g['version'], d['version'], len(gp), len(phang),
                     'khop file' if khop else '⚠ LECH NOI DUNG — provisioner da BO QUA file'))
            if not khop:
                a, b = dau_van(gp), dau_van(phang)
                for k in sorted(set(a) ^ set(b))[:6]:
                    print('        %s %s' % ('grafana-co' if k in a else 'file-co', str(k)[:110]))
            if not khop:
                tong_loi += 1

    print('\n=== TONG: %s ===' % ('%d cho SAI' % tong_loi if tong_loi else 'khong loi'))
    return 1 if tong_loi else 0


if __name__ == '__main__':
    sys.exit(main())
