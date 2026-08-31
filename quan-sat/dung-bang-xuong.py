#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dựng ba bảng Grafana chuyên đề cho xưởng, từ các ô ĐÃ KIỂM CHỨNG của `dahao-tinh-trang`.

  1. `dahao-can-xu-ly`  — máy nào cần người ra xử lý, tách làm ba nhóm việc khác nhau.
  2. `dahao-dut-chi`    — chuyên đề đứt chỉ / vá: máy nào, mẫu nào, giờ nào.
  3. `dahao-mot-may`    — soi kỹ MỘT máy, cho thợ đứng tại máy đó.

Nguyên tắc giữ nguyên như `dung-bang-xem-nhanh.py`: **không viết truy vấn mới từ đầu**. Chép ô
đã chạy thật rồi chỉ thêm cái chặn (`and on (may) …`) và đổi cột. Bảng mã (tình trạng, vì sao
dừng) **đọc ngược từ chính `dahao-tinh-trang.json`**, không chép tay lần thứ năm.

⚠ Vì sao phải chặn TỪNG target chứ không lọc ở tầng bảng: `joinByField` ghép kiểu **outer**, nên
chỉ cần một target còn trả về máy X là máy X vẫn hiện ra hàng — dù target "tình trạng" đã lọc nó
đi. Lọc bằng `filterByValue` thì gặp rủi ro khác: sai tên cột là nó **âm thầm không lọc gì**.
Chặn ở LogQL không có kiểu hỏng im lặng ấy.
"""
import copy
import io
import json
import os
import sys

NGUON = sys.argv[1]
RA = sys.argv[2]

# Tình trạng mới nhất của mỗi máy — dùng làm cái chặn cho mọi bảng.
V = 'last_over_time({job="tinh-trang", may=~"$may"} | json | unwrap ma [3m]) by (may)'
# Bản có kèm nhãn `ten`. Chỉ `job="tinh-trang"` mới mang tên máy; `job="va-mau"` KHÔNG có nhãn `ten`.
VT = 'last_over_time({job="tinh-trang", may=~"$may"} | json | unwrap ma [3m]) by (may, ten)'
GIAY = 'last_over_time({job="tinh-trang", may=~"$may"} | json | unwrap giay [3m]) by (may, ten)'
# Lần dừng đang mở của bộ dò lùi-mũi (`soi-lan-dung.py`). Giá trị = MA_NGHI.
NGHI = 'last_over_time({job="va-mau", may=~"$may", viec=~"mo|dang"} | unwrap ma_nghi [2m]) by (may)'
# Mã bịa THÊM cho riêng chỗ hiển thị: máy đang dừng mà bộ dò chưa mở lần dừng nào.
# Thà hiện một ô "chưa rõ vì sao" còn hơn để máy ấy BIẾN MẤT khỏi bảng việc cần làm.
CHUA_RO = 90

# MA_TT: 0 lỗi · 1 dừng · 2 mất tín hiệu · 3 chưa rõ · 4 hoàn thành · 5 chờ việc · 6 thêu · 7 tắt hẳn
NHOM = {
    'dung':  ['1'],
    'mat':   ['0', '2', '7'],
    'nghi':  ['3', '4', '5'],
    'chay':  ['6'],
}


def chan(ma_list):
    """Vector chỉ chứa những máy đang ở một trong các mã ấy."""
    return ' or '.join('(%s == %s)' % (V, m) for m in ma_list)


def chan_ten(ma_list):
    """Như `chan()` nhưng giữ cả nhãn `ten`, để ô chữ lớn có tên máy mà ghi."""
    return ' or '.join('(%s == %s)' % (VT, m) for m in ma_list)


def cong(expr, g):
    return '(%s)\n  and on (may) (%s)' % (expr, g)


def keo_ten(expr, ma_list):
    """Kèm nhãn `ten` vào một biểu thức KHÔNG có tên (vd `va-mau`), đồng thời chặn đúng nhóm máy.

    Nhân với `0 * (chặn) + 1` để giữ nguyên GIÁ TRỊ của vế trái mà chỉ mượn cái nhãn.
    `group_left(ten)` là chỗ nhãn `ten` từ `tinh-trang` chui sang.
    """
    return '(%s)\n  * on (may) group_left(ten) (0 * (%s) + 1)' % (expr, chan_ten(ma_list))


def lay_mappings(o7, ten_cot):
    """Đọc bảng ánh xạ từ chính ô 7 — đừng chép tay bảng mã thêm lần nào nữa."""
    for ov in o7['fieldConfig']['overrides']:
        if ov['matcher']['options'] == ten_cot:
            for pr in ov['properties']:
                if pr['id'] == 'mappings':
                    return copy.deepcopy(pr['value'])
    raise SystemExit('khong tim thay mappings cua cot "%s"' % ten_cot)


def chon_cot(p, giu, them=None):
    """Giữ đúng các cột (theo TÊN HIỂN THỊ) và xếp theo thứ tự ấy; còn lại ẩn hết."""
    tr = next(t for t in p['transformations'] if t['id'] == 'organize')
    o = tr['options']
    doi = dict(o.get('renameByName', {}))
    doi.update(them or {})
    o['renameByName'] = doi
    nguoc = {v: k for k, v in doi.items()}
    thay = [nguoc[g] for g in giu if g in nguoc]
    thieu = [g for g in giu if g not in nguoc]
    if thieu:
        raise SystemExit('khong co cot: %s' % thieu)
    tat_ca = set(doi) | set(o.get('indexByName', {}))
    o['excludeByName'] = {k: True for k in tat_ca if k not in thay}
    o['indexByName'] = {k: i for i, k in enumerate(thay)}


def bang_tu_o7(o7, nhom, tieu_de, giu, mo_ta=None, them_loi_text=False):
    """Một biến thể của ô 7: chỉ những máy thuộc `nhom`, và ít cột hơn."""
    p = copy.deepcopy(o7)
    g = chan(NHOM[nhom])
    for t in p['targets']:
        e = t['expr']
        if them_loi_text and t['refId'] == 'D':
            e = e.replace('sum by (may, ten, mau)', 'sum by (may, ten, mau, loi_text)')
        t['expr'] = cong(e, g)
    if them_loi_text:
        for tr in p['transformations']:
            if tr['id'] == 'filterFieldsByName':
                tr['options']['include']['pattern'] = '^(may|ten|mau|loi_text|Value.*)$'
    p['title'] = tieu_de
    if mo_ta:
        p['description'] = mo_ta
    chon_cot(p, giu, {'loi_text': 'Bridge nói gì'} if them_loi_text else None)
    p['options'] = dict(p.get('options') or {})
    p['options']['cellHeight'] = 'md'
    return p


def o_dem(mau_o, tieu_de, expr, mau_sac, nguong=1, mo_ta=None):
    p = copy.deepcopy(mau_o)
    p['title'] = tieu_de
    p['targets'] = [dict(p['targets'][0], expr=expr)]
    p['fieldConfig']['defaults']['thresholds'] = {
        'mode': 'absolute',
        'steps': [{'color': 'text', 'value': None}, {'color': mau_sac, 'value': nguong}]}
    p['options'] = dict(p['options'])
    p['options']['colorMode'] = 'background'
    p['options']['text'] = {'titleSize': 16, 'valueSize': 56}
    if mo_ta:
        p['description'] = mo_ta
    return p


def o_to(mau_o, tieu_de, expr, mo_ta, mappings=None, mau_nen='red', don_vi=None, co_gt=34):
    """Một Ô CHỮ LỚN: mỗi máy một thẻ, TÊN MÁY ở trên, sự cố / thời gian ở dưới.

    TÊN MÁY luôn ghim cứng 22px, không cho Grafana tự co: tự co thì nó ưu tiên giá trị và bóp
    tên máy bé lại, mà tên máy chính là thứ người ta cần đọc để biết đi tới máy nào.

    GIÁ TRỊ thì tuỳ loại. Số ngắn ("1.3 giờ") ghim 34px cho đều mắt. Nhưng ô 🟠 hiện CÂU
    ("đang dừng — chưa rõ vì sao", 25 chữ): ghim cứng là câu ấy tràn ra ngoài thẻ hẹp và bị cắt
    cụt — nên chỗ ấy truyền `co_gt=None` để Grafana tự co riêng phần giá trị.

    Canh cho trường hợp XẤU NHẤT: cả 13 máy cùng rơi vào một nhóm. Đo thật bằng bản dựng lại
    ngoài Grafana: 13 thẻ trong ô rộng 24 ⇒ lưới 2×7 ⇒ mỗi thẻ ~200×113px; 22px tên + 34px giá
    trị vừa lọt. Nên chiều cao ô KHÔNG được xuống dưới 6 hàng lưới.
    """
    p = copy.deepcopy(mau_o)
    p['title'] = tieu_de
    p['description'] = mo_ta
    p['targets'] = [dict(p['targets'][0], expr=expr, legendFormat='{{ten}}')]
    d = p['fieldConfig']['defaults']
    d['mappings'] = mappings or []
    d['color'] = {'mode': 'thresholds'}
    d['thresholds'] = {'mode': 'absolute', 'steps': [{'color': mau_nen, 'value': None}]}
    d['noValue'] = 'Không có máy nào'
    d['displayName'] = '${__field.labels.ten}'
    if don_vi:
        d['unit'] = don_vi
        d['decimals'] = 0
    else:
        d.pop('unit', None)
    p['options'] = {
        'colorMode': 'background', 'graphMode': 'none', 'justifyMode': 'center',
        'orientation': 'auto', 'textMode': 'value_and_name', 'wideLayout': True,
        'percentChangeColorMode': 'standard', 'showPercentChange': False,
        'reduceOptions': {'calcs': ['lastNotNull'], 'fields': '', 'values': False},
        'text': {'titleSize': 22} if co_gt is None else {'titleSize': 22, 'valueSize': co_gt},
    }
    return p


def hang_gap(tieu_de, y, pid, trong):
    """Hàng gấp lại — phần chi tiết chữ nhỏ giấu ở đây, bấm mới mở."""
    return {'collapsed': True, 'type': 'row', 'id': pid, 'title': tieu_de,
            'gridPos': {'h': 1, 'w': 24, 'x': 0, 'y': y}, 'panels': trong}


def khung(p, x, y, w, h, pid):
    p['gridPos'] = {'h': h, 'w': w, 'x': x, 'y': y}
    p['id'] = pid
    return p


def vo(uid, ten, tags, panels, goc, refresh='10s', tu='now-6h', bien=None, mo_ta='', phien=1):
    # ⚠ `version` PHẢI lớn hơn bản đang nằm trong DB, không thì `allowUiUpdates: true` khiến
    # Grafana lặng lẽ bỏ qua file: không log, không lỗi, mtime mới tinh, mà bảng thật không đổi.
    return {
        'uid': uid, 'title': ten, 'tags': tags, 'description': mo_ta,
        'timezone': goc.get('timezone', 'browser'),
        'schemaVersion': goc.get('schemaVersion', 39),
        'editable': False, 'graphTooltip': 0, 'refresh': refresh,
        'time': {'from': tu, 'to': 'now'},
        'templating': bien or copy.deepcopy(goc['templating']),
        'panels': panels, 'version': phien,
    }


def bien_may(goc, nhieu):
    """Lấy danh sách máy từ `tinh-trang` chứ không từ `broker` — nguồn broker THIẾU A15-MQTT."""
    t = copy.deepcopy(goc['templating'])
    v = t['list'][0]
    v['query'] = 'label_values({job="tinh-trang"}, may)'
    if nhieu:
        return t
    v['multi'] = False
    v['includeAll'] = False
    v.pop('allValue', None)
    v['current'] = {}
    v['label'] = 'Chọn máy'
    return t


def ghi(d, ten_tep):
    duong = os.path.join(RA, ten_tep)
    io.open(duong, 'w', encoding='utf-8').write(
        json.dumps(d, ensure_ascii=False, indent=2) + '\n')
    print('%-28s v%s  %2d o  %s' % (d['uid'], d['version'], len(d['panels']), duong))
    for p in sorted(d['panels'], key=lambda x: (x['gridPos']['y'], x['gridPos']['x'])):
        g = p['gridPos']
        print('     id=%-4d %-14s y=%-3d h=%-3d w=%-3d %s'
              % (p['id'], p['type'], g['y'], g['h'], g['w'], p['title']))
        for c in sorted(p.get('panels', []), key=lambda x: x['gridPos']['y']):
            gc = c['gridPos']
            print('       └ id=%-4d %-14s y=%-3d h=%-3d w=%-3d %s'
                  % (c['id'], c['type'], gc['y'], gc['h'], gc['w'], c['title']))


def main():
    goc = json.load(io.open(NGUON, encoding='utf-8'))
    o = {p['id']: p for p in goc['panels']}
    o7 = o[7]

    # ── Bảng 1: cần xử lý ────────────────────────────────────────────────────────────────────
    tiles = [
        o_dem(o[2], 'Dừng giữa mẫu', 'count(%s) or vector(0)' % chan(NHOM['dung']), 'orange',
              mo_ta='Máy đang dở tấm mà đứng im. Đây là nhóm CẦN RA XEM NGAY.'),
        o_dem(o[2], 'Mất tín hiệu', 'count(%s) or vector(0)' % chan(NHOM['mat']), 'red',
              mo_ta='Máy không còn gửi tin. Có thể máy tắt, rớt mạng, hoặc đường đo hỏng — '
                    'xem cột "Bridge nói gì" ở bảng dưới.'),
        o_dem(o[2], 'Xong tấm / chờ việc', 'count(%s) or vector(0)' % chan(NHOM['nghi']), 'blue',
              mo_ta='Máy khỏe nhưng không có việc. Cần nạp mẫu mới hoặc thay khung.'),
        o_dem(o[2], 'Đang chạy', 'count(%s) or vector(0)' % chan(NHOM['chay']), 'green'),
    ]
    p = [khung(t, i * 6, 0, 6, 4, 101 + i) for i, t in enumerate(tiles)]

    # ── Ba ô CHỮ LỚN: tên máy + sự cố, đọc được từ xa ────────────────────────────────────────
    ly_do = lay_mappings(o7, 'Vì sao dừng')
    ly_do[0]['options'][str(CHUA_RO)] = {
        'text': 'đang dừng — chưa rõ vì sao', 'color': 'orange', 'index': 90}
    p.append(khung(o_to(
        o[2], '🟠 ĐANG DỪNG GIỮA MẪU — ra xem ngay',
        # Vế `or` là lưới an toàn: máy đang dừng mà bộ dò lùi-mũi chưa mở lần dừng nào thì
        # vẫn phải hiện ra, chỉ là ghi "chưa rõ vì sao". Thiếu vế này là máy im lặng biến mất.
        '%s\n  or (0 * (%s) + %d)' % (keo_ten(NGHI, NHOM['dung']), chan_ten(NHOM['dung']), CHUA_RO),
        'Mỗi thẻ một máy đang dở tấm mà đứng im. Chữ dưới tên là SUY LUẬN từ số mũi — '
        'máy không tự báo lỗi bao giờ.', mappings=ly_do, mau_nen='orange',
        # Giá trị ở đây là CÂU chứ không phải số ⇒ để Grafana tự co, ghim cứng là cụt chữ.
        co_gt=None), 0, 4, 24, 7, 120))

    p.append(khung(o_to(
        o[2], '🔴 MẤT TÍN HIỆU — máy không còn gửi tin (số là ĐÃ IM BAO LÂU)',
        cong(GIAY, chan(NHOM['mat'])),
        'Không kết luận được là máy hỏng: có thể máy tắt, rớt mạng, hoặc chính đường đo hỏng. '
        'Mở "Chi tiết" ở dưới để đọc nguyên văn bridge nói gì.',
        mau_nen='red', don_vi='s'), 0, 11, 24, 7, 121))

    p.append(khung(o_to(
        o[2], '⚪ XONG TẤM / CHỜ VIỆC — cần nạp mẫu (số là ĐÃ RẢNH BAO LÂU)',
        cong(GIAY, chan(NHOM['nghi'])),
        'Máy khỏe, chỉ là hết việc. Việc cần làm là nạp mẫu / thay khung, không phải sửa máy.',
        mau_nen='blue', don_vi='s'), 0, 18, 24, 6, 122))

    chi_tiet = []
    chi_tiet.append(khung(bang_tu_o7(
        o7, 'dung', '🟠 Đang dừng giữa mẫu — mẫu, mũi, bao lâu',
        ['Máy', 'Vì sao dừng', 'Bao lâu rồi', 'Mẫu đang làm', 'Mũi hiện tại', 'Xong'],
        'Máy đang dở tấm mà số mũi đứng im. Cột "Vì sao dừng" là SUY LUẬN từ số mũi '
        '(máy không tự báo lỗi) — "nghi đứt chỉ" nghĩa là đã có người lùi khung để vá.'),
        0, 25, 24, 7, 110))
    chi_tiet.append(khung(bang_tu_o7(
        o7, 'mat', '🔴 Mất tín hiệu — bridge nói gì',
        ['Máy', 'Tình trạng', 'Bao lâu rồi', 'Bridge nói gì', 'Mẫu đang làm', 'Xong'],
        'Cột "Bridge nói gì" chép nguyên văn câu bridge tự nhận xét — đọc câu ấy trước khi '
        'kết luận máy hỏng.', them_loi_text=True), 0, 32, 24, 7, 111))
    chi_tiet.append(khung(bang_tu_o7(
        o7, 'nghi', '⚪ Xong tấm / chờ việc',
        ['Máy', 'Tình trạng', 'Bao lâu rồi', 'Mẫu đang làm', 'Xong']), 0, 39, 24, 6, 112))
    log = copy.deepcopy(o[15])
    log['title'] = 'Máy vừa dừng vì gì — mới nhất ở trên'
    chi_tiet.append(khung(log, 0, 45, 24, 10, 113))
    chi_tiet.append(khung(bang_tu_o7(
        o7, 'chay', '🟢 Đang chạy — không phải làm gì',
        ['Máy', 'Mẫu đang làm', 'Mũi hiện tại', 'Mũi tổng', 'Xong']), 0, 55, 24, 6, 114))
    p.append(hang_gap('Chi tiết — bảng chữ nhỏ, mẫu, mũi, nhật ký (bấm để mở)', 24, 130, chi_tiet))

    ghi(vo('dahao-can-xu-ly', 'Dahao — cần xử lý', ['dahao', 'xuong', 'xu-ly'], p, goc,
           refresh='10s', tu='now-1h', bien=bien_may(goc, True), phien=4,
           mo_ta='Máy nào cần người ra tay, tách theo LOẠI VIỆC phải làm.'),
        'dahao-can-xu-ly.json')

    # ── Bảng 2: chuyên đề đứt chỉ ────────────────────────────────────────────────────────────
    VM = '{job="va-mau", viec="dong", may=~"$may"}'
    VD = '{job="va-mau", nghi="nghi-dut-chi", viec="dong", may=~"$may"}'
    ti_le = ('100 * (sum(count_over_time(%s [$__range]))\n  / (sum(count_over_time(%s [$__range])) > 0))'
             % (VD, VM))

    q = [khung(copy.deepcopy(o[12]), 0, 0, 8, 5, 201),
         khung(copy.deepcopy(o[13]), 8, 0, 8, 5, 202)]
    q[0]['options'] = dict(q[0]['options'], colorMode='background',
                           text={'titleSize': 16, 'valueSize': 56})
    q[1]['options'] = copy.deepcopy(q[0]['options'])
    q[1]['title'] = 'Tổng lần dừng'
    tl = o_dem(o[2], 'Tỉ lệ phải vá', ti_le, 'orange', nguong=25,
               mo_ta='Trong tất cả các lần dừng, bao nhiêu phần trăm là có người lùi khung vá. '
                     'Mẫu số lọc `> 0` để khỏi ra NaN khi chưa có lần dừng nào.')
    tl['fieldConfig']['defaults']['unit'] = 'percent'
    tl['fieldConfig']['defaults']['decimals'] = 0
    q.append(khung(tl, 16, 0, 8, 5, 203))

    may_va = copy.deepcopy(o[14])
    may_va['title'] = 'Máy nào hay phải vá nhất'
    q.append(khung(may_va, 0, 5, 12, 10, 204))

    mau_dut = {
        'id': 205, 'type': 'table', 'title': 'Mẫu nào hay đứt chỉ nhất',
        'description': 'Gộp theo tên file mẫu. Mẫu lên đầu bảng thường là mẫu dày mũi hoặc '
                       'nhiều màu — đáng xem lại chỉ / kim trước khi chạy mẻ sau.',
        'datasource': copy.deepcopy(o[14]['datasource']),
        'gridPos': {'h': 10, 'w': 12, 'x': 12, 'y': 5},
        'targets': [{'refId': 'A', 'datasource': copy.deepcopy(o[14]['datasource']),
                     'queryType': 'instant', 'format': 'table',
                     'expr': 'sort_desc(sum by (mau) (count_over_time(%s [$__range])))' % VD}],
        'transformations': [
            {'id': 'filterFieldsByName', 'options': {'include': {'pattern': '^(mau|Value)$'}}},
            {'id': 'organize', 'options': {
                'renameByName': {'mau': 'Mẫu', 'Value': 'Số lần vá'},
                'indexByName': {'mau': 0, 'Value': 1}}}],
        'fieldConfig': {'defaults': {'noValue': '—', 'custom': {'align': 'auto'}},
                        'overrides': []},
        'options': {'cellHeight': 'md', 'showHeader': True},
    }
    q.append(mau_dut)

    ly_do = copy.deepcopy(o[16])
    ly_do['title'] = 'Lý do dừng theo thời gian — cột cao là lúc xưởng vất'
    q.append(khung(ly_do, 0, 15, 24, 9, 206))
    log2 = copy.deepcopy(o[15])
    log2['title'] = 'Từng lần dừng — nguyên văn'
    q.append(khung(log2, 0, 24, 24, 12, 207))

    ghi(vo('dahao-dut-chi', 'Dahao — đứt chỉ & vá', ['dahao', 'xuong', 'dut-chi'], q, goc,
           refresh='30s', tu='now-24h', bien=bien_may(goc, True), phien=4,
           mo_ta='Chuyên đề đứt chỉ. Nhắc lại: máy KHÔNG tự báo đứt chỉ — đây là suy luận từ '
                 'thao tác lùi khung (sổ tay §2.4).'),
        'dahao-dut-chi.json')

    # ── Bảng 3: soi một máy ──────────────────────────────────────────────────────────────────
    # Biến `may` để một-giá-trị, nên `may=~"$may"` trong mọi ô chép sang vẫn đúng, khỏi sửa gì.
    tt = o_dem(o[2], 'Đang thế nào', V, 'text', mo_ta='Tình trạng mới nhất máy này khai.')
    tt['fieldConfig']['defaults']['mappings'] = lay_mappings(o7, 'Tình trạng')
    tt['fieldConfig']['defaults'].pop('thresholds', None)
    tt['fieldConfig']['defaults']['color'] = {'mode': 'thresholds'}
    tt['fieldConfig']['defaults']['thresholds'] = {'mode': 'absolute',
                                                   'steps': [{'color': 'text', 'value': None}]}
    tt['options']['colorMode'] = 'value'
    tt['options']['text'] = {'titleSize': 16, 'valueSize': 38}

    xong = o_dem(o[2], 'Xong bao nhiêu',
                 '100 * ((last_over_time({job="tinh-trang", may=~"$may"} | json | unwrap mui [3m]) by (may))'
                 '\n  / (last_over_time({job="tinh-trang", may=~"$may"} | json | unwrap tong [3m]) by (may) > 0))',
                 'green', nguong=100)
    xong['fieldConfig']['defaults']['unit'] = 'percent'
    xong['fieldConfig']['defaults']['decimals'] = 0
    xong['options']['colorMode'] = 'value'

    r = [khung(tt, 0, 0, 6, 5, 301),
         khung(xong, 6, 0, 6, 5, 302),
         khung(copy.deepcopy(o[12]), 12, 0, 6, 5, 303),
         khung(copy.deepcopy(o[13]), 18, 0, 6, 5, 304)]
    r[2]['options'] = dict(r[2]['options'], colorMode='background',
                           text={'titleSize': 16, 'valueSize': 46})
    r[3]['options'] = copy.deepcopy(r[2]['options'])
    r[3]['title'] = 'Lần dừng'

    b7 = copy.deepcopy(o7)
    b7['title'] = 'Máy này đang làm gì'
    r.append(khung(b7, 0, 5, 24, 5, 305))
    mui = copy.deepcopy(o[6])
    mui['title'] = 'Mũi thêu dồn — đường NẰM NGANG là máy đang đứng'
    r.append(khung(mui, 0, 10, 24, 10, 306))
    tl2 = copy.deepcopy(o[5])
    tl2['title'] = 'Tình trạng theo thời gian — đọc BỀ NGANG để biết dừng bao lâu'
    r.append(khung(tl2, 0, 20, 24, 6, 307))
    log3 = copy.deepcopy(o[15])
    log3['title'] = 'Mọi lần dừng của máy này'
    r.append(khung(log3, 0, 26, 24, 12, 308))

    ghi(vo('dahao-mot-may', 'Dahao — soi một máy', ['dahao', 'xuong', 'mot-may'], r, goc,
           refresh='10s', tu='now-12h', bien=bien_may(goc, False), phien=4,
           mo_ta='Chọn một máy ở ô trên cùng. Dành cho thợ đang đứng tại máy đó.'),
        'dahao-mot-may.json')


if __name__ == '__main__':
    main()
