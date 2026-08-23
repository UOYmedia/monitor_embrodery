#!/usr/bin/env python3
# Self-test OFFLINE cho [E2] build_frame — KHÔNG cần máy, KHÔNG cần mạng, KHÔNG cần người.
import importlib.util, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('broker', os.path.join(HERE, '..', 'broker.py'))
broker = importlib.util.module_from_spec(spec)
sys.argv = ['broker']
spec.loader.exec_module(broker)

BODY = {'patternName': 'AO-01', 'curStitch': 120, 'patternStitch': 9538}

# ---------- 1) Frame CŨ không đổi: máy không tự nói thì không có khoá `events` ----------
broker._prev.clear()
frame = broker.build_frame('devA', dict(BODY))
assert set(frame.keys()) == {'observedAt', 'status', 'job'}, frame.keys()
assert frame['job'] == {'fileName': 'AO-01', 'currentStitch': 120, 'totalStitches': 9538}, frame['job']
assert frame['status'] == 'unknown'          # lần đầu: chưa đủ cơ sở, đúng hành vi cũ
print('  [1] frame cũ giữ nguyên, không đẻ khoá thừa OK')

# ---------- 2) Máy tự nói -> đúng MỘT event, nguyên văn ----------
broker._prev.clear()
frame = broker.build_frame('devB', dict(BODY, stateID=3, wstrStatusDesc='  Thread break  '))
assert 'events' in frame and len(frame['events']) == 1, frame
ev = frame['events'][0]
assert ev['message'] == 'Thread break', ev            # nguyên văn, chỉ cắt khoảng trắng hai đầu
assert ev['code'] == '3' and ev['source'] == 'controller'
assert ev['occurredAt'] == frame['observedAt'], 'mốc sự kiện phải là mốc của chính frame'
# ba khoá cũ vẫn y nguyên khi có thêm event
assert frame['job']['currentStitch'] == 120 and frame['status'] in ('unknown', 'running', 'stopped')
print('  [2] lời máy đi nguyên văn qua events[] OK')

# ---------- 3) BẤT BIẾN: severity phải là 'info' ----------
# alerts.mjs bỏ qua đúng mức 'info'. Nâng mức = mỗi nhịp tim của máy thành một cảnh báo.
assert ev['severity'] == 'info', 'nâng mức ở đây là biến nhịp tim thành cảnh báo'
print('  [3] severity info — không tự phong nhịp tim thành lỗi OK')

# ---------- 4) Máy KHÔNG nói thì không nói hộ ----------
broker._prev.clear()
for thieu in ({}, {'wstrStatusDesc': ''}, {'wstrStatusDesc': '   '},
              {'stateID': 7}, {'wstrStatusDesc': 'Idle'}):   # cuối: có mô tả nhưng không số hiệu nào
    f = broker.build_frame('devC', dict(BODY, **thieu))
    assert 'events' not in f, (thieu, f)
print('  [4] thiếu mô tả hoặc thiếu số hiệu -> không bịa sự kiện OK')

# ---------- 5) Ngã về `state` khi không có `stateID` ----------
broker._prev.clear()
f = broker.build_frame('devD', dict(BODY, state=15, wstrStatusDesc='Idle'))
assert f['events'][0]['code'] == '15', f['events'][0]
print('  [5] không có stateID thì ngã về state OK')

# ---------- 6) Giới hạn của hợp đồng bridge (contract.mjs:224/:236/:239) ----------
broker._prev.clear()
f = broker.build_frame('devE', dict(BODY, stateID='X' * 100, wstrStatusDesc='Y' * 900))
ev = f['events'][0]
assert len(ev['code']) == 40 and len(ev['message']) == 400 and len(ev['id']) <= 80, (len(ev['code']), len(ev['message']), len(ev['id']))
print('  [6] cắt đúng trần code/message/id của hợp đồng OK')

# ---------- 7) id ỔN ĐỊNH theo trạng thái, không đẻ theo nhịp ----------
broker._prev.clear()
a = broker.build_frame('devF', dict(BODY, stateID=3, wstrStatusDesc='Thread break'))['events'][0]['id']
b = broker.build_frame('devF', dict(BODY, stateID=3, wstrStatusDesc='Thread break'))['events'][0]['id']
c = broker.build_frame('devF', dict(BODY, stateID=9, wstrStatusDesc='Oil'))['events'][0]['id']
assert a == b and a != c, (a, b, c)
print('  [7] id ổn định theo trạng thái, đổi khi trạng thái đổi OK')

print('== FRAME SELF-TEST PASS ==')
