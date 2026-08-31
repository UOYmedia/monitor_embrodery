#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Đưa phần LỖI MÁY THẬT lên trên bảng `dahao-tinh-trang`.

Vì sao phải làm: user tưởng dashboard chỉ biết mỗi lỗi kết nối. Thật ra bộ dò `soi-lan-dung.py`
đã bắt được 162 lần dừng có phân loại (65 lần nghi đứt chỉ) — nhưng năm ô ấy nằm ở y=83..105,
tức là sau NĂM ô cao 10-15 hàng. Trên điện thoại thì coi như không tồn tại. Không phải thiếu
tính năng, mà là **thiếu thứ tự**.

Chạy lại bao nhiêu lần cũng được: chỉ đặt lại `gridPos`/`title`, và target E của ô 18 nhận theo
`refId` nên không nhân đôi.
"""
import io
import json
import sys

DUONG = sys.argv[1]

# ── Thứ tự mới. Nguyên tắc: LỖI MÁY trước, lỗi tuyến đo sau, chẩn đoán để cuối. ──────────────
# Ô đếm rút còn w=3 để nhét vừa 8 ô một hàng; tên ô phải ngắn kẻo Grafana ngắt dòng trong w=3.
O_DEM = [
    (1,  'Tổng máy'),
    (2,  'Đang chạy'),
    (3,  'Đang lỗi'),
    (17, 'Cảnh báo'),
    (12, 'Nghi đứt chỉ'),      # <- kéo từ y=83 lên
    (13, 'Lần dừng'),          # <- kéo từ y=83 lên
    (4,  'Mất tín hiệu'),
    (11, 'Nhịp số liệu'),
]

# (id, x, w, h) theo từng hàng, y tính dồn.
KHOI = [
    [(18, 0, 24, 7)],           # máy nào ĐANG có chuyện
    [(15, 0, 24, 10)],          # <- kéo từ y=95: sổ lỗi máy, nguyên văn từng lần dừng
    [(14, 0, 12, 9), (16, 12, 12, 9)],   # <- kéo từ y=83/87
    [(19, 0, 24, 8)],           # sổ báo lỗi của bridge (lỗi tuyến đo)
    [(7, 0, 24, 11)],
    [(5, 0, 24, 15)],
    [(6, 0, 24, 10)],
    [(10, 0, 24, 10)],
    [(9, 0, 24, 8)],
    [(8, 0, 24, 9)],
]

DOI_TEN = {
    15: 'Vì sao máy dừng — SUY TỪ SỐ MŨI, không phải máy tự báo',
    14: 'Máy nào hay phải vá nhất',
    16: 'Lý do dừng theo thời gian — cột cao là lúc xưởng vất',
    19: 'Sổ báo lỗi TUYẾN ĐO — nguyên văn câu bridge nói, không viết lại',
}

# Bảng mã của `soi-lan-dung.py` (MA_NGHI). Chép tay ở đây là bản thứ hai — chấp nhận được vì
# `kiem-bang-bao-loi.py` đọc ngược lại chính chỗ này để đối chiếu.
VI_SAO = {
    '0': ('nghi đứt chỉ — có người vá', 'red'),
    '1': ('dừng hẳn, chưa chạy lại', 'red'),
    '2': ('dừng lâu, không lùi mũi', 'orange'),
    '3': ('dừng thoáng rồi chạy tiếp', 'text'),
    '4': ('đổi mẫu', 'text'),
    '5': ('mất tín hiệu giữa chừng', 'orange'),
    '6': ('làm tấm mới', 'green'),
}

NEN_TT = '{job="tinh-trang", may=~"$may", muc_ten!="thuong"}'
VM = '{job="va-mau", viec="dong", may=~"$may"}'


def o_theo_id(d):
    return {p['id']: p for p in d['panels']}


def dat_o_dem(o_map):
    for i, (pid, ten) in enumerate(O_DEM):
        p = o_map[pid]
        p['gridPos'] = {'h': 4, 'w': 3, 'x': i * 3, 'y': 0}
        p['title'] = ten


def dat_khoi(o_map):
    y = 4
    for hang in KHOI:
        for pid, x, w, h in hang:
            o_map[pid]['gridPos'] = {'h': h, 'w': w, 'x': x, 'y': y}
        y += max(h for _, _, _, h in hang)
    return y


def them_cot_vi_sao(o18):
    """Ô 18 nói được máy đang lỗi gì, nhưng chưa nói lần DỪNG gần nhất là vì sao.

    Bẫy: `joinByField` ghép kiểu outer, nên nếu hỏi va-mau trần thì mọi máy vừa dừng trong 30
    phút đều lọt vào bảng — kể cả máy đang chạy ngon. Phải chốt bằng `and on (may) (…tinh-trang
    muc_ten!="thuong"…)`, đúng lối target G của ô 7 đang dùng.
    """
    goc = next(t for t in o18['targets'] if t['refId'] == 'A')
    e = {'refId': 'E',
         'datasource': goc['datasource'],
         'queryType': 'instant',
         'format': 'table',
         'expr': '(last_over_time(%s | json | unwrap ma_nghi [30m]) by (may)) '
                 'and on (may) (last_over_time(%s | json | unwrap muc [90s]) by (may))'
                 % (VM, NEN_TT)}
    o18['targets'] = [t for t in o18['targets'] if t['refId'] != 'E'] + [e]

    for tr in o18['transformations']:
        if tr['id'] == 'filterFieldsByName':
            # `Value.*` đã bắt sẵn Value #E, không phải sửa.
            pass
        if tr['id'] == 'organize':
            o = tr['options']
            o.setdefault('renameByName', {})['Value #E'] = 'Lần dừng gần nhất'
            # Chen ngay sau "Vì sao" để hai cột lý do đứng cạnh nhau; đẩy phần còn lại ra sau.
            idx = o.setdefault('indexByName', {})
            if idx.get('Value #E') is None:
                cho = idx.get('loi_nguon', 3)
                for k in list(idx):
                    if idx[k] > cho:
                        idx[k] += 1
                idx['Value #E'] = cho + 1

    ov = o18['fieldConfig'].setdefault('overrides', [])
    ov = [x for x in ov if x['matcher']['options'] != 'Lần dừng gần nhất']
    ov.append({'matcher': {'id': 'byName', 'options': 'Lần dừng gần nhất'},
               'properties': [
                   {'id': 'mappings',
                    'value': [{'type': 'value',
                               'options': {k: {'text': t, 'color': c, 'index': int(k)}
                                           for k, (t, c) in VI_SAO.items()}}]},
                   {'id': 'custom.cellOptions', 'value': {'type': 'color-text'}},
                   {'id': 'noValue', 'value': '—'}]})
    o18['fieldConfig']['overrides'] = ov


def main():
    d = json.load(io.open(DUONG, encoding='utf-8'))
    o_map = o_theo_id(d)
    thieu = [pid for pid, _ in O_DEM if pid not in o_map]
    thieu += [pid for hang in KHOI for pid, _, _, _ in hang if pid not in o_map]
    if thieu:
        raise SystemExit('thieu o: %s' % thieu)

    dat_o_dem(o_map)
    cao = dat_khoi(o_map)
    for pid, ten in DOI_TEN.items():
        o_map[pid]['title'] = ten
    them_cot_vi_sao(o_map[18])

    d['panels'].sort(key=lambda p: (p['gridPos']['y'], p['gridPos']['x']))
    d['version'] = int(d.get('version') or 0) + 1
    io.open(DUONG, 'w', encoding='utf-8').write(
        json.dumps(d, ensure_ascii=False, indent=2) + '\n')
    print('da xep lai %d o, cao %d hang, version=%d' % (len(d['panels']), cao, d['version']))


if __name__ == '__main__':
    main()
