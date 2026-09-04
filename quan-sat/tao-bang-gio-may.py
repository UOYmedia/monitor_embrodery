# -*- coding: utf-8 -*-
"""Đẻ ra bảng Grafana `dahao-gio-may` — trong một ngày máy thêu bao lâu, dừng bao lâu, chờ bao lâu."""
import io, json

DS = {"type": "loki", "uid": "loki-dahao"}
SEL = '{job="gio-may", ten=~"$ten", gio=~"$gio"}'


def tong(truong, theo=None):
    """Cộng dồn một cột số trong cả khoảng thời gian đang xem."""
    goi = 'sum by (%s) ' % theo if theo else 'sum'
    return '%s(sum_over_time(%s | unwrap %s [$__range]))' % (goi, SEL, truong)


def ty_le(theo=None):
    """Thêu / (thêu + dừng + chờ). Mẫu số lọc `> 0` để 0/0 không ra NaN — bẫy cũ của Grafana."""
    return '(%s) / ((%s) + (%s) + (%s) > 0)' % (
        tong('chay', theo), tong('chay', theo), tong('dung', theo), tong('cho', theo))


def dich(refid, expr):
    return {"refId": refid, "datasource": DS, "queryType": "instant",
            "format": "table", "expr": expr}


def o(pid, ten_o, mo_ta, expr, x, y, w=4, h=5, don_vi="s", so_le=0, mau="text", cao=48):
    """Một ô chữ to."""
    return {
        "id": pid, "type": "stat", "title": ten_o, "description": mo_ta, "datasource": DS,
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "targets": [{"refId": "A", "datasource": DS, "queryType": "instant",
                     "expr": "(%s) or vector(0)" % expr}],
        "options": {
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "colorMode": "value", "graphMode": "none", "textMode": "value",
            "justifyMode": "center", "text": {"titleSize": 16, "valueSize": cao},
        },
        "fieldConfig": {"defaults": {
            "unit": don_vi, "decimals": so_le,
            "color": {"mode": "fixed", "fixedColor": mau},
        }, "overrides": []},
    }


COT = [
    # (refId, biểu thức, tên cột, đơn vị, số lẻ, rộng)
    ("A", tong('chay', 'may, ten'), "Đang thêu", "s", 0, 110),
    ("B", tong('dung', 'may'), "Dừng", "s", 0, 100),
    ("C", tong('cho', 'may'), "Chờ", "s", 0, 100),
    ("D", tong('mat', 'may'), "Mất tín hiệu", "s", 0, 120),
    ("E", ty_le('may'), "Tỷ lệ thêu", "percentunit", 1, 100),
    ("F", tong('ngan', 'may'), "Dừng <1′", "s", 0, 95),
    ("G", tong('so_ngan', 'may'), "lần", "short", 0, 70),
    ("H", tong('so_nhay', 'may'), "≤4 giây", "short", 0, 80),
    ("I", tong('dai', 'may'), "Dừng ≥1′", "s", 0, 95),
    ("J", tong('so_dai', 'may'), "lần ", "short", 0, 70),
    ("K", tong('mui', 'may'), "Mũi đã thêu", "short", 0, 110),
    ("L", tong('lui', 'may'), "Mũi lùi lại", "short", 0, 110),
]

# Bốn rổ, dùng lại cho ô 450 — cùng phép cộng với bảng 430, chỉ khác cách vẽ.
ROI = [
    ("A", tong('chay', 'may, ten'), "Đang thêu", "green"),
    ("B", tong('dung', 'may'), "Dừng", "orange"),
    ("C", tong('cho', 'may'), "Chờ việc", "yellow"),
    ("D", tong('mat', 'may'), "Mất tín hiệu", "red"),
]

