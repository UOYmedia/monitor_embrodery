# -*- coding: utf-8 -*-
"""Thêm hai ô NHÌN BẰNG MẮT theo từng máy vào `tao-bang-gio-may.py`.

Bảng số ô 430 đã có đủ từng máy, nhưng phải đọc từng dòng mới so được. Hai ô này trả lời
cùng câu hỏi ấy bằng hình: ô 450 xếp 19 máy cạnh nhau trong cùng một khoảng, ô 460 rải
từng máy ra trục thời gian để thấy máy nào thêu vào giờ nào.
"""
import io, sys

P = '/Users/phong/dashboarddahao/quan-sat/tao-bang-gio-may.py'
s = io.open(P, encoding='utf-8').read()

if 'id": 450' in s:
    print('đã có ô 450, bỏ qua'); sys.exit(0)

# 1) rổ dùng chung cho ô 450 -------------------------------------------------
MOC_COT = '\nGIAI_THICH = ('
assert MOC_COT in s, 'không thấy GIAI_THICH'
ROI = '''
# Bốn rổ, dùng lại cho ô 450 — cùng phép cộng với bảng 430, chỉ khác cách vẽ.
ROI = [
    ("A", tong('chay', 'may, ten'), "Đang thêu", "green"),
    ("B", tong('dung', 'may'), "Dừng", "orange"),
    ("C", tong('cho', 'may'), "Chờ việc", "yellow"),
    ("D", tong('mat', 'may'), "Mất tín hiệu", "red"),
]

'''
s = s.replace(MOC_COT, ROI + MOC_COT[1:], 1)

# 2) đẩy ô 440 xuống nhường chỗ ---------------------------------------------
CU = '"gridPos": {"h": 9, "w": 24, "x": 0, "y": 28},'
assert s.count(CU) == 1, 'không thấy đúng một gridPos của ô 440'
s = s.replace(CU, '"gridPos": {"h": 9, "w": 24, "x": 0, "y": 42},', 1)

# 3) chèn ô 450 + 460 ngay trên ô 440 ---------------------------------------
NEO = '''            {
                "id": 440, "type": "timeseries", "title": "Ngày trôi đi thế nào",'''
assert NEO in s, 'không thấy ô 440'

