#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Chuyển cả tuyến Dahao từ LaunchAgent sang LaunchDaemon — để nó sống dậy từ lúc MÁY BẬT.

Vì sao
------
Mọi job `com.dahao.*` đang nằm ở `~/Library/LaunchAgents/`. LaunchAgent chỉ được nạp khi
có người ĐĂNG NHẬP vào màn hình. Máy tự đăng nhập thì đang tắt, nên:

  Thứ Sáu 28/08: máy khởi động lúc 08:56 (giờ VN), nhưng không ai ngồi vào đăng nhập mãi
  tới 16:40. Suốt 7 giờ 44 phút ấy broker không nghe cổng nào, bridge không chạy, không
  một dòng số liệu nào được ghi. Không lỗi, không cảnh báo — nhật ký chỉ đơn giản là trống,
  và một khoảng trống trông y hệt một ngày xưởng nghỉ.

LaunchDaemon nạp từ `/Library/LaunchDaemons/` ngay khi máy bật, trước và độc lập với mọi
phiên đăng nhập. Đó là đúng chỗ của một cái cổng công nghiệp chạy 24/7.

Cách dùng (trên Mini)
---------------------
    sudo /usr/bin/python3 -B chay-tu-luc-khoi-dong.py            # chạy khan, chỉ xem
    sudo /usr/bin/python3 -B chay-tu-luc-khoi-dong.py --that     # làm thật
    sudo /usr/bin/python3 -B chay-tu-luc-khoi-dong.py --lui      # trả lại như cũ
             /usr/bin/python3 -B chay-tu-luc-khoi-dong.py --kiem # xem đang ở đâu (không cần sudo)

Ba chỗ dễ hỏng, đã xử lý sẵn
----------------------------
1. **Chạy dưới quyền ai.** Daemon mặc định chạy dưới `root`. Để nguyên là hỏng: broker ghi
   vào `~phong/dahao-gateway`, và file do root tạo thì sau này người dùng sửa không được.
   Nên mọi job đều đặt `UserName`/`GroupName` về đúng chủ cũ.
2. **Thiếu biến môi trường.** Daemon KHÔNG có `HOME`, và `PATH` chỉ có bốn thư mục hệ
   thống — không có `/opt/homebrew/bin`. `cloudflared` tìm chứng thư theo `$HOME`; Grafana,
   Loki, Alloy đều nằm trong Homebrew. Nên phải khai tay cả hai.
3. **Nạp hai lần.** Nếu để nguyên plist cũ trong `~/Library/LaunchAgents/`, thì lần sau có
   người đăng nhập là launchd nạp thêm một bản NỮA — hai broker giành cổng 3865, hai bridge
   giành cổng 1600. Nên plist cũ phải được DỜI ĐI, không phải chỉ gỡ nạp.

