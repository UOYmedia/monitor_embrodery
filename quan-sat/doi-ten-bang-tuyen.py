#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Đổi tên bảng `dahao-tuyen` cho đúng việc nó làm.

Bảng này đo ĐƯỜNG ỐNG: bản tin/giây, lượt gọi API bị từ chối, giá trị trạng thái thô mà
máy đẩy lên. Nó KHÔNG trả lời "máy nào đang chạy, máy nào lỗi" — chuyện đó là của
`dahao-xem-nhanh` và `dahao-can-xu-ly`.

Tên cũ "Tuyến Dahao — vận hành" khiến người mở lên tưởng là bảng vận hành, thấy toàn số 0
rồi kết luận hệ thống hỏng. 28/08 đã cắn thật: user mở đúng bảng này và hỏi vì sao không
thấy máy nào on. Chạy khan để xem, thêm `--that` để ghi.

Bảng được cấp phát TỪ FILE (`provisioning`, 30 giây quét lại một lần), nên phải sửa file
chứ đừng sửa qua API — sửa qua API sẽ bị lượt quét sau đè lại.
"""
import io
import json
import os
import sys

TEN_MOI = 'Dahao — kỹ thuật (đường ống, không phải bảng xưởng)'
MO_TA = ('Bảng KỸ THUẬT: đo đường truyền, không đo máy. Muốn biết máy nào đang chạy / '
         'đang lỗi thì mở "Dahao — xem nhanh" hoặc "Dahao — cần xử lý".')

BAN = [os.path.expanduser('~/dahao-gateway/quan-sat/grafana/dashboards/dahao-tuyen.json'),
       os.path.expanduser('~/dashboarddahao/quan-sat/grafana/dashboards/dahao-tuyen.json')]

that = '--that' in sys.argv
for p in BAN:
    if not os.path.exists(p):
        print('  bo qua (khong co):', p)
        continue
    d = json.load(io.open(p, encoding='utf-8'))
    cu = d.get('title')
    if cu == TEN_MOI and d.get('description') == MO_TA:
        print('  bo qua — da dung:', p)
        continue
    d['title'] = TEN_MOI
    d['description'] = MO_TA
    tags = d.get('tags') or []
    if 'ky-thuat' not in tags:
        tags.append('ky-thuat')
        d['tags'] = tags
    print('  %s' % p)
    print('    %r -> %r' % (cu, TEN_MOI))
    if that:
        io.open(p, 'w', encoding='utf-8').write(
            json.dumps(d, ensure_ascii=False, indent=2) + "\n")
print('DA GHI' if that else 'chay khan — them --that de ghi')
