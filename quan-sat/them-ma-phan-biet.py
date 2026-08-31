#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Thêm nhãn cho hai mã tình trạng mới 9 (`cum-im`) và 10 (`tat-may`) vào các bảng Grafana.

VÌ SAO

`dong-bo-tinh-trang.py` từ 28/08 tách ô "máy im" ra làm nhiều nhánh, vì user hỏi thẳng: *"tôi muốn
nó phân biệt được lúc nào không làm và lúc nào nó mất tín hiệu"*. Trước đó mọi thứ im đều bị dán
một chữ duy nhất — trưa 27/08 có **1 035 lượt** đọc ra `off` (= "mất tín hiệu"), trong đó **636
lượt (61,4 %)** thật ra là máy đã thêu xong tấm rồi thợ tắt đi ăn cơm.

  · **9 = `cum-im`** — KHÔNG CÒN MỘT MÁY NÀO trong xưởng đang nói. 13 cái máy không cùng hỏng một
    lúc, nên đây là mất điện / đứt mạng / bộ ghi chết. Không quy được cho cái máy nào cả.
  · **10 = `tat-may`** — một mình nó im giữa đàn đang nói, VÀ số mũi lần đọc cuối cho thấy nó đã
    thêu hết tấm (hoặc chưa động vào mẫu nào). Tức là tắt có chủ ý, không phải sự cố.

Mã mới mà bảng chưa có `mappings` thì Grafana in ra **số 9 / số 10 trần** — tệ hơn nhãn sai, vì
không ai đoán được nó nghĩa gì.

⚠ SỬA FILE, ĐỪNG SỬA QUA API — bảng do Grafana nạp từ file (`provisioning/dashboards/tu-dong.yml`,
`updateIntervalSeconds: 30`); ghi qua `POST /api/dashboards/db` là bị bộ nạp đè lại trong nửa phút.

