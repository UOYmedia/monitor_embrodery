#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bắt hai bản chép tay của `tinhTrang()` chấm cùng một đề, rồi so từng ca.

VÌ SAO CẦN

Luật "máy im rồi thì vì sao nó im" được viết **hai lần**: một bản Python trong
`quan-sat/dong-bo-tinh-trang.py` (đẩy số cho Grafana) và một bản JavaScript trong
`xem/index.html` (màn hình cả xưởng nhìn). Không có gì bắt chúng giống nhau ngoài một lời dặn
trong header — và lời dặn ấy **đã từng bị bỏ qua**: bản `xem/` đứng im suốt 4 mã liền
(`tat-han`, `ngoai-gio`, `cum-im`, `tat-may`), tức là hai màn hình nói hai chuyện khác nhau về
cùng một cái máy trong nhiều ngày mà không ai biết.

CÁCH LÀM

Sinh ma trận ca phủ `kn` × số mũi × trạng thái thô × giờ × bối cảnh cả đàn, chấm bằng cả hai bản,
so từng ca. Bản JS chạy được là nhờ cắt đoạn `<script>` ra rồi chèn một dòng xuất hàm ngay TRƯỚC
mấy dòng gắn sự kiện DOM ở cuối — cả script nằm trong một IIFE nên không gọi thẳng từ ngoài được.
Lưu ý: đây là chấm trên **chính file đang phục vụ**, không phải trên bản chép lại.

    python3 -B doi-chieu-hai-ban.py [đường-dẫn-index.html]

