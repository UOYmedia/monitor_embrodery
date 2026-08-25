#!/usr/bin/env python3
"""Xoay vòng các log mà launchd tự ghi (logs/*.out, logs/*.err) — ca K‑20.

VÌ SAO CẦN: launchd mở StandardOutPath/StandardErrorPath rồi ghi nối mãi mãi, không
bao giờ tự xoay. `broker.out` phình ~1,6 MB/ngày (đo 25/08/2026: 6,5 MB sau 97 giờ).
Đĩa thì thừa (405 GB trống) nên đây KHÔNG phải chuyện hết chỗ — mà là chuyện sau một
năm không ai mở nổi cái file 600 MB để soi lỗi nữa.

VÌ SAO KHÔNG ĐỔI TÊN MÀ LẠI CẮT: launchd giữ file descriptor mở suốt đời tiến trình.
Đổi tên file thì launchd vẫn ghi tiếp vào inode cũ, file mới mãi mãi rỗng — bẫy kinh
điển. Nên phải CHÉP RỒI CẮT TẠI CHỖ (copy-truncate): fd mở kiểu O_APPEND nên sau khi
cắt về 0, lần ghi kế tiếp rơi đúng đầu file, không để lại lỗ rỗng.

ĐÁNH ĐỔI THÀNH THẬT: giữa lúc chép xong và lúc cắt, vài dòng vừa ghi có thể mất. Cửa
sổ đó cỡ mili giây và đây là log vận hành, không phải sổ kế toán — chấp nhận được.
Không chấp nhận được thì phải dừng dịch vụ để xoay, mà cái giá đó đắt hơn nhiều.

CANH LUÔN `broker.log` (ca K‑20d, 25/08/2026). File này KHÔNG do launchd ghi mà do
`broker.py` tự mở, nên nó nằm ngoài logs/ và trước đây không ai xoay nó cả. Nó chỉ được
xoay đúng một lúc: khi broker KHỞI ĐỘNG. Mà mục tiêu K‑19 lại là broker chạy liền 7
ngày không khởi động lại — nghĩa là mục tiêu càng đạt thì file càng to (đo thật: 3.754
KiB/ngày sau khi dòng `*** STATE` có thêm dấu giờ, 7 ngày ≈ 26 MB không ai cắt).

Chép-rồi-cắt an toàn với `broker.log` vì `log()` trong broker.py mở-ghi-đóng TỪNG DÒNG
(`with open(LOG,'a')`), không giữ fd. Nên không cần đụng vào broker.py, không cần khởi
động lại, máy không phải quay số lại.

VÌ SAO BẢN LƯU CỦA `broker.log` LẠI NẰM TRONG logs/ VÀ ĐỔI TÊN: `broker.py::_xoay_log`
lúc khởi động có bộ dọn riêng, nó xoá mọi file cùng thư mục có tên bắt đầu bằng
`broker.log.` và chỉ chừa 10 cái mới nhất — bộ dọn ấy KHÔNG lọc đuôi `.gz`. Đặt bản nén
cạnh file gốc là tự nộp lịch sử cho nó xoá. Nên bản nén đi vào `logs/broker-log.<mốc>.gz`:
khác thư mục, và `broker-log.` khác `broker.log.` nên dù có ai dời file cũng không trùng.

KHÔNG đụng gì tới broker.py, bridge hay tunnel — chỉ ĐỌC `broker.log` rồi cắt nó tại chỗ.

Chạy:
  python3 xoay_log_he_thong.py            # xoay file nào vượt ngưỡng
  python3 xoay_log_he_thong.py --thu      # chỉ nói sẽ làm gì, không đụng vào file
  python3 xoay_log_he_thong.py --nguong 1048576 --giu 5
  python3 xoay_log_he_thong.py --khong-broker-log     # chỉ xoay logs/*.out|*.err

Biến môi trường: DAHAO_GATEWAY (mặc định ~/dahao-gateway)
"""
import os, re, sys, gzip, time, shutil, argparse

NGUONG_MAC_DINH = 8 * 1024 * 1024      # 8 MiB ~ 5 ngày broker.out
GIU_MAC_DINH    = 10                    # giữ 10 bản nén ~ gần 2 tháng lịch sử

