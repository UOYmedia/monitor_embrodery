#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Suy ra VÌ SAO máy dừng, từ số mũi — vì giao thức không có trường lỗi.

Máy A15 không gửi mã lỗi (đã chốt trên 224.016 khung: luôn đúng 8 trường, 4 giá trị `state`,
không trường nào là lý do). Nhưng nó để lại một dấu vết:

    Sổ tay BECS-A15 §2.6  đứt chỉ / hết suốt  -> MÁY TỰ DỪNG
    Sổ tay BECS-A15 §2.4  "The purpose of returning is for patching" — thợ bấm nút lùi,
                          khung chạy ngược theo đúng đường đã thêu, rồi bấm chạy tiếp.

Lùi khung = `curStitch` GIẢM giữa một mẫu. Chuyện đó KHÔNG BAO GIỜ xảy ra khi thêu bình thường,
cũng không xảy ra khi thợ chỉ bấm dừng. Nên "dừng giữa mẫu + mũi lùi + chạy tiếp" là chữ ký nhìn
thấy được qua mạng của MỘT LẦN VÁ — mà lần vá thì gần như luôn là đứt chỉ hoặc hết suốt.

Đo thật 15,2 giờ / 64.301 khung: 13 lần lùi, độ lùi luôn là bội của một bước cố định theo từng máy
(30 mũi ở 3 máy, 50 mũi ở 1 máy) — đúng kiểu "giữ nút lùi 2 giây" của §2.4, không phải nhiễu.

⚠ ĐÂY LÀ SUY ĐOÁN, KHÔNG PHẢI MÁY BÁO. Phân biệt được "có người đang vá" với "dừng bình thường",
KHÔNG phân biệt được đứt chỉ trên / hết suốt dưới / gãy kim. Muốn biết chính xác thì thợ nhập tay
hoặc đọc HMI. Nhãn nào cũng mở đầu bằng "nghi-" là vì thế.

