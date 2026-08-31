#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Hạ mức nhật ký của Loki từ `info` xuống `warn`.

Đo thật 29/08: `logs/loki.err` = **942 MB** chỉ sau một ngày, và không có lấy một dòng lỗi.
Toàn bộ là `level=info` — Loki ghi mọi truy vấn Grafana bắn vào. Sáu bảng, mỗi bảng làm mới
vài giây một lần, nên mỗi lượt làm mới đẻ ra chục dòng: "executing query", "get or create
table", "compacting table"...

Ba cái hại, cái thứ ba mới là cái đáng sợ:
  1. Xoay log mỗi ngày một lần lúc 04:17, nên giữa hai lần xoay có lúc phình gần 1 GB.
  2. Giữ 60 bản nén => nhật ký RÁC chiếm đĩa nhiều hơn số liệu THẬT.
  3. Đĩa đầy thì broker hết chỗ ghi, Loki hỏng chỉ mục — tức là hỏng đúng theo kiểu câm
     lặng mà cả tuyến này đã dính một lần rồi.

`warn` vẫn giữ nguyên thứ cần đọc: cảnh báo vứt dòng ghi lệch thứ tự ("entry too far
behind") — chính là dòng từng làm mất số mà bảng vẫn vẽ đẹp — nằm ở mức `warn`, không phải
`info`. Nên vá này KHÔNG làm mù thêm chỗ nào.

Chạy khan để xem, thêm `--that` để ghi. Có `--lui` để trả lại `info` khi cần soi kỹ.
"""
import io
import os
import re
import shutil
import sys

BAN = [os.path.expanduser('~/dahao-gateway/quan-sat/native/loki.yml'),
       os.path.expanduser('~/dashboarddahao/quan-sat/native/loki.yml')]

GHI_CHU = """  # Hạ xuống `warn` ngày 29/08: ở mức `info`, Loki ghi MỌI truy vấn Grafana bắn vào và
  # thổi `logs/loki.err` lên 942 MB/ngày mà không có lấy một dòng lỗi. Đĩa đầy là cả tuyến
  # chết câm. Cảnh báo vứt dòng lệch thứ tự ("entry too far behind") ở mức `warn` nên vẫn
  # còn — xem ghi chú `max_chunk_age` bên dưới.
"""


def sua(p, muc_moi, that):
    if not os.path.exists(p):
        print('  bỏ qua (không có): %s' % p)
        return False
    van = io.open(p, encoding='utf-8').read()
    m = re.search(r'^(\s*)log_level:\s*(\S+)\s*$', van, re.M)
    if not m:
        print('  ! %s: không tìm thấy dòng `log_level:` — KHÔNG tự thêm, xem tay.' % p)
        return False
    if m.group(2) == muc_moi:
        print('  bỏ qua — đã là %s: %s' % (muc_moi, p))
        return False
    moi = van[:m.start()] + ('%slog_level: %s' % (m.group(1), muc_moi)) + van[m.end():]
    if muc_moi == 'warn' and 'Hạ xuống `warn`' not in moi:
        moi = moi[:m.start()] + GHI_CHU + moi[m.start():]
    print('  %s: log_level %s -> %s' % (p, m.group(2), muc_moi))
    if that:
        if not os.path.exists(p + '.pre-loglevel.bak'):
            shutil.copy2(p, p + '.pre-loglevel.bak')
        io.open(p, 'w', encoding='utf-8').write(moi)
    return True


if __name__ == '__main__':
    that = '--that' in sys.argv
    muc = 'info' if '--lui' in sys.argv else 'warn'
    doi = [sua(p, muc, that) for p in BAN]
    if not that:
        print('\n(chạy khan — thêm --that để ghi)')
    elif any(doi):
        print('\nĐÃ GHI. Phải nạp lại Loki thì mới ăn:')
        print('  launchctl kickstart -k gui/$(id -u)/com.dahao.loki')
        print('  (hoặc `launchctl stop com.dahao.loki` rồi để KeepAlive dựng lại)')