# Bản lưu của broker.log: `logs/broker-log.<mốc>.gz`. Dấu gạch ngang là CỐ Ý — xem đầu
# file: `broker.py` xoá sạch mọi thứ bắt đầu bằng `broker.log.` nằm cạnh nó.
NEN_GOC_BROKER  = 'broker-log'

# Bản nén hợp lệ: `<gốc>.20260825-041700.gz`. Đòi đúng hình dạng mốc giờ chứ không chỉ
# so tiền tố — xem `don_ban_cu`.
DANG_BAN_NEN    = r'^%s\d{8}-\d{6}\.gz$'


def cac_log(thu_muc):
    """Các file log launchd tự ghi. Bỏ qua chính các bản đã nén."""
    try:
        ten = sorted(os.listdir(thu_muc))
    except OSError:
        return []
    return [os.path.join(thu_muc, t) for t in ten
            if (t.endswith('.out') or t.endswith('.err')) and not t.endswith('.gz')]


def don_ban_cu(duong, giu):
    """Xoá bớt bản nén cũ, giữ lại `giu` bản mới nhất. Trả về danh sách đã xoá.

    Khớp CẢ HÌNH DẠNG MỐC GIỜ chứ không chỉ so tiền tố. Lý do rất cụ thể: từ ca K‑20d,
    bản lưu của `broker.log` nằm ở `logs/broker-log.<mốc>.gz`, tức là chung thư mục với
    log launchd. Chỉ so tiền tố thì ngày nào đó có thêm một log tên `broker-log.out`,
    bản lưu `broker-log.out.<mốc>.gz` của nó sẽ lọt vào tầm dọn của `broker-log` và bị
    xoá nhầm. Đây đúng là loại lỗi mà chính ca K‑20d sinh ra để phòng, nên không đặt
    thêm một cái bẫy cùng kiểu ngay trong lúc gỡ cái cũ.
    """
    thu_muc = os.path.dirname(duong) or '.'
    goc = os.path.basename(duong) + '.'
    mau = re.compile(DANG_BAN_NEN % re.escape(goc))
    try:
        ban = sorted(t for t in os.listdir(thu_muc) if mau.match(t))
    except OSError:
        return []
    da_xoa = []
    for t in ban[:-giu] if giu > 0 else ban:
        try:
            os.remove(os.path.join(thu_muc, t)); da_xoa.append(t)
        except OSError:
            pass
    return da_xoa


def xoay_mot(duong, nguong, giu, thu=False, moc=None, nen_goc=None):
    """Xoay một file nếu nó vượt ngưỡng. Trả về dòng mô tả việc đã làm, hoặc None.

    `nen_goc` = gốc tên của bản lưu; mặc định trùng luôn với file gốc (`broker.out` ->
    `broker.out.<mốc>.gz` nằm ngay cạnh). Tách được hai thứ này ra là vì `broker.log`
    KHÔNG được phép lưu cạnh chính nó — xem đầu file.
    """
    try:
        co = os.path.getsize(duong)
    except OSError:
        return None
    if co < nguong:
        return None

    nen_goc = nen_goc or duong
    dich = '%s.%s.gz' % (nen_goc, moc or time.strftime('%Y%m%d-%H%M%S'))
    if thu:
        return 'SẼ xoay %s (%.1f MB) -> %s' % (duong, co / 1048576.0, os.path.basename(dich))

    # Chép sang bản nén trước, cắt sau. Nếu chép hỏng thì KHÔNG cắt — thà log to
    # còn hơn mất lịch sử.
    tam = dich + '.dang-ghi'
    try:
        with open(duong, 'rb') as vao, gzip.open(tam, 'wb') as ra:
            shutil.copyfileobj(vao, ra, 1024 * 1024)
        os.rename(tam, dich)
    except OSError as e:
        try:
            os.remove(tam)
        except OSError:
            pass
        return 'LỖI khi nén %s (%s) — KHÔNG cắt, giữ nguyên file' % (duong, e)

    try:
        with open(duong, 'r+b') as f:
            f.truncate(0)
    except OSError as e:
        return 'Đã nén %s nhưng KHÔNG cắt được (%s) — lần sau sẽ nén trùng' % (duong, e)

    nen = os.path.getsize(dich)
    dong = 'Đã xoay %s: %.1f MB -> %s (%.1f MB nén, còn %.0f%%)' % (
        duong, co / 1048576.0, os.path.basename(dich), nen / 1048576.0, 100.0 * nen / co)
    xoa = don_ban_cu(nen_goc, giu)
    if xoa:
        dong += '; xoá %d bản cũ nhất' % len(xoa)
    return dong


