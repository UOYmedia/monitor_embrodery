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

KHÔNG đụng gì tới broker.py, bridge hay tunnel. Chỉ đọc/ghi trong thư mục logs/.

Chạy:
  python3 xoay_log_he_thong.py            # xoay file nào vượt ngưỡng
  python3 xoay_log_he_thong.py --thu      # chỉ nói sẽ làm gì, không đụng vào file
  python3 xoay_log_he_thong.py --nguong 1048576 --giu 5

Biến môi trường: DAHAO_GATEWAY (mặc định ~/dahao-gateway)
"""
import os, sys, gzip, time, shutil, argparse

NGUONG_MAC_DINH = 8 * 1024 * 1024      # 8 MiB ~ 5 ngày broker.out
GIU_MAC_DINH    = 10                    # giữ 10 bản nén ~ gần 2 tháng lịch sử


def cac_log(thu_muc):
    """Các file log launchd tự ghi. Bỏ qua chính các bản đã nén."""
    try:
        ten = sorted(os.listdir(thu_muc))
    except OSError:
        return []
    return [os.path.join(thu_muc, t) for t in ten
            if (t.endswith('.out') or t.endswith('.err')) and not t.endswith('.gz')]


def don_ban_cu(duong, giu):
    """Xoá bớt bản nén cũ, giữ lại `giu` bản mới nhất. Trả về danh sách đã xoá."""
    thu_muc = os.path.dirname(duong) or '.'
    goc = os.path.basename(duong) + '.'
    try:
        ban = sorted(t for t in os.listdir(thu_muc)
                     if t.startswith(goc) and t.endswith('.gz'))
    except OSError:
        return []
    da_xoa = []
    for t in ban[:-giu] if giu > 0 else ban:
        try:
            os.remove(os.path.join(thu_muc, t)); da_xoa.append(t)
        except OSError:
            pass
    return da_xoa


def xoay_mot(duong, nguong, giu, thu=False, moc=None):
    """Xoay một file nếu nó vượt ngưỡng. Trả về dòng mô tả việc đã làm, hoặc None."""
    try:
        co = os.path.getsize(duong)
    except OSError:
        return None
    if co < nguong:
        return None

    dich = '%s.%s.gz' % (duong, moc or time.strftime('%Y%m%d-%H%M%S'))
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
    xoa = don_ban_cu(duong, giu)
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
    a = ap.parse_args(argv)

    gw = os.environ.get('DAHAO_GATEWAY', os.path.expanduser('~/dahao-gateway'))
    thu_muc = a.logs or os.path.join(gw, 'logs')
    if not os.path.isdir(thu_muc):
        print('Không thấy thư mục log: %s' % thu_muc)
        return 1

    ds = cac_log(thu_muc)
    if not ds:
        print('Không có file .out/.err nào trong %s' % thu_muc)
        return 0

    lam = [xoay_mot(d, a.nguong, a.giu, a.thu) for d in ds]
    lam = [x for x in lam if x]
    print('=== XOAY LOG %s (ngưỡng %.0f MB, giữ %d bản) ==='
          % (time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), a.nguong / 1048576.0, a.giu))
    for x in lam:
        print('  ' + x)
    if not lam:
        tong = sum(os.path.getsize(d) for d in ds if os.path.exists(d))
        print('  (không file nào vượt ngưỡng; %d file, tổng %.1f MB)' % (len(ds), tong / 1048576.0))
    return 1 if any(x.startswith('LỖI') for x in lam) else 0


if __name__ == '__main__':
    sys.exit(main())
