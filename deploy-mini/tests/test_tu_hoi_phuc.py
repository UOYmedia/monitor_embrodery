#!/usr/bin/env python3
# Thử TỰ HỒI PHỤC: giết thật từng thành phần rồi xem tuyến tự đứng dậy hay không.
# Ca K‑12 (giết broker), K‑13 (giết bridge), K‑14 (đứt tunnel) — PRD_TUYEN_A15_BAN_GIAO.md
#
# CẢNH BÁO: bài này GIẾT tiến trình production thật. Nó chỉ chạy khi có cờ
#   DAHAO_CHO_PHEP_GIET=1
# Không có cờ thì thoát 77 (bỏ qua). Đặt vậy để không ai lỡ tay chạy trong lúc máy đang thêu.
#
# Bài này KHÔNG mock gì cả: giết bằng kill -9, đo bằng launchctl và HTTP thật,
# và kiểm chứng máy A15 thật quay số về sau khi broker chết.
import os, re, sys, time, json, datetime, subprocess, urllib.request, urllib.error

GW   = os.environ.get('DAHAO_GATEWAY', os.path.expanduser('~/dahao-gateway'))
LOG  = os.path.join(GW, 'broker.log')
CSVF = os.path.join(GW, 'enum-growth.csv')
CAT  = os.path.join(GW, 'catalog.json')
LAN  = os.environ.get('DAHAO_URL_LAN', 'http://100.107.219.95:8790')
PUB  = os.environ.get('DAHAO_URL_CONG_KHAI', 'https://redthread.phonh.io.vn')
DEV  = os.environ.get('DAHAO_DEV', '602602704E7B')

def bo_qua(ly_do):
    print('BỎ QUA: ' + ly_do); sys.exit(77)

if os.environ.get('DAHAO_CHO_PHEP_GIET') != '1':
    bo_qua('thiếu DAHAO_CHO_PHEP_GIET=1 — bài này giết tiến trình production thật.')
if not os.path.exists(os.path.join(GW, 'broker.py')):
    bo_qua('không thấy %s/broker.py — chạy bài này TRÊN Mac Mini.' % GW)

# ---------------------------------------------------------------- tiện ích

