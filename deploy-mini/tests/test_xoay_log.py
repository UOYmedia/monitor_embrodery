#!/usr/bin/env python3
# Self-test OFFLINE cho [V1] _xoay_log — KHÔNG cần máy, KHÔNG cần mạng, KHÔNG cần người.
# Trước bản vá, main() gọi open(LOG,'w').close() => mỗi lần khởi động lại là mất sạch
# nhật ký phiên trước. Bài này chốt lại hành vi mới: ĐỔI TÊN, và chỉ giữ 10 bản.
import importlib.util, os, sys, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('broker', os.path.join(HERE, '..', 'broker.py'))
broker = importlib.util.module_from_spec(spec)
sys.argv = ['broker']
spec.loader.exec_module(broker)

tmp = tempfile.mkdtemp(prefix='xoaylog-')
try:
    broker.LOG = os.path.join(tmp, 'broker.log')

    # ---------- 1) Không có log cũ thì không nổ ----------
    broker._xoay_log()
    assert os.listdir(tmp) == [], os.listdir(tmp)
    print('  [1] chưa có log thì bỏ qua êm OK')

    # ---------- 2) Có log cũ -> ĐỔI TÊN, nội dung còn nguyên ----------
    with open(broker.LOG, 'w') as f:
        f.write('dòng của phiên trước\n')
    broker._xoay_log()
    assert not os.path.exists(broker.LOG), 'file gốc phải được dọn đi'
    con = [f for f in os.listdir(tmp) if f.startswith('broker.log.')]
    assert len(con) == 1, con
    with open(os.path.join(tmp, con[0])) as f:
        assert f.read() == 'dòng của phiên trước\n'
    print('  [2] log cũ được giữ lại nguyên vẹn, không bị cắt trắng OK')

    # ---------- 3) Log rỗng thì không đẻ bản lưu vô nghĩa ----------
    open(broker.LOG, 'w').close()
    broker._xoay_log()
    con = [f for f in os.listdir(tmp) if f.startswith('broker.log.')]
    assert len(con) == 1, 'log rỗng không nên sinh thêm bản lưu, thấy %r' % con
    print('  [3] log rỗng không sinh bản lưu thừa OK')

    # ---------- 4) Chỉ giữ 10 bản gần nhất ----------
    for f in os.listdir(tmp):
        os.remove(os.path.join(tmp, f))
    for i in range(15):
        # tên tự sắp xếp được theo thứ tự thời gian, giống định dạng %Y%m%d-%H%M%S
        with open(os.path.join(tmp, 'broker.log.202608%02d-000000' % (i + 1)), 'w') as f:
            f.write(str(i))
    with open(broker.LOG, 'w') as f:
        f.write('mới nhất\n')
    broker._xoay_log()
    con = sorted(f for f in os.listdir(tmp) if f.startswith('broker.log.'))
    assert len(con) == 10, 'phải còn đúng 10 bản, thấy %d' % len(con)
    # bản vừa xoay phải nằm trong số còn lại, bản cổ nhất phải bị dọn
    assert 'broker.log.20260801-000000' not in con, 'bản cổ nhất chưa bị dọn'
    print('  [4] dọn còn đúng 10 bản, bỏ bản cổ nhất OK')

    # ---------- 5) Thư mục chỉ-đọc thì nuốt lỗi, không làm sập broker ----------
    ro = tempfile.mkdtemp(prefix='xoaylog-ro-')
    broker.LOG = os.path.join(ro, 'broker.log')
    with open(broker.LOG, 'w') as f:
        f.write('x\n')
    os.chmod(ro, 0o500)
    try:
        broker._xoay_log()          # không được ném ra ngoài
        print('  [5] thư mục chỉ-đọc: nuốt lỗi, broker vẫn khởi động được OK')
    finally:
        os.chmod(ro, 0o700)
        shutil.rmtree(ro, ignore_errors=True)

    print('TẤT CẢ ĐẠT — [V1] _xoay_log')
finally:
    shutil.rmtree(tmp, ignore_errors=True)
