#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dựng lại ô 18 "Máy nào đang báo lỗi — và lỗi gì" ở dòng lệnh.

Grafana ghép bảng và ánh xạ chữ Ở PHÍA TRÌNH DUYỆT — không API nào trả về bảng cuối cùng, nên
"truy vấn chạy được" KHÔNG chứng minh "bảng hiện ra đúng". Script này gọi đúng `/api/ds/query`
Grafana gọi, rồi tự làm nốt `filterFieldsByName` → `joinByField` → `organize` → `mappings`, và soi
hộ hai thứ chỉ lộ ra sau khi ghép: **một máy ra hai dòng** và ô `NaN`/rỗng.

    cd ~/dahao-gateway/quan-sat && (set -a; . ./mcp-grafana.env; set +a; python3 -B kiem-bang-bao-loi.py)
"""
import json
import os
import sys
import urllib.request

URL = os.environ['GRAFANA_URL'].rstrip('/')
TOK = os.environ['GRAFANA_SERVICE_ACCOUNT_TOKEN']
BANG = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    'grafana', 'dashboards', 'dahao-tinh-trang.json')
O_ID = int(sys.argv[1]) if len(sys.argv) > 1 else 18


def lay_o():
    d = json.load(open(BANG, encoding='utf-8'))
    for p in d['panels']:
        if p['id'] == O_ID:
            return p
    raise SystemExit('khong thay o id=%d' % O_ID)


def hoi(o):
    """Gọi đúng endpoint Grafana gọi, `$may` thay bằng `.+` (biến bảng mặc định là tất cả)."""
    body = {'queries': [dict(t, expr=t['expr'].replace('$may', '.+'),
                             datasource=t['datasource'], maxLines=1000)
                        for t in o['targets']],
            'from': 'now-5m', 'to': 'now'}
    rq = urllib.request.Request(URL + '/api/ds/query', method='POST',
                                data=json.dumps(body).encode('utf-8'),
                                headers={'Authorization': 'Bearer ' + TOK,
                                         'Content-Type': 'application/json',
                                         # `GRAFANA_URL` là đường CÔNG KHAI qua Cloudflare, và
                                         # Cloudflare trả 403 cho `Python-urllib/*`. Không phải
                                         # token sai — cùng token ấy `curl` vẫn 200.
                                         'User-Agent': 'kiem-bang-bao-loi/1.0'})
    return json.load(urllib.request.urlopen(rq, timeout=60))


def khung_thanh_hang(kq):
    """Đổi mỗi frame thành list các dict {ten_cot: gia_tri}, khoá theo refId.

    ⚠ `/api/ds/query` KHÔNG trả bảng đã dàn cột: mỗi series là một frame `Time`+`Value`, còn nhãn
    (`may`, `ten`, `loi_do`...) nằm trong `schema.fields[…].labels`. Chính Grafana ở trình duyệt mới
    trải nhãn thành cột khi target đặt `format:"table"`. Nên phải trải hộ ở đây, nếu không sẽ tưởng
    truy vấn hỏng trong khi bảng thật vẫn vẽ đúng.
    """
    ra = {}
    for ref, goi in sorted(kq.get('results', {}).items()):
        if goi.get('error'):
            print('  ✗ %s LOI: %s' % (ref, goi['error'][:160]))
            ra[ref] = []
            continue
        hang = []
        for fr in goi.get('frames', []):
            truong = fr['schema']['fields']
            nhan = {}
            for f in truong:
                nhan.update(f.get('labels') or {})
            cot = [f['name'] for f in truong]
            for r in zip(*fr['data']['values']):
                hang.append(dict(nhan, **dict(zip(cot, r))))
        ra[ref] = hang
    return ra


def thu_tu_cot(o):
    """Lấy ĐÚNG thứ tự cột từ `organize` của chính ô, trả [(ten_goc, ten_hien)].

    Đọc từ bảng chứ không chép tay: bảng mã tình trạng phải khớp ở bốn nơi rồi (`MA_TT`,
    `MA_NGHI`, `mappings` của ô, và bộ kiểm) — thêm một bản chép nữa là thêm một chỗ lệch âm thầm.
    """
    org = next(t for t in o['transformations'] if t['id'] == 'organize')
    doi = org['options'].get('renameByName') or {}
    bo = org['options'].get('excludeByName') or {}
    thu_tu = org['options'].get('indexByName') or {}
    goc = [k for k in thu_tu if not bo.get(k)]
    goc.sort(key=lambda k: thu_tu[k])
    return [(k, doi.get(k, k)) for k in goc]


def anh_xa(o):
    """Bảng ánh xạ theo TÊN CỘT SAU KHI ĐỔI TÊN, giống hệt Grafana."""
    ra = {}
    for ov in o['fieldConfig']['overrides']:
        for pr in ov['properties']:
            if pr['id'] == 'mappings':
                for m in pr['value']:
                    if m.get('type') == 'value':
                        ra.setdefault(ov['matcher']['options'], {}).update(
                            {k: v.get('text') for k, v in m['options'].items()})
    return ra


def main():
    o = lay_o()
    print('Ô %d — %s\n' % (o['id'], o['title']))
    hang = khung_thanh_hang(hoi(o))
    cap = thu_tu_cot(o)
    ax = anh_xa(o)

    # joinByField 'may', mode outer.
    gop = {}
    for ref, ds in hang.items():
        for r in ds:
            may = r.get('may')
            if may is None:
                continue
            o_ = gop.setdefault(may, {'may': may})
            for k, v in r.items():
                if k == 'Time':
                    continue
                o_[k if k != 'Value' else 'Value #' + ref] = v

    # Bẫy đã cắn ở ô 7: cửa sổ vắt qua một lần đổi ⇒ một máy ra nhiều dòng.
    nhieu = {}
    for ref, ds in hang.items():
        dem = {}
        for r in ds:
            dem[r.get('may')] = dem.get(r.get('may'), 0) + 1
        for m, n in dem.items():
            if n > 1:
                nhieu.setdefault(m, []).append('%s×%d' % (ref, n))

    W = 24
    rong = []
    print('  '.join('%-*s' % (W, c) for _, c in cap))
    print('-' * ((W + 2) * len(cap)))
    for may in sorted(gop, key=lambda m: (-(gop[m].get('Value #A') or 0), m)):
        r = gop[may]
        o_hang = []
        for g, c in cap:
            v = r.get(g)
            if v is None or (isinstance(v, float) and v != v):
                # `NaN` ở đây gần như luôn là phép chia `0/0` của LogQL (máy chưa nạp mẫu).
                rong.append('%s / %s' % (r.get('ten', may), c))
                o_hang.append('—')
                continue
            if isinstance(v, float) and v == int(v):
                v = int(v)
            o_hang.append(str(ax.get(c, {}).get(str(v), v))[:W])
        print('  '.join('%-*s' % (W, x) for x in o_hang))

    print()
    print('máy trong bảng     : %d' % len(gop))
    # Chỉ cái này mới là HỎNG. Ô trống thì phần lớn là CỐ Ý: cột "Xong" lọc mẫu số `b > 0` để khỏi
    # in ra chữ `NaN`, cột "Vì sao dừng" chỉ có giá trị khi bộ dò nghi máy đang vá. Nên liệt kê cho
    # xem chứ đừng gọi là lỗi — gọi mọi ô trống là lỗi thì lần sau không ai đọc dòng này nữa.
    print('máy ra nhiều dòng  : %s   <- ra gì ở đây là HỎNG' % (nhieu or 'không có ✓'))
    print('ô để trống (%2d)    : %s' % (len(rong), ', '.join(rong) or 'không có'))
    return 1 if nhieu else 0


if __name__ == '__main__':
    sys.exit(main())
