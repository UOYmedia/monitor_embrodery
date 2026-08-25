#!/usr/bin/env python3
# Đo độ ổn định của tuyến máy A15 -> broker. CHỈ ĐỌC, không sửa gì, không cần người.
#
# Nguồn số liệu: enum-growth.csv — enumerator ghi một dòng mỗi 30 giây khi broker còn
# sống. Chỗ nào thiếu dòng quá 3 nhịp thì đó là lúc tuyến chết. Cách đo này bắt được cả
# broker chết lẫn Mini ngủ, vì cả hai đều làm ngưng nhịp ghi.
#
# Chạy:
#   python3 do_on_dinh.py                      # toàn bộ lịch sử
#   python3 do_on_dinh.py --tu 2026-08-25T10:30:00Z   # từ một mốc (cửa sổ đo sạch)
#
# Biến môi trường: DAHAO_GATEWAY (mặc định ~/dahao-gateway)
import os, csv, sys, json, datetime

GW = os.environ.get('DAHAO_GATEWAY', os.path.expanduser('~/dahao-gateway'))
CSV_NHIP = os.path.join(GW, 'enum-growth.csv')
CATALOG = os.path.join(GW, 'catalog.json')
NHIP = 30.0
NGUONG = 90.0          # thiếu quá 3 nhịp = coi là gián đoạn

def doc_moc(s):
    return datetime.datetime.strptime(s, '%Y-%m-%dT%H:%M:%SZ')

tu = None
if '--tu' in sys.argv:
    try:
        tu = doc_moc(sys.argv[sys.argv.index('--tu') + 1])
    except (IndexError, ValueError):
        print('--tu cần một mốc dạng 2026-08-25T10:30:00Z'); sys.exit(2)

if not os.path.exists(CSV_NHIP):
    print('Không thấy %s — enumerator chưa bật?' % CSV_NHIP); sys.exit(1)

moc = []
with open(CSV_NHIP) as f:
    for r in csv.DictReader(f):
        try:
            t = doc_moc(r['ts'])
        except (KeyError, ValueError):
            continue
        if tu is None or t >= tu:
            moc.append(t)
moc.sort()

if len(moc) < 2:
    print('CHƯA ĐỦ DỮ LIỆU (%d mốc). Cửa sổ đo cần ít nhất vài phút.' % len(moc))
    sys.exit(1)

t_dau, t_cuoi = moc[0], moc[-1]
tong = (t_cuoi - t_dau).total_seconds()

gian_doan = []
song = 0.0
for a, b in zip(moc, moc[1:]):
    d = (b - a).total_seconds()
    if d > NGUONG:
        gian_doan.append((a, b, d))
    else:
        song += d

print('=== ĐỘ ỔN ĐỊNH TUYẾN (nguồn: enum-growth.csv, nhịp %ds) ===' % int(NHIP))
if tu:
    print('Đo từ    : %s (cửa sổ chỉ định)' % tu)
print('Cửa sổ   : %s  ->  %s' % (t_dau, t_cuoi))
print('Tổng     : %.1f giờ' % (tong / 3600))
print('Sống     : %.1f giờ' % (song / 3600))
print('Gián đoạn: %.1f giờ  (%d lần)' % ((tong - song) / 3600, len(gian_doan)))
print('UPTIME   : %.2f %%' % (100.0 * song / tong if tong else 0))
print()
print('--- Từng lần gián đoạn ---')
for a, b, d in gian_doan:
    print('  %s  ->  %s   mất %6.1f phút' % (a, b, d / 60))
if not gian_doan:
    print('  (không có) — tuyến chạy liền mạch suốt cửa sổ')

try:
    with open(CATALOG) as f:
        cat = json.load(f)
except (OSError, ValueError) as e:
    print()
    print('Không đọc được catalog.json (%s) — bỏ phần thống kê máy.' % e)
    sys.exit(0)

phien = cat.get('sessions') or []
print()
print('--- Broker khởi động lại: %d lần (toàn bộ lịch sử, không theo --tu) ---' % len(phien))
for s in phien[-10:]:
    print('  %s  pid=%s' % (s.get('startedAt'), s.get('pid')))
if len(phien) > 10:
    print('  (chỉ hiện 10 lần gần nhất trong %d lần)' % len(phien))

tp = cat.get('topics') or {}
def lay(hau_to):
    for k, v in tp.items():
        if k.endswith(hau_to):
            return v
    return {}

dn = lay('/auth/login/' + (cat.get('connect', {}).get('clientId', '')[:12] or 'x'))
if not dn:
    dn = next((v for k, v in tp.items() if '/auth/login/' in k), {})
st = next((v for k, v in tp.items() if '/state/' in k), {})

print()
print('--- Máy quay số vào broker ---')
print('  LƯU Ý: mọi số dưới đây lấy từ catalog.json nên là TOÀN BỘ lịch sử, --tu KHÔNG lọc chúng.')
print('  Số lần auth/login    : %s' % dn.get('count', '?'))
print('  Bản tin state        : %s' % st.get('count', '?'))
print('  state đầu -> cuối    : %s  ->  %s' % (st.get('firstSeen'), st.get('lastSeen')))

# Nhịp phải chia cho ĐÚNG dải thời gian đã sinh ra chỗ bản tin đó — tức firstSeen..lastSeen
# trong catalog — chứ không phải thời gian sống của cửa sổ --tu. Trộn hai thứ đó vào nhau
# ra con số vô nghĩa: bản cũ từng in "0,01 giây/bản" vì lấy 10 phút chia cho 4 ngày bản tin.
try:
    dai = (doc_moc(st['lastSeen']) - doc_moc(st['firstSeen'])).total_seconds()
except (KeyError, TypeError, ValueError):
    dai = None
if isinstance(st.get('count'), int) and st['count'] and dai and dai > 0:
    print('  Nhịp state trung bình: %.2f giây/bản (trên trọn dải trên, tính cả lúc đứt)'
          % (dai / st['count']))
else:
    print('  Nhịp state trung bình: không tính được (thiếu firstSeen/lastSeen hoặc count)')