def main(argv=None):
    ap = argparse.ArgumentParser(description='Xoay vòng log launchd của tuyến Dahao')
    ap.add_argument('--nguong', type=int, default=NGUONG_MAC_DINH,
                    help='byte; vượt mức này mới xoay (mặc định %d)' % NGUONG_MAC_DINH)
    ap.add_argument('--giu', type=int, default=GIU_MAC_DINH,
                    help='giữ bao nhiêu bản nén (mặc định %d)' % GIU_MAC_DINH)
    ap.add_argument('--thu', action='store_true', help='chỉ nói sẽ làm gì, không đụng file')
    ap.add_argument('--logs', default=None, help='thư mục logs (mặc định $DAHAO_GATEWAY/logs)')
    ap.add_argument('--broker-log', default=None, dest='broker_log',
                    help='đường dẫn broker.log (mặc định <thư mục cha của logs>/broker.log)')
    ap.add_argument('--khong-broker-log', action='store_true', dest='khong_broker',
                    help='bỏ qua broker.log, chỉ xoay logs/*.out|*.err')
    a = ap.parse_args(argv)

    gw = os.environ.get('DAHAO_GATEWAY', os.path.expanduser('~/dahao-gateway'))
    thu_muc = a.logs or os.path.join(gw, 'logs')
    if not os.path.isdir(thu_muc):
        print('Không thấy thư mục log: %s' % thu_muc)
        return 1

    # Mỗi việc là một cặp (file cần xoay, gốc tên bản lưu). Với log launchd thì hai
    # thứ trùng nhau; chỉ `broker.log` là lệch — xem đầu file.
    viec = [(d, d) for d in cac_log(thu_muc)]

    # `broker.log` bám theo THƯ MỤC CHA của logs/ chứ không bám `gw`. Nhờ vậy bài
    # self-test trỏ `--logs <tmp>/logs` thì chỉ đụng `<tmp>/broker.log`; nếu bám `gw`
    # thì một bài test chạy trên Mini sẽ cắt đúng log production đang chạy.
    if not a.khong_broker:
        cha = os.path.dirname(os.path.abspath(thu_muc))
        blog = a.broker_log or os.path.join(cha, 'broker.log')
        if os.path.exists(blog):
            viec.append((blog, os.path.join(thu_muc, NEN_GOC_BROKER)))

    if not viec:
        # Nói đúng chuyện: bảo "không thấy broker.log" trong khi chính người dùng vừa
        # tắt nó đi là một dòng log biết nói dối, và log biết nói dối thì lần sau
        # không ai dám tin nó nữa.
        them = '' if a.khong_broker else ', cũng không thấy broker.log'
        print('Không có file .out/.err nào trong %s%s' % (thu_muc, them))
        return 0

    lam = [xoay_mot(d, a.nguong, a.giu, a.thu, nen_goc=g) for d, g in viec]
    lam = [x for x in lam if x]
    print('=== XOAY LOG %s (ngưỡng %.0f MB, giữ %d bản) ==='
          % (time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), a.nguong / 1048576.0, a.giu))
    for x in lam:
        print('  ' + x)
    if not lam:
        tong = sum(os.path.getsize(d) for d, _ in viec if os.path.exists(d))
        print('  (không file nào vượt ngưỡng; %d file, tổng %.1f MB)'
              % (len(viec), tong / 1048576.0))
    return 1 if any(x.startswith('LỖI') for x in lam) else 0


if __name__ == '__main__':
    sys.exit(main())
