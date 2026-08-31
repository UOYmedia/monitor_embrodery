#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rút ra ĐÚNG những tấm thẻ mà ba ô chữ lớn sẽ vẽ, để xem trước bên ngoài Grafana.

Không đoán: đọc thẳng `dahao-can-xu-ly.json`, chạy chính target của nó vào Loki, rồi áp
đúng `mappings` / `unit` mà ô ấy khai. Kết quả in ra JSON cho bên kia dựng HTML.
"""
import io
import json
import os
import urllib.parse
import urllib.request

LOKI = 'http://127.0.0.1:3100'
TEP = os.path.expanduser('~/dahao-gateway/quan-sat/grafana/dashboards/dahao-can-xu-ly.json')


def hoi(q):
    u = LOKI + '/loki/api/v1/query?' + urllib.parse.urlencode({'query': q})
    r = urllib.request.Request(u)
    r.add_header('User-Agent', 'dahao-quan-sat/1.0')
    with urllib.request.urlopen(r, timeout=30) as f:
        return json.loads(f.read().decode('utf-8'))


def doc_giay(g):
    """Bắt chước `unit: s` của Grafana: 3661 → "1.02 hour"; nó rút gọn chứ không đếm giây."""
    g = float(g)
    if g < 60:
        return '%d giây' % g
    if g < 3600:
        return '%d phút' % round(g / 60.0)
    return '%.1f giờ' % (g / 3600.0)


def main():
    d = json.load(io.open(TEP, encoding='utf-8'))
    ra = []
    for p in d['panels']:
        if p['id'] not in (120, 121, 122):
            continue
        de = p['fieldConfig']['defaults']
        anh_xa = {}
        for m in de.get('mappings') or []:
            if m['type'] == 'value':
                for k, v in m['options'].items():
                    anh_xa[str(k)] = v
        q = p['targets'][0]['expr'].replace('$may', '.+')
        kq = hoi(q)
        the = []
        for r in kq['data']['result']:
            gt = r['value'][1]
            ten = r['metric'].get('ten') or r['metric'].get('may')
            key = str(int(float(gt)))
            if key in anh_xa:
                chu, mau = anh_xa[key]['text'], anh_xa[key].get('color')
            elif de.get('unit') == 's':
                chu, mau = doc_giay(gt), None
            else:
                chu, mau = gt, None
            the.append({'ten': ten, 'chu': chu, 'mau': mau})
        ra.append({
            'id': p['id'], 'tieu_de': p['title'],
            'h': p['gridPos']['h'],
            'nen': de['thresholds']['steps'][0]['color'],
            'co_ten': p['options']['text'].get('titleSize'),
            'co_gt': p['options']['text'].get('valueSize'),
            'the': sorted(the, key=lambda x: x['ten']),
        })
    print(json.dumps(ra, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
