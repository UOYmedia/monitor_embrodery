#!/usr/bin/env python3
# Self-test SỐNG cho [V2]+[V3] — CẦN broker đang chạy, KHÔNG cần máy A15, KHÔNG cần người.
#
# Vì sao có bài này: trước bản vá, broker không đặt hạn đọc cho socket nào cả. Máy khai
# keepalive=30 lúc CONNECT nhưng broker không hề áp. Nên một TCP chết âm thầm (rút dây,
# chớp điện, router bỏ NAT) sẽ treo luồng VĨNH VIỄN, cái xác vẫn nằm trong `clients`, và
# deliver() đếm cả nó rồi báo "giao 1 sub" sai sự thật.
# Bằng chứng lúc phát hiện: logs/broker.out có 14 dòng "KẾT NỐI TCP" nhưng chỉ 5 dòng "ĐÓNG".
#
#   T1  Kết nối rồi im lặng       -> broker phải CẮT trong ~65s.
#   T2  Hai CONNECT cùng clientId -> broker phải ĐÁ phiên cũ (đúng chuẩn MQTT).
#   T3  Máy A15 thật vẫn sống sau cả hai phép thử.
#   T4  Hạn đọc SIẾT THEO keepalive máy khai, không phải một hằng số cứng (ca K‑11).
#
# Dùng dev id GIẢ (AABBCCDDEEFF) nên không thể đá nhầm máy thật.
#
# Chạy:  python3 tests/test_ben_vung_live.py
# Biến môi trường: DAHAO_HOST, DAHAO_PORT, DAHAO_LOG, DAHAO_DEV
import socket, struct, time, os, sys

HOST = os.environ.get('DAHAO_HOST', '127.0.0.1')
PORT = int(os.environ.get('DAHAO_PORT', '3865'))
BLOG = os.environ.get('DAHAO_LOG', os.path.expanduser('~/dahao-gateway/broker.log'))
DEV_THAT = os.environ.get('DAHAO_DEV', '602602704E7B')
DEV_GIA = 'AABBCCDDEEFF'
HAN_IM = 60          # broker đặt settimeout(60) lúc vào luồng, trước khi đọc CONNECT
KIEN_NHAN = HAN_IM + 30

def mk_connect(cid, keepalive=30):
    """Gói CONNECT MQTT 3.1 tối giản, đúng dạng máy A15 gửi (MQIsdp, level 3)."""
    pn = b'MQIsdp'
    body = struct.pack('>H', len(pn)) + pn + bytes([3, 0x02]) + struct.pack('>H', keepalive)
    c = cid.encode()
    body += struct.pack('>H', len(c)) + c
    return bytes([0x10, len(body)]) + body

def doc_log():
    with open(BLOG, errors='ignore') as f:
        return f.readlines()

ket_qua = []
def cham(ten, dat, chi_tiet=''):
    ket_qua.append((ten, dat))
    print('  %s  %s  %s' % ('ĐẠT  ' if dat else 'TRƯỢT', ten, chi_tiet))

if not os.path.exists(BLOG):
    print('BỎ QUA: không thấy %s — broker chưa chạy?' % BLOG)
    sys.exit(77)

print('=== THỬ BỀN VỮNG KẾT NỐI (broker %s:%d) ===' % (HOST, PORT))
print()

# ---------------- T1: im lặng -> phải bị cắt ----------------
print('T1  Kết nối rồi im lặng, đợi broker cắt (tới %ds)...' % KIEN_NHAN)
m0 = len(doc_log())
s1 = socket.socket(); s1.settimeout(KIEN_NHAN)
t0 = time.time()
s1.connect((HOST, PORT))
try:
    d = s1.recv(1)          # KHÔNG gửi gì cả
    het = time.time() - t0
    cham('T1 broker cắt kết nối im lặng', d == b'',
         'sau %.1fs (mong đợi ~%ds)' % (het, HAN_IM))
except socket.timeout:
    cham('T1 broker cắt kết nối im lặng', False,
         'quá %ds vẫn chưa cắt -> VẪN CÒN TREO' % KIEN_NHAN)
finally:
    try: s1.close()
    except OSError: pass

time.sleep(1)
moi = doc_log()[m0:]
co_log = any('IM QUÁ LÂU' in l for l in moi)
cham('T1 broker ghi log rõ lý do', co_log,
     '"IM QUÁ LÂU, cắt kết nối"' if co_log else 'không thấy dòng log nào')

# ---------------- T2: trùng clientId -> phải đá phiên cũ ----------------
print()
print('T2  Hai CONNECT cùng clientId %s...' % DEV_GIA)
m0 = len(doc_log())
cid = DEV_GIA + 'ForEMCAD'
CONNACK_OK = b'\x20\x02\x00\x00'

a = socket.socket(); a.settimeout(20); a.connect((HOST, PORT))
a.sendall(mk_connect(cid))
cham('T2 phiên A được CONNACK', a.recv(4) == CONNACK_OK)

