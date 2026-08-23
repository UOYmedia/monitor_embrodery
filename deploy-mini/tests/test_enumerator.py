#!/usr/bin/env python3
# Self-test OFFLINE cho ENUMERATOR (Phase A) — KHÔNG cần máy, KHÔNG cần người, KHÔNG cần mạng.
# Import broker.py như module (guard __main__ => KHÔNG khởi động server) rồi drive catalog trực tiếp.
import importlib.util, os, sys, json, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('broker', os.path.join(HERE, '..', 'broker.py'))
broker = importlib.util.module_from_spec(spec)
sys.argv = ['broker']                 # phòng trường hợp đọc argv
spec.loader.exec_module(broker)       # nếu import khởi động server thì test treo -> chứng minh import-safe

_real_mtime = (os.path.getmtime(os.path.join(HERE, '..', 'catalog.json'))
               if os.path.exists(os.path.join(HERE, '..', 'catalog.json')) else None)

# Chuyển hướng MỌI đường ghi sang tempdir NGAY, trước mọi catalog_dump():
# đường mặc định là catalog.json/enum.log của chính deploy-mini, và từ khi có [A2]
# catalog.json là file LOAD-BEARING (broker nạp lại lúc start) -> test không được đụng vào.
broker.CATALOG  = os.path.join(tempfile.gettempdir(), 'catalog.enumtest.json')
broker.ENUM_LOG = os.path.join(tempfile.gettempdir(), 'enum.enumtest.log')
broker.GROWTH   = os.path.join(tempfile.gettempdir(), 'growth.enumtest.csv')
for _f in (broker.CATALOG, broker.ENUM_LOG, broker.GROWTH):
    if os.path.exists(_f): os.remove(_f)

def reset():
    broker._enum.clear()
    broker._enum.update({'startedAt': None, 'topics': {}, 'fields': {}, 'states': {}, 'connect': {}})
    broker._growth_prev['fields'] = 0

# ---------- 1) Union field qua nhiều TRẠNG THÁI + min/max + state-coverage ----------
reset()
idle    = {'header': {'companyId': 1, 'userId': 2},
           'body': {'state': 15, 'wstrStatusDesc': 'idle',    'curStitch': 0,    'patternStitch': 0,    'machineName': 'A15'}}
running = {'header': {'companyId': 1, 'userId': 2},
           'body': {'state': 1,  'wstrStatusDesc': 'running', 'curStitch': 1200, 'patternStitch': 9538, 'Speed': 720, 'needleNo': 6}}
brk     = {'header': {'companyId': 1, 'userId': 2},
           'body': {'state': 3,  'wstrStatusDesc': 'break',   'curStitch': 1200, 'threadBreakNeedle': 9, 'errCode': 'E12'}}
TOPIC = 'emCAD/client/v1/state/602602704E7B'
for msg in (idle, running, brk):
    p = broker.aes_enc_json(msg).encode()
    broker.catalog_observe('in', TOPIC, broker.dec_json(p), len(p))

snap = broker.catalog_dump()
f = snap['fields']
assert 'body.needleNo' in f, 'field chỉ có ở running phải được bắt'
assert 'body.threadBreakNeedle' in f and 'body.errCode' in f, 'field chỉ có ở break phải được bắt'
assert set(snap['states'].keys()) == {'wstrStatusDesc=idle', 'wstrStatusDesc=running', 'wstrStatusDesc=break'}, snap['states'].keys()
assert f['body.curStitch']['numMin'] == 0 and f['body.curStitch']['numMax'] == 1200, f['body.curStitch']
assert set(f['body.curStitch']['states']) >= {'wstrStatusDesc=idle', 'wstrStatusDesc=running', 'wstrStatusDesc=break'}
# state-coverage: mỗi state giữ đúng union key của riêng nó
assert 'body.needleNo' in snap['states']['wstrStatusDesc=running']['keys']
assert 'body.errCode' in snap['states']['wstrStatusDesc=break']['keys']
assert 'body.needleNo' not in snap['states']['wstrStatusDesc=idle']['keys']
print('  [1] union field + min/max + state-coverage OK')

# ---------- 2) Payload KHÔNG giải mã được vẫn đếm, đánh dấu non-decodable, không crash ----------
broker.catalog_observe('in', 'emCAD/client/v1/weird', None, 42)
w = broker._enum['topics']['emCAD/client/v1/weird']
assert w['decodable'] is False and w['count'] == 1, w
print('  [2] non-decodable đếm + đánh dấu OK')

