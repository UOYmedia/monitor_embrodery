#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Đặt tên thật cho từng máy, thay cho tên tạm "Máy XXXXXX".

VÌ SAO PHẢI CÓ CHỖ NÀY

Cả 13 máy đang mang tên tạm do bridge tự chế từ 6 ký tự cuối của mã. Không phải lỗi: HMI của máy
A15 để trống `machineName` (đã soi 224.016 khung — trường ấy rỗng ở cả 13 máy), nên bridge không
có gì để lấy. Tên thật chỉ có một đường vào duy nhất: người đứng ở xưởng nhìn máy rồi khai.

CÁCH DÙNG

1. Ra xưởng, chụp/ghi mã máy dán trên thân (hoặc đọc trong Grafana cột "Mã máy").
2. Điền vào `quan-sat/ten-may.json`:

       {
         "3CE4B0C54F54": {"ten": "Máy 1",  "khu": "Chuyền A"},
         "602602621294": {"ten": "Máy 2",  "khu": "Chuyền A"}
       }

   Khoá là MÃ MÁY (không phân biệt hoa thường). `khu` bỏ trống được.
3. Xem trước, chưa ghi gì:   python3 -B quan-sat/dat-ten-may.py
4. Ghi thật:                 python3 -B quan-sat/dat-ten-may.py --lam

Bước 4 cần token TECHNICIAN hoặc ADMIN (`machine:update`), nạp bằng:

    cd ~/dahao-gateway && (set -a; . ./bridge-tokens.env; set +a; \
      python3 -B quan-sat/dat-ten-may.py --lam)

Token đọc từ biến môi trường, KHÔNG in ra bất cứ đâu.

TÊN CHẢY ĐI ĐÂU

    bridge (identity.name) --> /api/v2/fleet --> dong-bo-tinh-trang.py (trường `ten`)
                                            --> logs/tinh-trang.out --> Loki --> Grafana cột "Máy"
                                            --> trang xem/

Đổi một chỗ này là cả ba màn hình đổi theo, trong vòng vài giây. Không phải sửa `may.json` —
tệp ấy chỉ nói MÃ NÀO LÀ MÁY NÀO, không giữ tên.

KHÔNG ĐỘNG VÀO `verification`