Chạy lại bao nhiêu lần cũng được. Bản trước khi ghi chép ra `du-lieu/bang-truoc-phan-biet/`.
"""
import io
import json
import os
import sys

NHA = os.path.expanduser('~/dahao-gateway/quan-sat')
BANG = os.path.join(NHA, 'grafana', 'dashboards')
LUU = os.path.join(NHA, 'du-lieu', 'bang-truoc-phan-biet')

# Dấu nhận dạng bảng tình trạng: phải có đủ mấy mã này thì mới là nó. Cốt để không vá nhầm bảng mã
# THÔ (`-1/0/2/15`) vốn trùng số 0 và 2 mà nghĩa hoàn toàn khác, và bảng lý do dừng của
# `dahao-can-xu-ly` (0..6 + 90) vốn cũng trùng số mà khác nghĩa — bảng ấy KHÔNG có mã 7.
DAU_NHAN_DANG = {'1', '3', '4', '5', '6', '7', '8'}

# Chữ và màu. Hai giọng: ô timeline viết HOA, ô số viết thường — theo đúng lệ sẵn có, dò bằng chữ
# của mã 7 chứ không ghim cứng theo tên bảng.
MOI = {
    '9': {
        'hoa': 'CẢ XƯỞNG IM', 'thuong': 'cả xưởng im',
        # Vàng, KHÔNG đỏ: đỏ là lời khẳng định về cái máy, mà `cum-im` nói về ĐƯỜNG ĐO chứ không
        # nói về máy. Nhưng cũng không được xám như `ngoai-gio`: giữa giờ làm mà cả xưởng im là
        # chuyện phải có người đi xem ngay.
        'mau_dam': '#d9a441', 'mau_nhat': 'yellow',
    },
    '10': {
        'hoa': 'THỢ TẮT MÁY', 'thuong': 'thợ tắt máy',
        # Xám sáng hơn `tat-han`(#3a3a44) và `ngoai-gio`(#4b4b58) để ba sắc xám còn phân biệt được
        # trên dải timeline, nhưng vẫn là xám: tắt có chủ ý thì không được tranh chỗ nhìn với lỗi.
        'mau_dam': '#6b6b7a', 'mau_nhat': 'text',
    },
}


# Ô "Máy nào đang báo lỗi — và lỗi gì" dịch cột `loi_do` sang tiếng người. `bao_loi()` từ 28/08
# phát thêm HAI mã lý do; thiếu ở đây thì ô ấy in ra chuỗi thô `mat-tin-hieu-dang-theu`.
LOI_DO_MOI = {
    'ca-cum-im': 'Cả xưởng cùng im — chưa biết vì đâu (điện, mạng, hết ca, hay bộ ghi)',
    'mat-tin-hieu-dang-theu': 'Mất tín hiệu giữa lúc đang thêu dở',
}
# Dấu nhận dạng bảng `loi_do`: mã này chỉ bảng ấy mới có.
DAU_LOI_DO = 'bridge-khong-doc-duoc'


def moi_bang_mapping(p):
    """Trả mọi danh sách `mappings` trong một ô — cả `defaults` lẫn từng `override`."""
    fc = p.get('fieldConfig') or {}
    d = fc.get('defaults') or {}
    if isinstance(d.get('mappings'), list):
        yield d['mappings']
    for o in (fc.get('overrides') or []):
        for pr in (o.get('properties') or []):
            if pr.get('id') == 'mappings' and isinstance(pr.get('value'), list):
                yield pr['value']


def moi_o(ds):
    for p in (ds.get('panels') or []):
        yield p
        for con in (p.get('panels') or []):
            yield con


def va(mp):
    """Thêm mã 9 và 10 vào một bảng `mappings` nếu đó đúng là bảng tình trạng.

    Trả danh sách mã đã thêm. Bảng đã có sẵn thì trả rỗng — chạy lại không đẻ thêm gì."""
    them = []
    for e in mp:
        if e.get('type') != 'value':
            continue
        op = e.get('options') or {}
        if not DAU_NHAN_DANG.issubset(set(op)):
            continue
        # Giọng chữ và kiểu màu lấy theo mã 8 đang có sẵn trong CHÍNH bảng này.
        tam = op.get('8') or {}
        chu_hoa = str(tam.get('text') or '').isupper()
        dam = str(tam.get('color', '')).startswith('#')
        for ma in ('9', '10'):
            if ma in op:
                continue
            c = MOI[ma]
            op[ma] = {
                'text': c['hoa'] if chu_hoa else c['thuong'],
                'color': c['mau_dam'] if dam else c['mau_nhat'],
                'index': int(ma),
            }
            them.append(ma)
        return them
    return them


def va_loi_do(mp):
    """Thêm chữ cho mấy mã `loi_do` mới. Trả danh sách mã đã thêm."""
    them = []
    for e in mp:
        if e.get('type') != 'value':
            continue
        op = e.get('options') or {}
        if DAU_LOI_DO not in op:
            continue
        # Chen vào TRƯỚC `chua-ket-luan` để nhánh "chưa kết luận" vẫn nằm cuối danh sách.
        n = max([v.get('index', 0) for v in op.values() if isinstance(v, dict)] or [0])
        for ma, chu in LOI_DO_MOI.items():
            if ma in op:
                continue
            n += 1
            op[ma] = {'text': chu, 'index': n}
            them.append(ma)
        return them
    return them


def main():
    if not os.path.isdir(LUU):
        os.makedirs(LUU)
    tong = 0
    for ten in sorted(os.listdir(BANG)):
        # CHỈ `.json` trần. Mấy file `.json.pre-*.bak` cùng thư mục là bản lưu tay của lượt trước;
        # Grafana bỏ qua chúng thì mình cũng phải bỏ qua, không thì vá vào đồ cổ.
        if not ten.endswith('.json'):
            continue
        duong = os.path.join(BANG, ten)
        goc = io.open(duong, encoding='utf-8').read()
        d = json.loads(goc)
        uid = d.get('uid') or ten[:-5]
        doi = []
        for p in moi_o(d):
            for mp in moi_bang_mapping(p):
                for ma in va(mp):
                    doi.append('%s:ma%s' % (p.get('id'), ma))
                for ma in va_loi_do(mp):
                    doi.append('%s:%s' % (p.get('id'), ma))
        if not doi:
            print('  =  %-18s khong can doi' % uid)
            continue
        io.open(os.path.join(LUU, ten), 'w', encoding='utf-8').write(goc)
        io.open(duong, 'w', encoding='utf-8').write(
            json.dumps(d, ensure_ascii=False, indent=2) + '\n')
        tong += len(doi)
        print('  OK %-18s %s' % (uid, ', '.join(doi)))
    print('\nda va %d cho' % tong)
    return 0


if __name__ == '__main__':
    sys.exit(main())