# ---------- 3) Bất biến an toàn: field tên giống bí mật CHỈ ghi TÊN, không ghi giá trị/min-max ----------
reset()
auth = {'header': {'mesgNo': '1'},
        'body': {'secret': [123456789, 123456789], 'encode': [42, 43, 44, 45], 'machineName': 'A15'}}
p = broker.aes_enc_json(auth).encode()
broker.catalog_observe('in', 'emCAD/client/v1/auth/login/602602704E7B', broker.dec_json(p), len(p))
snap = broker.catalog_dump()
for sk in ('body.secret[]', 'body.encode[]'):
    assert sk in snap['fields'], sk
    fe = snap['fields'][sk]
    assert fe.get('redacted') is True and fe['example'] == '<redacted:name-only>', fe
    assert fe['numMin'] is None and fe['numMax'] is None, fe
assert snap['fields']['body.machineName']['example'] == 'A15'   # field thường vẫn ghi bình thường
print('  [3] redaction field bí mật OK')

# ---------- 4) report ghi được CẢ HAI artifact, không lỗi, catalog.json hợp lệ ----------
broker.catalog_report()
assert os.path.exists(broker.CATALOG) and os.path.exists(broker.ENUM_LOG)
json.load(open(broker.CATALOG))   # phải là JSON hợp lệ
print('  [4] catalog.json + enum.log ghi OK')

# ---------- 5) [A1] firstSeen có mặt trên field VÀ state, dạng ISO ----------
reset()
p = broker.aes_enc_json(running).encode()
broker.catalog_observe('in', TOPIC, broker.dec_json(p), len(p))
snap = broker.catalog_dump()
fs_field = snap['fields']['body.needleNo']['firstSeen']
fs_state = snap['states']['wstrStatusDesc=running']['firstSeen']
for fs in (fs_field, fs_state):
    assert isinstance(fs, str) and fs.endswith('Z') and fs[4] == '-' and 'T' in fs, fs
# firstSeen KHÔNG được dịch chuyển khi field xuất hiện lại
broker.catalog_observe('in', TOPIC, broker.dec_json(p), len(p))
snap = broker.catalog_dump()
assert snap['fields']['body.needleNo']['firstSeen'] == fs_field
assert snap['fields']['body.needleNo']['count'] == 2
print('  [5] firstSeen field+state, không dịch chuyển OK')

# ---------- 6) [A2] restart hợp nhất: nạp lại catalog cũ, KHÔNG mất độ phủ ----------
for f_ in (broker.CATALOG, broker.GROWTH):
    if os.path.exists(f_): os.remove(f_)
reset()
for msg in (idle, running, brk):
    p = broker.aes_enc_json(msg).encode()
    broker.catalog_observe('in', TOPIC, broker.dec_json(p), len(p))
before = broker.catalog_dump()
n_fields_before, started_before = len(before['fields']), before['startedAt']

reset()                                    # <- mô phỏng broker restart: RAM về rỗng
assert broker._enum['fields'] == {}
assert broker.catalog_load() is True
after = broker._enum
assert len(after['fields']) == n_fields_before, (len(after['fields']), n_fields_before)
assert set(after['states']) == set(before['states'])
assert after['startedAt'] == started_before, 'startedAt phải giữ mốc lần chạy đầu tiên'
assert len(after['sessions']) == 1 and 'pid' in after['sessions'][0]
assert broker._growth_prev['fields'] == n_fields_before, 'restart không được tính là khám phá mới'
# quan sát tiếp sau restart thì cộng dồn, không ghi đè
broker.catalog_observe('in', TOPIC, broker.dec_json(broker.aes_enc_json(
    {'header': {'companyId': 1}, 'body': {'state': 7, 'wstrStatusDesc': 'oil', 'oilAlarm': 1}}).encode()), 99)
snap = broker.catalog_dump()
assert 'body.oilAlarm' in snap['fields'] and 'body.needleNo' in snap['fields'], 'phải có CẢ cũ lẫn mới'
assert len(snap['sessions']) == 1
broker.catalog_dump()
assert len(json.load(open(broker.CATALOG))['sessions']) == 1
print('  [6] restart hợp nhất, giữ startedAt + sessions OK')

