#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Canh gác đường số liệu — ghi NHỊP SỐNG, và quan trọng hơn: ghi cả LÚC MÌNH ĐÃ CHẾT.

Vì sao cần bộ này, nói cho đúng bản chất
---------------------------------------
Ngày 28/08 cả tuyến mù 7 giờ 44 phút mà KHÔNG một dòng nào kêu lên. Không phải vì thiếu
cảnh báo — mà vì **không thể báo động lên sự vắng mặt bằng chính sự vắng mặt**. Lúc mọi
tiến trình đều chết, không còn ai ở lại để viết "tôi chết rồi". Nhật ký chỉ đơn giản là
ngừng, và một khoảng ngừng trông y hệt một đêm xưởng nghỉ.

Chỗ gỡ nút: bộ canh gác đập một NHỊP mỗi phút vào chính nhật ký của nó. Nhịp ấy là bằng
chứng dương "lúc ấy tôi còn sống". Nên khi sống dậy, nó chỉ cần so nhịp cuối cùng với bây
giờ là ĐO ĐƯỢC cái lỗ, rồi ghi hẳn một dòng `viec=mu` mang số giây. Khoảng mù thôi vô hình.

Đây là lý do bộ này phải ghi nhật ký RIÊNG, không ghi ké ai: nhịp phải là nhịp của chính
nó thì mới nói được về cái chết của chính nó.

Nó canh gì
----------
`broker` (cổng 3865) · `bridge` (HTTP) · `Loki` (3100) · `cloudflared` · tuổi khung máy gần
nhất trong `broker.log` · chỗ trống đĩa. Mỗi phút một dòng JSON ra stdout; launchd đổ vào
`logs/canh-gac.out`; Alloy gom vào Loki nhãn `job="canh-gac"`.

Hai chỗ CỐ Ý không làm
----------------------
1. Hỏi bridge **không kèm token**. 401/403 vẫn chứng minh bridge còn sống và còn phục vụ —
   đúng thứ cần biết. Đổi lại, bộ canh gác không phải cầm bí mật nào, nên chạy được ở bất kỳ
   đâu, kể cả tay người khác. "Không đọc được" ở đây là tính năng.
2. `khong-khung` chỉ là **cảnh báo (mức 1)**, không phải lỗi. Cả xưởng tắt máy thì cũng
   không có khung — đó là chuyện của xưởng, không phải hỏng đường ống. Việc phân biệt
   "xưởng nghỉ" với "máy mất tín hiệu" đã có `dong-bo-tinh-trang.py` làm; kéo nó vào đây là
   nói vọng lại lời mình. Cái bộ này thêm được, mà chỗ kia không thấy, là ca **broker còn
   thở nhưng đã treo** — tiến trình còn, cổng còn, mà khung thì tắc.

⚠ `MA_GAC` chỉ được NỐI VÀO ĐUÔI, vĩnh viễn. Lịch sử trong Loki mang số cũ; đổi nghĩa một
mã là làm sai mọi bảng đọc về quá khứ. Cùng luật với `MA_TT` bên `dong-bo-tinh-trang.py`.

