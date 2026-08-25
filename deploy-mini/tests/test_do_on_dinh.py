#!/usr/bin/env python3
# Self-test OFFLINE cho do_on_dinh.py — KHÔNG cần máy, KHÔNG cần broker, KHÔNG cần người.
# Ca K‑18 trong PRD_TUYEN_A15_BAN_GIAO.md.
#
# Vì sao có bài này: do_on_dinh.py là công cụ DUY NHẤT trả lời câu "tuyến có ổn không".
# Nếu nó ném traceback trần khi thiếu file, người đọc sẽ tưởng tuyến hỏng chứ không phải
# công cụ hỏng. Và nếu nó đếm sai khoảng gián đoạn thì mọi con số uptime đều vô nghĩa.
import os, re, sys, json, tempfile, shutil, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
CONG_CU = os.path.join(HERE, '..', 'do_on_dinh.py')
CO_TS = 'ts,nTopics,nStates,nFields,newFieldsThisCycle'

def chay(gw, *cf):
    """Chạy do_on_dinh.py với DAHAO_GATEWAY trỏ vào thư mục giả. Trả (mã thoát, stdout+stderr)."""
    moi = dict(os.environ, DAHAO_GATEWAY=gw)
    r = subprocess.run([sys.executable, CONG_CU, *cf], env=moi,
                       capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr

def viet_csv(gw, moc):
    with open(os.path.join(gw, 'enum-growth.csv'), 'w') as f:
        f.write(CO_TS + '\n')
        for m in moc:
            f.write('%s,4,2,17,0\n' % m)

def nhip(bat_dau_gio, so_nhip, buoc=30):
    """Sinh mốc ISO cách nhau `buoc` giây, bắt đầu từ giờ tròn `bat_dau_gio`."""
    ra = []
    for i in range(so_nhip):
        t = i * buoc
        ra.append('2026-08-25T%02d:%02d:%02dZ' % (bat_dau_gio + t // 3600, (t // 60) % 60, t % 60))
    return ra

tmp = tempfile.mkdtemp(prefix='doondinh-')
try:
    # ---------- 1) Thiếu enum-growth.csv -> báo rõ, KHÔNG traceback ----------
    ma, ra = chay(tmp)
    assert ma == 1, 'mong đợi mã thoát 1, thấy %d' % ma
    assert 'Traceback' not in ra, 'ném traceback trần:\n' + ra
    assert 'Không thấy' in ra and 'enumerator' in ra, ra
    print('  [1] thiếu enum-growth.csv -> báo rõ, không traceback OK')

    # ---------- 2) Chỉ có tiêu đề / một dòng -> "chưa đủ dữ liệu" ----------
    viet_csv(tmp, [])
    ma, ra = chay(tmp)
    assert ma == 1 and 'CHƯA ĐỦ DỮ LIỆU' in ra, (ma, ra)
    viet_csv(tmp, ['2026-08-25T10:00:00Z'])
    ma, ra = chay(tmp)
    assert ma == 1 and 'CHƯA ĐỦ DỮ LIỆU' in ra, (ma, ra)
    assert 'Traceback' not in ra, ra
    print('  [2] 0 hoặc 1 mốc -> "chưa đủ dữ liệu", không chia cho 0 OK')

    # ---------- 3) Dòng mốc hỏng bị bỏ qua, không làm chết cả báo cáo ----------
    with open(os.path.join(tmp, 'enum-growth.csv'), 'w') as f:
        f.write(CO_TS + '\n')
        f.write('khong-phai-iso,4,2,17,0\n')
        f.write('2026-08-25T10:00:00Z,4,2,17,0\n')
        f.write(',4,2,17,0\n')
        f.write('2026-08-25T10:00:30Z,4,2,17,0\n')
    ma, ra = chay(tmp)
    assert ma == 0, (ma, ra)
    assert 'UPTIME   : 100.00 %' in ra, ra
    print('  [3] dòng mốc hỏng bị bỏ qua, phần còn lại vẫn tính được OK')

    # ---------- 4) Đếm ĐÚNG khoảng gián đoạn ----------
    # 10 nhịp liền (0..270s), nhảy 10 phút, rồi 10 nhịp nữa.
    moc = nhip(10, 10)
    moc += ['2026-08-25T10:14:30Z']          # cách mốc trước 600s = gián đoạn
    moc += ['2026-08-25T10:15:00Z', '2026-08-25T10:15:30Z']
    viet_csv(tmp, moc)
    ma, ra = chay(tmp)
    assert ma == 0, (ma, ra)
    assert '(1 lần)' in ra, 'phải thấy đúng 1 lần gián đoạn:\n' + ra
    assert 'mất   10.0 phút' in ra, 'thời lượng gián đoạn phải là 10,0 phút:\n' + ra
    # tổng 930s, sống 330s (11 khoảng 30s) -> 35,48 %
    assert 'UPTIME   : 35.48 %' in ra, ra
    print('  [4] tìm đúng 1 lần gián đoạn 10,0 phút, uptime 35,48 % OK')

    # ---------- 5) Ngưỡng 90 giây: 90s KHÔNG phải gián đoạn, 91s thì phải ----------
    viet_csv(tmp, ['2026-08-25T10:00:00Z', '2026-08-25T10:01:30Z'])   # đúng 90s
    ma, ra = chay(tmp)
    assert '(0 lần)' in ra, 'đúng 90s không được tính là gián đoạn:\n' + ra
    viet_csv(tmp, ['2026-08-25T10:00:00Z', '2026-08-25T10:01:31Z'])   # 91s
    ma, ra = chay(tmp)
    assert '(1 lần)' in ra, '91s phải tính là gián đoạn:\n' + ra
    print('  [5] ngưỡng 90 giây chốt đúng ở cả hai phía OK')

    # ---------- 6) --tu lọc đúng, và mốc sai định dạng thì từ chối tử tế ----------
    viet_csv(tmp, nhip(10, 6) + ['2026-08-25T11:00:00Z', '2026-08-25T11:00:30Z'])
    ma, ra = chay(tmp, '--tu', '2026-08-25T11:00:00Z')
    assert ma == 0, (ma, ra)
    assert 'cửa sổ chỉ định' in ra and '(0 lần)' in ra, ra
    assert '11:00:00' in ra and '11:00:30' in ra, ra
    ma, ra = chay(tmp, '--tu', 'hom-qua')
    assert ma == 2 and 'Traceback' not in ra, (ma, ra)
    ma, ra = chay(tmp, '--tu')            # thiếu hẳn tham số
    assert ma == 2 and 'Traceback' not in ra, (ma, ra)
    print('  [6] --tu lọc đúng cửa sổ; mốc sai/thiếu -> từ chối, không traceback OK')

    # ---------- 7) catalog.json thiếu hoặc hỏng -> vẫn ra uptime ----------
    viet_csv(tmp, nhip(10, 4))
    ma, ra = chay(tmp)                     # chưa có catalog.json
    assert ma == 0 and 'UPTIME' in ra and 'Traceback' not in ra, (ma, ra)
    with open(os.path.join(tmp, 'catalog.json'), 'w') as f:
        f.write('{ khong phai json')
    ma, ra = chay(tmp)
    assert ma == 0, (ma, ra)
    assert 'Không đọc được catalog.json' in ra, ra
    assert 'UPTIME' in ra, 'mất catalog không được làm mất luôn phần uptime:\n' + ra
    print('  [7] catalog thiếu/hỏng -> vẫn ra uptime, chỉ bỏ phần thống kê máy OK')

    # ---------- 8) catalog lành -> đọc được số phiên và nhịp state ----------
    with open(os.path.join(tmp, 'catalog.json'), 'w') as f:
        json.dump({
            'sessions': [{'startedAt': '2026-08-25T09:00:00Z', 'pid': 111},
                         {'startedAt': '2026-08-25T10:00:00Z', 'pid': 222}],
            'topics': {
                'emCAD/client/v1/auth/login/AABBCCDDEEFF': {'count': 7},
                'emCAD/client/v1/state/AABBCCDDEEFF': {
                    'count': 90, 'firstSeen': '2026-08-25T10:00:00Z',
                    'lastSeen': '2026-08-25T10:01:30Z'},
            },
        }, f)
    ma, ra = chay(tmp)
    assert ma == 0, (ma, ra)
    assert 'Broker khởi động lại: 2 lần' in ra, ra
    assert 'pid=222' in ra, ra
    assert 'Số lần auth/login    : 7' in ra, ra
    assert 'Bản tin state        : 90' in ra, ra
    assert 'Nhịp state trung bình: 1.00 giây/bản' in ra, 'dải 90s / 90 bản = 1,00 s:\n' + ra
    print('  [8] catalog lành -> đếm phiên, đếm login, tính nhịp state đúng OK')

    # ---------- 8b) Nhịp state phải chia cho DẢI CỦA CATALOG, không phải cửa sổ --tu ----------
    # Bẫy thật đã sập ngày 25/08/2026: cửa sổ --tu 10 phút, catalog đếm bản tin của 4 ngày,
    # chia lẫn vào nhau ra "0,01 giây/bản". Con số đó vô nghĩa mà nhìn vẫn rất thuyết phục.
    with open(os.path.join(tmp, 'catalog.json'), 'w') as f:
        json.dump({
            'sessions': [{'startedAt': '2026-08-21T00:00:00Z', 'pid': 1}],
            'topics': {
                'emCAD/client/v1/state/AABBCCDDEEFF': {
                    'count': 100000, 'firstSeen': '2026-08-21T00:00:00Z',
                    'lastSeen': '2026-08-25T00:00:00Z'},          # dải 4 ngày = 345.600 giây
            },
        }, f)
    viet_csv(tmp, ['2026-08-25T10:00:00Z', '2026-08-25T10:00:30Z',
                   '2026-08-25T10:01:00Z', '2026-08-25T10:01:30Z'])   # cửa sổ CSV chỉ 90 giây
    ma, ra = chay(tmp, '--tu', '2026-08-25T10:00:00Z')
    assert ma == 0, (ma, ra)
    assert 'Nhịp state trung bình: 3.46 giây/bản' in ra, \
        'phải là 345600/100000 = 3,46 s/bản, không phải 90/100000:\n' + ra
    assert 'TOÀN BỘ lịch sử' in ra, 'phải nói rõ số catalog không bị --tu lọc:\n' + ra
    assert 'không theo --tu' in ra, 'phần đếm phiên cũng phải nói rõ điều đó:\n' + ra
    print('  [8b] nhịp state chia theo dải catalog chứ không theo cửa sổ --tu OK')

    # ---------- 8c) Thiếu firstSeen/lastSeen -> nói thẳng là không tính được ----------
    with open(os.path.join(tmp, 'catalog.json'), 'w') as f:
        json.dump({'sessions': [], 'topics': {
            'emCAD/client/v1/state/AABBCCDDEEFF': {'count': 100000}}}, f)
    ma, ra = chay(tmp)
    assert ma == 0 and 'không tính được' in ra and 'Traceback' not in ra, (ma, ra)
    print('  [8c] thiếu firstSeen/lastSeen -> nói "không tính được", không bịa số OK')

    # ---------- 9) Không rò bí mật ra báo cáo ----------
    assert 'redacted' not in ra.lower() or '<redacted' in ra, ra
    assert not re.search(r"['\"][A-Za-z]{16}['\"]", ra), 'báo cáo có chuỗi nghi là khoá'
    print('  [9] báo cáo không chứa chuỗi nghi là khoá OK')

    print('TẤT CẢ ĐẠT — do_on_dinh.py (ca K‑18)')
finally:
    shutil.rmtree(tmp, ignore_errors=True)