# ---------- 7) [A2] catalog ghi TRƯỚC A1 (không có firstSeen) -> chuẩn hoá None, không crash ----------
legacy = {'startedAt': '2026-08-21T00:00:00Z', 'connect': {},
          'topics': {'t1': {'dir': 'in', 'count': 1, 'firstSeen': '2026-08-21T00:00:00Z',
                            'lastSeen': None, 'decodable': True, 'minLen': 1, 'maxLen': 1}},
          'fields': {'body.old': {'types': ['int'], 'example': 1, 'count': 1,
                                  'states': [], 'topics': ['t1'], 'numMin': 1, 'numMax': 1}},
          'states': {'state=15': {'count': 1, 'keys': ['body.old']}}}
json.dump(legacy, open(broker.CATALOG, 'w'))
reset()
assert broker.catalog_load() is True
assert broker._enum['fields']['body.old']['firstSeen'] is None, 'không biết thì phải là None, không bịa'
assert broker._enum['states']['state=15']['firstSeen'] is None
assert broker._enum['startedAt'] == '2026-08-21T00:00:00Z'
print('  [7] catalog legacy thiếu firstSeen -> None, không crash OK')

# ---------- 8) [A2] catalog hỏng -> giữ lại .bad, bắt đầu lại từ rỗng, KHÔNG crash ----------
open(broker.CATALOG, 'w').write('{ day khong phai json')
bad = broker.CATALOG + '.bad'
if os.path.exists(bad): os.remove(bad)
reset()
assert broker.catalog_load() is False
assert os.path.exists(bad), 'file hỏng phải được giữ lại làm bằng chứng'
assert broker._enum['fields'] == {}
os.remove(bad)
if os.path.exists(broker.CATALOG): os.remove(broker.CATALOG)
print('  [8] catalog hỏng -> .bad + start rỗng OK')

# ---------- 9) [A3] enum-growth.csv: chỉ-ghi-thêm, header một lần, đếm đúng ----------
if os.path.exists(broker.GROWTH): os.remove(broker.GROWTH)
reset()
for msg in (idle, running):
    p = broker.aes_enc_json(msg).encode()
    broker.catalog_observe('in', TOPIC, broker.dec_json(p), len(p))
broker.catalog_report()                              # chu kỳ 1: tất cả field đều mới
broker.catalog_report()                              # chu kỳ 2: không quan sát gì thêm -> 0 mới
broker.catalog_observe('in', TOPIC, broker.dec_json(broker.aes_enc_json(brk).encode()), 77)
broker.catalog_report()                              # chu kỳ 3: field của state break lộ ra
rows = [l for l in open(broker.GROWTH).read().strip().split('\n')]
assert rows[0] == broker.GROWTH_HEADER, rows[0]
assert len([r for r in rows if r == broker.GROWTH_HEADER]) == 1, 'header chỉ được ghi MỘT lần'
assert len(rows) == 4, rows                          # 1 header + 3 chu kỳ
c1, c2, c3 = [r.split(',') for r in rows[1:]]
n1, n3 = int(c1[3]), int(c3[3])
assert int(c1[4]) == n1 and n1 > 0, c1              # chu kỳ đầu: mọi field đều mới
assert int(c2[4]) == 0 and c2[3] == c1[3], c2       # đứng yên -> 0 mới, tổng không đổi
assert int(c3[4]) == n3 - n1 > 0, c3                # break lộ thêm field -> đếm đúng phần chênh
assert int(c3[2]) == 3, 'phải thấy 3 state'
# CSV chỉ chứa SỐ và mốc giờ: không tên field, không giá trị, không bí mật
txt = open(broker.GROWTH).read()
for leak in ('secret', 'encode', 'needleNo', 'errCode', 'A15', 'body.'):
    assert leak not in txt, 'enum-growth.csv rò rỉ %r' % leak
print('  [9] growth CSV chỉ-ghi-thêm + đếm đúng + không rò rỉ OK')

# ---------- 10) Bất biến của chính bộ test: không ghi vào artifact thật của deploy-mini ----------
REAL = os.path.join(HERE, '..', 'catalog.json')
assert os.path.abspath(broker.CATALOG) != os.path.abspath(REAL)
assert _real_mtime == (os.path.getmtime(REAL) if os.path.exists(REAL) else None), \
    'bộ test đã ghi đè catalog.json thật — đường ghi bị rò về mặc định'
print('  [10] test không đụng catalog.json thật OK')

print('== ENUM SELF-TEST PASS ==')