time.sleep(0.5)
b = socket.socket(); b.settimeout(20); b.connect((HOST, PORT))
b.sendall(mk_connect(cid))
cham('T2 phiên B được CONNACK', b.recv(4) == CONNACK_OK)

a.settimeout(10)
try:
    d = a.recv(1)
    cham('T2 phiên A bị đá ra', d == b'', 'recv trả về %r' % d)
except socket.timeout:
    cham('T2 phiên A bị đá ra', False, 'A vẫn sống -> [V3] không chạy')
except OSError as e:
    cham('T2 phiên A bị đá ra', True, 'socket đứt: %s' % e)

time.sleep(1)
moi = doc_log()[m0:]
co_v3 = any('[V3] đá phiên cũ' in l for l in moi)
cham('T2 broker ghi log đá phiên cũ', co_v3,
     'dev %s' % DEV_GIA if co_v3 else 'không thấy')

for s in (a, b):
    try: s.close()
    except OSError: pass

# ---------------- T4: hạn đọc siết theo keepalive máy khai (K‑11) ----------------
# Vá V2 đặt settimeout(60) lúc vào luồng, rồi SIẾT LẠI theo gói CONNECT:
#     sock.settimeout(max(45, ka * 2) if ka else 90)
# Nếu bỏ vế siết đó đi thì mọi kết nối đều bị cắt ở 60s bất kể máy khai gì — bài T1 một
# mình KHÔNG phân biệt được hai trường hợp, vì máy thật khai ka=30 nên cũng ra đúng 60s.
# T4 mới là bài phân biệt: ka=0 phải cho tới 90s, ka=10 phải cắt sớm ở 45s.
print()
print('T4  Hạn đọc có siết theo keepalive máy khai không (chạy song song, tới ~100s)...')

def do_han_cat(dev, ka, mong_doi, ra):
    """Nối, khai keepalive=ka, rồi im. Đo bao lâu tới lúc broker cắt."""
    try:
        s = socket.socket(); s.settimeout(mong_doi + 40)
        s.connect((HOST, PORT))
        s.sendall(mk_connect(dev + 'ForEMCAD', keepalive=ka))
        if s.recv(4) != b'\x20\x02\x00\x00':
            ra[ka] = ('khong-connack', None); return
        t = time.time()
        d = s.recv(1)                      # im lặng từ đây
        ra[ka] = ('cat' if d == b'' else 'du-lieu-la', time.time() - t)
    except socket.timeout:
        ra[ka] = ('khong-cat', None)
    except OSError as e:
        ra[ka] = ('loi:%s' % e, None)
    finally:
        try: s.close()
        except Exception: pass

import threading
KICH_BAN = [('AABBCCDDEE01', 0, 90), ('AABBCCDDEE02', 30, 60), ('AABBCCDDEE03', 10, 45)]
ra = {}
luong = [threading.Thread(target=do_han_cat, args=(d, k, m, ra)) for d, k, m in KICH_BAN]
for t in luong: t.start()
for t in luong: t.join()

DUNG_SAI = 8
for dev, ka, mong_doi in KICH_BAN:
    trang_thai, thuc = ra.get(ka, ('khong-chay', None))
    ok = trang_thai == 'cat' and thuc is not None and abs(thuc - mong_doi) <= DUNG_SAI
    cham('T4 khai keepalive=%-2d -> cắt ở ~%ds' % (ka, mong_doi), ok,
         'thực tế %.1fs' % thuc if thuc is not None else trang_thai)

# Và phải THỰC SỰ khác nhau — nếu cả ba cùng ra 60s thì vế siết đã bị bỏ mất.
co_du = [ra.get(k, (None, None))[1] for _, k, _ in KICH_BAN]
khac_nhau = all(v is not None for v in co_du) and (max(co_du) - min(co_du)) > 20
cham('T4 ba hạn KHÁC nhau (không phải hằng số cứng)', khac_nhau,
     'chênh %.1fs giữa cao nhất và thấp nhất' % (max(co_du) - min(co_du))
     if all(v is not None for v in co_du) else 'thiếu số đo')

# ---------------- T3: máy thật vẫn sống ----------------
print()
print('T3  Máy A15 thật có còn sống không...')
time.sleep(3)
het_log = doc_log()
con_state = sum(1 for l in het_log[-40:] if 'STATE dev=%s' % DEV_THAT in l)
cham('T3 máy thật vẫn phát state', con_state > 0,
     '%d bản tin state trong 40 dòng cuối' % con_state)
bi_da = any('[V3] đá phiên cũ cùng dev %s' % DEV_THAT in l for l in het_log)
cham('T3 máy thật KHÔNG bị đá nhầm', not bi_da,
     'không dòng nào đá dev thật' if not bi_da else 'ĐÁ NHẦM MÁY THẬT!')

print()
dat = sum(1 for _, d in ket_qua if d)
print('=== %d/%d ĐẠT ===' % (dat, len(ket_qua)))
sys.exit(0 if dat == len(ket_qua) else 1)