def pid(nhan):
    """PID hiện tại của một job launchd, hoặc None nếu job đang không chạy."""
    r = subprocess.run(['launchctl', 'list', nhan], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    m = re.search(r'"PID"\s*=\s*(\d+)', r.stdout)
    return int(m.group(1)) if m else None

def con_song(p):
    if p is None:
        return False
    try:
        os.kill(p, 0); return True
    except OSError:
        return False

NHIP_DOI = 0.5

def doi(dieu_kien, han, mo_ta, nhip=NHIP_DOI):
    """Chờ tới khi dieu_kien() trả về giá trị thật. Trả (giá trị, số giây đã chờ)."""
    t0 = time.time()
    while time.time() - t0 < han:
        v = dieu_kien()
        if v:
            return v, time.time() - t0
        time.sleep(nhip)
    raise AssertionError('QUÁ HẠN sau %.0fs khi chờ: %s' % (han, mo_ta))

def giay(s):
    """In thời gian chờ cho khỏi hiểu nhầm: đúng ngay lần hỏi đầu KHÔNG phải là 'tức thì',
    chỉ là nhanh hơn mức bài thử đo nổi."""
    if s < NHIP_DOI:
        return 'đúng ngay lần hỏi đầu (nhanh hơn mức đo được của bài thử)'
    return 'sau %.1fs' % s

def dem(chuoi, tep=None):
    try:
        with open(tep or LOG, errors='replace') as f:
            return f.read().count(chuoi)
    except OSError:
        return 0

def http(goc, duong='/api/health', han=6):
    """Trả mã HTTP, hoặc chuỗi mô tả lỗi mạng.

    Phải đặt User-Agent riêng: Cloudflare CHẶN thẳng UA mặc định 'Python-urllib/*'
    bằng 403 trên đường công khai (đã dựng lại được 25/08/2026; các UA khác —
    python-requests, axios, okhttp, Java, Go — đều qua). Không đặt thì bài thử
    tự bắn vào chân mình rồi tưởng tunnel hỏng.
    """
    yc = urllib.request.Request(goc + duong, headers={'User-Agent': 'dahao-test/1.0'})
    try:
        with urllib.request.urlopen(yc, timeout=han) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception as e:
        return type(e).__name__

def moc_csv_cuoi():
    try:
        with open(CSVF) as f:
            dong = [l for l in f.read().splitlines() if l and not l.startswith('ts,')]
        return dong[-1].split(',')[0] if dong else None
    except OSError:
        return None

def doc_moc(s):
    return datetime.datetime.strptime(s, '%Y-%m-%dT%H:%M:%SZ')

def so_phien():
    try:
        with open(CAT) as f:
            return len(json.load(f).get('sessions') or [])
    except (OSError, ValueError):
        return None

dat = []
def xong(ma, cau):
    dat.append(ma); print('  [%s] %s ĐẠT' % (ma, cau))

# ---------------------------------------------------------------- nền

print('=== THỬ TỰ HỒI PHỤC (giết thật) ===')
p_broker0, p_bridge0, p_tunnel0 = pid('com.dahao.broker'), pid('com.dahao.bridge'), pid('com.dahao.tunnel')
print('Nền: broker=%s bridge=%s tunnel=%s' % (p_broker0, p_bridge0, p_tunnel0))
assert con_song(p_broker0), 'broker chưa chạy — không có gì để thử'
assert con_song(p_bridge0), 'bridge chưa chạy — không có gì để thử'
assert con_song(p_tunnel0), 'tunnel chưa chạy — không có gì để thử'
assert http(LAN) == 200, 'bridge LAN chưa lành trước khi thử: %s' % http(LAN)
t_bat_dau = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
print('Bắt đầu lúc %s' % t_bat_dau)
print()

# ================================================================ K‑13: giết bridge
print('--- K‑13: kill -9 bridge ---')
state0   = dem('*** STATE dev=%s' % DEV)
fwd_ok0  = dem('[FWD] nối bridge')
fwd_loi0 = dem('[FWD] lỗi')
os.kill(p_bridge0, 9)

# 13a) broker KHÔNG chết theo
time.sleep(2)
assert pid('com.dahao.broker') == p_broker0 and con_song(p_broker0), \
    'broker chết theo bridge (pid %s -> %s)' % (p_broker0, pid('com.dahao.broker'))
xong('K‑13a', 'bridge chết nhưng broker vẫn nguyên PID %d' % p_broker0)

# 13b) broker nhận ra đường sang bridge đã đứt
_, s = doi(lambda: dem('[FWD] lỗi') > fwd_loi0, 40, 'broker ghi nhận [FWD] lỗi')
xong('K‑13b', 'broker phát hiện mất bridge %s, không im lặng nuốt lỗi' % giay(s))

# 13c) state VẪN chảy trong lúc bridge chết — máy không bị ảnh hưởng
_, s = doi(lambda: dem('*** STATE dev=%s' % DEV) >= state0 + 3, 40,
           'máy vẫn phát state khi bridge chết')
xong('K‑13c', 'máy vẫn phát state bình thường (+3 bản trong %.1fs) khi bridge nằm' % s)

# 13d) launchd dựng bridge dậy với PID mới
p_bridge1, s = doi(lambda: (lambda p: p if p and p != p_bridge0 else None)(pid('com.dahao.bridge')),
                   90, 'launchd dựng lại bridge')
xong('K‑13d', 'launchd dựng lại bridge %s, PID %d -> %d' % (giay(s), p_bridge0, p_bridge1))

# 13e) bridge trả lời lại /api/health
_, s = doi(lambda: http(LAN) == 200, 90, 'bridge trả lời /api/health')
xong('K‑13e', 'bridge trả 200 trở lại %s kể từ lúc bị giết' % giay(s))

# 13f) broker tự nối lại sang bridge, không cần ai đụng vào
_, s = doi(lambda: dem('[FWD] nối bridge') > fwd_ok0, 90, 'broker nối lại sang bridge')
xong('K‑13f', 'broker tự nối lại đường sang bridge %s, không cần khởi động lại' % giay(s))
print()

# ================================================================ K‑14: đứt tunnel
print('--- K‑14: kill -9 tunnel (mất đường công khai) ---')
pub0 = http(PUB, han=10)
print('  đường công khai trước khi giết: %s' % pub0)
do_pub = (pub0 == 200)
if not do_pub:
    print('  LƯU Ý: nền đã không ra được đường công khai (%s) — bỏ hai phần kiểm đường '
          'công khai, vẫn kiểm phần LAN.' % pub0)
os.kill(p_tunnel0, 9)

# 14a) mất tunnel KHÔNG làm sập bridge hay broker
time.sleep(3)
assert con_song(p_broker0), 'broker chết theo tunnel'
assert pid('com.dahao.bridge') == p_bridge1, 'bridge chết theo tunnel'
xong('K‑14a', 'tunnel chết nhưng broker và bridge vẫn nguyên')

# 14b) dashboard trong nhà VẪN dùng được — đây mới là khẳng định chính
for _ in range(6):
    ma = http(LAN)
    assert ma == 200, 'mất tunnel làm hỏng luôn đường LAN: %s' % ma
    time.sleep(1)
xong('K‑14b', 'đường LAN/Tailscale trả 200 suốt 6 lần thử trong lúc tunnel nằm')

# 14c) máy vẫn phát state — tunnel không nằm trên đường dữ liệu
st = dem('*** STATE dev=%s' % DEV)
_, s = doi(lambda: dem('*** STATE dev=%s' % DEV) >= st + 3, 40, 'state vẫn chảy khi tunnel chết')
xong('K‑14c', 'máy vẫn phát state khi tunnel nằm — tunnel chỉ là đường ra ngoài')

# 14d) đường công khai có suy giảm không (mềm — biên Cloudflare có thể còn giữ kết nối cũ)
if do_pub:
    sut, t0 = None, time.time()
    while time.time() - t0 < 25:
        ma = http(PUB, han=5)
        if ma != 200:
            sut = ma; break
        time.sleep(2)
    if sut is None:
        print('  [K‑14d] LƯU Ý: đường công khai vẫn trả 200 suốt 25s sau khi giết tunnel '
              '(biên Cloudflare giữ kết nối cũ, hoặc launchd dựng lại quá nhanh) — '
              'không coi là trượt, nhưng cũng không tính là ĐẠT.')
    else:
        xong('K‑14d', 'đường công khai suy giảm đúng như dự đoán (%s)' % sut)

# 14e) launchd dựng lại tunnel và đường công khai lành lại
p_tunnel1, s = doi(lambda: (lambda p: p if p and p != p_tunnel0 else None)(pid('com.dahao.tunnel')),
                   90, 'launchd dựng lại tunnel')
print('  tunnel PID %d -> %d, launchd dựng lại %s' % (p_tunnel0, p_tunnel1, giay(s)))
if do_pub:
    _, s = doi(lambda: http(PUB, han=8) == 200, 180, 'đường công khai lành lại')
    xong('K‑14e', 'đường công khai tự lành %s, không cần ai đụng vào' % giay(s))

# 14f) Đường LAN KHÔNG bị lọc theo User-Agent. Cần khẳng định vì đường công khai CÓ:
#      Cloudflare trả 403 cho 'Python-urllib/*'. Đội tích hợp phải biết đường trong nhà
#      không dính luật đó, nếu không họ sẽ đổ lỗi nhầm cho bridge.
def http_ua(goc, ua):
    yc = urllib.request.Request(goc + '/api/health', headers={'User-Agent': ua})
    try:
        with urllib.request.urlopen(yc, timeout=6) as r: return r.status
    except urllib.error.HTTPError as e: return e.code
    except Exception as e: return type(e).__name__
ua_lan = {u: http_ua(LAN, u) for u in ('Python-urllib/3.13', 'python-requests/2.32.3', 'curl/8.7.1', '')}
assert set(ua_lan.values()) == {200}, 'đường LAN lọc theo User-Agent: %s' % ua_lan
xong('K‑14f', 'đường LAN trả 200 với mọi User-Agent đã thử (%d loại) — không dính luật WAF'
              % len(ua_lan))
if do_pub:
    ua_pub = http_ua(PUB, 'Python-urllib/3.13')
    print('  [K‑14f] ghi nhận: đường CÔNG KHAI với UA "Python-urllib/*" trả %s '
          '(Cloudflare chặn) — đội tích hợp phải đặt User-Agent riêng.' % ua_pub)
print()

# ================================================================ K‑12: giết broker
print('--- K‑12: kill -9 broker (nặng nhất — máy phải tự quay số về) ---')
phien0 = so_phien()
n_xoay0 = len([f for f in os.listdir(GW) if f.startswith('broker.log.')])
moc_truoc = moc_csv_cuoi()
print('  trước: phiên=%s, bản xoay log=%d, mốc CSV cuối=%s' % (phien0, n_xoay0, moc_truoc))
t_giet = time.time()
os.kill(p_broker0, 9)

# 12a) launchd dựng lại broker với PID mới
p_broker1, s = doi(lambda: (lambda p: p if p and p != p_broker0 else None)(pid('com.dahao.broker')),
                   90, 'launchd dựng lại broker')
xong('K‑12a', 'launchd dựng lại broker %s, PID %d -> %d' % (giay(s), p_broker0, p_broker1))

# 12b) bridge KHÔNG chết theo broker
assert pid('com.dahao.bridge') == p_bridge1, 'bridge chết theo broker'
xong('K‑12b', 'bridge sống sót qua cái chết của broker (PID vẫn %d)' % p_bridge1)

# 12c) vá V1 giữ được lịch sử: log cũ được ĐỔI TÊN chứ không bị cắt trắng
_, s = doi(lambda: len([f for f in os.listdir(GW) if f.startswith('broker.log.')]) > n_xoay0,
           60, 'broker.log cũ được xoay vòng')
xong('K‑12c', 'log cũ được giữ lại dưới tên khác (vá V1 đứng vững qua kill -9)')

# 12d) MÁY THẬT tự quay số về và đi trọn chuỗi auth — không ai ra xưởng bấm gì
_, s = doi(lambda: dem('*** AUTH XONG ***') > 0, 240, 'máy A15 quay số về và qua auth')
xong('K‑12d', 'máy A15 tự quay số về, qua trọn chuỗi auth %s — không cần người' % giay(s))

# 12e) state chảy lại
_, s = doi(lambda: dem('*** STATE dev=%s' % DEV) >= 3, 90, 'state chảy lại')
tong_hoi = time.time() - t_giet
xong('K‑12e', 'state chảy lại; TỔNG thời gian đứt đầu-cuối = %.1fs' % tong_hoi)

# 12f) broker nối lại đường sang bridge
_, s = doi(lambda: dem('[FWD] nối bridge') > 0, 90, 'broker nối lại sang bridge')
xong('K‑12f', 'broker nối lại sang bridge %s' % giay(s))

# 12g) catalog ghi nhận thêm một phiên
_, s = doi(lambda: (so_phien() or 0) > (phien0 or 0), 120, 'catalog ghi thêm phiên')
xong('K‑12g', 'catalog.json ghi nhận phiên mới: %s -> %s phiên' % (phien0, so_phien()))

# 12h) enumerator ghi lại nhịp, và cú restart KHÔNG tạo lỗ > 90s trong số liệu uptime.
#      Đo bằng đúng thứ do_on_dinh.py đọc — khoảng cách giữa hai mốc CSV — chứ không
#      gộp cả thời gian máy quay số vào, vì nhịp CSV không phụ thuộc vào máy.
moc_moi, s = doi(lambda: (lambda m: m if m and m != moc_truoc else None)(moc_csv_cuoi()),
                 150, 'enumerator ghi mốc CSV mới')
ho = (doc_moc(moc_moi) - doc_moc(moc_truoc)).total_seconds() if moc_truoc else 0.0
assert ho <= 90, ('cú restart tạo lỗ %.0fs > ngưỡng 90s — báo cáo uptime sẽ tính đây là '
                  'một lần gián đoạn thật' % ho)
xong('K‑12h', 'nhịp CSV nối lại, lỗ %.0fs ≤ ngưỡng 90s nên không thành gián đoạn giả '
              '(máy quay số về mất %.0fs, không tính vào lỗ này)' % (ho, tong_hoi))
print()

# ================================================================ khép lại
print('--- Hiện trạng sau khi thử ---')
print('broker=%s bridge=%s tunnel=%s' % (pid('com.dahao.broker'), pid('com.dahao.bridge'), pid('com.dahao.tunnel')))
print('LAN /api/health = %s   |   công khai /api/health = %s' % (http(LAN), http(PUB, han=8)))
assert http(LAN) == 200, 'đường LAN chưa lành hẳn sau bài thử'
if do_pub:
    assert http(PUB, han=8) == 200, 'đường công khai chưa lành hẳn sau bài thử'
t_ket = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
print()
print('%d/%d ĐẠT — %s' % (len(dat), len(dat), ', '.join(dat)))
print('Bài thử chạy từ %s đến %s.' % (t_bat_dau, t_ket))
print('LƯU Ý: bài này cố ý làm đứt tuyến, nên cửa sổ đo sạch phải TÍNH LẠI TỪ %s.' % t_ket)