Bản ghi máy có sẵn ô `verification.status` đang là `unverified`. Đặt tên xong thì đúng là tên đã
được người thật xác nhận tại chỗ, NHƯNG `verification` là một luồng riêng có bằng chứng đi kèm —
tự bật nó ở đây là nói hộ luồng ấy. Chỗ này chỉ ghi lại vào `note` rằng tên lấy từ hiện trường
ngày nào, còn bật `verification` để làm đúng đường của nó.
"""
import json
import os
import sys
import urllib.error
import urllib.request

GOC = os.environ.get('BRIDGE_URL', 'http://100.107.219.95:8790')
BANG = os.environ.get('TEN_MAY_JSON',
                      os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ten-may.json'))
LAM = '--lam' in sys.argv


def token(*ten):
    for t in ten:
        v = os.environ.get(t)
        if v:
            return v
    return None


def goi(duong, cach='GET', than=None, tok=None):
    r = urllib.request.Request(GOC + duong, method=cach)
    r.add_header('Authorization', 'Bearer ' + tok)
    r.add_header('User-Agent', 'dat-ten-may/1')      # Cloudflare chặn User-Agent Python
    if than is not None:
        r.add_header('Content-Type', 'application/json')
        r.data = json.dumps(than, ensure_ascii=False).encode()
    with urllib.request.urlopen(r, timeout=20) as o:
        return json.loads(o.read().decode())


# ------------------------------------------------------------------ đọc bảng tên
if not os.path.exists(BANG):
    print('Chua co %s. Tao tep ay roi dien theo mau trong phan dau tep nay.' % BANG)
    print('Muon xem may nao dang ten gi thi chay lai sau khi tao.')
    sys.exit(1)

def chuan(k):
    """Bỏ dấu ngăn trong mã MAC gõ kiểu `3C:E4:B0:...` hay `3C-E4-B0-...`.

    CHỈ bỏ khi bỏ xong ra đúng 12 ký tự hex — không thì để nguyên. Máy thử `A15-MQTT` cũng có
    dấu gạch, bỏ bừa là nó thành `A15MQTT` rồi không khớp với gì cả (đã dính lúc thử).
    """
    k = k.strip().upper()
    tran = k.replace(':', '').replace('-', '').replace('.', '')
    if len(tran) == 12 and all(c in '0123456789ABCDEF' for c in tran):
        return tran
    return k


muon = json.load(open(BANG))
muon = {chuan(k): v for k, v in muon.items()}
if not muon:
    print('%s rong — chua co gi de dat.' % BANG)
    sys.exit(1)

tok_doc = token('BRIDGE_TOKEN_VIEWER', 'BRIDGE_TOKEN_TECHNICIAN', 'BRIDGE_TOKEN_ADMIN')
if not tok_doc:
    print('Khong thay token nao trong moi truong. Nap bang:')
    print('  cd ~/dahao-gateway && (set -a; . ./bridge-tokens.env; set +a; python3 -B ... )')
    sys.exit(1)

so = goi('/api/v2/fleet', tok=tok_doc)
theo_ma = {}
for m in so.get('machines') or []:
    i = m.get('identity') or {}
    at = (i.get('assetTag') or '').upper()
    if at:
        theo_ma[at] = i

# ------------------------------------------------------------------ so sánh
doi, thieu, y_nguyen = [], [], []
for ma, v in sorted(muon.items()):
    ten_moi = (v.get('ten') or '').strip() if isinstance(v, dict) else str(v).strip()
    khu_moi = (v.get('khu') or '').strip() if isinstance(v, dict) else ''
    if ma not in theo_ma:
        thieu.append(ma)
        continue
    i = theo_ma[ma]
    ten_cu, khu_cu = i.get('name') or '', i.get('zone') or ''
    if ten_moi == ten_cu and (not khu_moi or khu_moi == khu_cu):
        y_nguyen.append((ma, ten_cu))
    else:
        doi.append((ma, i, ten_cu, ten_moi, khu_cu, khu_moi or khu_cu))

print('So may trong so bridge : %d' % len(theo_ma))
print('So dong trong bang ten : %d' % len(muon))
print()
if y_nguyen:
    print('DA DUNG ROI (%d):' % len(y_nguyen))
    for ma, t in y_nguyen:
        print('  %-14s %s' % (ma, t))
    print()
if thieu:
    print('KHONG THAY TRONG SO BRIDGE (%d) — may chua ghep, hoac go nham ma:' % len(thieu))
    for ma in thieu:
        print('  %s' % ma)
    print()
if not doi:
    print('Khong co gi de doi.')
    sys.exit(0)

print('SE DOI (%d):' % len(doi))
for ma, _i, tc, tm, kc, km in doi:
    print('  %-14s  %-32s -> %-32s   khu: %s -> %s' % (ma, tc, tm, kc, km))
print()

if not LAM:
    print('Day moi la XEM TRUOC, chua ghi gi. Muon ghi that thi them --lam va nap token ghi:')
    print('  cd ~/dahao-gateway && (set -a; . ./bridge-tokens.env; set +a; \\')
    print('    python3 -B quan-sat/dat-ten-may.py --lam)')
    sys.exit(0)

tok_ghi = token('BRIDGE_TOKEN_TECHNICIAN', 'BRIDGE_TOKEN_ADMIN')
if not tok_ghi:
    print('Doi ten can quyen machine:update -> token TECHNICIAN hoac ADMIN. Chua thay.')
    sys.exit(1)

hom_nay = __import__('datetime').datetime.utcnow().strftime('%Y-%m-%d')
xong, hong = 0, []
for ma, i, _tc, tm, _kc, km in doi:
    # PATCH của bridge không phải sửa-từng-trường: nó đi qua pairMany → validateMachineInput,
    # tức là upsert NGUYÊN bản ghi. siteId/ipAddress thiếu là 400; model/serial/macAddress
    # thiếu là bị xoá thành null. Nên chép lại từ bản ghi đang có, chỉ thay tên/khu/ghi chú.
    # (assetTag, adapter, verification, maintenance, giá mũi: bridge tự giữ theo bản cũ.)
    than = {'siteId': i.get('siteId'), 'ipAddress': i.get('ipAddress'),
            'model': i.get('model'), 'serial': i.get('serial'), 'macAddress': i.get('macAddress'),
            'name': tm, 'zone': km,
            'note': 'Định danh %s. Tên và vị trí do người khai tại xưởng ngày %s.' % (ma, hom_nay)}
    try:
        goi('/api/v2/machines/' + i['id'], 'PATCH', than, tok_ghi)
        print('  ok    %-14s -> %s' % (ma, tm))
        xong += 1
    except urllib.error.HTTPError as e:
        cho = e.read()[:300].decode('utf8', 'replace')
        print('  HONG  %-14s %s %s' % (ma, e.code, cho))
        hong.append(ma)

print()
print('Da doi %d may.%s' % (xong, ('  Hong: ' + ', '.join(hong)) if hong else ''))
print('Grafana va trang xem/ tu doi theo trong ~5 giay, khong phai khoi dong lai gi.')