Ghi ra stdout, launchd hứng vào logs/va-mau.out, Alloy đẩy sang Loki job="va-mau".
"""
import argparse
import calendar
import json
import re
import subprocess
import sys
import time

LOG = '/Users/phong/dahao-gateway/broker.log'
DONG = re.compile(
    r'^\*\*\* STATE dev=(?P<may>[0-9A-Fa-f]+) cur=(?P<cur>\d+) tot=(?P<tot>\d+) '
    r'state=(?P<st>-?\d+) pat=(?P<pat>.*?) @(?P<t>\S+)')

NGAN_GIAY = 60          # dừng dưới ngần này mà không lùi mũi -> coi là dừng ngắn
NHIP_GIAY = 30          # đang dừng thì cứ ngần này giây nhắc một dòng
NGUNG_GIAY = 120        # máy khai mỗi ~2 giây; im ngần này là mất tin, không phải chậm

# Lùi khung của §2.4 là thao tác TAY: giữ nút, khung bò ngược ~30 mũi mỗi nhịp đo 2 giây. Giữ cả
# phút cũng chưa tới ngần này. Tụt hơn thế trong một nhịp là máy nhảy về đầu mẫu, không phải vá.
LUI_TOI_DA = 1000
# Thêu xong tấm rồi bấm chạy lại chính mẫu ấy: mũi nhảy thẳng về gần 0. Ngưỡng này để một lần vá
# đúng ở mũi cuối (thêu xong mới phát hiện đứt) vẫn được tính là vá, chứ không bị gộp vào "tấm mới".
VE_DAU = 0.05

# Mã số cho Grafana `unwrap` — Grafana không lọc được theo "nhãn mới nhất".
MA_NGHI = {
    'nghi-dut-chi': 0,   # có lùi mũi = có người đang vá
    'dung-han': 1,       # dừng rồi thôi, không chạy tiếp
    'dung-lau': 2,       # dừng lâu, không lùi mũi
    'dung-ngan': 3,      # dừng thoáng rồi chạy tiếp
    'doi-mau': 4,        # đang dở thì nhảy sang mẫu khác
    'mat-ket-noi': 5,    # máy im giữa chừng
    'khoi-dong-lai': 6,  # thêu lại chính mẫu ấy từ đầu (tấm tiếp theo)
}


def gio(t):
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(t))


def doc_gio(s):
    return calendar.timegm(time.strptime(s[:19], '%Y-%m-%dT%H:%M:%S'))


def doan(lan):
    """Đặt tên cho một lần dừng. Trả (nhãn, một câu tiếng người)."""
    if lan['ket'] == 'mat-ket-noi':
        return 'mat-ket-noi', 'Máy ngưng gửi tin giữa lúc đang dở mẫu.'
    if lan['ket'] == 'doi-mau':
        return 'doi-mau', 'Bỏ dở mẫu này, nhảy sang mẫu khác.'
    if lan['ket'] == 'khoi-dong-lai':
        return 'khoi-dong-lai', 'Thêu lại chính mẫu ấy từ đầu — tấm tiếp theo, không phải sự cố.'
    if lan['lui'] > 0:
        return 'nghi-dut-chi', (
            'Có người lùi khung %d mũi rồi cho chạy tiếp — đúng thao tác vá của sổ tay §2.4. '
            'Gần như chắc là đứt chỉ hoặc hết suốt; máy không nói rõ cái nào.' % lan['lui'])
    if lan['ket'] != 'chay-tiep':
        return 'dung-han', 'Dừng giữa mẫu rồi thôi, chưa chạy lại.'
    if lan['giay'] > NGAN_GIAY:
        return 'dung-lau', (
            'Dừng %.0f giây rồi chạy tiếp, không lùi mũi. Không phải vá — '
            'thường là chờ việc, chỉnh khung, hoặc thợ rời máy.' % lan['giay'])
    return 'dung-ngan', (
        'Dừng %.0f giây rồi chạy tiếp, không lùi mũi. Thường là đổi màu, cắt chỉ, '
        'hoặc thợ chỉnh nhanh.' % lan['giay'])


class Bo:
    """Theo dõi từng máy, nhả ra sự kiện. Tách khỏi phần đọc file để tự kiểm được."""

    def __init__(self, ngan=NGAN_GIAY, nhip=NHIP_GIAY, ngung=NGUNG_GIAY):
        self.truoc = {}      # may -> (cur, tot, pat, t)
        self.dang = {}       # may -> lần dừng đang mở
        self.im = set()      # máy đã báo mất tin rồi, đừng báo lại mỗi dòng
        self.ngan, self.nhip, self.ngung = ngan, nhip, ngung

    # -- nhả sự kiện --------------------------------------------------------
    def _dong_goi(self, may, lan, viec):
        nhan, cau = doan(lan)
        return {
            'at': gio(lan['den'] if viec == 'dong' else lan['t_nhac']),
            'viec': viec,                      # mo | dang | dong
            'may': may,
            'nghi': nhan,
            'ma_nghi': MA_NGHI[nhan],
            'giay': round(lan['giay'], 1),
            'lui': lan['lui'],
            'mui': lan['mui'],
            'tong': lan['tot'],
            'mau': lan['pat'],
            'ket': lan['ket'],
            'tu_luc': gio(lan['tu']),
            'y_nghia': cau,
        }

    def _mo(self, may, cur, tot, pat, t):
        self.dang[may] = {'tu': t, 'den': t, 't_nhac': t, 'mui': cur, 'tot': tot,
                          'pat': pat, 'lui': 0, 'giay': 0.0, 'ket': 'dang-dung',
                          'da_bao': False}

    def _dong(self, may, ket, t):
        lan = self.dang.pop(may, None)
        if lan is None:
            return []
        lan['den'], lan['ket'] = t, ket
        lan['giay'] = t - lan['tu']
        # Mốc `tu` là lần CUỐI còn thấy mũi nhúc nhích, nên một lần dừng chỉ hiện ra trong đúng một
        # nhịp đo (2 giây) vẫn ra `giay` = 4. Cắt chỉ và đổi màu đều rơi vào đây; ghi lại thì lấp
        # mất những lần đáng nhìn. Có lùi mũi thì giữ, dù ngắn tới đâu.
        if lan['giay'] <= 4 and lan['lui'] == 0 and ket == 'chay-tiep':
            return []
        return [self._dong_goi(may, lan, 'dong')]

    # -- nạp một khung ------------------------------------------------------
    def khung(self, may, cur, tot, pat, t):
        ra = []
        p = self.truoc.get(may)
        self.truoc[may] = (cur, tot, pat, t)
        self.im.discard(may)
        if p is None:
            return ra
        pcur, ptot, ppat, pt = p

        if pat != ppat:                                   # sang mẫu khác
            ra += self._dong(may, 'doi-mau', t)
            return ra
        if not pat or tot <= 0:                           # chưa nạp mẫu -> không xét
            ra += self._dong(may, 'doi-mau', t)
            return ra

        lan = self.dang.get(may)
        if cur < pcur and cur > 0:                        # MŨI TỤT
            # Có hai kiểu tụt, khác hẳn nhau. Lùi khung để vá (§2.4) là tay giữ nút, mỗi nhịp đo
            # bò ngược mấy chục mũi. Còn thêu xong tấm rồi bấm chạy lại chính mẫu ấy thì mũi nhảy
            # một phát về gần 0 — hết tấm chứ không phải sự cố. Đo thật đã dính một lần:
            # B83DF60B3FB8 lúc 02:38, 3788/3788 -> 1, bị đọc thành "lùi 3787 mũi".
            if pcur - cur > LUI_TOI_DA or (pcur >= tot and cur <= tot * VE_DAU):
                ra += self._dong(may, 'khoi-dong-lai', t)
                return ra
            if lan is None:
                self._mo(may, pcur, tot, pat, pt)
                lan = self.dang[may]
            lan['lui'] += pcur - cur
            lan['den'] = t
            lan['giay'] = t - lan['tu']
        elif cur > pcur:                                  # đang thêu
            ra += self._dong(may, 'chay-tiep', t)
        elif 0 < cur < tot:                               # đứng yên giữa mẫu
            if lan is None:
                self._mo(may, cur, tot, pat, pt)
                lan = self.dang[may]
            lan['den'] = t
            lan['giay'] = t - lan['tu']
        else:                                             # mũi 0 hoặc đã xong mẫu
            ra += self._dong(may, 'xong-hoac-cho', t)
            return ra

        # nhắc lại trong lúc còn đang dừng, để màn hình thấy được chuyện đang xảy ra
        lan = self.dang.get(may)
        if lan is not None:
            dang_ke = lan['lui'] > 0 or lan['giay'] >= self.ngan
            if dang_ke and (not lan['da_bao'] or t - lan['t_nhac'] >= self.nhip):
                lan['t_nhac'] = t
                ra.append(self._dong_goi(may, lan, 'mo' if not lan['da_bao'] else 'dang'))
                lan['da_bao'] = True
        return ra

    def het_tin(self, may, t):
        if may not in self.dang:
            p = self.truoc.get(may)
            if p and p[2] and 0 < p[0] < p[1]:
                self._mo(may, p[0], p[1], p[2], p[3])
        return self._dong(may, 'mat-ket-noi', t)

    def quet(self, t):
        """Máy im bặt thì KHÔNG có khung nào tới để kích hoạt gì cả — phải chủ động rà.

        Gọi mỗi khi có một khung bất kỳ (máy nào cũng được): xưởng còn một máy sống là còn
        nhịp để rà. Cả xưởng chết cùng lúc thì trang `xem/` lo, không phải việc của chỗ này.
        """
        ra = []
        for may, (cur, tot, pat, pt) in list(self.truoc.items()):
            if t - pt < self.ngung or may in self.im:
                continue
            self.im.add(may)
            ra += self.het_tin(may, pt)
        return ra


# --------------------------------------------------------------------------- chạy
def nap(bo, dong, ra):
    m = DONG.match(dong)
    if not m:
        return
    try:
        t = doc_gio(m.group('t'))
    except ValueError:
        return
    for sk in bo.khung(m.group('may'), int(m.group('cur')), int(m.group('tot')),
                       m.group('pat'), t):
        ra(sk)
    for sk in bo.quet(t):
        ra(sk)


def tu_kiem():
    """Ca thử — mỗi ca là một tình huống thật đã thấy trong broker.log."""
    loi = []

    def ca(ten, dieu):
        if not dieu:
            loi.append(ten)

    # 1) thêu bình thường: không sinh sự kiện nào
    b = Bo()
    sk = []
    for i, c in enumerate([100, 400, 700, 1000]):
        sk += b.khung('M1', c, 5000, 'a.DST', 1000 + i * 2)
    ca('thêu đều thì im lặng', sk == [])

    # 2) lùi mũi rồi chạy tiếp -> nghi đứt chỉ  (đúng ca 60260295C907 lúc 01:04:59)
    b = Bo()
    sk = []
    sk += b.khung('M1', 7343, 9993, 'a.DST', 1000)
    sk += b.khung('M1', 7373, 9993, 'a.DST', 1002)
    sk += b.khung('M1', 7343, 9993, 'a.DST', 1004)   # lùi 30
    sk += b.khung('M1', 7343, 9993, 'a.DST', 1006)
    sk += b.khung('M1', 7400, 9993, 'a.DST', 1008)   # chạy tiếp
    d = [x for x in sk if x['viec'] == 'dong']
    ca('lùi mũi -> nghi-dut-chi', len(d) == 1 and d[0]['nghi'] == 'nghi-dut-chi')
    ca('ghi đúng số mũi đã lùi', d and d[0]['lui'] == 30)
    ca('có báo ngay lúc đang dừng', any(x['viec'] == 'mo' for x in sk))

    # 3) giữ nút lùi liên tục -> gộp thành MỘT lần, cộng dồn (ca 602602911CB8 3 nhịp × 50)
    b = Bo()
    sk = []
    for c, t in ((170, 1000), (120, 1001), (70, 1002), (20, 1003), (60, 1005)):
        sk += b.khung('M1', c, 187, 'd.DST', t)
    d = [x for x in sk if x['viec'] == 'dong']
    ca('lùi nhiều nhịp vẫn là một lần', len(d) == 1)
    ca('cộng dồn 150 mũi', d and d[0]['lui'] == 150)

    # 4) dừng thoáng một nhịp đo, không lùi -> bỏ qua, đừng lấp log
    b = Bo()
    sk = []
    for c, t in ((500, 1000), (500, 1002), (560, 1004)):
        sk += b.khung('M1', c, 5000, 'a.DST', t)
    ca('dừng thoáng thì không ghi', sk == [])

    # 4b) nhưng dừng qua vài nhịp thì phải ghi — ngưỡng lọc không được nuốt luôn cái thật
    b = Bo()
    sk = []
    for c, t in ((500, 1000), (500, 1002), (500, 1004), (500, 1006), (560, 1008)):
        sk += b.khung('M1', c, 5000, 'a.DST', t)
    ca('dừng 8 giây thì có ghi', len([x for x in sk if x['viec'] == 'dong']) == 1)

    # 4c) dừng thoáng NHƯNG có lùi mũi -> vẫn phải ghi, đây mới là cái cần thấy
    b = Bo()
    sk = []
    for c, t in ((500, 1000), (470, 1002), (530, 1004)):
        sk += b.khung('M1', c, 5000, 'a.DST', t)
    d = [x for x in sk if x['viec'] == 'dong']
    ca('lùi mũi thì ngắn mấy cũng ghi', len(d) == 1 and d[0]['nghi'] == 'nghi-dut-chi')

    # 5) dừng 5 phút rồi chạy tiếp, không lùi -> dung-lau (KHÔNG phải đứt chỉ)
    b = Bo()
    sk = []
    sk += b.khung('M1', 500, 5000, 'a.DST', 1000)
    for k in range(1, 160):
        sk += b.khung('M1', 500, 5000, 'a.DST', 1000 + k * 2)
    sk += b.khung('M1', 560, 5000, 'a.DST', 1400)
    d = [x for x in sk if x['viec'] == 'dong']
    ca('dừng lâu không lùi -> dung-lau', len(d) == 1 and d[0]['nghi'] == 'dung-lau')
    ca('dừng lâu KHÔNG bị gọi là đứt chỉ', d and d[0]['lui'] == 0)

    # 6) thêu xong mẫu thì không phải là dừng
    b = Bo()
    sk = []
    sk += b.khung('M1', 4900, 5000, 'a.DST', 1000)
    sk += b.khung('M1', 5000, 5000, 'a.DST', 1002)
    sk += b.khung('M1', 5000, 5000, 'a.DST', 1004)
    ca('xong mẫu thì im lặng', [x for x in sk if x['viec'] == 'dong'] == [])

    # 7) mất tin giữa chừng
    b = Bo()
    sk = []
    sk += b.khung('M1', 500, 5000, 'a.DST', 1000)
    sk += b.khung('M1', 500, 5000, 'a.DST', 1120)
    sk += b.het_tin('M1', 1400)
    d = [x for x in sk if x['viec'] == 'dong']
    ca('mất tin -> mat-ket-noi', len(d) == 1 and d[0]['nghi'] == 'mat-ket-noi')

    # 8) hai máy không lẫn nhau
    b = Bo()
    sk = []
    sk += b.khung('M1', 500, 5000, 'a.DST', 1000)
    sk += b.khung('M2', 900, 8000, 'b.DST', 1000)
    sk += b.khung('M1', 470, 5000, 'a.DST', 1002)
    sk += b.khung('M2', 960, 8000, 'b.DST', 1002)
    sk += b.khung('M1', 520, 5000, 'a.DST', 1004)
    d = [x for x in sk if x['viec'] == 'dong']
    ca('hai máy tách bạch', len(d) == 1 and d[0]['may'] == 'M1')

    # 9) bảng mã phủ đủ, không trùng số
    ca('bảng mã không trùng', len(set(MA_NGHI.values())) == len(MA_NGHI))

    # 10) mọi nhãn đoán được đều có trong bảng mã
    b = Bo()
    ca('mọi nhãn đều có mã', all(
        doan({'ket': k, 'lui': l, 'giay': g, 'mui': 1, 'tot': 9, 'pat': 'x'})[0] in MA_NGHI
        for k, l, g in (('mat-ket-noi', 0, 1), ('doi-mau', 0, 1), ('chay-tiep', 30, 5),
                        ('chay-tiep', 0, 5), ('chay-tiep', 0, 900), ('dang-dung', 0, 5))))

    # 11) thêu xong tấm rồi thêu lại chính mẫu ấy -> KHÔNG phải đứt chỉ
    #     (ca thật B83DF60B3FB8 02:38:27: 3788/3788 -> 1, trước khi vá bị tính "lùi 3787 mũi")
    b = Bo()
    sk = []
    for c, t in ((3700, 1000), (3788, 1002), (3788, 1004), (1, 1008), (60, 1010)):
        sk += b.khung('M1', c, 3788, '4151~.DST', t)
    ca('thêu lại tấm mới không bị gọi là đứt chỉ',
       not any(x['nghi'] == 'nghi-dut-chi' for x in sk))
    ca('thêu lại tấm mới thì im lặng', sk == [])

    # 11b) nhưng vá đúng ở mũi CUỐI thì vẫn phải là vá — ngưỡng không được nuốt
    b = Bo()
    sk = []
    for c, t in ((3758, 1000), (3788, 1002), (3758, 1004), (3788, 1006)):
        sk += b.khung('M1', c, 3788, '4151~.DST', t)
    d = [x for x in sk if x['viec'] == 'dong']
    ca('vá ở mũi cuối vẫn là nghi-dut-chi',
       len(d) == 1 and d[0]['nghi'] == 'nghi-dut-chi' and d[0]['lui'] == 30)

    # 11c) dừng lâu giữa mẫu rồi bỏ luôn, nhảy về đầu -> khoi-dong-lai, không phải vá
    b = Bo()
    sk = []
    sk += b.khung('M1', 5000, 9000, 'a.DST', 1000)
    for k in range(1, 60):
        sk += b.khung('M1', 5000, 9000, 'a.DST', 1000 + k * 2)
    sk += b.khung('M1', 1, 9000, 'a.DST', 1122)
    d = [x for x in sk if x['viec'] == 'dong']
    ca('bỏ dở rồi làm lại từ đầu -> khoi-dong-lai',
       len(d) == 1 and d[0]['nghi'] == 'khoi-dong-lai' and d[0]['lui'] == 0)

    # 12) máy đang thêu rồi im bặt. Ca này CỐ Ý đi qua `nap()` chứ không gọi thẳng `Bo`: chỗ
    #     hỏng được của việc rà máy im là khúc nối (rà thì có, nhưng không ai gọi), y như lần
    #     `state:idle-long` chết câm vì NaN ở khúc nối chứ không phải ở phép so.
    b = Bo()
    sk = []
    def dong_log(dev, cur, tot, pat, t):
        return ('*** STATE dev=%s cur=%d tot=%d state=0 pat=%s @%s Δ2.001s'
                % (dev, cur, tot, pat, gio(t)))
    for dev, c, tt in (('AA01', 500, 1000), ('AA01', 560, 1002),
                       ('BB02', 100, 1002), ('BB02', 160, 1200)):
        n = 5000 if dev == 'AA01' else 9000
        nap(b, dong_log(dev, c, n, 'a.DST', tt), sk.append)
    d = [x for x in sk if x['viec'] == 'dong' and x['may'] == 'AA01']
    ca('máy im giữa mẫu thì tự rà ra', len(d) == 1 and d[0]['nghi'] == 'mat-ket-noi')

    # 12b) rà rồi thì thôi, đừng nhắc lại mỗi dòng
    sk2 = []
    for k in range(1, 20):
        nap(b, dong_log('BB02', 160 + k * 10, 9000, 'a.DST', 1202 + k * 2), sk2.append)
    ca('máy im chỉ báo đúng một lần', not any(x['may'] == 'AA01' for x in sk2))

    TONG = 20
    for x in loi:
        print('HỎNG:', x)
    print('%d/%d ca đạt' % (TONG - len(loi), TONG))
    return 1 if loi else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tu-kiem', action='store_true')
    ap.add_argument('--lich-su', type=int, metavar='N',
                    help='đọc N dòng cuối của broker.log rồi thôi (để đối chiếu)')
    ap.add_argument('--tom-tat', action='store_true', help='dùng với --lich-su: in bảng gộp')
    a = ap.parse_args()

    if a.tu_kiem:
        return tu_kiem()

    bo = Bo()
    if a.lich_su:
        gom = []
        duoi = subprocess.run(['tail', '-n', str(a.lich_su), LOG],
                              capture_output=True, text=True).stdout
        for d in duoi.splitlines():
            nap(bo, d, gom.append)
        xong = [x for x in gom if x['viec'] == 'dong']
        if a.tom_tat:
            import collections
            dem = collections.Counter(x['nghi'] for x in xong)
            print('%d lần dừng đáng kể' % len(xong))
            for k, v in dem.most_common():
                print('  %-14s %4d lần' % (k, v))
            print()
            print('--- các lần NGHI ĐỨT CHỈ ---')
            for x in xong:
                if x['nghi'] == 'nghi-dut-chi':
                    print('  %s  %-14s lùi %3d mũi  ở %d/%d  dừng %.0fs  %s'
                          % (x['tu_luc'][11:19], x['may'], x['lui'], x['mui'],
                             x['tong'], x['giay'], x['mau'][:24]))
            print()
            print('--- máy nào hay phải vá nhất ---')
            m = collections.Counter(x['may'] for x in xong if x['nghi'] == 'nghi-dut-chi')
            for k, v in m.most_common():
                print('  %-14s %d lần' % (k, v))
        else:
            for x in gom:
                print(json.dumps(x, ensure_ascii=False))
        return 0

    # chạy sống
    p = subprocess.Popen(['tail', '-n', '0', '-F', LOG], stdout=subprocess.PIPE, text=True)
    for d in p.stdout:
        nap(bo, d, lambda x: (sys.stdout.write(json.dumps(x, ensure_ascii=False) + '\n'),
                              sys.stdout.flush()))
    return 0


if __name__ == '__main__':
    sys.exit(main())
