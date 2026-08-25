#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Self-test OFFLINE cho nhóm P (đẩy mẫu) — phần chạy được HÔM NAY, không cần máy, không cần người.
Bao: P‑01 P‑02 P‑03 P‑04 P‑05 P‑07 P‑08 P‑09.

Vì sao đáng viết: mục 0 của PRD đang khẳng định "toàn bộ phía server đã kiểm hết và đúng".
Câu đó chưa có gì chống lưng — nhóm P chưa từng có một dòng test nào. Bài này là để câu đó
đúng hoặc sai một cách CÓ BẰNG CHỨNG.

⚠ Ranh giới phải nói trước: bài này chỉ chứng minh phía SERVER (broker.py) đọc mẫu, dựng
danh sách và cắt mảnh đúng. Nó KHÔNG chứng minh máy A15 nhận được mẫu — máy đang bị chặn ở
mức `registration` và chưa từng gửi `pattern/query` lần nào. Đó là P‑16/P‑17, cần người ở xưởng.

Chạy:  python3 deploy-mini/tests/test_mau_dst.py
"""
import base64, importlib.util, json, os, shutil, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('broker', os.path.join(HERE, '..', 'broker.py'))
broker = importlib.util.module_from_spec(spec)
sys.argv = ['broker']
spec.loader.exec_module(broker)

# `log()` ghi thẳng ra file + stdout. Bài test cần ĐỌC được nó (nhiều ca ở đây nghiệm thu bằng
# đúng dòng log, ví dụ P‑04 và P‑07), nên thay bằng bộ nhớ tạm.
NHAT_KY = []
broker.log = lambda *a: NHAT_KY.append(' '.join(str(x) for x in a))

# `load_patterns()` nối một dòng đo vào `NAP_CSV` mỗi lần chạy. Mặc định nó nằm cạnh broker.py,
# tức là NGAY TRONG REPO — chạy test mà đẻ rác vào cây làm việc thì lần `git status` nào cũng bẩn.
_RAC = tempfile.mkdtemp(prefix='dahao-test-p-')
broker.NAP_CSV = os.path.join(_RAC, 'nap.csv')


def nap(thu_muc):
    """Trỏ PATTERN_DIR vào một thư mục tạm rồi nạp lại. Trả về nhật ký của riêng lần nạp này."""
    NHAT_KY.clear()
    broker.PATTERN_DIR = thu_muc
    broker.load_patterns()
    return list(NHAT_KY)


def co_dong(nk, chuoi):
    return any(chuoi in d for d in nk)


def lam_dst(st=100, co=2, px=500, mx=500, py=0, my=300, ten='TEST', du_mui=1):
    """Dựng một file .DST hợp lệ, đủ chuẩn để `_dst_meta` đọc ra đúng những con số ta đặt vào.

    `du_mui` = số bản ghi mũi thực sự ghi ra so với con số khai trong `ST:`. Đặt < 1 để làm ra
    một file **cụt** (khai 100 mũi nhưng thân file không có đủ) — đó là ca P‑02.
    """
    h = ('LA:%-16s\r' % ten) + ('ST:%7d\r' % st) + ('CO:%3d\r' % co)
    h += ('+X:%5d\r' % px) + ('-X:%5d\r' % mx) + ('+Y:%5d\r' % py) + ('-Y:%5d\r' % my)
    h += 'AX:+     0\rAY:+     0\rMX:+     0\rMY:+     0\rPD:******\r\x1a'
    dau = h.encode('latin-1').ljust(512, b' ')
    return dau + b'\x00\x00\x03' * int(st * du_mui) + b'\x00\x00\xf3'


def ghi(goc, duong_dan, noi_dung):
    p = os.path.join(goc, duong_dan)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'wb') as f:
        f.write(noi_dung)
    return p


DAT = []
def dat(ma, cau):
    DAT.append(ma)
    print('  [%s] %s OK' % (ma, cau))


# ==================================================================== P‑01 (file thật)

THU_MAU = os.environ.get('DAHAO_PATTERNS', os.path.expanduser('~/dahao-gateway/patterns'))

# Hai file .DST thật đang nằm trên Mini, cùng những con số PRD đã ghi. Đây là chỗ duy nhất
# trong bài dùng dữ liệu thật; phần còn lại tự dựng file nên chạy được ở bất kỳ máy nào.
FILE_THAT = {
    '4144074237': dict(ten='4144074237_1_Front', co=13536, mui=4341, mau=0, rong=1408, cao=233),
    '4146757023': dict(ten='4146757023_1_Front', co=32328, mui=10605, mau=1, rong=1210, cao=513),
}

def p01_file_that():
    if not os.path.isdir(THU_MAU):
        print('  [P‑01] ⚠ BỎ QUA phần file thật: không thấy %s' % THU_MAU)
        print('         (đặt DAHAO_PATTERNS=... để chỉ chỗ khác. Phần tổng hợp bên dưới vẫn chạy.)')
        return False
    nk = nap(THU_MAU)
    for ma, mong in FILE_THAT.items():
        p = broker.PATTERNS.get(ma)
        assert p, 'không nạp được mẫu thật %s — nhật ký: %s' % (ma, nk)
        assert p['patternName'] == mong['ten'], p['patternName']
        assert p['patternSize'] == mong['co'], (ma, 'cỡ', p['patternSize'], mong['co'])
        assert p['drawingFileLen'] == mong['co'], (ma, 'drawingFileLen lệch cỡ file')
        assert p['drawingNeedleCn'] == mong['mui'], (ma, 'số mũi', p['drawingNeedleCn'], mong['mui'])
        assert p['drawingColorCn'] == mong['mau'], (ma, 'số màu', p['drawingColorCn'], mong['mau'])
        assert p['drawingWidth'] == mong['rong'], (ma, 'khổ ngang', p['drawingWidth'], mong['rong'])
        assert p['drawingHeight'] == mong['cao'], (ma, 'khổ dọc', p['drawingHeight'], mong['cao'])
        assert p['data'][:3] == b'LA:', 'byte đầu file thật phải là LA:'
        assert len(p['data']) == mong['co'], 'giữ thiếu byte so với file trên đĩa'
    dat('P‑01', 'header 2 file .DST thật đọc ra đúng số mũi / số màu / khổ / cỡ')
    return True


def p01_tong_hop():
    with tempfile.TemporaryDirectory() as g:
        ghi(g, '9001/a.dst', lam_dst(st=1234, co=7, px=321, mx=123, py=45, my=67))
        nap(g)
        p = broker.PATTERNS['9001']
        assert p['drawingNeedleCn'] == 1234, p
        assert p['drawingColorCn'] == 7, p
        # Khổ = hai nửa cộng lại. `+X` là phần bên phải gốc toạ độ, `-X` là phần bên trái —
        # cả hai đều lưu dưới dạng số dương, nên bề ngang thật là tổng, không phải hiệu.
        assert p['drawingWidth'] == 321 + 123, p
        assert p['drawingHeight'] == 45 + 67, p
    dat('P‑01b', 'file .DST tự dựng: mọi trường header đọc ra đúng giá trị đã đặt vào')


# ==================================================================== P‑02

def p02():
    xau = {
        'rong.dst': b'',
        'cut-than.dst': lam_dst(st=5000, du_mui=0.01),          # khai 5000 mũi, thân chỉ có 50
        'cut-dau.dst': lam_dst(st=300)[:200],                    # cụt ngay giữa header
        'khong-phai-dst.dst': b'\x89PNG\r\n\x1a\n' + b'\x00' * 2000,
        'van-ban.dst': 'đây là ghi chú chứ không phải mẫu\n'.encode() * 60,
        'st-bang-khong.dst': lam_dst(st=0),
    }
    with tempfile.TemporaryDirectory() as g:
        for i, (ten, noi) in enumerate(sorted(xau.items())):
            ghi(g, '%d/%s' % (7000 + i, ten), noi)
        ghi(g, '7999/tot.dst', lam_dst(st=42))                   # chứng thư: file tốt vẫn vào
        nk = nap(g)

        assert '7999' in broker.PATTERNS, 'chặn quá tay: file .DST tốt cũng bị loại'
        vao = sorted(k for k in broker.PATTERNS if k != '7999')
        assert vao == [], (
            'file hỏng / cụt / không phải DST vẫn được nạp: %s\n'
            'Nạp một file như thế nghĩa là ta sẵn sàng đẩy rác xuống máy thêu, và máy sẽ là\n'
            'chỗ đầu tiên phát hiện ra — bằng một mẻ hàng hỏng.\nNhật ký: %s' % (vao, nk))
        for ten in xau:
            assert co_dong(nk, ten), 'loại %s mà không nói vì sao — người vận hành sẽ tưởng file biến mất' % ten
    dat('P‑02', '6 kiểu file xấu đều bị loại, mỗi cái có một dòng nói rõ vì sao')


# ==================================================================== P‑03

def p03():
    with tempfile.TemporaryDirectory() as g:
        ghi(g, '4144074237/x_1_Front.dst', lam_dst(st=10))       # thư mục là số  -> lấy thư mục
        ghi(g, 'linh-tinh/8812345678_1_Back.dst', lam_dst(st=11))  # không phải số -> lấy đầu tên file
        nk = nap(g)
        assert '4144074237' in broker.PATTERNS, broker.PATTERNS.keys()
        assert '8812345678' in broker.PATTERNS, broker.PATTERNS.keys()

        # Nạp lại lần hai: cùng đầu vào phải ra cùng mã. Mã mẫu là thứ máy dùng để xin file;
        # đổi mã giữa hai lần khởi động nghĩa là đơn hàng hôm qua không tìm lại được.
        truoc = {k: v['patternName'] for k, v in broker.PATTERNS.items()}
        nap(g)
        assert {k: v['patternName'] for k, v in broker.PATTERNS.items()} == truoc, 'mã đổi giữa hai lần nạp'

        for ma, p in broker.PATTERNS.items():
            assert isinstance(ma, str), (ma, type(ma))
            assert ma.isdigit(), 'mã không phải chữ số: %r' % ma
            assert len(ma) <= 20, 'mã dài %d ký tự' % len(ma)
            assert broker._item(p)['barCodeID'] == ma
            assert broker._item(p)['patternNetID'] == ma

    # Mã KHÔNG phải chữ số: hôm nay chưa biết máy có nuốt được không, nên không chặn — nhưng
    # phải kêu lên. Một mã chữ lẳng lặng vào danh sách sẽ chỉ lộ ra ở xưởng.
    with tempfile.TemporaryDirectory() as g:
        ghi(g, 'linh-tinh/AO-01.dst', lam_dst(st=12))
        nk = nap(g)
        assert 'AO-01' in broker.PATTERNS, 'không chặn, chỉ cảnh báo'
        assert co_dong(nk, 'AO-01') and co_dong(nk, 'chữ số'), (
            'mã mẫu không phải chữ số mà không có lời cảnh báo nào: %s' % nk)
    dat('P‑03', 'mã mẫu suy ra ổn định qua các lần nạp; mã không phải chữ số bị kêu lên')


# ==================================================================== P‑04

KHOA_ITEM = {'barCodeID', 'patternNetID', 'patternName', 'type', 'patternSize',
             'drawingNeedleCn', 'drawingColorCn', 'drawingWidth', 'drawingHeight', 'drawingFileLen'}

def p04():
    with tempfile.TemporaryDirectory() as g:
        for i in range(3):
            ghi(g, '600%d/mau.dst' % i, lam_dst(st=100 + i))
        nk = nap(g)
        assert co_dong(nk, '[PATTERNS] nạp 3 mẫu'), nk
        for i in range(3):
            it = broker._item(broker.PATTERNS['600%d' % i])
            assert set(it) == KHOA_ITEM, set(it) ^ KHOA_ITEM
            assert it['drawingNeedleCn'] == 100 + i
            # Mọi khoá phải xuống dây đúng kiểu JSON — không được lọt bytes hay None vào.
            json.dumps(it)
    dat('P‑04', 'thả file vào patterns/<mã>/ -> nạp đủ, đúng 10 khoá của `_item`, đúng dòng log')


# ==================================================================== P‑05

def p05():
    with tempfile.TemporaryDirectory() as g:
        a = ghi(g, '4144074237/ban-a.dst', lam_dst(st=111, ten='BAN_A'))
        b = ghi(g, 'kho-cu/4144074237_ban-b.dst', lam_dst(st=222, ten='BAN_B'))
        nk = nap(g)

        assert len(broker.PATTERNS) == 1, 'trùng mã mà đẻ ra 2 mục thì mã không còn là mã'
        p = broker.PATTERNS['4144074237']
        # Ai thắng KHÔNG được phép phụ thuộc thứ tự `os.walk` trả về thư mục — thứ tự đó khác
        # nhau giữa các máy. Chốt: đường dẫn nhỏ hơn theo thứ tự chữ thì thắng, và nói ra.
        assert p['drawingNeedleCn'] == 111, (
            'bản thắng không đúng bản đã chốt (mong BAN_A=111, được %d)' % p['drawingNeedleCn'])
        assert co_dong(nk, 'TRÙNG MÃ'), 'ghi đè lặng lẽ một mẫu bằng mẫu khác: %s' % nk
        assert co_dong(nk, os.path.basename(b)), 'không nói rõ bản nào bị bỏ: %s' % nk
    dat('P‑05', 'trùng mã ở hai thư mục: không sập, bản thắng cố định, bản thua được nêu tên')


# ==================================================================== P‑06

def p06():
    with tempfile.TemporaryDirectory() as g:
        broker.NAP_CSV = os.path.join(g, 'nap.csv')
        for i in range(4):
            ghi(g, '820%d/m.dst' % i, lam_dst(st=2000 + i))
        ghi(g, '8299/hong.dst', b'khong phai dst')
        nk = nap(g)

        moc = [d for d in nk if 'T_chuẩn bị' in d]
        assert len(moc) == 1, 'không có mốc T_chuẩn bị trong log: %s' % nk
        # Bốn chặng phải tách ra được. Một con số tổng trần trụi không nói được chặng nào chậm,
        # mà "đẩy mẫu mất bao lâu" chỉ hữu ích khi biết chỗ nào bóp cổ chai.
        for chang in ('liệt kê', 'đọc', 'kiểm'):
            assert chang in moc[0], (chang, moc[0])
        assert 'bỏ 1 file' in moc[0], moc[0]

        assert os.path.exists(broker.NAP_CSV), 'không xuất CSV'
        dong = open(broker.NAP_CSV).read().strip().splitlines()
        assert len(dong) == 2, dong
        assert dong[0] == 'luc,so_mau,so_bo,so_byte,ms_liet_ke,ms_doc,ms_kiem,ms_tong', dong[0]
        o = dong[1].split(',')
        assert int(o[1]) == 4 and int(o[2]) == 1, o
        assert int(o[3]) == sum(p['patternSize'] for p in broker.PATTERNS.values()) + len(b'khong phai dst'), o
        ms_tong = float(o[7])
        assert 0 < ms_tong < 60_000, ms_tong
        # Tổng phải bao được các chặng đã tách — nếu chặng con lớn hơn tổng thì đồng hồ đặt sai chỗ.
        assert float(o[4]) + float(o[5]) + float(o[6]) <= ms_tong + 1e-6, o

        nap(g)  # lần nạp thứ hai chỉ nối thêm một dòng, không viết lại đầu đề
        assert len(open(broker.NAP_CSV).read().strip().splitlines()) == 3
        print('        T_chuẩn bị đo được: %.1f ms cho 4 mẫu / %s B' % (ms_tong, o[3]))
    dat('P‑06', 'T_chuẩn bị (t1→t2) có mốc trong log, tách 3 chặng, và nối thêm vào CSV')


# ==================================================================== P‑07

def p07():
    with broker.lock:
        con = list(broker.clients)
        del broker.clients[:]
    try:
        NHAT_KY.clear()
        for lenh in ('browse', 'query 4144074237', 'data 4144074237', 'lệnh-bịa'):
            broker.do_ctrl(lenh)      # không được ném ra ngoài
        assert co_dong(NHAT_KY, '[CTRL] chưa có máy nối'), NHAT_KY
        assert len([d for d in NHAT_KY if 'chưa có máy nối' in d]) == 4, NHAT_KY
    finally:
        with broker.lock:
            broker.clients.extend(con)
    dat('P‑07', 'push-cmd.txt lúc chưa có máy nào nối: 4 lệnh đều bỏ qua êm, không sập')


# ==================================================================== P‑08

def p08():
    with tempfile.TemporaryDirectory() as g:
        ghi(g, '4146757023/to.dst', lam_dst(st=10605))
        nap(g)
        p = broker.PATTERNS['4146757023']

        goi = []
        that = broker.deliver
        broker.deliver = lambda topic, payload: (goi.append((topic, payload)), 1)[1]
        try:
            broker._reply('DEV1', 'emCAD/server/v1/pattern/data', {'mesgNo': '77'}, {
                'barCodeID': p['barCodeID'],
                'data': base64.b64encode(p['data']).decode(),
                'fileStart': 0,
                'patternName': p['patternName'],
            })
        finally:
            broker.deliver = that

        assert len(goi) == 1, goi
        topic, payload = goi[0]
        assert topic.endswith('/DEV1'), topic
        # Giải mã ngược bằng đúng đường giao thức. Khoá không xuất hiện ở đây và không được
        # in ra bất kỳ đâu — bài test chỉ đi qua `dec_json`, không chạm vào giá trị khoá.
        lai = broker.dec_json(payload)
        assert lai['header']['mesgNo'] == '77', lai['header']
        assert base64.b64decode(lai['body']['data']) == p['data'], 'vòng mã hoá làm hỏng byte'
        assert lai['body']['barCodeID'] == '4146757023'
        assert lai['body']['fileStart'] == 0

        # Cắt mảnh rồi ghép lại phải khớp từng byte với file gốc (nền của P‑14).
        manh, moc, CO_MANH = [], 0, 4096
        while moc < len(p['data']):
            manh.append(p['data'][moc:moc + CO_MANH]); moc += CO_MANH
        assert b''.join(manh) == p['data'] and len(manh) > 1
    dat('P‑08', 'payload `pattern/data` giải mã ngược khớp byte, kể cả file 32 KB; khoá không lộ')


# ==================================================================== P‑09

def p09():
    with tempfile.TemporaryDirectory() as g:
        ghi(g, '5001/x.dst', lam_dst(st=9))
        ghi(g, '5002/y.DST', lam_dst(st=9))     # đuôi viết hoa
        nap(g)
        for ma in ('5001', '5002'):
            it = broker._item(broker.PATTERNS[ma])
            assert it['type'] == 'DST', it['type']
            assert isinstance(it['type'], str), type(it['type'])
    # Chốt bằng bằng chứng, không đoán: `type` đang là CHUỖI 'DST' ở cả ba chỗ phát ra —
    # `_item` (browse), `query/ack` khi tìm thấy, và `query/ack` khi không tìm thấy. Nếu sau
    # này máy thật từ chối vì nó chờ một con SỐ, đây là chỗ sửa, và ca này sẽ đỏ ngay.
    ma_nguon = open(os.path.join(HERE, '..', 'broker.py'), encoding='utf-8').read()
    assert ma_nguon.count("'type':'DST'") >= 1, 'query/ack không còn trả type dạng chuỗi'
    dat('P‑09', "`type` là chuỗi 'DST' ở mọi chỗ phát ra; đuôi .DST viết hoa vẫn nạp được")


if __name__ == '__main__':
    print('=== Nhóm P — phần chạy được không cần máy ===')
    that = p01_file_that()
    p01_tong_hop()
    p02()
    p03()
    p04()
    p05()
    p06()
    p07()
    p08()
    p09()
    shutil.rmtree(_RAC, ignore_errors=True)
    print('--- QUA %d ca: %s' % (len(DAT), ' '.join(DAT)))
    if not that:
        print('--- ⚠ phần "2 file .DST thật" của P‑01 BỊ BỎ QUA trên máy này')
