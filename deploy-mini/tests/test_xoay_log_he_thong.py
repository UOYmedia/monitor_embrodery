#!/usr/bin/env python3
# Self-test OFFLINE cho xoay_log_he_thong.py — ca K‑20.
#
# Điểm mấu chốt phải chứng minh, không được tin suông: kiểu "chép rồi cắt tại chỗ"
# có THẬT SỰ an toàn với một tiến trình đang giữ fd mở kiểu O_APPEND hay không —
# vì đó chính xác là cách launchd giữ broker.out. Nếu sai, log mới sẽ có một lỗ
# rỗng đầy byte NUL bằng đúng kích thước file cũ, và không ai đọc được nữa.
# Bài 7 dựng hẳn một tiến trình con ghi thật để thử, không mock.
import os, sys, gzip, time, json, shutil, tempfile, subprocess, signal

HERE = os.path.dirname(os.path.abspath(__file__))
CONG_CU = os.path.join(HERE, '..', 'xoay_log_he_thong.py')

def chay(*cf):
    r = subprocess.run([sys.executable, CONG_CU, *cf], capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr

def do_day(duong, so_byte, ky_tu=b'x'):
    with open(duong, 'wb') as f:
        f.write(ky_tu * so_byte)

def cac_gz(thu_muc, goc):
    return sorted(t for t in os.listdir(thu_muc) if t.startswith(goc + '.') and t.endswith('.gz'))

tmp = tempfile.mkdtemp(prefix='xoaylog-')
logs = os.path.join(tmp, 'logs'); os.makedirs(logs)
try:
    # ---------- 1) Dưới ngưỡng -> không đụng vào ----------
    a = os.path.join(logs, 'broker.out')
    do_day(a, 1000)
    ma, ra = chay('--logs', logs, '--nguong', '5000')
    assert ma == 0, (ma, ra)
    assert os.path.getsize(a) == 1000, 'file dưới ngưỡng bị đụng vào'
    assert cac_gz(logs, 'broker.out') == [], 'tạo bản nén khi chưa cần'
    assert 'không file nào vượt ngưỡng' in ra, ra
    print('  [1] dưới ngưỡng -> không xoay, không tạo rác OK')

    # ---------- 2) Trên ngưỡng -> nén đủ, cắt sạch, nội dung khớp từng byte ----------
    goc = bytes(range(256)) * 400            # 102.400 byte, có cả byte nhị phân
    with open(a, 'wb') as f: f.write(goc)
    ma, ra = chay('--logs', logs, '--nguong', '5000')
    assert ma == 0, (ma, ra)
    assert os.path.getsize(a) == 0, 'không cắt file gốc về 0'
    gz = cac_gz(logs, 'broker.out')
    assert len(gz) == 1, gz
    with gzip.open(os.path.join(logs, gz[0]), 'rb') as f:
        assert f.read() == goc, 'bản nén KHÔNG khớp từng byte với bản gốc'
    assert 'Đã xoay' in ra, ra
    assert not [t for t in os.listdir(logs) if t.endswith('.dang-ghi')], 'sót file tạm'
    print('  [2] trên ngưỡng -> nén khớp từng byte, gốc cắt về 0, không sót file tạm OK')

    # ---------- 3) Giữ đúng N bản, xoá bản CŨ NHẤT ----------
    for t in cac_gz(logs, 'broker.out'):
        os.remove(os.path.join(logs, t))
    for i in range(15):
        with gzip.open(os.path.join(logs, 'broker.out.202608%02d-000000.gz' % (i + 1)), 'wb') as f:
            f.write(b'ban %d' % i)
    do_day(a, 20000)
    ma, ra = chay('--logs', logs, '--nguong', '5000', '--giu', '10')
    assert ma == 0, (ma, ra)
    con = cac_gz(logs, 'broker.out')
    assert len(con) == 10, 'giữ %d bản, đáng lẽ 10' % len(con)
    assert not any('202608%02d' % (i + 1) in t for i in range(6) for t in con), \
        'còn sót bản cũ đáng lẽ đã xoá: %s' % con
    assert 'xoá' in ra, ra
    print('  [3] giữ đúng 10 bản mới nhất, xoá đúng các bản cũ nhất OK')

    # ---------- 4) --thu chỉ nói, không làm ----------
    for t in cac_gz(logs, 'broker.out'):
        os.remove(os.path.join(logs, t))
    do_day(a, 20000)
    ma, ra = chay('--logs', logs, '--nguong', '5000', '--thu')
    assert ma == 0 and 'SẼ xoay' in ra, (ma, ra)
    assert os.path.getsize(a) == 20000, '--thu vẫn cắt file'
    assert cac_gz(logs, 'broker.out') == [], '--thu vẫn tạo bản nén'
    print('  [4] --thu chỉ báo, tuyệt đối không đụng vào file OK')

    # ---------- 5) Chỉ nhận .out/.err, bỏ qua thứ khác và bỏ qua chính bản nén ----------
    do_day(os.path.join(logs, 'ghi-chu.txt'), 20000)
    do_day(os.path.join(logs, 'da-nen.out.20260101-000000.gz'), 20000)
    do_day(os.path.join(logs, 'tunnel.err'), 20000)
    ma, ra = chay('--logs', logs, '--nguong', '5000')
    assert ma == 0, (ma, ra)
    assert os.path.getsize(os.path.join(logs, 'ghi-chu.txt')) == 20000, 'đụng vào file không phải log'
    assert os.path.getsize(os.path.join(logs, 'da-nen.out.20260101-000000.gz')) == 20000, \
        'nén lại chính bản đã nén'
    assert os.path.getsize(os.path.join(logs, 'tunnel.err')) == 0, 'bỏ sót .err'
    print('  [5] chỉ xoay .out/.err, không nén lại bản .gz, không đụng file lạ OK')

    # ---------- 6) Thư mục thiếu / rỗng -> báo rõ, không traceback ----------
    ma, ra = chay('--logs', os.path.join(tmp, 'khong-co'))
    assert ma == 1 and 'Không thấy thư mục log' in ra and 'Traceback' not in ra, (ma, ra)
    rong = os.path.join(tmp, 'rong'); os.makedirs(rong)
    ma, ra = chay('--logs', rong)
    assert ma == 0 and 'Không có file' in ra and 'Traceback' not in ra, (ma, ra)
    print('  [6] thư mục thiếu/rỗng -> báo rõ, không traceback OK')

    # ---------- 7) CHỨNG MINH copy-truncate an toàn với fd O_APPEND đang mở ----------
    # Dựng một tiến trình con ghi thật kiểu launchd (O_APPEND), xoay giữa lúc nó đang ghi.
    song = os.path.join(logs, 'dangchay.out')
    do_day(song, 60000, b'C' * 1)                    # nền cho vượt ngưỡng ngay
    ma_con = (
        'import os,sys,time\n'
        'fd=os.open(sys.argv[1], os.O_WRONLY|os.O_APPEND|os.O_CREAT)\n'
        'i=0\n'
        'while True:\n'
        '    os.write(fd, b"D%08d\\n" % i); i+=1; time.sleep(0.0005)\n'
    )
    con = subprocess.Popen([sys.executable, '-c', ma_con, song])
    try:
        time.sleep(0.4)
        ma, ra = chay('--logs', logs, '--nguong', '5000')
        assert ma == 0, (ma, ra)
        time.sleep(0.4)
    finally:
        con.send_signal(signal.SIGKILL); con.wait()

    sau = open(song, 'rb').read()
    assert len(sau) > 0, 'sau khi cắt, tiến trình đang ghi không ghi được nữa'
    assert b'\x00' not in sau, \
        ('LỖ RỖNG: file mới có byte NUL — fd KHÔNG phải O_APPEND, ghi vào offset cũ. '
         'Cách chép-rồi-cắt KHÔNG dùng được.')
    assert sau.startswith(b'D'), 'file mới không bắt đầu bằng dòng thật: %r' % sau[:40]
    assert os.path.getsize(song) == len(sau), 'kích thước khai báo lệch với nội dung thật'

    gz7 = cac_gz(logs, 'dangchay.out')
    assert len(gz7) == 1, gz7
    with gzip.open(os.path.join(logs, gz7[0]), 'rb') as f:
        cu = f.read()
    def so_dong(b):
        return [int(d[1:]) for d in b.split(b'\n') if d.startswith(b'D') and len(d) == 9]
    n_cu, n_moi = so_dong(cu), so_dong(sau)
    assert n_cu and n_moi, 'không đọc được số dòng (cũ=%d mới=%d)' % (len(n_cu), len(n_moi))
    assert n_moi[0] > n_cu[-1], 'dòng bị ghi lặp giữa bản nén và bản mới'
    mat = n_moi[0] - n_cu[-1] - 1
    assert mat <= 50, 'mất %d dòng ở khoảnh khắc xoay — nhiều hơn mức chấp nhận' % mat
    assert n_moi == list(range(n_moi[0], n_moi[0] + len(n_moi))), 'dòng sau khi xoay bị đứt quãng'
    print('  [7] tiến trình đang ghi (O_APPEND) vẫn ghi liền mạch qua cú xoay; '
          'không lỗ NUL, mất %d dòng ở khoảnh khắc xoay OK' % mat)

    # ---------- 8) Nén hỏng thì TUYỆT ĐỐI không cắt — thà log to còn hơn mất lịch sử ----------
    kho = os.path.join(tmp, 'khoa'); os.makedirs(kho)
    b = os.path.join(kho, 'broker.out')
    do_day(b, 20000)
    os.chmod(kho, 0o500)                              # đọc + vào được, không ghi được
    try:
        ma, ra = chay('--logs', kho, '--nguong', '5000')
        assert os.path.getsize(b) == 20000, 'nén thất bại mà vẫn cắt file gốc — MẤT DỮ LIỆU'
        assert 'LỖI' in ra and 'KHÔNG cắt' in ra, ra
        assert ma == 1, 'nén hỏng phải trả mã thoát khác 0, thấy %d' % ma
        assert 'Traceback' not in ra, ra
    finally:
        os.chmod(kho, 0o700)
    print('  [8] nén thất bại -> giữ nguyên file gốc, báo lỗi, mã thoát 1 OK')

    print('TẤT CẢ ĐẠT — xoay_log_he_thong.py (ca K‑20)')
finally:
    shutil.rmtree(tmp, ignore_errors=True)
