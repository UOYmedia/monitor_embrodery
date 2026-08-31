#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bù phần lịch sử vào `va-mau.out`.

Bộ dò chạy sống bằng `tail -n 0`, nên nó chỉ thấy từ lúc bật trở đi — mấy tiếng trước đó nằm sẵn
trong `broker.log` mà không ai đọc. Chỗ này đọc lại phần cũ rồi nối vào, CHỈ những sự kiện có
dấu giờ SỚM HƠN dòng đầu tiên bộ chạy sống đã ghi, nên không trùng một dòng nào.

Mở bằng 'a' (O_APPEND) — cùng kiểu launchd đang giữ fd, nên hai bên ghi xen kẽ vẫn không cắt
ngang dòng của nhau. Alloy tail theo tên, thấy dòng mới là đẩy; `stage.timestamp` lấy trường `at`
nên sự kiện cũ rơi đúng chỗ trên trục thời gian chứ không dồn về hiện tại.
"""
import importlib.util
import json
import subprocess
import sys

RA = '/Users/phong/dahao-gateway/logs/va-mau.out'
BO = '/Users/phong/dahao-gateway/quan-sat/soi-lan-dung.py'
N = int(sys.argv[1]) if len(sys.argv) > 1 else 400000

sp = importlib.util.spec_from_file_location('soi', BO)
m = importlib.util.module_from_spec(sp)
sp.loader.exec_module(m)

try:
    dau = json.loads(open(RA).readline())['at']
except (OSError, ValueError, KeyError):
    print('chua co dong nao trong va-mau.out — chay bo do song truoc da')
    raise SystemExit(1)
print('moc cat:', dau, '(chi bu nhung gi som hon moc nay)')

gom = []
duoi = subprocess.run(['tail', '-n', str(N), m.LOG], capture_output=True, text=True).stdout
bo = m.Bo()
for d in duoi.splitlines():
    m.nap(bo, d, gom.append)

cu = [x for x in gom if x['at'] < dau]
with open(RA, 'a') as f:
    for x in cu:
        f.write(json.dumps(x, ensure_ascii=False) + '\n')

import collections
dem = collections.Counter(x['nghi'] for x in cu if x['viec'] == 'dong')
print('da bu %d dong (%d lan dung da khep)' % (len(cu), sum(dem.values())))
for k, v in dem.most_common():
    print('  %-14s %4d' % (k, v))