THEM = '''            {
                "id": 450, "type": "barchart",
                "title": "Từng máy chạy bao lâu — xếp cạnh nhau",
                "description":
                    "Cùng con số của bảng ngay trên, nhưng vẽ ra để so bằng mắt. Mỗi máy một "
                    "thanh, dài đúng bằng khoảng thời gian đang xem, chia làm bốn khúc màu.\\n\\n"
                    "Nhìn cái gì: khúc XANH dài ngắn khác nhau giữa các máy là chuyện bình "
                    "thường (mẫu khác nhau, việc khác nhau); nhưng máy nào khúc **CAM** (dừng "
                    "giữa mẫu) dài bất thường thì ra xem — đó là tấm đang làm dở mà máy đứng. "
                    "Khúc **ĐỎ** dài nghĩa là máy thôi gửi tin, hỏi lại điện và mạng trước khi "
                    "kết luận gì về máy.\\n\\n"
                    "Máy xếp theo SỐ chứ không xếp theo giá trị, để lần nào mở cũng tìm được "
                    "máy của mình ở đúng chỗ cũ.",
                "datasource": DS,
                "gridPos": {"h": 14, "w": 24, "x": 0, "y": 28},
                "targets": [dich(r, e) for r, e, _t, _c in ROI],
                "transformations": [
                    {"id": "filterFieldsByName",
                     "options": {"include": {"pattern": "^(may|ten|Value.*)$"}}},
                    {"id": "joinByField", "options": {"byField": "may", "mode": "outer"}},
                    {"id": "organize", "options": {
                        "excludeByName": {"may": True},
                        "renameByName": dict(
                            [("ten", "M\\u00e1y")] +
                            [("Value #%s" % r, t) for r, _e, t, _c in ROI]),
                        "indexByName": dict(
                            [("ten", 0)] +
                            [("Value #%s" % r, i + 1) for i, (r, _e, _t, _c) in enumerate(ROI)]),
                    }},
                    {"id": "sortBy", "options": {"fields": {},
                                                 "sort": [{"field": "M\\u00e1y", "desc": True}]}},
                ],
                "options": {
                    "orientation": "horizontal", "xField": "M\\u00e1y",
                    "stacking": "normal", "showValue": "auto",
                    "barWidth": 0.9, "groupWidth": 0.75,
                    "xTickLabelRotation": 0, "xTickLabelSpacing": 0,
                    "legend": {"displayMode": "list", "placement": "bottom",
                               "showLegend": True, "calcs": []},
                    "tooltip": {"mode": "multi", "sort": "none"},
                },
                "fieldConfig": {
                    "defaults": {
                        "unit": "s", "decimals": 0,
                        "custom": {"axisPlacement": "auto", "fillOpacity": 85,
                                   "lineWidth": 0, "gradientMode": "none", "axisSoftMin": 0},
                    },
                    "overrides": [
                        {"matcher": {"id": "byName", "options": t},
                         "properties": [{"id": "color",
                                         "value": {"mode": "fixed", "fixedColor": c}}]}
                        for _r, _e, t, c in ROI
                    ],
                },
            },

            {
                "id": 460, "type": "timeseries",
                "title": "T\\u1eebng m\\u00e1y th\\u00eau v\\u00e0o nh\\u1eefng gi\\u1edd n\\u00e0o",
                "description":
                    "Chỉ vẽ rổ **Đang thêu**, tách theo từng máy và rải ra trục thời gian. "
                    "Cột chồng lên nhau, nên chiều cao cả cột là số giây thêu của cả xưởng "
                    "trong khoảng ấy, còn mỗi dải màu là phần của một máy.\\n\\n"
                    "Cột **Total** ở bảng chú giải bên phải chính là **từng máy thêu tổng cộng "
                    "bao nhiêu** trong khoảng đang xem — bấm vào tên máy trong chú giải để chỉ "
                    "xem riêng máy đó.\\n\\n"
                    "Nhìn cái gì: chỗ nào cả cột tụt xuống là cả xưởng cùng nghỉ (giờ ăn, mất "
                    "điện); chỗ nào chỉ MỘT dải màu biến mất trong khi các dải khác vẫn dày là "
                    "riêng máy ấy có chuyện.",
                "datasource": DS,
                "gridPos": {"h": 11, "w": 24, "x": 0, "y": 51},
                "targets": [
                    {"refId": "A", "datasource": DS, "legendFormat": "{{ten}}",
                     "expr": 'sum by (ten) (sum_over_time(%s | unwrap chay [$__auto]))' % SEL},
                ],
                "options": {
                    "legend": {"displayMode": "table", "placement": "right",
                               "showLegend": True, "calcs": ["sum"],
                               "sortBy": "Total", "sortDesc": True, "width": 220},
                    "tooltip": {"mode": "multi", "sort": "desc"},
                },
                "fieldConfig": {
                    "defaults": {
                        "unit": "s", "decimals": 0,
                        "custom": {"drawStyle": "bars", "fillOpacity": 80, "lineWidth": 0,
                                   "barAlignment": 0, "showPoints": "never",
                                   "stacking": {"mode": "normal", "group": "A"},
                                   "axisSoftMin": 0},
                    },
                    "overrides": [],
                },
            },

'''
s = s.replace(NEO, THEM + NEO, 1)

# 4) bơm version để Grafana chịu nạp lại file (allowUiUpdates: true) ---------
assert '"version": 1,' in s
s = s.replace('"version": 1,', '"version": 2,', 1)

io.open(P, 'w', encoding='utf-8').write(s)
print('đã vá', P)