Chạy tự kiểm: `python3 -B canh-gac.py --tu-kiem`
"""
import calendar
import glob
import gzip
import io
import json
import os
import subprocess
import sys
import time

# --- Mã tình trạng đường ống. CHỈ ĐƯỢC NỐI ĐUÔI. ------------------------------------
MA_GAC = {
    'ok': 0,            # mọi thứ xanh
    'broker-chet': 1,   # không ai nghe cổng 3865
    'bridge-chet': 2,   # bridge không trả lời HTTP
    'loki-chet': 3,     # Loki không /ready
    'tunnel-chet': 4,   # cloudflared không chạy -> mất đường công khai
    'khong-khung': 5,   # mọi dịch vụ xanh nhưng lâu rồi không có khung máy nào
    'vua-mu': 6,        # dòng mốc: vừa sống lại sau một khoảng mù
    'dia-day': 7,       # đĩa sắp đầy -> sắp mất tất cả
}
MUC = {'thuong': 0, 'canh-bao': 1, 'loi': 2}

NHA = os.path.expanduser('~/dahao-gateway')
NHAT_KY = os.path.join(NHA, 'logs', 'canh-gac.out')
BROKER_LOG = os.path.join(NHA, 'broker.log')
BROKER_OUT = os.path.join(NHA, 'logs', 'broker.out')
KHO_BROKER = os.path.join(NHA, 'logs', 'broker.out.*.gz')

CONG_BROKER = 3865
BRIDGE_URL = 'http://100.107.219.95:8790/api/v2/fleet'
LOKI_URL = 'http://127.0.0.1:3100/ready'

NHIP_GIAY = 60          # một nhịp mỗi phút
NGUONG_MU = 180         # thiếu nhịp quá 3 phút = đã có lỗ (cho phép trượt 2 nhịp)
NGUONG_KHUNG = 900      # 15 phút không khung nào -> nghi broker treo
NGUONG_DIA_GB = 10.0    # dưới 10 GB trống là báo
NGUONG_LIEN_TIEP = 3    # hỏng phải lặp lại 3 nhịp mới được lên mức LỖI (xem `nang_muc`)

# Đọc đuôi `broker.log` theo bậc: chỉ trả tiền cho lần đọc lớn khi thật sự chưa thấy khung
# nào. Ngày thường bậc đầu (64 KB) là đủ; lúc cả xưởng im hàng chục tiếng thì mới phải lùi
# sâu — và đó đúng là lúc cần biết "khung cuối cùng cách đây bao lâu" nhất.
BAC_DOC = (65536, 1048576, 8388608)


def gio_utc(t=None):
    """ISO8601 UTC có hậu tố Z — cùng dạng với `tinh-trang.out` để hai nguồn ghép được.

    ⚠ Mọi chỗ đọc ngược chuỗi này về số giây đều dùng `calendar.timegm`, KHÔNG dùng
    `time.mktime(...) - time.timezone`. Mini đang giờ mùa hè (UTC-7) trong khi
    `time.timezone` giữ mốc mùa đông (UTC-8), nên lối kia lệch đúng MỘT GIỜ — vừa đủ để
    một khoảng mù thật bị đọc thành "chưa tới ngưỡng" và im lặng trôi qua.
    """
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() if t is None else t))


def doc_duoi(duong, so_byte=65536):
    """Đọc phần đuôi tệp. Nhật ký broker hàng chục MB — đọc cả tệp mỗi phút là tự bắn chân."""
    try:
        cd = os.path.getsize(duong)
        with io.open(duong, 'rb') as f:
            if cd > so_byte:
                f.seek(cd - so_byte)
            return f.read().decode('utf-8', 'replace')
    except (IOError, OSError):
        return ''


def tuoi_khung(noi_dung, bay_gio):
    """Số giây kể từ khung STATE gần nhất. None nếu không thấy khung nào.

    Lấy dấu giờ NHÚNG TRONG khung (`@2026-08-28T10:36:23Z`) chứ không lấy mtime của tệp:
    mtime nhúc nhích vì bất cứ dòng nào broker in ra, kể cả dòng chẳng liên quan tới máy.
    """
    moc = None
    for dong in noi_dung.splitlines():
        if '*** STATE' not in dong:
            continue
        vt = dong.rfind(' @')
        if vt < 0:
            continue
        cai = dong[vt + 2:].split()[0].strip()
        if not cai.endswith('Z'):
            continue
        try:
            moc = calendar.timegm(time.strptime(cai, '%Y-%m-%dT%H:%M:%SZ'))
        except ValueError:
            continue
    if moc is None:
        return None
    return round(bay_gio - moc, 1)


def moc_nhip_cuoi(duong):
    """Giờ của nhịp cuối cùng bộ canh gác từng ghi. None nếu chưa có nhật ký.

    Đây là toàn bộ trí nhớ của bộ này. Không có nó thì không đo được lỗ.
    """
    for dong in reversed(doc_duoi(duong).splitlines()):
        dong = dong.strip()
        if not dong.startswith('{'):
            continue
        try:
            ban = json.loads(dong)
        except ValueError:
            continue
        cai = ban.get('at')
        if not cai:
            continue
        try:
            return calendar.timegm(time.strptime(cai, '%Y-%m-%dT%H:%M:%SZ'))
        except ValueError:
            continue
    return None


def gio_khoi_dong():
    """Giờ máy bật, từ `kern.boottime`. Dùng để nói lỗ là do KHỞI ĐỘNG LẠI hay do job chết."""
    try:
        ra = subprocess.run(['/usr/sbin/sysctl', '-n', 'kern.boottime'],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5)
        van = ra.stdout.decode('utf-8', 'replace')
        # dạng: { sec = 1756345014, usec = 0 } Thu Aug 27 18:56:54 2026
        khoa = 'sec = '
        vt = van.find(khoa)
        if vt < 0:
            return None
        return float(van[vt + len(khoa):].split(',')[0].strip())
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def soi_cong(cong):
    """(có ai nghe cổng này?, số kết nối đang mở). Một lần `lsof` trả lời cả hai."""
    try:
        ra = subprocess.run(['/usr/sbin/lsof', '-nP', '-iTCP:%d' % cong],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15)
        van = ra.stdout.decode('utf-8', 'replace')
    except (OSError, subprocess.SubprocessError):
        return (None, None)   # không đo được — KHÁC với "đo được và bằng 0"
    return ('(LISTEN)' in van, van.count('(ESTABLISHED)'))


def hoi_http(url, cho=8):
    """Mã HTTP, hoặc None nếu không nối được.

    KHÔNG kèm token. 401/403 vẫn là bằng chứng bridge còn sống — xem ghi chú đầu tệp.
    """
    try:
        import urllib.error
        import urllib.request
        req = urllib.request.Request(url, headers={'User-Agent': 'canh-gac/1'})
        return urllib.request.urlopen(req, timeout=cho).getcode()
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return None


def tien_trinh_song(ten):
    try:
        ra = subprocess.run(['/usr/bin/pgrep', '-x', ten],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5)
        return ra.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return None


def dia_trong_gb(duong):
    try:
        st = os.statvfs(duong)
        return round(st.f_bavail * st.f_frsize / (1024.0 ** 3), 1)
    except OSError:
        return None


def tuoi_khung_bac(duong, bay_gio, bac=BAC_DOC):
    """`tuoi_khung` nhưng lùi dần ra sau nếu bậc trước chưa thấy khung nào.

    Không có nó thì lúc xưởng im lâu, ô hiện `null` — mà `null` đọc ra là "không biết",
    trong khi sự thật là "khung cuối cách đây 14 tiếng". Hai câu đó khác hẳn nhau.
    """
    cd = 0
    try:
        cd = os.path.getsize(duong)
    except OSError:
        return None
    da_doc = 0
    for n in bac:
        if da_doc and da_doc >= cd:
            break               # đã đọc hết tệp rồi, lùi thêm cũng vô ích
        t = tuoi_khung(doc_duoi(duong, n), bay_gio)
        if t is not None:
            return t
        da_doc = n
    return None


_KHO = {}       # nhớ lần bới kho gần nhất, để khỏi giải nén lại mỗi phút


def moc_khung_trong_kho(bay_gio):
    """Tuổi khung cuối lấy từ bản nhật ký ĐÃ XOAY. None nếu kho không có khung nào.

    Chỉ được gọi khi hai tệp đang sống đều câm — tức là ngay sau 04:17, lúc `xoaylog` vừa
    cắt cả hai. Giải nén vài MB mỗi phút là phí, nên nhớ lại theo (đường, mtime, cỡ): kho
    đã đóng thì ba thứ ấy đứng yên, mà khung cuối trong kho cũng đứng yên theo.
    """
    ds = sorted(glob.glob(KHO_BROKER))
    if not ds:
        return None
    duong = ds[-1]
    try:
        st = os.stat(duong)
    except OSError:
        return None
    khoa = (duong, int(st.st_mtime), st.st_size)
    if _KHO.get('khoa') != khoa:
        try:
            f = gzip.open(duong, 'rb')
            noi = f.read().decode('utf-8', 'replace')
            f.close()
        except (IOError, OSError):
            return None
        t = tuoi_khung(noi, bay_gio)
        _KHO['khoa'] = khoa
        _KHO['moc'] = (bay_gio - t) if t is not None else None
    m = _KHO.get('moc')
    return None if m is None else round(bay_gio - m, 1)


def tuoi_khung_moi_nguon(bay_gio):
    """Tuổi khung cuối, lần lượt qua ba nguồn — mỗi nguồn có một kiểu mù riêng.

    `broker.log` bị broker GHI ĐÈ mỗi lần khởi động, nên sau một lần khởi động lại nó rỗng
    khung và ô đọc ra "không biết" ĐÚNG LÚC cần biết nhất. Đo thật 29/08: vừa đổi sang
    daemon xong là `khung_giay=null`, trong khi khung cuối cách đó 16 tiếng.

    `logs/broker.out` sống qua khởi động lại (launchd giữ fd O_APPEND), nhưng bị `xoaylog`
    cắt lúc 04:17. Nên nguồn thứ ba là bản `.gz` vừa xoay.
    """
    for duong in (BROKER_LOG, BROKER_OUT):
        t = tuoi_khung_bac(duong, bay_gio)
        if t is not None:
            return t
    return moc_khung_trong_kho(bay_gio)


def nang_muc(muc_goc, lan_lien_tiep):
    """Chống nháy: một nhịp hỏng chưa được kêu mức LỖI, phải hỏng liên tiếp mới được.

    Đã cắn thật 29/08: `/ready` của Loki trả 503 đúng một lần giữa lúc nó gộp chỉ mục, năm
    lần đo ngay sau đó đều 200. Nếu cái nháy ấy nhuộm đỏ bảng thì chỉ vài đêm là người ta
    thôi tin bảng — và lúc hỏng thật sẽ không ai buồn nhìn.

    Chưa đủ số lần thì vẫn GHI, vẫn giữ nguyên mã, chỉ hạ xuống mức cảnh báo. Nuốt luôn
    dòng ấy là tự bịt mắt mình lần nữa.
    """
    if muc_goc >= MUC['loi'] and lan_lien_tiep < NGUONG_LIEN_TIEP:
        return MUC['canh-bao']
    return muc_goc


def quyet_dinh(do):
    """Từ các phép đo -> (tên tình trạng, mã, mức, câu giải thích cho người đọc).

    Hàm THUẦN: không đọc mạng, không đọc đĩa. Nhờ vậy tự kiểm được mà không cần dựng cả
    hệ thống — đúng bài học của `doi-chieu-hai-ban.py`.

    Thứ tự xét là thứ tự THIỆT HẠI, không phải thứ tự tiện tay: đĩa đầy làm chết mọi thứ
    còn lại nên xét trước; broker chết thì không còn số liệu nào để nói tiếp.
    """
    if do.get('dia_gb') is not None and do['dia_gb'] < NGUONG_DIA_GB:
        return ('dia-day', MA_GAC['dia-day'], MUC['loi'],
                'Đĩa chỉ còn %.1f GB. Đầy đĩa là mất sạch: log không ghi được, Loki hỏng chỉ mục.'
                % do['dia_gb'])
    if do.get('broker_nghe') is False:
        return ('broker-chet', MA_GAC['broker-chet'], MUC['loi'],
                'Không ai nghe cổng %d. Máy thêu có gọi vào cũng không ai nhận.' % CONG_BROKER)
    if do.get('bridge_ma') is None:
        return ('bridge-chet', MA_GAC['bridge-chet'], MUC['loi'],
                'Bridge không trả lời HTTP. Dashboard và bên tích hợp đều đang đọc số cũ.')
    if do.get('loki_ma') != 200:
        return ('loki-chet', MA_GAC['loki-chet'], MUC['loi'],
                'Loki không sẵn sàng. Vẫn thu được số liệu nhưng không tra cứu lại được.')
    if do.get('tunnel_song') is False:
        return ('tunnel-chet', MA_GAC['tunnel-chet'], MUC['canh-bao'],
                'cloudflared không chạy. Trong xưởng vẫn xem được, từ xa thì mất.')
    kg = do.get('khung_giay')
    if kg is None or kg > NGUONG_KHUNG:
        return ('khong-khung', MA_GAC['khong-khung'], MUC['canh-bao'],
                'Dịch vụ đều xanh nhưng %s. Hoặc cả xưởng tắt máy, hoặc broker còn thở mà đã treo.'
                % ('chưa từng thấy khung nào' if kg is None else 'đã %d phút không khung nào' % int(kg // 60)))
    return ('ok', MA_GAC['ok'], MUC['thuong'], 'Đường số liệu thông suốt.')


def do_mot_lua(lan_lien_tiep=NGUONG_LIEN_TIEP):
    bay_gio = time.time()
    nghe, noi = soi_cong(CONG_BROKER)
    do = {
        'broker_nghe': nghe,
        'may_noi': noi,
        'bridge_ma': hoi_http(BRIDGE_URL),
        'loki_ma': hoi_http(LOKI_URL),
        'tunnel_song': tien_trinh_song('cloudflared'),
        'khung_giay': tuoi_khung_moi_nguon(bay_gio),
        'dia_gb': dia_trong_gb(NHA),
    }
    ten, ma, muc_goc, vi_sao = quyet_dinh(do)
    ban = {'at': gio_utc(bay_gio), 'viec': 'nhip', 'tinh_trang': ten, 'ma': ma,
           'muc': nang_muc(muc_goc, lan_lien_tiep), 'muc_goc': muc_goc,
           'lan_lien_tiep': lan_lien_tiep, 'vi_sao': vi_sao}
    ban.update(do)
    return ban


def ban_ghi_mu(bay_gio, nhip_cuoi, boot):
    """Dòng mốc lúc sống dậy. Trả None nếu không có lỗ nào đáng nói."""
    if nhip_cuoi is None:
        return {'at': gio_utc(bay_gio), 'viec': 'mu', 'tinh_trang': 'vua-mu',
                'ma': MA_GAC['vua-mu'], 'muc': MUC['thuong'], 'mu_giay': None,
                'do_dau': 'lan-dau',
                'vi_sao': 'Bộ canh gác chạy lần đầu — chưa có nhịp cũ để so, nên chưa nói được gì về quá khứ.'}
    lo = bay_gio - nhip_cuoi
    if lo <= NGUONG_MU:
        return None
    # Máy bật SAU nhịp cuối => cái lỗ là do khởi động lại. Ngược lại thì máy vẫn chạy mà
    # riêng bộ canh gác chết — hai chuyện khác hẳn nhau, và phải nói rõ là chuyện nào.
    do_reboot = boot is not None and boot > nhip_cuoi
    return {
        'at': gio_utc(bay_gio), 'viec': 'mu', 'tinh_trang': 'vua-mu',
        'ma': MA_GAC['vua-mu'], 'muc': MUC['loi'] if lo > 3600 else MUC['canh-bao'],
        'mu_tu': gio_utc(nhip_cuoi), 'mu_den': gio_utc(bay_gio),
        'mu_giay': round(lo, 1), 'mu_phut': round(lo / 60.0, 1),
        'do_dau': 'may-khoi-dong-lai' if do_reboot else 'bo-canh-gac-chet',
        'boot': gio_utc(boot) if boot else None,
        'vi_sao': 'Mù %.1f phút (%s). Trong khoảng ấy KHÔNG có số liệu nào được ghi — '
                  'đừng đọc khoảng ấy là "xưởng nghỉ".'
                  % (lo / 60.0, 'máy khởi động lại' if do_reboot else 'bộ canh gác chết'),
    }


def xa(ban):
    sys.stdout.write(json.dumps(ban, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def chay():
    bay_gio = time.time()
    mu = ban_ghi_mu(bay_gio, moc_nhip_cuoi(NHAT_KY), gio_khoi_dong())
    if mu:
        xa(mu)
    ma_truoc, lien_tiep = None, 0
    while True:
        try:
            # Đếm TRƯỚC khi đo thì không biết đếm cái gì, nên đo hai bước: lấy mã ở lần đo
            # thật, rồi mới quyết mức. `do_mot_lua` nhận số lần liền kề của mã LẦN TRƯỚC —
            # chính xác khi mã lặp lại, và khi mã đổi thì `nang_muc` tự hạ xuống cảnh báo,
            # đúng điều mong muốn cho một hỏng hóc vừa mới xuất hiện.
            ban = do_mot_lua(lien_tiep + 1 if ma_truoc is not None else 1)
            if ban['ma'] == ma_truoc:
                lien_tiep += 1
            else:
                ma_truoc, lien_tiep = ban['ma'], 1
            ban['lan_lien_tiep'] = lien_tiep
            ban['muc'] = nang_muc(ban['muc_goc'], lien_tiep)
            xa(ban)
        except Exception as e:                      # noqa: BLE001
            # Bộ canh gác chết vì một phép đo lỗi thì lại thành đúng cái bệnh nó chữa.
            xa({'at': gio_utc(), 'viec': 'nhip', 'tinh_trang': 'khong-khung',
                'ma': MA_GAC['khong-khung'], 'muc': MUC['canh-bao'],
                'vi_sao': 'Một phép đo hỏng: %s' % e})
        time.sleep(NHIP_GIAY)


# ------------------------------------------------------------------ tự kiểm
def tu_kiem():
    dat = [0]
    hong = []

    def kt(ten, thuc, mong):
        dat[0] += 1
        if thuc != mong:
            hong.append('%s: được %r, mong %r' % (ten, thuc, mong))

    # --- quyết định: thứ tự thiệt hại
    xanh = {'dia_gb': 100.0, 'broker_nghe': True, 'bridge_ma': 200,
            'loki_ma': 200, 'tunnel_song': True, 'khung_giay': 2.0}
    kt('mọi thứ xanh', quyet_dinh(xanh)[0], 'ok')
    kt('mức lúc xanh', quyet_dinh(xanh)[2], MUC['thuong'])

    d = dict(xanh, dia_gb=3.0, broker_nghe=False)
    kt('đĩa đầy thắng broker chết', quyet_dinh(d)[0], 'dia-day')
    kt('đĩa đầy là mức lỗi', quyet_dinh(d)[2], MUC['loi'])

    kt('broker chết', quyet_dinh(dict(xanh, broker_nghe=False))[0], 'broker-chet')
    kt('bridge chết', quyet_dinh(dict(xanh, bridge_ma=None))[0], 'bridge-chet')
    kt('bridge 401 vẫn tính là sống', quyet_dinh(dict(xanh, bridge_ma=401))[0], 'ok')
    kt('bridge 403 vẫn tính là sống', quyet_dinh(dict(xanh, bridge_ma=403))[0], 'ok')
    kt('loki chết', quyet_dinh(dict(xanh, loki_ma=503))[0], 'loki-chet')
    kt('tunnel chết', quyet_dinh(dict(xanh, tunnel_song=False))[0], 'tunnel-chet')
    kt('tunnel chết chỉ là cảnh báo', quyet_dinh(dict(xanh, tunnel_song=False))[2], MUC['canh-bao'])
    kt('không khung', quyet_dinh(dict(xanh, khung_giay=None))[0], 'khong-khung')
    kt('khung cũ quá', quyet_dinh(dict(xanh, khung_giay=NGUONG_KHUNG + 1))[0], 'khong-khung')
    kt('khung sát ngưỡng vẫn ok', quyet_dinh(dict(xanh, khung_giay=NGUONG_KHUNG))[0], 'ok')
    kt('không khung chỉ là cảnh báo', quyet_dinh(dict(xanh, khung_giay=None))[2], MUC['canh-bao'])
    # `broker_nghe=None` là KHÔNG ĐO ĐƯỢC (lsof hỏng), không phải "không ai nghe".
    # Đoán bừa ở đây là dựng báo động giả lúc 3 giờ sáng.
    kt('không đo được cổng thì đừng kết tội', quyet_dinh(dict(xanh, broker_nghe=None))[0], 'ok')

    # --- tuổi khung
    moc = time.time() - 300
    cai = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(moc))
    van = ('CONNECT proto=MQTT lvl=4 cid=abc keepalive=60\n'
           '*** STATE dev=AABBCC cur=1 tot=2 state=15 pat= @%s Δ2.0s\n' % cai)
    kt('tuổi khung ~300s', abs(tuoi_khung(van, time.time()) - 300) < 3, True)
    kt('không có khung -> None', tuoi_khung('CONNECT gì đó\n', time.time()), None)
    # Tên mẫu CÓ DẤU CÁCH — đúng cái bẫy đã làm 2/6 máy biến mất khỏi Grafana ngày 26/08.
    van2 = '*** STATE dev=A cur=1 tot=2 state=15 pat=4153725796 front(1).DST @%s Δ2.0s\n' % cai
    kt('tên mẫu có dấu cách vẫn đọc được giờ', abs(tuoi_khung(van2, time.time()) - 300) < 3, True)
    # Phải lấy khung CUỐI CÙNG, không phải khung đầu tiên.
    cu = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - 9000))
    van3 = ('*** STATE dev=A cur=1 tot=2 state=15 pat= @%s Δ2.0s\n' % cu +
            '*** STATE dev=A cur=2 tot=2 state=15 pat= @%s Δ2.0s\n' % cai)
    kt('lấy khung cuối cùng', abs(tuoi_khung(van3, time.time()) - 300) < 3, True)

    # --- bản ghi mù
    gio = time.time()
    kt('không lỗ thì không ghi', ban_ghi_mu(gio, gio - 60, None), None)
    kt('lỗ sát ngưỡng vẫn im', ban_ghi_mu(gio, gio - NGUONG_MU, None), None)
    b = ban_ghi_mu(gio, gio - 27840, gio - 20000)     # đúng cái lỗ 7h44 ngày 28/08
    kt('lỗ 7h44 có ghi', b is not None, True)
    kt('lỗ 7h44 = 464 phút', int(b['mu_phut']), 464)
    kt('lỗ sau khi máy bật lại', b['do_dau'], 'may-khoi-dong-lai')
    kt('lỗ dài là mức lỗi', b['muc'], MUC['loi'])
    b2 = ban_ghi_mu(gio, gio - 27840, gio - 90000)    # máy bật TRƯỚC nhịp cuối
    kt('máy không reboot -> tại bộ canh gác', b2['do_dau'], 'bo-canh-gac-chet')
    b3 = ban_ghi_mu(gio, gio - 400, None)
    kt('lỗ ngắn chỉ là cảnh báo', b3['muc'], MUC['canh-bao'])
    kt('lần đầu thì nói thẳng là lần đầu', ban_ghi_mu(gio, None, None)['do_dau'], 'lan-dau')

    # --- đọc lại mốc nhịp từ chính nhật ký (vòng khép kín)
    tam = os.path.join(os.environ.get('TMPDIR', '/tmp'), 'canh-gac-tu-kiem.jsonl')
    with io.open(tam, 'w', encoding='utf-8') as f:
        f.write(u'không phải JSON, dòng rác\n')
        f.write(json.dumps({'at': gio_utc(gio - 120), 'viec': 'nhip'}) + '\n')
    doc = moc_nhip_cuoi(tam)
    kt('đọc lại được mốc nhịp cuối', doc is not None and abs(doc - (gio - 120)) < 2, True)
    os.remove(tam)
    kt('nhật ký không tồn tại -> None', moc_nhip_cuoi('/khong/co/that.jsonl'), None)

    # --- chống nháy
    kt('hỏng lần 1 chỉ là cảnh báo', nang_muc(MUC['loi'], 1), MUC['canh-bao'])
    kt('hỏng lần 2 vẫn cảnh báo', nang_muc(MUC['loi'], 2), MUC['canh-bao'])
    kt('hỏng lần 3 mới lên lỗi', nang_muc(MUC['loi'], 3), MUC['loi'])
    kt('chống nháy không đụng cảnh báo', nang_muc(MUC['canh-bao'], 1), MUC['canh-bao'])
    kt('chống nháy không đụng bình thường', nang_muc(MUC['thuong'], 1), MUC['thuong'])

    # --- bậc đọc: chỉ lùi sâu khi bậc trước chưa thấy khung
    tam2 = os.path.join(os.environ.get('TMPDIR', '/tmp'), 'canh-gac-broker.log')
    cai2 = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - 52000))
    with io.open(tam2, 'w', encoding='utf-8') as f:
        f.write(u'*** STATE dev=A cur=1 tot=2 state=15 pat= @%s Δ2.0s\n' % cai2)
        f.write(u'rác không phải khung\n' * 20000)      # đẩy khung ra ngoài bậc 64 KB
    kt('bậc 64 KB không thấy khung', tuoi_khung(doc_duoi(tam2, 65536), time.time()), None)
    kt('lùi bậc thì thấy', abs(tuoi_khung_bac(tam2, time.time()) - 52000) < 3, True)
    os.remove(tam2)
    kt('tệp không có -> None', tuoi_khung_bac('/khong/co/that.log', time.time()), None)

    # --- mã không được trùng nhau (bảo vệ luật chỉ-nối-đuôi)
    kt('mã không trùng', len(set(MA_GAC.values())), len(MA_GAC))

    for h in hong:
        print('HỎNG  ' + h)
    print('%d/%d đạt' % (dat[0] - len(hong), dat[0]))
    return 1 if hong else 0


if __name__ == '__main__':
    if '--tu-kiem' in sys.argv:
        sys.exit(tu_kiem())
    if '--mot-lan' in sys.argv:
        xa(do_mot_lua())
        sys.exit(0)
    chay()
