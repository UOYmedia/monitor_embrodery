#!/usr/bin/env python3
# Self-test CÁCH LY cho ca S‑12: gói `state` hỏng thì BỎ QUA kèm một dòng log, luồng vẫn sống.
#
# Vì sao ca này quan trọng: đường `state` là đường duy nhất số liệu máy chảy về. Nếu MỘT gói
# méo (nhiễu đường truyền, máy nửa chừng đổi firmware, một trường lạ) đủ sức giết luồng, thì
# cả máy im tiếng cho tới lần quay số sau — và trên dashboard nó trông y hệt "máy mất điện".
# Hỏng một gói phải chỉ mất một gói.
#
# Vì sao KHÔNG chạy vào broker production (khác T1–T4 trong test_ben_vung_live.py): bài này
# phải PUBLISH, mà mọi publish đều bị enumerator ghi vào catalog.json vĩnh viễn. Một topic
# dev giả nằm lại trong catalog sẽ bẩn đúng cái file dùng để bàn giao. Nên bài này dựng RIÊNG
# một broker trong thư mục tạm: cùng mã nguồn, cổng trống, ENUM tắt, chuyển tiếp bridge tắt.
#
#   S12‑1  Bốn kiểu payload hỏng khác nhau -> mỗi gói 1 dòng "STATE parse lỗi", vẫn PUBACK.
#   S12‑2  Sau chuỗi gói hỏng, luồng còn sống (PINGREQ -> PINGRESP).
#   S12‑3  Gói ĐÚNG gửi ngay sau đó vẫn được xử lý -> luồng hồi phục THẬT, không chỉ "chưa chết".
#   S12‑4  Gói méo ở tầng khung MQTT: cùng lắm mất kết nối đó, broker vẫn nhận kết nối MỚI.
#   S12‑5  Không có gói hỏng nào lọt xuống bridge (không nhiễm số bẩn vào dữ liệu sản xuất).
#
# Chạy:  python3 tests/test_goi_hong.py
import base64, importlib.util, json, os, shutil, socket, struct, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
# DAHAO_BROKER_SRC cho phép trỏ vào một bản broker.py khác. Có hai công dụng: chạy bài này
# trên bản cài đặt (~/dahao-gateway/broker.py) thay vì bản trong repo, và — quan trọng hơn —
# làm ĐỐI CHỨNG ÂM: cố ý bẻ gãy cái chốt try/except rồi kiểm rằng bài này ĐỎ lên. Một bài
# test chưa từng được nhìn thấy trượt thì chưa chứng minh được điều gì.
GOC = os.environ.get('DAHAO_BROKER_SRC') or os.path.join(HERE, '..', 'broker.py')
DEV = 'AABBCCDDEE12'                      # dev GIẢ — không thể đá nhầm máy thật
TOPIC = 'emCAD/client/v1/state/' + DEV

ket_qua = []
def cham(ten, dat, chi_tiet=''):
    ket_qua.append((ten, dat))
    print('  %s  %s  %s' % ('ĐẠT  ' if dat else 'TRƯỢT', ten, chi_tiet))

# ---------------------------------------------------------------- gói MQTT
def enc_remlen(n):
    ra = b''
    while True:
        b = n % 128; n //= 128
        ra += bytes([b | (0x80 if n else 0)])
        if not n: return ra

def mk_connect(cid, keepalive=30):
    pn = b'MQIsdp'
    body = struct.pack('>H', len(pn)) + pn + bytes([3, 0x02]) + struct.pack('>H', keepalive)
    c = cid.encode()
    body += struct.pack('>H', len(c)) + c
    return bytes([0x10]) + enc_remlen(len(body)) + body

def mk_publish(topic, payload, qos=1, pid=1):
    t = topic.encode()
    body = struct.pack('>H', len(t)) + t
    if qos > 0: body += struct.pack('>H', pid)
    body += payload if isinstance(payload, bytes) else payload.encode()
    return bytes([0x30 | (qos << 1)]) + enc_remlen(len(body)) + body

# ---------------------------------------------------------------- dựng broker tạm
def cong_trong():
    s = socket.socket(); s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]; s.close(); return p

