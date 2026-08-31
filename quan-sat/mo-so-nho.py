#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Mồi sổ nhớ số mũi (`quan-sat/nho-viec.json`) từ nhật ký `logs/tinh-trang.out` đã có.

VÌ SAO CẦN

Sổ nhớ chỉ ghi được lời máy khai lúc nó CÒN NÓI. Máy đã im từ trước khi sổ ra đời thì mãi mãi
không có mục nào — mà đó lại đúng là mấy cái máy cần phân biệt nhất. Đo thật lúc 17:20 ngày 28/08,
ngay sau khi chạy bản mới: sổ nhớ có 9 máy, đúng bằng 9 máy đang nói; **4 máy đang im thì không
có mục nào**, nên 306/306 dòng của chúng đọc ra `off` = "mất tín hiệu" — trong đó hai máy thật ra
đã **thêu xong tấm rồi mới im lúc 18:30 tan ca hôm qua**:

    60260295C907   3721/3721 (XONG)  27/08 18:30 VN
    602602A6F22B   3512/3512 (XONG)  27/08 18:30 VN

Gọi cái đó là "mất tín hiệu" là báo động giả về hai cái máy đã tắt đúng quy trình.

NGUYÊN TẮC — CHỈ CHÉP SỐ ĐO ĐƯỢC, KHÔNG CHÉP PHÁN ĐOÁN

  · Chỉ lấy `mui`/`tong` — hai con số máy tự khai. Không lấy `tinh_trang` (cái đó là kết luận của
    mình, mồi vào là tự nói vọng lại lời của chính mình).
  · Mốc thời gian lấy `do_luc` (lúc ĐO), không lấy `at` (lúc ghi log). Mỗi dòng ra sau này mang
    `dang_do_luc` = mốc này, để người đọc thấy ngay kết luận đang dựa vào số cũ tới mức nào.
  · **Không đè** mục đã có: lời máy khai lúc này luôn mới hơn nhật ký.
  · **Không tự đặt hạn cũ.** Số của hôm kia vẫn là số đo được; đặt ngưỡng "quá N giờ thì bỏ" là
    bịa một con số mà dữ liệu xưởng chưa đỡ nổi. Ai cần lọc thì lọc bằng `dang_do_luc`.
  · Ghi ra file tạm rồi đổi tên, y như `SoNhoViec.luu()` — cúp điện giữa chừng thì sổ cũ nguyên vẹn.

Chạy lại bao nhiêu lần cũng được: lần hai sẽ không thêm gì.

    python3 -B mo-so-nho.py [--that]      # không có `--that` thì chỉ in ra, không ghi
"""
import io
import json
import os
import sys

NHA = os.path.expanduser('~/dahao-gateway')
LOG = os.path.join(NHA, 'logs', 'tinh-trang.out')
SO = os.path.join(NHA, 'quan-sat', 'nho-viec.json')


def doc_so():
    try:
        d = json.load(io.open(SO, encoding='utf-8'))
    except Exception:
        return {}
    m = d.get('may')
    return m if isinstance(m, dict) else {}


def quet_log():
    """Lần đọc CUỐI CÙNG có số dùng được của từng máy, theo `do_luc`."""
    cuoi = {}
    for dong in io.open(LOG, encoding='utf-8', errors='replace'):
        try:
            r = json.loads(dong)
        except Exception:
            continue
        may = r.get('may')
        mui, tong = r.get('mui'), r.get('tong')
        if not may:
            continue
        if not isinstance(mui, (int, float)) or not isinstance(tong, (int, float)) or tong <= 0:
            continue
        luc = r.get('do_luc') or r.get('at')
        if may in cuoi and cuoi[may]['at'] >= luc:
            continue
        cuoi[may] = {'mui': mui, 'tong': tong, 'at': luc, 'mau': r.get('mau')}
    return cuoi


def main():
    that = '--that' in sys.argv
    co = doc_so()
    tim = quet_log()
    them = {k: v for k, v in tim.items() if k not in co}
    print('sổ đang có %d máy · nhật ký có số của %d máy · mồi thêm %d'
          % (len(co), len(tim), len(them)))
    for k in sorted(them):
        v = them[k]
        print('   + %-14s mui=%-7s tong=%-7s (%s) lúc %s'
              % (k, v['mui'], v['tong'], 'XONG tấm' if v['mui'] >= v['tong'] else 'DỞ tấm', v['at']))
    if not them:
        return 0
    if not that:
        print('\n(chạy thử — thêm `--that` để ghi thật)')
        return 0
    co.update(them)
    tam = SO + '.tam'
    io.open(tam, 'w', encoding='utf-8').write(json.dumps(
        {'phien_ban': 1, 'moi_tu': 'logs/tinh-trang.out', 'may': co}, ensure_ascii=False))
    os.replace(tam, SO)
    print('\nđã ghi %s — %d máy' % (SO, len(co)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
