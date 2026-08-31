#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Thêm nhãn cho mã tình trạng 8 (`ngoai-gio`) vào các bảng Grafana, và gọi đúng tên hai ô mã thô.

VÌ SAO

`dong-bo-tinh-trang.py` từ 27/08 phát thêm mã 8 = `ngoai-gio`: ngoài giờ xưởng chạy mà máy im thì
đó là **đã tắt máy về nhà**, không phải mất tín hiệu. Mã mới mà bảng chưa có `mappings` thì Grafana
in ra **số 8 trần** — tệ hơn cả nhãn sai, vì không ai đoán được 8 nghĩa là gì.

Căn cứ để được phép suy "im + ngoài giờ = đã tắt": máy A15 cắm điện thì đẩy khung mỗi 2 giây kể cả
lúc rảnh (đo trên `602602704E7B`: 1 799 khung/giờ suốt đêm, `cur=0 tot=0 pat=`). Máy im chưa bao
giờ nghĩa là "máy rảnh".

⚠ SỬA FILE, ĐỪNG SỬA QUA API

Bảng ở đây do Grafana **nạp từ file** (`quan-sat/grafana/provisioning/dashboards/tu-dong.yml`,
`updateIntervalSeconds: 30`). Ghi qua `POST /api/dashboards/db` thì bộ nạp lấy file trên đĩa đè lại
trong vòng nửa phút — đã cắn thật: chạy hai lượt liên tiếp đều báo "đã vá 13 chỗ" và `version` nhảy
+2 mỗi lượt (một của mình, một của bộ nạp khôi phục). File JSON MỚI là bản gốc.

HAI Ô MÃ THÔ (`dahao-tuyen` id 6, `dahao-tinh-trang` id 10) SỬA KIỂU KHÁC

Hai ô ấy đọc mã máy tự khai (`-1/0/2/15`) từ log broker, KHÔNG đọc `tinh-trang`, nên chúng không
biết mấy giờ và mãi mãi không biết. Chỗ trống trong đó đang bị dán chữ **"máy off"** — một lời
khẳng định về cái máy, dựng lên từ chỗ hoàn toàn không có số liệu. Đổi thành "máy không gửi khung":
đúng cả ban ngày lẫn ban đêm, và không thay xưởng khẳng định hộ cái gì.

Đối chiếu: hai ô timeline của `tinh-trang`/`mot-may` vốn đã ghi "không có số liệu" — đúng sẵn,
KHÔNG đụng vào.

An toàn: chép bản hiện tại ra `du-lieu/bang-truoc-ngoai-gio/` trước khi ghi (đừng đẻ thêm `.bak`
vào chính thư mục bộ nạp đang quét). Chạy lại bao nhiêu lần cũng được — có mã 8 rồi thì bỏ qua.
"""
import io
import json
import os
import sys

NHA = os.path.expanduser('~/dahao-gateway/quan-sat')
BANG = os.path.join(NHA, 'grafana', 'dashboards')
LUU = os.path.join(NHA, 'du-lieu', 'bang-truoc-ngoai-gio')

# Bộ tên mã 0..7 phải khớp `MA_TT` bên `dong-bo-tinh-trang.py`. Dùng làm DẤU NHẬN DẠNG: một bảng
# `mappings` chỉ được coi là bảng tình trạng khi nó có đủ mấy mã này — để không đi vá nhầm bảng
# mã thô (`-1/0/2/15`) vốn trùng số 0 và 2 mà nghĩa hoàn toàn khác.
DAU_NHAN_DANG = {'1', '3', '4', '5', '6', '7'}

# Hai ô đọc mã máy TỰ KHAI. `(uid, panel id)`.
O_MA_THO = {('dahao-tuyen', 6), ('dahao-tinh-trang', 10)}
CHU_CU_MA_THO = 'máy off'
CHU_MOI_MA_THO = 'máy không gửi khung'


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


def va_tinh_trang(mp):
    """Thêm mã 8 vào một bảng `mappings` nếu đó đúng là bảng tình trạng. Trả True nếu có đổi."""
    for e in mp:
        if e.get('type') != 'value':
            continue
        op = e.get('options') or {}
        if not DAU_NHAN_DANG.issubset(set(op)):
            continue
        if '8' in op:
            return False
        bay = op.get('7') or {}
        chu_hoa = str(bay.get('text') or '').isupper()
        op['8'] = {
            'text': 'NGOÀI GIỜ' if chu_hoa else 'ngoài giờ',
            # Xám hơn cả `tat-han`, cố ý: ngoài giờ là chuyện ĐÚNG DỰ KIẾN, phải là thứ im nhất
            # trên màn hình. Ô timeline cần màu đặc để còn nhìn thấy dải; ô số thì để màu chữ.
            'color': '#4b4b58' if str(bay.get('color', '')).startswith('#') else 'text',
            'index': 8,
        }
        return True
    return False


def va_ma_tho(mp):
    """Đổi chữ của nhánh `special: null` ở hai ô mã thô. Trả True nếu có đổi."""
    for e in mp:
        if e.get('type') != 'special':
            continue
        kq = (e.get('options') or {}).get('result') or {}
        if kq.get('text') == CHU_CU_MA_THO:
            kq['text'] = CHU_MOI_MA_THO
            return True
    return False


def main():
    if not os.path.isdir(LUU):
        os.makedirs(LUU)
    tong = 0
    for ten in sorted(os.listdir(BANG)):
        # CHỈ `.json` trần. Mấy file `.json.pre-*.bak` nằm cùng thư mục là bản lưu tay của lượt
        # sửa trước; Grafana bỏ qua chúng thì mình cũng phải bỏ qua, không thì vá vào đồ cổ.
        if not ten.endswith('.json'):
            continue
        duong = os.path.join(BANG, ten)
        goc = io.open(duong, encoding='utf-8').read()
        d = json.loads(goc)
        uid = d.get('uid') or ten[:-5]
        doi = []
        for p in moi_o(d):
            pid = p.get('id')
            for mp in moi_bang_mapping(p):
                if va_tinh_trang(mp):
                    doi.append('%s:ma8' % pid)
                if (uid, pid) in O_MA_THO and va_ma_tho(mp):
                    doi.append('%s:chu-ma-tho' % pid)
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
