#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Chữa bốn ô "đông cứng" trên bảng `dahao-tuyen`, và nói lại cho đúng ô nhịp bản tin.

BỆNH

Grafana chạy `query_range` chứ không phải truy vấn tức thời. Loki **không phát mẫu 0** cho khoảng
trống — chuỗi chỉ đơn giản là KẾT THÚC. `lastNotNull` bèn giữ nguyên giá trị thật cuối cùng, mãi
mãi, và `graphMode: "none"` giấu luôn chỗ đứt. Kết quả: ô "Máy đang nói (5 phút qua)" đứng ở **3,
màu xanh**, trong khi cả xưởng đã tắt máy từ nhiều tiếng trước. Đây là kiểu hỏng tệ nhất — không
báo lỗi, không "No data", chỉ là một con số cũ mặc áo xanh.

Đổi `lastNotNull` sang `last` KHÔNG chữa được: khung dữ liệu trả về không hề có ô rỗng nào, nó
ngắn đi thôi. Phải sửa trong CHÍNH TRUY VẤN, bằng `or vector(0)`.

CHỈ VÁ BỐN Ô NÀY, CÓ LÝ DO

`or vector(0)` chỉ đúng khi 0 là **câu trả lời thật**: "không máy nào nói trong 5 phút qua" = 0.
Bốn ô của `dahao-tuyen` đều là con số gộp toàn xưởng nên hợp.

Các ô tương tự bên `dahao-can-xu-ly` (120/121/122) và `dahao-mot-may` (301/302) thì **cấm vá kiểu
này**: chúng gộp `by (may, ten)`, nhét thêm `vector(0)` là đẻ ra một chuỗi KHÔNG CÓ TÊN MÁY. Riêng
ô 301 "Đang thế nào" đọc `unwrap ma` — mà `ma` = 0 nghĩa là **`loi`**. Vá bừa vào đó là biến "chưa
đọc được" thành "máy đang lỗi", tự dựng ra sự cố không có thật. Chỗ đông cứng theo từng máy là bệnh
khác, phải chữa cách khác; ghi ra đây để người sau đừng "vá nốt cho đều".

CÒN MÀU NỮA, KHÔNG VÁ MÀU LÀ CÔNG CỐC

Ngưỡng cũ của ô 1: **đỏ khi < 1**. Vá xong `or vector(0)` thì đêm nào ô cũng tụt về 0 và đỏ rực —
đúng cái tật "hô hoán suốt đêm rồi dạy người ta lờ màu đỏ" vừa mới chữa bên `dong-bo-tinh-trang`.
Mà ô này đọc thẳng log broker, **không biết mấy giờ và mãi mãi không biết** (đó là mục đích của nó:
trả lời "đường ống còn sống không", độc lập với mọi suy luận). Nên: 0 để **màu chữ trung tính**,
≥1 mới xanh. Chỗ được phép đỏ là bảng `dahao-can-xu-ly` — bảng đó ăn `job="tinh-trang"`, có đồng hồ.
Kèm `graphMode: "area"` để NHÌN THẤY lúc nó tụt, thay vì chỉ đọc một con số trần.

Chạy lại bao nhiêu lần cũng được.
"""
import io
import json
import os
import sys

NHA = os.path.expanduser('~/dahao-gateway/quan-sat')
DUONG = os.path.join(NHA, 'grafana', 'dashboards', 'dahao-tuyen.json')
LUU = os.path.join(NHA, 'du-lieu', 'bang-truoc-ngoai-gio')

O_GOP = (1, 2, 3, 4)

MO_TA_O1 = ("Đếm số định danh máy khác nhau có phát bản tin trạng thái trong 5 phút gần đây.\n\n"
            "Ô này đọc THẲNG log broker nên không biết mấy giờ: 0 lúc 9 giờ tối là cả xưởng đã tắt "
            "máy về nhà, 0 lúc 10 giờ sáng là đường ống chết. Nó không phân biệt được, và cố ý "
            "không đoán — vì thế 0 để màu trung tính chứ không đỏ. Muốn biết máy nào đang cần "
            "người thì xem bảng 'Cần xử lý', bảng đó có đồng hồ.\n\n"
            "Sửa 27/08: trước đây không có nhánh `or vector(0)`, nên khi máy ngừng nói thì chuỗi "
            "Loki KẾT THÚC (Loki không phát mẫu 0) và `lastNotNull` giữ nguyên con số cũ vô thời "
            "hạn — ô đứng ở 3 màu xanh suốt đêm.")

MO_TA_O5 = ("Nhịp bản tin của từng máy, mỗi máy một đường.\n\n"
            "Máy ngừng nói thì đường **ĐỨT**, không phải tụt xuống 0 — Loki không phát mẫu 0 cho "
            "khoảng trống. `spanNulls` để tắt chính là để nhìn thấy chỗ đứt đó; đừng bật lên, bật "
            "lên là nối liền qua quãng mất tín hiệu. Cột `min` trong chú giải là nhịp thấp nhất "
            "ĐO ĐƯỢC, không phải mức máy tụt xuống.\n\n"
            "Thêm máy vào xưởng thì đường mới tự hiện, không phải sửa bảng.")


def main():
    goc = io.open(DUONG, encoding='utf-8').read()
    d = json.loads(goc)
    doi = []
    for p in (d.get('panels') or []):
        pid = p.get('id')
        if pid in O_GOP:
            for t in (p.get('targets') or []):
                e = t.get('expr')
                if e and 'or vector(' not in e:
                    t['expr'] = '(%s) or vector(0)' % e
                    doi.append('%s:vector0' % pid)
        if pid == 1:
            b = ((p.get('fieldConfig') or {}).get('defaults') or {}).get('thresholds') or {}
            for s in (b.get('steps') or []):
                if s.get('value') is None and s.get('color') == 'red':
                    s['color'] = 'text'
                    doi.append('1:mau-0-thanh-trung-tinh')
            if (p.get('options') or {}).get('graphMode') == 'none':
                p['options']['graphMode'] = 'area'
                doi.append('1:hien-duong')
            if p.get('description') != MO_TA_O1:
                p['description'] = MO_TA_O1
                doi.append('1:mo-ta')
        if pid == 5 and p.get('description') != MO_TA_O5:
            p['description'] = MO_TA_O5
            doi.append('5:mo-ta')
    if not doi:
        print('khong can doi')
        return 0
    if not os.path.isdir(LUU):
        os.makedirs(LUU)
    io.open(os.path.join(LUU, 'dahao-tuyen.json.pre-dongcung'), 'w', encoding='utf-8').write(goc)
    io.open(DUONG, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
    print('da va: %s' % ', '.join(doi))
    return 0


if __name__ == '__main__':
    sys.exit(main())