GIAI_THICH = (
    "Mỗi máy mỗi phút được chia đúng 60 giây vào **bốn rổ**, không rổ nào chồng lên rổ nào:\n\n"
    "| rổ | nghĩa | máy khai gì |\n|---|---|---|\n"
    "| **Đang thêu** | kim đang chạy | số mũi TĂNG giữa hai khung |\n"
    "| **Dừng** | mẫu đang dở, máy đứng im | số mũi ĐỨNG YÊN (hoặc lùi) trong khi 0 < mũi < tổng |\n"
    "| **Chờ** | không có việc trong máy | chưa nạp mẫu, hoặc mũi = 0, hoặc đã thêu xong tấm |\n"
    "| **Mất tín hiệu** | không biết | máy thôi gửi khung — mất điện, rớt mạng, hoặc tắt máy |\n\n"
    "Cộng bốn rổ luôn đúng bằng thời gian đã trôi. “Dừng” và “Chờ” tách nhau vì trách nhiệm khác "
    "nhau: **dừng** là tấm đang làm mà máy đứng (đứt chỉ, hết chỉ, đổi màu, thợ bỏ đi); **chờ** là "
    "máy rảnh chờ người nạp việc. Số liệu đến từ `quan-sat/dem-gio-may.py` đọc thẳng `broker.log` "
    "— không phải suy từ bảng tình trạng."
)