Script viết theo lối làm-lại-được: chạy mấy lần cũng ra một kết quả.
"""
import glob
import os
import plistlib
import pwd
import shutil
import subprocess
import sys
import time

DAEMON_DIR = '/Library/LaunchDaemons'
NGUOI_MAC_DINH = 'phong'

THEM_MOI_TRUONG = {
    'PATH': '/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin',
    'PYTHONIOENCODING': 'utf-8',
}


def chu_nhan():
    """Ai là chủ của tuyến. Lấy từ `SUDO_USER` để không đóng đinh tên người vào mã."""
    ten = os.environ.get('SUDO_USER') or NGUOI_MAC_DINH
    if ten == 'root':
        ten = NGUOI_MAC_DINH
    return pwd.getpwnam(ten)


def chay(lenh, bo_qua_loi=False):
    ra = subprocess.run(lenh, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    van = ra.stdout.decode('utf-8', 'replace').strip()
    if ra.returncode and not bo_qua_loi:
        print('    ! %s -> %s %s' % (' '.join(lenh), ra.returncode, van))
    return ra.returncode, van


def nhan(label, domain):
    """Job này có đang nạp trong domain ấy không."""
    ra = subprocess.run(['/bin/launchctl', 'print', '%s/%s' % (domain, label)],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return ra.returncode == 0


def doc_plist(duong):
    with open(duong, 'rb') as f:
        return plistlib.load(f)


def lam_ban_daemon(ban, nd):
    """Bản LaunchAgent -> bản LaunchDaemon. Giữ nguyên mọi thứ, chỉ THÊM."""
    d = dict(ban)
    d['UserName'] = nd.pw_name
    d['GroupName'] = 'staff'
    mt = dict(d.get('EnvironmentVariables') or {})
    for k, v in THEM_MOI_TRUONG.items():
        mt.setdefault(k, v)
    mt.setdefault('HOME', nd.pw_dir)
    d['EnvironmentVariables'] = mt
    return d


def kiem(nd):
    """In ra đang ở đâu — không sửa gì, không cần quyền root."""
    agent_dir = os.path.join(nd.pw_dir, 'Library', 'LaunchAgents')
    ag = sorted(glob.glob(os.path.join(agent_dir, 'com.dahao.*.plist')))
    dm = sorted(glob.glob(os.path.join(DAEMON_DIR, 'com.dahao.*.plist')))
    print('Chủ tuyến: %s (uid %d, nhà %s)' % (nd.pw_name, nd.pw_uid, nd.pw_dir))
    print('LaunchAgent  (cần đăng nhập): %d tệp' % len(ag))
    print('LaunchDaemon (chạy từ lúc bật máy): %d tệp' % len(dm))
    nhan_all = sorted({os.path.basename(p)[:-6] for p in ag + dm})
    print('')
    print('%-24s %-10s %-10s %s' % ('job', 'agent', 'daemon', 'đang chạy ở'))
    for lb in nhan_all:
        co_ag = os.path.exists(os.path.join(agent_dir, lb + '.plist'))
        co_dm = os.path.exists(os.path.join(DAEMON_DIR, lb + '.plist'))
        o = []
        if nhan(lb, 'gui/%d' % nd.pw_uid):
            o.append('gui')
        if nhan(lb, 'system'):
            o.append('system')
        print('%-24s %-10s %-10s %s' % (lb, 'có' if co_ag else '-',
                                        'có' if co_dm else '-', '+'.join(o) or 'KHÔNG CHẠY'))
    print('')
    if dm and not ag:
        print('=> Đã ở chế độ DAEMON: mất điện bật lại là tự dậy, không cần ai đăng nhập.')
    elif ag and not dm:
        print('=> Đang ở chế độ AGENT: máy khởi động lại mà không ai đăng nhập là MÙ HOÀN TOÀN.')
    else:
        print('=> ĐANG LƯNG CHỪNG — có cả hai. Coi chừng chạy hai bản giành cổng.')


def vao(nd, that):
    agent_dir = os.path.join(nd.pw_dir, 'Library', 'LaunchAgents')
    kho = os.path.join(nd.pw_dir, 'dahao-gateway', 'launchd-agent-cu')
    ag = sorted(glob.glob(os.path.join(agent_dir, 'com.dahao.*.plist')))
    if not ag:
        print('Không còn LaunchAgent nào — có lẽ đã chuyển rồi. Chạy --kiem để xem.')
        return 0
    print('Sẽ chuyển %d job sang LaunchDaemon:' % len(ag))
    if that and not os.path.isdir(kho):
        os.makedirs(kho)
        os.chown(kho, nd.pw_uid, nd.pw_gid)

    for p in ag:
        lb = os.path.basename(p)[:-6]
        print('  %s' % lb)
        ban = lam_ban_daemon(doc_plist(p), nd)
        dich = os.path.join(DAEMON_DIR, lb + '.plist')
        if not that:
            print('      -> %s (UserName=%s, HOME=%s)'
                  % (dich, ban['UserName'], ban['EnvironmentVariables']['HOME']))
            print('      -> dời %s vào %s/' % (os.path.basename(p), kho))
            continue

        # 1. Gỡ bản đang chạy ở phiên đăng nhập. Không gỡ là lát nữa hai bản cùng chạy.
        chay(['/bin/launchctl', 'bootout', 'gui/%d/%s' % (nd.pw_uid, lb)], bo_qua_loi=True)
        # 2. Gỡ bản daemon cũ nếu chạy lại script lần hai.
        chay(['/bin/launchctl', 'bootout', 'system/%s' % lb], bo_qua_loi=True)
        # 3. Ghi plist daemon. launchd TỪ CHỐI nạp nếu tệp không thuộc root hoặc ai cũng ghi được.
        with open(dich, 'wb') as f:
            plistlib.dump(ban, f)
        os.chown(dich, 0, 0)
        os.chmod(dich, 0o644)
        # 4. Dời plist agent đi — đây là bước chặn "nạp hai lần" lúc có người đăng nhập.
        shutil.move(p, os.path.join(kho, os.path.basename(p)))
        # 5. Nạp vào domain hệ thống.
        ma, van = chay(['/bin/launchctl', 'bootstrap', 'system', dich])
        print('      %s' % ('đã nạp' if ma == 0 else 'NẠP HỎNG: ' + van))

    if not that:
        print('')
        print('(chạy khan — thêm --that để làm thật)')
        return 0

    print('')
    print('Chờ 5 giây cho các job dựng lại rồi kiểm...')
    time.sleep(5)
    kiem(nd)
    return 0


def lui(nd, that):
    """Trả về LaunchAgent. Có đường lui thì mới dám đi đường tới."""
    kho = os.path.join(nd.pw_dir, 'dahao-gateway', 'launchd-agent-cu')
    agent_dir = os.path.join(nd.pw_dir, 'Library', 'LaunchAgents')
    cu = sorted(glob.glob(os.path.join(kho, 'com.dahao.*.plist')))
    if not cu:
        print('Không có bản lưu nào ở %s — không lui được.' % kho)
        return 1
    print('Sẽ trả %d job về LaunchAgent:' % len(cu))
    for p in cu:
        lb = os.path.basename(p)[:-6]
        print('  %s' % lb)
        if not that:
            continue
        chay(['/bin/launchctl', 'bootout', 'system/%s' % lb], bo_qua_loi=True)
        dm = os.path.join(DAEMON_DIR, lb + '.plist')
        if os.path.exists(dm):
            os.remove(dm)
        dich = os.path.join(agent_dir, os.path.basename(p))
        shutil.move(p, dich)
        os.chown(dich, nd.pw_uid, nd.pw_gid)
        chay(['/bin/launchctl', 'bootstrap', 'gui/%d' % nd.pw_uid, dich], bo_qua_loi=True)
    if not that:
        print('\n(chạy khan — thêm --that để làm thật)')
        return 0
    time.sleep(3)
    kiem(nd)
    return 0


def soan(nd):
    """Soạn ĐÚNG những plist sẽ được cài, nhưng ra thư mục tạm — không cần quyền root.

    Có bước này thì mới kiểm được nội dung thật bằng `plutil -lint` TRƯỚC khi đụng vào
    `/Library/LaunchDaemons`. Xem bản in ra rồi tin là khác với xem tệp thật rồi tin.
    """
    agent_dir = os.path.join(nd.pw_dir, 'Library', 'LaunchAgents')
    ra = os.path.join(nd.pw_dir, 'dahao-gateway', 'launchd-daemon-thu')
    if not os.path.isdir(ra):
        os.makedirs(ra)
    n = 0
    for p in sorted(glob.glob(os.path.join(agent_dir, 'com.dahao.*.plist'))):
        lb = os.path.basename(p)[:-6]
        with open(os.path.join(ra, lb + '.plist'), 'wb') as f:
            plistlib.dump(lam_ban_daemon(doc_plist(p), nd), f)
        n += 1
    print('Đã soạn thử %d plist vào %s' % (n, ra))
    print('Kiểm bằng:  plutil -lint %s/*.plist' % ra)
    return 0


if __name__ == '__main__':
    nd = chu_nhan()
    that = '--that' in sys.argv

    if '--kiem' in sys.argv:
        kiem(nd)
        sys.exit(0)
    if '--soan' in sys.argv:
        sys.exit(soan(nd))

    # Chỉ lúc LÀM THẬT mới cần root. Chạy khan phải xem được tự do — bắt gõ mật khẩu chỉ để
    # đọc là dạy người ta gõ sudo mà không nhìn, đúng thói quen làm hỏng máy.
    if that and os.geteuid() != 0:
        print('Phải chạy bằng sudo (ghi vào %s và nạp domain hệ thống).' % DAEMON_DIR)
        print('  sudo /usr/bin/python3 -B %s --that' % os.path.basename(__file__))
        sys.exit(2)

    sys.exit(lui(nd, that) if '--lui' in sys.argv else vao(nd, that))