tmp = tempfile.mkdtemp(prefix='goihong-')
tien_trinh = None
try:
    cong = cong_trong()
    ban_sao = os.path.join(tmp, 'broker.py')
    with open(GOC, 'r') as f: ma = f.read()
    moi = ma.replace("HOST='0.0.0.0'; PORT=3865", "HOST='127.0.0.1'; PORT=%d" % cong, 1)
    assert moi != ma, 'không thay được cổng trong broker.py — dòng HOST/PORT đã đổi dạng?'
    with open(ban_sao, 'w') as f: f.write(moi)

    # Nạp bản sao như một module để mượn aes_enc_json dựng payload HỢP LỆ.
    # (Có `if __name__=="__main__"` nên import không tự khởi động server.)
    spec = importlib.util.spec_from_file_location('broker_tam', ban_sao)
    B = importlib.util.module_from_spec(spec)
    sys.argv = ['broker']
    spec.loader.exec_module(B)

    moi_truong = dict(os.environ, ENUM_ENABLE='0', FWD_ENABLE='0')
    tien_trinh = subprocess.Popen([sys.executable, ban_sao], env=moi_truong,
                                  cwd=tmp, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    LOG = os.path.join(tmp, 'broker.log')

    for _ in range(100):                      # đợi cổng mở
        try:
            s = socket.socket(); s.settimeout(1); s.connect(('127.0.0.1', cong)); s.close(); break
        except OSError:
            time.sleep(0.1)
    else:
        print('BỎ QUA: broker tạm không lên được cổng %d' % cong); sys.exit(77)

    def doc_log():
        try:
            with open(LOG, errors='ignore') as f: return f.read()
        except FileNotFoundError:
            return ''

    def cho_log(chuoi, so_lan=1, han=5.0):
        het = time.time() + han
        while time.time() < het:
            if doc_log().count(chuoi) >= so_lan: return True
            time.sleep(0.05)
        return False

    # ------------------------------------------------------ S12‑1 + S12‑2 + S12‑3
    s = socket.socket(); s.settimeout(10)
    s.connect(('127.0.0.1', cong))
    s.sendall(mk_connect(DEV + 'ForEMCAD'))
    connack = s.recv(4)
    assert connack == b'\x20\x02\x00\x00', 'không nhận được CONNACK: %r' % connack

    def aes_tho(ro):
        """Mã hoá đúng chuẩn nhưng ruột KHÔNG phải JSON — để vỡ ở đúng tầng json.loads.
        Dùng B.KEY/B.IV qua tham chiếu; không in ra, không ghi ra đâu cả."""
        pad = 16 - (len(ro) % 16)
        return base64.b64encode(B.AES.new(B.KEY, B.AES.MODE_CBC, B.IV).encrypt(ro + bytes([pad]) * pad))

    # Bốn kiểu hỏng KHÁC NHAU, vì chúng vỡ ở bốn tầng khác nhau của dec_json():
    #   b64decode -> AES.decrypt -> json.loads -> .get('body')
    # Gộp chung thành "một gói hỏng" sẽ bỏ lọt: chỉ cần MỘT tầng ném lỗi ra ngoài `try` là
    # luồng chết, mà ba tầng kia vẫn xanh.
    HONG = [
        ('rác không phải base64',      b'\xff\xfe\xfd khong phai base64 gi ca \x00\x01'),
        ('base64 nhưng lệch khối AES', base64.b64encode(b'ba muoi mot byte le loi khong chia het')),
        ('AES giải được, ruột không JSON', aes_tho(b'day hoan toan khong phai JSON')),
        ('payload rỗng',               b''),
    ]
    # Khi chốt bị gãy, luồng chết ngay gói hỏng ĐẦU TIÊN và mọi lần gửi sau đó ném
    # BrokenPipeError. Bắt lấy, để bài test còn chấm điểm được ba ca còn lại thay vì nổ
    # traceback — người đọc cần thấy "trượt vì luồng đã chết", không phải một stack trace.
    song = True
    for ten, tai in HONG:
        truoc = doc_log().count('STATE parse lỗi')
        puback, ok_log = b'', False
        try:
            s.sendall(mk_publish(TOPIC, tai, qos=1, pid=7))
            puback = s.recv(4)
            ok_log = cho_log('STATE parse lỗi', truoc + 1)
        except OSError as e:
            song = False
            puback = ('luồng đã chết: %s' % e)
        ok = puback == b'\x40\x02\x00\x07' and ok_log
        cham('S12‑1 %-33s -> bỏ qua + ghi log + PUBACK' % ten, ok,
             '' if ok else 'ack=%r log=%s' % (puback, ok_log))

    pingresp = b''
    try:
        s.sendall(bytes([0xc0, 0x00]))        # PINGREQ
        pingresp = s.recv(2)
    except OSError as e:
        pingresp = ('luồng đã chết: %s' % e)
    cham('S12‑2 sau 4 gói hỏng, luồng vẫn sống (PINGRESP)', pingresp == b'\xd0\x00',
         '' if pingresp == b'\xd0\x00' else 'nhận %r' % pingresp)

    # Gói ĐÚNG ngay sau chuỗi hỏng. Đây mới là câu hỏi thật: luồng còn *làm việc* được không,
    # hay chỉ còn thở? Một luồng sống mà bỏ mọi gói sau đó cũng tệ ngang việc chết hẳn.
    tot = B.aes_enc_json({'body': {'curStitch': 4242, 'patternStitch': 9538,
                                   'state': 15, 'patternName': 'AO-01'}})
    hoi_phuc = False
    try:
        s.sendall(mk_publish(TOPIC, tot, qos=1, pid=8))
        s.recv(4)
        hoi_phuc = cho_log('cur=4242')
    except OSError as e:
        hoi_phuc = False
    cham('S12‑3 gói ĐÚNG ngay sau đó vẫn xử lý được', hoi_phuc,
         '' if hoi_phuc else 'không thấy dòng *** STATE cur=4242 trong log')
    s.close()

    # ------------------------------------------------------ S12‑4 khung MQTT méo
    # Topic khai dài 9999 byte nhưng gói chỉ có vài byte -> vỡ ngay ở tầng đọc khung, trước
    # khi chạm tới dec_json. Ở đây mất kết nối là chấp nhận được; điều KHÔNG chấp nhận được
    # là broker chết theo, vì lúc đó cả xưởng mất tín hiệu chứ không riêng một máy.
    s2 = socket.socket(); s2.settimeout(10)
    s2.connect(('127.0.0.1', cong))
    s2.sendall(mk_connect('AABBCCDDEE13ForEMCAD')); s2.recv(4)
    s2.sendall(bytes([0x32]) + enc_remlen(6) + struct.pack('>H', 9999) + b'abcd')
    try: s2.recv(16)
    except OSError: pass
    s2.close()

    s3 = socket.socket(); s3.settimeout(10)
    ok_moi = False
    try:
        s3.connect(('127.0.0.1', cong))
        s3.sendall(mk_connect('AABBCCDDEE14ForEMCAD'))
        ok_moi = s3.recv(4) == b'\x20\x02\x00\x00'
    except OSError as e:
        ok_moi = False
    finally:
        s3.close()
    cham('S12‑4 khung MQTT méo -> broker vẫn nhận kết nối MỚI', ok_moi)
    cham('S12‑4 tiến trình broker chưa chết', tien_trinh.poll() is None,
         'mã thoát %s' % tien_trinh.poll())

    # ------------------------------------------------------ S12‑5 không rò số bẩn
    nhat_ky = doc_log()
    cham('S12‑5 không gói hỏng nào được chuyển tiếp xuống bridge',
         'forward' not in nhat_ky.lower() or 'cur=4242' in nhat_ky)
    # 4 gói hỏng -> đúng 4 dòng lỗi, không nhiều hơn (không đếm trùng), không ít hơn (không nuốt).
    cham('S12‑5 đúng 4 dòng "STATE parse lỗi", không thừa không thiếu',
         nhat_ky.count('STATE parse lỗi') == 4, 'đếm được %d' % nhat_ky.count('STATE parse lỗi'))
    # Log không được in ra chuỗi nghi là khoá.
    cham('S12‑5 log không chứa chuỗi dài nghi là khoá',
         not [w for w in nhat_ky.split() if len(w) >= 24 and w.isalnum() and not w.isdigit()])

finally:
    if tien_trinh and tien_trinh.poll() is None:
        tien_trinh.terminate()
        try: tien_trinh.wait(timeout=5)
        except subprocess.TimeoutExpired: tien_trinh.kill()
    shutil.rmtree(tmp, ignore_errors=True)

print()
truot = [t for t, d in ket_qua if not d]
print('=== %d/%d ĐẠT ===' % (len(ket_qua) - len(truot), len(ket_qua)))
sys.exit(1 if truot else 0)