def bang():
    return {
        "uid": "dahao-gio-may",
        "title": "Dahao — giờ máy chạy & dừng",
        "tags": ["dahao", "xuong", "gio-may"],
        "timezone": "browser",
        "schemaVersion": 39,
        "version": 3,
        "editable": False,
        "graphTooltip": 1,
        "refresh": "1m",
        "time": {"from": "now/d", "to": "now"},
        "templating": {"list": [
            {
                "name": "ten", "label": "Máy", "type": "query", "datasource": DS,
                "query": 'label_values({job="gio-may"}, ten)',
                "definition": 'label_values({job="gio-may"}, ten)',
                "refresh": 2, "sort": 1,
                "includeAll": True, "allValue": ".+", "multi": True,
                "current": {"text": ["All"], "value": ["$__all"]},
            },
            {
                "name": "gio", "label": "Khung giờ", "type": "custom",
                "query": "trong-gio,ngoai-gio",
                "options": [
                    {"text": "Trong giờ làm", "value": "trong-gio", "selected": True},
                    {"text": "Ngoài giờ", "value": "ngoai-gio", "selected": False},
                ],
                "includeAll": True, "allValue": ".+", "multi": True,
                "current": {"text": ["Trong giờ làm"], "value": ["trong-gio"]},
            },
        ]},
        "panels": [
            {
                "id": 400, "type": "text", "title": "Bốn rổ thời gian — đọc bảng này thế nào",
                "gridPos": {"h": 6, "w": 24, "x": 0, "y": 0},
                "options": {"mode": "markdown", "content": GIAI_THICH},
            },

            o(410, "Đang thêu", "Tổng thời gian kim thật sự chạy, cộng hết các máy đang chọn.\n\n"
                    "Đo bằng: số mũi tăng giữa hai khung liên tiếp trong broker.log.", tong('chay'),
              0, 6, mau="green"),
            o(411, "Dừng", "Máy có mẫu đang dở nhưng số mũi không nhúc nhích. Đây là thời gian "
                    "MẤT — đứt chỉ, hết chỉ, đổi màu, thợ rời máy.", tong('dung'), 4, 6,
              mau="orange"),
            o(412, "Chờ việc", "Máy rảnh: chưa nạp mẫu, hoặc mũi = 0, hoặc vừa thêu xong tấm và "
                    "đứng đợi người tháo khung nạp tấm mới.", tong('cho'), 8, 6, mau="yellow"),
            o(413, "Mất tín hiệu", "Không có khung nào gửi về. Máy A15 cắm điện thì đẩy khung "
                    "mỗi ~2 giây suốt 24/7, kể cả lúc rảnh — nên im ở đây nghĩa là MẤT ĐIỆN / "
                    "RỚT MẠNG / TẮT MÁY, chứ không bao giờ là “máy đang rảnh”.",
              tong('mat'), 12, 6, mau="red"),
            o(414, "Tỷ lệ thêu", "Thêu ÷ (thêu + dừng + chờ). Không tính giờ mất tín hiệu, vì "
                    "khoảng đó mình không biết máy làm gì nên không được phép quy tội cho ai.",
              ty_le(), 16, 6, don_vi="percentunit", so_le=1, mau="blue"),
            o(415, "Mũi đã thêu", "Tổng số mũi cộng thêm được trong khoảng đang xem.",
              tong('mui'), 20, 6, don_vi="short", mau="text"),

            o(420, "Dừng dưới 1 phút", "SỐ LẦN máy dừng ngắn (< 60 giây) đã KHÉP LẠI — dừng rồi "
                    "chạy tiếp. Lần dừng được tính vào phút mà nó KẾT THÚC.\n\nPhần lớn là cắt "
                    "chỉ, đổi màu, chỉnh khung: vụn nhưng cộng lại rất tốn — thời gian nằm ở ô "
                    "“mất bao lâu” ngay bên cạnh.",
              tong('so_ngan'), 0, 11, w=5, don_vi="short", mau="orange"),
            o(421, "mất bao lâu", "Cộng THỜI GIAN của đúng những lần dừng ngắn đã đếm ở ô bên "
                    "trái.", tong('ngan'), 5, 11, w=4),
            o(422, "trong đó chỉ thoáng ≤ 4 giây", "Những lần dừng chỉ hiện ra đúng một nhịp đo "
                    "(máy khai mỗi ~2 giây). Thường là cắt chỉ tự động chứ không phải sự cố — "
                    "thời gian vẫn được cộng đủ vào ô “mất bao lâu” bên trái, tách ra đây để ô đếm "
                    "“Dừng dưới 1 phút” không bị nó lấp mất.\n\nNhật ký vá mẫu (`va-mau`) VỨT HẲN những lần này, nên "
                    "số lần bên đó bao giờ cũng nhỏ hơn ở đây.",
              tong('so_nhay'), 9, 11, w=5, don_vi="short"),
            o(423, "Dừng từ 1 phút trở lên", "SỐ LẦN máy dừng dài (≥ 60 giây) đã khép lại trong "
                    "khoảng đang xem.\n\nĐây mới là thứ đáng đi hỏi: hết chỉ không ai thay, kẹt "
                    "khung, thợ bỏ máy.",
              tong('so_dai'), 14, 11, w=5, don_vi="short", mau="red"),
            o(424, "mất bao lâu", "Cộng THỜI GIAN của đúng những lần dừng dài đã đếm ở ô bên "
                    "trái.", tong('dai'), 19, 11, w=5),

            {
                "id": 430, "type": "table", "title": "Từng máy — một ngày trôi đi đâu",
                "description":
                    "Mỗi dòng là một máy. Bốn cột đầu cộng lại đúng bằng khoảng thời gian đang "
                    "xem.\n\n“lần” là số lần dừng đã KHÉP LẠI (dừng rồi chạy tiếp) — một lần dừng "
                    "còn đang mở ở mép cửa sổ thì giây của nó đã tính nhưng chưa được đếm lần, "
                    "nên tổng giây có thể nhỉnh hơn (ngắn + dài) một chút.\n\n"
                    "“Mũi lùi lại” = số mũi máy KÉO NGƯỢC. Máy A15 không hề gửi mã lỗi nào, nhưng "
                    "thợ muốn vá chỗ đứt chỉ thì bắt buộc phải lùi khung — nên mũi giảm giữa mẫu "
                    "là dấu vết gián tiếp của việc vá. Cột này SUY RA, không phải máy khai.",
                "datasource": DS,
                "gridPos": {"h": 12, "w": 24, "x": 0, "y": 16},
                "targets": [dich(r, e) for r, e, _t, _u, _d, _w in COT],
                "transformations": [
                    {"id": "filterFieldsByName",
                     "options": {"include": {"pattern": "^(may|ten|Value.*)$"}}},
                    {"id": "joinByField", "options": {"byField": "may", "mode": "outer"}},
                    {"id": "organize", "options": {
                        "excludeByName": {"may": True},
                        "renameByName": dict(
                            [("ten", "Máy")] +
                            [("Value #%s" % r, t) for r, _e, t, _u, _d, _w in COT]),
                        "indexByName": dict(
                            [("ten", 0)] +
                            [("Value #%s" % r, i + 1)
                             for i, (r, _e, _t, _u, _d, _w) in enumerate(COT)]),
                    }},
                    {"id": "sortBy", "options": {"fields": {},
                                                 "sort": [{"field": "Máy", "desc": False}]}},
                ],
                "options": {"showHeader": True, "cellHeight": "sm",
                            "footer": {"show": True, "reducer": ["sum"], "countRows": False,
                                       "fields": ["Đang thêu", "Dừng", "Chờ", "Mất tín hiệu",
                                                  "Dừng <1′", "lần", "≤4 giây", "Dừng ≥1′",
                                                  "lần ", "Mũi đã thêu", "Mũi lùi lại"]}},
                "fieldConfig": {
                    "defaults": {"custom": {"align": "right", "minWidth": 70},
                                 "unit": "s", "decimals": 0},
                    "overrides": (
                        [{"matcher": {"id": "byName", "options": "Máy"},
                          "properties": [{"id": "custom.align", "value": "left"},
                                         {"id": "custom.width", "value": 90},
                                         {"id": "unit", "value": "string"}]}] +
                        [{"matcher": {"id": "byName", "options": t},
                          "properties": [{"id": "unit", "value": u},
                                         {"id": "decimals", "value": d},
                                         {"id": "custom.width", "value": w}]}
                         for _r, _e, t, u, d, w in COT] +
                        [{"matcher": {"id": "byName", "options": "Tỷ lệ thêu"},
                          "properties": [{"id": "custom.cellOptions",
                                          "value": {"type": "gauge", "mode": "gradient"}},
                                         {"id": "min", "value": 0}, {"id": "max", "value": 1},
                                         {"id": "color", "value": {"mode": "continuous-RdYlGr"}}]},
                         {"matcher": {"id": "byName", "options": "Mất tín hiệu"},
                          "properties": [{"id": "custom.cellOptions",
                                          "value": {"type": "color-text"}},
                                         {"id": "thresholds", "value": {
                                             "mode": "absolute",
                                             "steps": [{"color": "text", "value": None},
                                                       {"color": "red", "value": 1}]}}]}]
                    ),
                },
            },

            {
                "id": 450, "type": "barchart",
                "title": "Từng máy chạy bao lâu — xếp cạnh nhau",
                "description":
                    "Cùng con số của bảng ngay trên, nhưng vẽ ra để so bằng mắt. Mỗi máy một "
                    "thanh, dài đúng bằng khoảng thời gian đang xem, chia làm bốn khúc màu.\n\n"
                    "Nhìn cái gì: khúc XANH dài ngắn khác nhau giữa các máy là chuyện bình "
                    "thường (mẫu khác nhau, việc khác nhau); nhưng máy nào khúc **CAM** (dừng "
                    "giữa mẫu) dài bất thường thì ra xem — đó là tấm đang làm dở mà máy đứng. "
                    "Khúc **ĐỎ** dài nghĩa là máy thôi gửi tin, hỏi lại điện và mạng trước khi "
                    "kết luận gì về máy.\n\n"
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
                            [("ten", "M\u00e1y")] +
                            [("Value #%s" % r, t) for r, _e, t, _c in ROI]),
                        "indexByName": dict(
                            [("ten", 0)] +
                            [("Value #%s" % r, i + 1) for i, (r, _e, _t, _c) in enumerate(ROI)]),
                    }},
                    {"id": "sortBy", "options": {"fields": {},
                                                 "sort": [{"field": "M\u00e1y", "desc": True}]}},
                ],
                "options": {
                    "orientation": "horizontal", "xField": "M\u00e1y",
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
                "title": "T\u1eebng m\u00e1y th\u00eau v\u00e0o nh\u1eefng gi\u1edd n\u00e0o",
                "description":
                    "Chỉ vẽ rổ **Đang thêu**, tách theo từng máy và rải ra trục thời gian. "
                    "Cột chồng lên nhau, nên chiều cao cả cột là số giây thêu của cả xưởng "
                    "trong khoảng ấy, còn mỗi dải màu là phần của một máy.\n\n"
                    "Cột **Total** ở bảng chú giải bên phải chính là **từng máy thêu tổng cộng "
                    "bao nhiêu** trong khoảng đang xem — bấm vào tên máy trong chú giải để chỉ "
                    "xem riêng máy đó.\n\n"
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

            {
                "id": 440, "type": "timeseries", "title": "Ngày trôi đi thế nào",
                "description":
                    "Cùng bốn rổ ấy nhưng xếp theo trục thời gian, cộng hết các máy đang chọn. "
                    "Cột cao bằng nhau ở mọi chỗ vì mỗi khoảng luôn đủ 60 giây × số máy — cái "
                    "đáng nhìn là TỶ LỆ MÀU trong cột, và chỗ nào màu đỏ (mất tín hiệu) dâng lên.",
                "datasource": DS,
                "gridPos": {"h": 9, "w": 24, "x": 0, "y": 42},
                "targets": [
                    {"refId": "A", "datasource": DS, "legendFormat": "Đang thêu",
                     "expr": 'sum(sum_over_time(%s | unwrap chay [$__auto]))' % SEL},
                    {"refId": "B", "datasource": DS, "legendFormat": "Dừng",
                     "expr": 'sum(sum_over_time(%s | unwrap dung [$__auto]))' % SEL},
                    {"refId": "C", "datasource": DS, "legendFormat": "Chờ việc",
                     "expr": 'sum(sum_over_time(%s | unwrap cho [$__auto]))' % SEL},
                    {"refId": "D", "datasource": DS, "legendFormat": "Mất tín hiệu",
                     "expr": 'sum(sum_over_time(%s | unwrap mat [$__auto]))' % SEL},
                ],
                "options": {
                    "legend": {"displayMode": "list", "placement": "bottom",
                               "showLegend": True, "calcs": []},
                    "tooltip": {"mode": "multi", "sort": "none"},
                },
                "fieldConfig": {
                    "defaults": {
                        "unit": "s", "decimals": 0,
                        "custom": {"drawStyle": "bars", "fillOpacity": 85, "lineWidth": 0,
                                   "barAlignment": 0, "showPoints": "never",
                                   "stacking": {"mode": "normal", "group": "A"},
                                   "axisSoftMin": 0},
                    },
                    "overrides": [
                        {"matcher": {"id": "byName", "options": n},
                         "properties": [{"id": "color",
                                         "value": {"mode": "fixed", "fixedColor": c}}]}
                        for n, c in [("Đang thêu", "green"), ("Dừng", "orange"),
                                     ("Chờ việc", "yellow"), ("Mất tín hiệu", "red")]
                    ],
                },
            },
        ],
    }


if __name__ == '__main__':
    import sys
    ra = sys.argv[1] if len(sys.argv) > 1 else 'dahao-gio-may.json'
    io.open(ra, 'w', encoding='utf-8').write(
        json.dumps(bang(), ensure_ascii=False, indent=2) + '\n')
    print('đã ghi', ra)