Ra 0 nếu khớp hết. Ra 1 và in vài ca lệch nếu không.
"""
import collections
import importlib.util
import itertools
import json
import os
import subprocess
import sys
import tempfile

NHA = os.path.dirname(os.path.abspath(__file__))
PY_BAN = os.path.join(NHA, 'dong-bo-tinh-trang.py')
# Tìm theo thứ tự: bản trong repo (cạnh chính mình) → bản đang phục vụ trên Mini. Bên nhận gói
# không có `~/dahao-gateway`, ghim cứng đường ấy là bài thử chết ngay câu đầu.
_GAN = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    '..', 'deploy-mini', 'xem', 'index.html')
JS_BAN = (os.path.normpath(_GAN) if os.path.exists(_GAN)
          else os.path.expanduser('~/dahao-gateway/xem/index.html'))
NODE = os.path.expanduser('~/node/bin/node')

KN = ['online', 'stale', 'offline', 'unknown', 'connecting']
SO = [(None, None), (0, 1000), (500, 1000), (1000, 1000), (1200, 1000), (500, 0), (0, 0)]
TT = ['running', 'stopped', 'paused', 'unknown', 'fault']
GIO = [3, 6, 12, 18, 19, 23]
DAN = ['tat-ca-im', 'co-may-noi', 'mot-minh']


def may(mid, kn, cur, tot, tt, loi=False, nang=False):
    m = {'identity': {'id': mid, 'name': mid},
         'connection': {'state': kn, 'lastTelemetryAt': '2026-08-28T05:00:00Z'},
         'telemetryError': {'code': 'x'} if loi else None,
         'derivedAlerts': [{'severity': 'critical', 'id': 'z'}] if nang else [],
         'alerts': []}
    tel = {'observedAt': '2026-08-28T05:00:00Z', 'status': {'value': tt}}
    if cur is not None or tot is not None:
        tel['job'] = {'value': {'currentStitch': cur, 'totalStitches': tot, 'fileName': 'A.DST'}}
    m['telemetry'] = tel
    return m


def sinh_ca():
    ra = []
    for kn, (cur, tot), tt, gio, dan in itertools.product(KN, SO, TT, GIO, DAN):
        muc = may('X', kn, cur, tot, tt)
        if dan == 'tat-ca-im':
            khac = [may('B', 'unknown', None, None, 'unknown'),
                    may('C', 'offline', None, None, 'unknown')]
        elif dan == 'co-may-noi':
            khac = [may('B', 'online', 5, 10, 'running'),
                    may('C', 'unknown', None, None, 'unknown')]
        else:
            khac = []
        ra.append({'gio_vn': gio, 'dan': dan, 'may': [muc] + khac})
    for kn in ('online', 'unknown'):
        for loi, nang in ((True, False), (False, True)):
            ra.append({'gio_vn': 12, 'dan': 'co-may-noi',
                       'may': [may('X', kn, 500, 1000, 'stopped', loi, nang),
                               may('B', 'online', 5, 10, 'running')]})
    return ra


def cham_py(ca):
    spec = importlib.util.spec_from_file_location('dbt', PY_BAN)
    d = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(d)
    ra = []
    for c in ca:
        ds = c['may']
        # `GIO_LAM` tính bằng PHÚT kể từ nửa đêm, không phải giờ — đã cắn thật lúc dựng bài này.
        tg = d.GIO_LAM[0] <= c['gio_vn'] * 60 < d.GIO_LAM[1]
        ra.append(d.tinh_trang(ds[0], tg, d.khao_sat(ds)))
    return ra


KICH_JS = r'''
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const js = readFileSync(process.argv[2], 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
const MOC = "  el('cong-form').addEventListener"
if (js.split(MOC).length !== 2) { console.error('KHONG TIM THAY MOC CHEN'); process.exit(2) }
const kich = js.replace(MOC, `
  globalThis.__T = { tinhTrang: tinhTrang, datMay: function (x) { may = x },
                     datLech: function (x) { lechDongHo = x } }
` + MOC)
const kho = new Map()
const nut = () => new Proxy({}, {
  get: (t, k) => (typeof k === 'string' && /^(addEventListener|removeEventListener|appendChild|remove|setAttribute|focus|blur|insertBefore|replaceChildren|scrollIntoView)$/.test(k)
    ? () => {} : k === 'classList' ? { add () {}, remove () {}, toggle () {}, contains: () => false }
    : (k === 'style' || k === 'dataset') ? {} : (k === 'children' || k === 'childNodes') ? [] : t[k]),
  set: (t, k, v) => (t[k] = v, true) })
const sb = { console, Date, Math, JSON, Number, String, Object, Array, Boolean, Error, RegExp, Map, Set,
  Promise, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, isFinite,
  URLSearchParams, URL, Intl, setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0,
  clearInterval: () => {}, requestAnimationFrame: () => 0, fetch: () => new Promise(() => {}),
  WebSocket: function () { return nut() }, EventSource: function () { return nut() },
  localStorage: { getItem: (k) => (kho.has(k) ? kho.get(k) : null),
                  setItem: (k, v) => kho.set(k, String(v)), removeItem: (k) => kho.delete(k) },
  location: { href: 'https://x/', protocol: 'https:', host: 'x', search: '', hash: '', origin: 'https://x' },
  navigator: { userAgent: 'node' },
  document: { getElementById: nut, querySelector: nut, querySelectorAll: () => [], createElement: nut,
              addEventListener () {}, body: nut(), documentElement: nut(), hidden: false } }
sb.window = sb; sb.self = sb; sb.globalThis = sb
vm.createContext(sb)
// Phần dựng màn hình nổ thì kệ — chỗ chèn nằm TRƯỚC đó nên hàm vẫn lấy ra được.
try { vm.runInContext(kich, sb, { filename: 'xem-inline.js' }) } catch (e) {}
if (!sb.__T) { console.error('KHONG LAY DUOC HAM RA'); process.exit(2) }
const ca = JSON.parse(readFileSync(process.argv[3], 'utf8'))
console.log(JSON.stringify(ca.map((c) => {
  const gioVN = new Date(Date.now() + 7 * 3600 * 1000).getUTCHours()
  sb.__T.datLech((c.gio_vn - gioVN) * 3600 * 1000)
  sb.__T.datMay(c.may)
  return sb.__T.tinhTrang(c.may[0])
})))
'''


def cham_js(ca, duong_html):
    tmp = tempfile.mkdtemp(prefix='doi-chieu-')
    f_js = os.path.join(tmp, 'cham.mjs')
    f_ca = os.path.join(tmp, 'ca.json')
    open(f_js, 'w').write(KICH_JS)
    open(f_ca, 'w').write(json.dumps(ca))
    p = subprocess.Popen([NODE, f_js, duong_html, f_ca],
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out, err = p.communicate()
    if p.returncode != 0:
        sys.stderr.write(err.decode('utf-8', 'replace'))
        raise SystemExit('bản JS không chấm được')
    return json.loads(out.decode('utf-8'))


def main():
    duong_html = sys.argv[1] if len(sys.argv) > 1 else JS_BAN
    ca = sinh_ca()
    a = cham_py(ca)
    b = cham_js(ca, duong_html)
    lech = [(i, x, y) for i, (x, y) in enumerate(zip(a, b)) if x != y]
    print('%d ca · %s' % (len(ca), 'KHỚP HẾT' if not lech else 'LỆCH %d ca' % len(lech)))
    print('phân bố nhãn:', dict(collections.Counter(a)))
    if not lech:
        return 0
    for k, v in collections.Counter((x, y) for _, x, y in lech).most_common(10):
        print('   py=%-10s js=%-10s  %d ca' % (k[0], k[1], v))
    for i, x, y in lech[:3]:
        c = ca[i]
        m = c['may'][0]
        print('   --- ca %d: giờ VN %s · đàn %s · kn=%s · tt=%s · job=%s → py=%s js=%s'
              % (i, c['gio_vn'], c['dan'], m['connection']['state'],
                 m['telemetry']['status']['value'],
                 (m['telemetry'].get('job') or {}).get('value'), x, y))
    return 1


if __name__ == '__main__':
    sys.exit(main())
