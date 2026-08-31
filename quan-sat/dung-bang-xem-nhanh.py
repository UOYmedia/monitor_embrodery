#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dựng bảng `dahao-xem-nhanh` — bản gọn cho người chỉ đứng xem.

Vì sao tách bảng: `dahao-tinh-trang` có 18 ô, trong đó quá nửa là ô chẩn đoán (log broker, mã
thô, nhịp số liệu, sổ lỗi tuyến đo). Người vận hành xưởng không cần, mà lại phải cuộn qua chúng.
Bảng này giữ đúng 6 ô, tất cả trả lời một câu: **giờ xưởng thế nào, máy nào đang có chuyện.**

Nguyên tắc: KHÔNG viết truy vấn mới. Chép nguyên ô đã kiểm chứng từ `dahao-tinh-trang` rồi chỉ
đổi khung/tên/cỡ chữ. Mọi thứ ở đây đã chạy thật trên production, không có đường nào chưa thử.

Chạy lại bao nhiêu lần cũng được — ghi đè hẳn file đích, và tự nâng `version` vượt bản trong DB
(bẫy `allowUiUpdates: true`: Grafana bỏ qua file có version thấp hơn DB, không một dòng log).
"""
import copy
import io
import json
import sys

NGUON = sys.argv[1]
DICH = sys.argv[2]
VERSION = int(sys.argv[3]) if len(sys.argv) > 3 else 1

UID = 'dahao-xem-nhanh'
TEN = 'Dahao — xem nhanh'

# Bốn ô đếm, mỗi ô w=6 để trên điện thoại xếp 2x2 chứ không bẹp thành 8 cột.
O_DEM = [(2, 'Đang chạy'), (3, 'Đang lỗi'), (17, 'Cảnh báo'), (12, 'Nghi đứt chỉ')]

# Cột bỏ khỏi bảng máy: mã máy (đã có tên), mũi hiện tại / mũi tổng (đã có cột "Xong" %).
BO_COT = ['may', 'Value #A', 'Value #B']


def main():
    goc = json.load(io.open(NGUON, encoding='utf-8'))
    o = {p['id']: p for p in goc['panels']}

    panels = []

    for i, (pid, ten) in enumerate(O_DEM):
        p = copy.deepcopy(o[pid])
        p['id'] = 100 + i
        p['title'] = ten
        p['gridPos'] = {'h': 6, 'w': 6, 'x': i * 6, 'y': 0}
        # Chữ to hẳn: bảng này để liếc từ xa, không để soi.
        p['options']['colorMode'] = 'background'
        p['options']['text'] = {'titleSize': 18, 'valueSize': 64}
        panels.append(p)

    bang = copy.deepcopy(o[7])
    bang['id'] = 110
    bang['title'] = 'Máy nào đang làm gì'
    bang['gridPos'] = {'h': 13, 'w': 24, 'x': 0, 'y': 6}
    bang['options']['cellHeight'] = 'lg'
    for tr in bang['transformations']:
        if tr['id'] == 'organize':
            opt = tr['options']
            for c in BO_COT:
                opt.setdefault('excludeByName', {})[c] = True
            # Đánh lại chỉ số cho liền, kẻo Grafana chèn cột lạ vào khoảng trống.
            con = [k for k, v in sorted(opt.get('indexByName', {}).items(), key=lambda x: x[1])
                   if not opt.get('excludeByName', {}).get(k)]
            opt['indexByName'] = {k: n for n, k in enumerate(con)}
    panels.append(bang)

    log = copy.deepcopy(o[15])
    log['id'] = 111
    log['title'] = 'Máy vừa dừng vì gì — mới nhất ở trên'
    log['gridPos'] = {'h': 12, 'w': 24, 'x': 0, 'y': 19}
    panels.append(log)

    d = {
        'uid': UID,
        'title': TEN,
        'tags': ['dahao', 'xuong', 'xem-nhanh'],
        'timezone': goc.get('timezone', 'browser'),
        'schemaVersion': goc.get('schemaVersion', 39),
        'editable': False,          # bảng cho người xem: khoá lại cho khỏi lỡ tay kéo ô
        'graphTooltip': 0,
        'refresh': '10s',
        'time': {'from': 'now-6h', 'to': 'now'},
        'templating': copy.deepcopy(goc['templating']),
        'panels': panels,
        'version': VERSION,
        'description': 'Bản gọn của "Dahao — tình trạng máy": chỉ 6 ô, bỏ hết phần chẩn đoán.',
    }

    io.open(DICH, 'w', encoding='utf-8').write(
        json.dumps(d, ensure_ascii=False, indent=2) + '\n')
    print('da dung %s: %d o, version=%d' % (DICH, len(panels), VERSION))
    for p in panels:
        g = p['gridPos']
        print('  id=%-4d %-8s y=%-3d h=%-3d w=%-3d %s'
              % (p['id'], p['type'], g['y'], g['h'], g['w'], p['title']))


if __name__ == '__main__':
    main()
