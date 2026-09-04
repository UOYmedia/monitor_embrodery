#!/usr/bin/env python3
# Self-test OFFLINE cho bảng tên máy (dev -> machineId) + luật chọn máy của do_ctrl.
# KHÔNG cần máy, KHÔNG cần mạng, KHÔNG cần người.
#
# Vì sao có file này: broker đẩy telemetry của MỌI máy qua chung một socket. Nếu khung không
# tự khai tên máy thì bridge chỉ còn địa chỉ nguồn để đoán, và hai máy sẽ rơi vào một bản
# ghi — số mũi trộn nhau mà không một dòng lỗi. Hai bất biến phải giữ:
#   (a) bảng RỖNG thì frame giữ nguyên từng byte như bản cũ (nâng broker không đổi gì);
#   (b) có hai máy nối mà lệnh đẩy file không ghi @<dev> thì TỪ CHỐI, không đoán.
import importlib.util, json, os, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
TAM = tempfile.mkdtemp(prefix='ban-ten-may-')
os.environ['DEV_MAP_PATH'] = os.path.join(TAM, 'may.json')

spec = importlib.util.spec_from_file_location('broker', os.path.join(HERE, '..', 'broker.py'))
broker = importlib.util.module_from_spec(spec)
sys.argv = ['broker']
spec.loader.exec_module(broker)

MAP = os.environ['DEV_MAP_PATH']
BODY = {'patternName': 'AO-01', 'curStitch': 120, 'patternStitch': 9538}
dat = 0

def ok(nhan):
    global dat; dat += 1; print('  ĐẠT   %s' % nhan)

def ghi(bang):
    open(MAP, 'w').write(json.dumps(bang))
    # dev_map() chỉ soi lại file mỗi 5 giây; test không được ngồi chờ.
    broker._devmap['at'] = 0.0

# ---------- 1) Bảng chưa có -> frame giữ nguyên từng byte như bản cũ ----------
broker._prev.clear()
frame = broker.build_frame('602602704E7B', dict(BODY))
assert set(frame.keys()) == {'observedAt', 'status', 'job'}, frame.keys()
ok('[1] chưa có bảng thì KHÔNG thêm machineId — hành vi cũ nguyên vẹn')

# ---------- 2) Có bảng -> frame tự khai đúng tên ----------
ghi({'602602704E7B': 'mch-a15-mqtt'})
broker._prev.clear()
frame = broker.build_frame('602602704E7B', dict(BODY))
assert frame['machineId'] == 'mch-a15-mqtt', frame
assert frame['job'] == {'fileName': 'AO-01', 'currentStitch': 120, 'totalStitches': 9538}, frame['job']
ok('[2] có bảng thì khai đúng machineId, ba khoá cũ không suy suyển')

# ---------- 3) Không phân biệt hoa thường: dev trên dây có thể về kiểu nào ----------
assert broker.machine_id_of('602602704e7b') == 'mch-a15-mqtt'
ok('[3] tra bảng không phân biệt hoa thường')

# ---------- 4) dev lạ -> không khai bừa ----------
broker._prev.clear()
frame = broker.build_frame('DEV-LA', dict(BODY))
assert 'machineId' not in frame, frame
ok('[4] dev chưa có trong bảng thì thà không khai còn hơn khai bừa')

# ---------- 5) Nạp lại NÓNG: thêm máy không phải khởi động lại broker ----------
ghi({'602602704E7B': 'mch-a15-mqtt', 'AAA': 'mch-hai'})
assert broker.machine_id_of('AAA') == 'mch-hai'
ok('[5] thêm máy vào bảng có hiệu lực ngay, không cần khởi động lại')

# ---------- 6) File hỏng -> GIỮ bảng cũ, không rơi về rỗng ----------
open(MAP, 'w').write('{ hong')
broker._devmap['at'] = 0.0
assert broker.machine_id_of('602602704E7B') == 'mch-a15-mqtt', 'rơi về rỗng = lặng lẽ quay lại lỗi trộn máy'
ok('[6] bảng hỏng thì giữ bảng đang dùng, không lặng lẽ trở lại trộn máy')

# ---------- 7) File biến mất -> vẫn giữ bảng cũ ----------
os.remove(MAP); broker._devmap['at'] = 0.0
assert broker.machine_id_of('602602704E7B') == 'mch-a15-mqtt'
ok('[7] bảng biến mất thì giữ bảng đang dùng')

# ---------- 8) Giá trị sai kiểu -> từ chối cả bảng, giữ bảng cũ ----------
ghi({'602602704E7B': 123})
assert broker.machine_id_of('602602704E7B') == 'mch-a15-mqtt'
ok('[8] machineId không phải chuỗi thì từ chối cả bảng')

# ---------- do_ctrl: chọn máy ----------
class MayGia:
    def __init__(self, dev): self.c = (None, None, {'dev': dev})

def noi(*devs):
    broker.clients[:] = [MayGia(d).c for d in devs]

# 9) Một máy, không ghi @dev -> giữ nguyên cách gõ cũ
noi('DEV1')
assert broker._pick_dev(['12345']) == ('DEV1', ['12345'])
ok('[9] đúng một máy nối thì lệnh cũ vẫn chạy y như trước')

# 10) HAI máy, không ghi @dev -> TỪ CHỐI. Đây là bất biến quan trọng nhất file này.
noi('DEV1', 'DEV2')
dev, _ = broker._pick_dev(['12345'])
assert dev is None, 'đoán máy ở đây = thêu nhầm mẫu lên nhầm máy, không ai biết'
ok('[10] hai máy mà lệnh không ghi @<dev> thì TỪ CHỐI, không đoán')

# 11) HAI máy, có ghi @dev -> chọn đúng máy, và cắt @dev khỏi tham số
assert broker._pick_dev(['@DEV2', '12345']) == ('DEV2', ['12345'])
assert broker._pick_dev(['@dev2', '12345']) == ('DEV2', ['12345'])
ok('[11] ghi @<dev> thì chọn đúng máy, không phân biệt hoa thường')

# 12) @dev trỏ máy không nối -> từ chối, không rơi về máy khác
assert broker._pick_dev(['@DEV9', '12345'])[0] is None
ok('[12] @<dev> trỏ máy không nối thì từ chối, không rơi về máy khác')

# 13) Chưa máy nào nối -> từ chối
noi()
assert broker._pick_dev(['12345'])[0] is None
ok('[13] chưa có máy nào nối thì bỏ qua lệnh')

print('\n=== %d/%d ĐẠT ===' % (dat, dat))
