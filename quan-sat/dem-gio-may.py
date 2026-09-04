#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Đếm giờ: một ngày mỗi máy THÊU bao lâu, DỪNG bao lâu, CHỜ bao lâu, MẤT TÍN HIỆU bao lâu.

VÌ SAO PHẢI CÓ CHỖ NÀY (đừng tính lại bằng LogQL — đã thử, không ra)

  - `tinh-trang` chỉ ghi khi ĐỔI tình trạng + nhịp tim 20 giây, nên "đếm số dòng nhân 20" là sai:
    lúc máy đổi trạng thái liên tục thì dòng dày lên mà thời gian có dài ra đâu. Đo thật trên
    53.520 dòng: khoảng cách giữa hai dòng cùng một máy chạy từ 2 tới 22 giây.
  - `va-mau` cho từng lần dừng kèm số giây CHÍNH XÁC, nhưng nó CỐ Ý chỉ nhìn lúc máy đang dở mẫu
    (0 < mũi < tổng). Máy thêu xong tấm rồi để đó chờ người tháo khung thì `va-mau` không thấy —
    mà đó lại đúng là khoảng "chờ" xưởng cần đo.
  - `broker.log` có đủ nguyên liệu (mỗi máy một khung mỗi ~2 giây) nhưng LogQL không so được hai
    mẫu liền nhau của cùng một luồng, nên "mũi có tăng không" là câu LogQL không trả lời được.

Nên chỗ này làm đúng một việc: đọc `broker.log`, xếp TỪNG KHOẢNG giữa hai khung liền nhau vào một
trong bốn giỏ, rồi mỗi phút nhả ra một dòng JSON cho mỗi máy.

  chay  mũi TĂNG                                            -> máy đang thêu
  dung  mũi ĐỨNG YÊN (hoặc lùi) trong khi đang dở mẫu        -> máy dừng giữa chừng
  cho   đứng yên mà mũi = 0, hoặc mũi = tổng, hoặc chưa nạp  -> chờ việc / xong tấm / đổi mẫu
        mẫu, hoặc vừa nhảy sang mẫu khác
  mat   không có khung nào                                   -> mất điện / mất mạng / tắt máy

BỐN GIỎ ẤY CỘNG LẠI LUÔN ĐÚNG 60 GIÂY MỖI PHÚT MỖI MÁY. Đó là bất biến, và `--tu-kiem` bắt nó.
Cái gì không xếp được vào ba giỏ đầu thì rơi vào `mat` — nên không có giây nào biến mất im lặng.

"MẤT TÍN HIỆU" KHÔNG PHẢI "MÁY RẢNH". Máy A15 cắm điện là đẩy khung mỗi 2 giây, 24/7, kể cả lúc
đứng không (đo thật: 1.799 khung/giờ suốt đêm, nội dung `cur=0 tot=0 pat=`). Nên im = mất điện,
mất mạng, hoặc đã tắt máy — không bao giờ là "đang rảnh". Muốn tách "hết giờ làm" ra thì dùng nhãn
`gio` (`trong-gio` / `ngoai-gio`) chứ đừng đọc `mat` thành "máy nghỉ".

DƯỚI 1 PHÚT / TRÊN 1 PHÚT

Một LẦN DỪNG là chuỗi liền các khoảng `dung`. Lúc nó khép lại mới biết nó dài bao nhiêu, nên số
giây của nó được ghi thêm một lần nữa vào `ngan` (< 60 giây) hoặc `dai` (>= 60 giây) — ghi vào
phút mà nó KẾT THÚC. Vì thế:

  - `dung` là thời gian rải đúng theo trục thời gian (vẽ đồ thị thì dùng cái này),
  - `ngan` + `dai` là cùng số giây ấy nhưng dồn về lúc khép — cộng trên cả ngày thì hai bên bằng
    nhau, trừ đúng một lần dừng đang còn dở ở mép cửa sổ. ĐỪNG cộng cả `dung` lẫn `ngan`+`dai`
    vào một tổng, là đếm đôi.

KHÁC `va-mau` MỘT NHỊP ĐO: `va-mau` tính lần dừng tới tận khung máy chạy lại (nên dư ~2 giây),
chỗ này tính tới khung CUỐI CÙNG còn thấy máy đứng. Lệch ~2 giây mỗi lần dừng là cố ý, để bất
biến 60 giây ở trên không bị vỡ. `--doi-chieu` in ra chênh lệch ấy để ai cũng kiểm được.

GHI RA ĐÂU: stdout, launchd hứng vào `logs/gio-may.out`, Alloy đẩy sang Loki `job="gio-may"`.
Không tự mở file, không tự xoay file — `com.dahao.xoaylog` đã xoay sẵn mọi `logs/*.out` bằng lối
chép-rồi-cắt, lối duy nhất an toàn với fd `O_APPEND` của launchd.
"""
import argparse
import calendar
import collections
import gzip
import io
import json
import os
import re
import subprocess
import sys
import time

LOG = os.environ.get('BROKER_LOG', '/Users/phong/dahao-gateway/broker.log')
TEN_MAY = os.environ.get('TEN_MAY', '/Users/phong/dahao-gateway/quan-sat/ten-may.json')
BO_DO = os.environ.get('BO_DO', '/Users/phong/dahao-gateway/quan-sat/soi-lan-dung.py')
RA_TEP = os.environ.get('GIO_MAY_OUT', '/Users/phong/dahao-gateway/logs/gio-may.out')

DONG = re.compile(
    r'^\*\*\* STATE dev=(?P<may>[0-9A-Fa-f]+) cur=(?P<cur>\d+) tot=(?P<tot>\d+) '
    r'state=(?P<st>-?\d+) pat=(?P<pat>.*?) @(?P<t>\S+)')

PHUT = 60               # một dòng cho mỗi máy mỗi phút
NGAN_GIAY = 60          # ranh giới "dừng ngắn" / "dừng lâu" — đúng câu hỏi của xưởng
NGUNG_GIAY = 120        # máy khai mỗi ~2 giây; im ngần này là mất tin, không phải chậm (= soi-lan-dung)
# Chờ ngần này rồi mới chốt một phút. `broker.log` KHÔNG xếp đúng thứ tự giờ giữa các máy — nhả
# cả cụm một lúc, có cụm trễ tới hàng phút. Chốt sớm quá thì khoảng của máy đi sau bị vứt IM LẶNG.
# Đo trên 75.493 dòng thật: 45 giây bỏ 33 khoảng · 90 giây bỏ 6 · 180 giây bỏ 3 rồi thôi không
# giảm nữa (3 khoảng ấy là dòng lệch giờ hàng chục phút, không lối chờ nào cứu). Nên để 180 —
# đổi lại bảng trễ ~4 phút so với thực tại, chấp nhận được với câu hỏi "hôm nay bao lâu".
TRE_GIAY = int(os.environ.get('TRE_GIAY', '180'))

# Dừng chỉ hiện ra trong đúng MỘT nhịp đo (máy khai mỗi ~2 giây) thì thường là cắt chỉ / đổi màu,
# không phải cái xưởng gọi là "một lần dừng". Vẫn tính đủ số GIÂY vào `dung`/`ngan` — giây nào
# cũng là giây máy không chạy — nhưng đếm riêng ra `so_nhay` để cột "số lần" không bị nó lấp.
# (`soi-lan-dung.py` vứt hẳn những lần này khỏi nhật ký; ở đây không vứt, chỉ tách.)
NHAY_GIAY = 4

# Hai ngưỡng này PHẢI khớp `soi-lan-dung.py`, không thì hai bảng nói hai chuyện về cùng một lần
# tụt mũi. `--tu-kiem` đọc thẳng file kia ra so, nên chép lệch là hỏng bài thử ngay.
LUI_TOI_DA = 1000       # tụt hơn ngần này trong một nhịp = nhảy về đầu mẫu, không phải lùi khung
VE_DAU = 0.05           # xong tấm rồi mũi rơi dưới 5% tổng = tấm mới, không phải vá

# Mini chạy ở UTC-7. TUYỆT ĐỐI không dùng `localtime` — lệch 14 tiếng là đúng nửa ngày, ban ngày
# thành ban đêm. Cộng thẳng vào epoch rồi đọc bằng `gmtime`. (Chép đúng lối `dong-bo-tinh-trang.py`.)
LECH_VN_GIAY = int(os.environ.get('LECH_MUI_GIO_GIAY', str(7 * 3600)))


def _doc_gio_lam(s):
    a, b = s.split('-')

    def phut(x):
        h, m = x.strip().split(':')
        return int(h) * 60 + int(m)
    return phut(a), phut(b)


GIO_LAM = _doc_gio_lam(os.environ.get('GIO_LAM', '06:00-19:00'))
NGAY_NGHI = {int(x) for x in os.environ.get('NGAY_NGHI', '').replace(',', ' ').split()}

GIO = ('chay', 'dung', 'cho')      # ba giỏ đếm được; `mat` là phần còn lại của phút


def gio_iso(t):
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(t))


def doc_gio(s):
    return calendar.timegm(time.strptime(s[:19], '%Y-%m-%dT%H:%M:%S'))


def trong_gio_lam(t):
    """Thời điểm này có nằm trong giờ xưởng chạy không (giờ VN)."""
    vn = time.gmtime(t + LECH_VN_GIAY)
    if vn.tm_wday in NGAY_NGHI:
        return False
    phut = vn.tm_hour * 60 + vn.tm_min
    bd, kt = GIO_LAM
    return bd <= phut < kt if bd <= kt else (phut >= bd or phut < kt)


def _ro():
    return {'chay': 0, 'dung': 0, 'cho': 0, 'ngan': 0, 'dai': 0,
            'so_ngan': 0, 'so_dai': 0, 'so_nhay': 0, 'mui': 0, 'lui': 0}


class Dem:
    """Nhận từng khung, nhả ra mỗi phút một dòng cho mỗi máy. Tách khỏi phần đọc file để tự kiểm."""

    def __init__(self, ten_may=None, tre=TRE_GIAY, ngung=NGUNG_GIAY, ngan=NGAN_GIAY):
        self.ten = dict(ten_may or {})
        self.tre, self.ngung, self.ngan = tre, ngung, ngan
        self.truoc = {}       # may -> (cur, tot, pat, t)
        self.dung = {}        # may -> số giây của lần dừng đang mở
        self.o = {}           # (moc, may) -> giỏ
        self.dong_ho = None   # giờ mới nhất thấy trong log, bất kể của máy nào
        self.moc_tiep = None  # phút kế tiếp chờ chốt
        self.muon = 0         # số khoảng tới sau khi phút của nó đã chốt (phải luôn là 0)

    # -- sổ sách ------------------------------------------------------------
    def _o(self, moc, may):
        k = (moc, may)
        if k not in self.o:
            self.o[k] = _ro()
        return self.o[k]

    def danh_sach(self):
        return sorted(set(self.ten) | set(self.truoc))

    def cong(self, may, loai, t1, t2):
        """Cộng khoảng [t1, t2) vào giỏ, CẮT theo mốc phút — khoảng vắt qua nửa phút không được
        dồn hết về một bên, không thì đồ thị nhảy cục."""
        while t1 < t2:
            moc = t1 - t1 % PHUT
            het = min(t2, moc + PHUT)
            if self.moc_tiep is not None and moc < self.moc_tiep:
                self.muon += 1          # phút ấy chốt rồi; đếm để `--tu-kiem` / `--tom-tat` thấy
            else:
                self._o(moc, may)[loai] += het - t1
            t1 = het

    # -- lần dừng -----------------------------------------------------------
    def _dong_dung(self, may, t):
        giay = self.dung.pop(may, 0)
        if giay <= 0:
            return
        moc = t - t % PHUT
        if self.moc_tiep is not None and moc < self.moc_tiep:
            self.muon += 1
            return
        b = self._o(moc, may)
        if giay < self.ngan:
            b['ngan'] += giay
            b['so_ngan'] += 1
            if giay <= NHAY_GIAY:
                b['so_nhay'] += 1
        else:
            b['dai'] += giay
            b['so_dai'] += 1

    # -- nạp một khung ------------------------------------------------------
    def khung(self, may, cur, tot, pat, t):
        p = self.truoc.get(may)
        if p is not None and t < p[3]:
            return                      # khung lệch thứ tự: bỏ hẳn, đừng làm bẩn mốc trước
        self.dong_ho = t if self.dong_ho is None else max(self.dong_ho, t)
        if self.moc_tiep is None:
            self.moc_tiep = t - t % PHUT
        if p is None:
            self.truoc[may] = (cur, tot, pat, t)
            return
        pcur, ptot, ppat, pt = p
        self.truoc[may] = (cur, tot, pat, t)
        d = t - pt

        # Nhiều khung rơi vào CÙNG một giây (broker nhả cả cụm một lúc, Δ0.001s — thấy thật trong
        # log). Không có thời gian để chia, nhưng số mũi thì vẫn phải cộng, không thì sản lượng hụt.
        if d == 0:
            if cur > pcur:
                self._o(t - t % PHUT, may)['mui'] += cur - pcur
            return

        if d > self.ngung:              # khoảng trống: để phần "bù cho đủ 60 giây" gọi tên là `mat`
            self._dong_dung(may, pt)
            return

        loai = 'cho'
        if pat != ppat:                 # nhảy sang mẫu khác = đổi tấm, không phải đang thêu
            loai = 'cho'
        elif cur > pcur:
            loai = 'chay'
        elif cur < pcur:
            # Hai kiểu tụt mũi khác hẳn nhau (chép đúng luật của `soi-lan-dung.py`): lùi khung để
            # vá thì mỗi nhịp bò ngược mấy chục mũi; còn thêu xong tấm rồi chạy lại chính mẫu ấy
            # thì mũi nhảy một phát về gần 0 — hết tấm chứ không phải sự cố.
            if pcur - cur > LUI_TOI_DA or (ptot > 0 and pcur >= ptot and cur <= ptot * VE_DAU):
                loai = 'cho'
            else:
                loai = 'dung'
        elif ppat and ptot > 0 and 0 < pcur < ptot:
            loai = 'dung'               # đứng yên GIỮA mẫu

        self.cong(may, loai, pt, t)
        moc = pt - pt % PHUT
        if loai == 'chay':
            if not (self.moc_tiep and moc < self.moc_tiep):
                self._o(moc, may)['mui'] += cur - pcur
        if loai == 'dung':
            if cur < pcur and not (self.moc_tiep and moc < self.moc_tiep):
                self._o(moc, may)['lui'] += pcur - cur
            self.dung[may] = self.dung.get(may, 0) + d
        else:
            self._dong_dung(may, pt)

    # -- chốt phút ----------------------------------------------------------
    def _goi(self, moc, may):
        b = self.o.pop((moc, may), None) or _ro()
        dat = b['chay'] + b['dung'] + b['cho']
        ten = (self.ten.get(may) or {}).get('ten') or may
        return {
            'at': gio_iso(moc),
            'may': may,
            'ten': ten,
            'gio': 'trong-gio' if trong_gio_lam(moc) else 'ngoai-gio',
            'phut': PHUT,
            'chay': b['chay'],
            'dung': b['dung'],
            'cho': b['cho'],
            'mat': max(0, PHUT - dat),
            'ngan': b['ngan'],
            'dai': b['dai'],
            'so_ngan': b['so_ngan'],
            'so_nhay': b['so_nhay'],
            'so_dai': b['so_dai'],
            'mui': b['mui'],
            'lui': b['lui'],
        }

    def chot(self, het=False):
        """Nhả những phút đã chắc chắn không còn khung nào tới nữa."""
        ra = []
        if self.dong_ho is None or self.moc_tiep is None:
            return ra
        # `het`: chốt nốt cả phút đang dở. Phút cuối vì thế bị bù `mat` cho đủ 60 giây — chỉ
        # dùng cho `--lich-su`/`--tu-kiem`, đừng dùng lúc chạy sống.
        gioi = self.dong_ho + PHUT if het else self.dong_ho - self.tre
        while self.moc_tiep + PHUT <= gioi:
            for may in self.danh_sach():
                ra.append(self._goi(self.moc_tiep, may))
            self.moc_tiep += PHUT
        return ra


def nap(dem, dong, ra):
    m = DONG.match(dong)
    if not m:
        return
    try:
        t = doc_gio(m.group('t'))
    except ValueError:
        return
    dem.khung(m.group('may'), int(m.group('cur')), int(m.group('tot')), m.group('pat'), t)
    for x in dem.chot():
        ra(x)


def doc_ten_may(duong=TEN_MAY):
    try:
        with io.open(duong, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def mo_tep(p):
    return gzip.open(p, 'rt', encoding='utf-8', errors='replace') if p.endswith('.gz') \
        else io.open(p, encoding='utf-8', errors='replace')


# --------------------------------------------------------------------------- tự kiểm
def tu_kiem():
    loi = []

    def ca(ten, dieu):
        if not dieu:
            loi.append(ten)

    def chay(khung, ten_may=None, tre=TRE_GIAY):
        d = Dem(ten_may=ten_may, tre=tre)
        ra = []
        for k in khung:
            d.khung(*k)
            ra += d.chot()
        ra += d.chot(het=True)
        return d, ra

    def gom(ra, may=None):
        t = _ro()
        t['mat'] = 0
        for x in ra:
            if may and x['may'] != may:
                continue
            for k in ('chay', 'dung', 'cho', 'mat', 'ngan', 'dai', 'so_ngan', 'so_nhay',
                      'so_dai', 'mui', 'lui'):
                t[k] = t.get(k, 0) + x[k]
        return t

    T0 = 1788000000 - 1788000000 % 60      # đúng mốc phút cho dễ đọc

    # 1) thêu đều suốt một phút -> cả 60 giây vào giỏ `chay`
    _, ra = chay([('M1', 100 + i * 30, 5000, 'a.DST', T0 + i * 2) for i in range(0, 31)])
    t = gom(ra)
    ca('thêu đều -> chay = 60', t['chay'] == 60 and t['dung'] == 0 and t['cho'] == 0)
    ca('đếm đúng số mũi thêu được', t['mui'] == 30 * 30)

    # 2) đứng yên giữa mẫu suốt một phút -> `dung`
    _, ra = chay([('M1', 100, 5000, 'a.DST', T0 + i * 2) for i in range(0, 31)])
    ca('đứng giữa mẫu -> dung = 60', gom(ra)['dung'] == 60)

    # 3) mũi 0 và mũi = tổng -> `cho`, KHÔNG phải dừng
    _, ra = chay([('M1', 0, 5000, 'a.DST', T0 + i * 2) for i in range(0, 31)])
    ca('mũi 0 -> cho', gom(ra)['cho'] == 60 and gom(ra)['dung'] == 0)
    _, ra = chay([('M1', 5000, 5000, 'a.DST', T0 + i * 2) for i in range(0, 31)])
    ca('xong tấm -> cho', gom(ra)['cho'] == 60 and gom(ra)['dung'] == 0)

    # 4) máy có tên trong sổ mà chưa từng gửi khung nào -> cả phút là `mat`
    _, ra = chay([('M1', 100 + i * 30, 5000, 'a.DST', T0 + i * 2) for i in range(0, 31)],
                 ten_may={'M1': {'ten': 'Máy 01'}, 'M2': {'ten': 'Máy 02'}})
    ca('máy im -> mat = 60 mỗi phút',
       all(x['mat'] == 60 for x in ra if x['may'] == 'M2'))
    ca('máy im vẫn có dòng riêng', any(x['may'] == 'M2' for x in ra))
    ca('lấy được tên máy', all(x['ten'] == 'Máy 02' for x in ra if x['may'] == 'M2'))

    # 5) BẤT BIẾN: mỗi dòng, bốn giỏ cộng lại đúng 60 giây
    khung = []
    for i in range(0, 200):                       # thêu, dừng, chờ, rồi im hẳn
        t = T0 + i * 2
        if i < 40:
            khung.append(('M1', 100 + i * 30, 5000, 'a.DST', t))
        elif i < 80:
            khung.append(('M1', 100 + 39 * 30, 5000, 'a.DST', t))
        elif i < 120:
            khung.append(('M1', 0, 5000, 'a.DST', t))
    khung.append(('M1', 0, 5000, 'a.DST', T0 + 400))
    _, ra = chay(khung)
    ca('bất biến 60 giây mỗi dòng',
       all(x['chay'] + x['dung'] + x['cho'] + x['mat'] == 60 for x in ra))
    ca('có dòng mất tín hiệu thật', any(x['mat'] > 0 for x in ra))

    # 6) dừng 30 giây rồi chạy tiếp -> một lần NGẮN
    khung = [('M1', 100, 5000, 'a.DST', T0), ('M1', 130, 5000, 'a.DST', T0 + 2)]
    khung += [('M1', 130, 5000, 'a.DST', T0 + 2 + i * 2) for i in range(1, 16)]
    khung += [('M1', 160, 5000, 'a.DST', T0 + 34)]
    _, ra = chay(khung)
    t = gom(ra)
    ca('dừng 30s -> đếm 1 lần ngắn', t['so_ngan'] == 1 and t['so_dai'] == 0)
    ca('dừng 30s -> ghi 30 giây vào ngắn', t['ngan'] == 30 and t['dai'] == 0)
    ca('ngắn+dài = tổng thời gian dừng', t['ngan'] + t['dai'] == t['dung'])

    # 6b) dừng thoáng đúng một nhịp đo -> vẫn tính giây, nhưng đếm riêng ra `so_nhay`
    khung = [('M1', 100, 5000, 'a.DST', T0), ('M1', 130, 5000, 'a.DST', T0 + 2),
             ('M1', 130, 5000, 'a.DST', T0 + 4), ('M1', 160, 5000, 'a.DST', T0 + 6)]
    _, ra = chay(khung)
    t = gom(ra)
    ca('dừng thoáng vẫn tính đủ giây', t['dung'] == 2 and t['ngan'] == 2)
    ca('dừng thoáng đếm riêng', t['so_nhay'] == 1 and t['so_ngan'] == 1)
    ca('dừng 30 giây không bị gọi là thoáng',
       gom(chay([('M1', 100, 5000, 'a.DST', T0), ('M1', 130, 5000, 'a.DST', T0 + 2)]
                + [('M1', 130, 5000, 'a.DST', T0 + 2 + i * 2) for i in range(1, 16)]
                + [('M1', 160, 5000, 'a.DST', T0 + 34)])[1])['so_nhay'] == 0)

    # 7) dừng 150 giây -> một lần DÀI, và số giây rải qua nhiều phút vẫn khớp
    khung = [('M1', 100, 5000, 'a.DST', T0), ('M1', 130, 5000, 'a.DST', T0 + 2)]
    khung += [('M1', 130, 5000, 'a.DST', T0 + 2 + i * 2) for i in range(1, 76)]
    khung += [('M1', 160, 5000, 'a.DST', T0 + 154)]
    _, ra = chay(khung)
    t = gom(ra)
    ca('dừng 150s -> đếm 1 lần dài', t['so_dai'] == 1 and t['so_ngan'] == 0)
    ca('dừng 150s -> ghi 150 giây vào dài', t['dai'] == 150)
    ca('dừng dài rải đúng qua nhiều phút', t['dung'] == 150 and len(
        {x['at'] for x in ra if x['dung'] > 0}) >= 3)

    # 8) lùi khung để vá -> vẫn là `dung`, và mũi lùi được ghi lại
    khung = [('M1', 7343, 9993, 'a.DST', T0), ('M1', 7373, 9993, 'a.DST', T0 + 2),
             ('M1', 7343, 9993, 'a.DST', T0 + 4), ('M1', 7343, 9993, 'a.DST', T0 + 6),
             ('M1', 7400, 9993, 'a.DST', T0 + 8)]
    _, ra = chay(khung)
    t = gom(ra)
    ca('lùi khung -> dung', t['dung'] == 4 and t['lui'] == 30)
    ca('lùi khung không bị tính là thêu', t['chay'] == 4)   # 2 giây đầu + 2 giây cuối

    # 9) thêu xong tấm rồi làm tấm mới -> `cho`, KHÔNG phải dừng (bẫy đã cắn thật ở soi-lan-dung)
    khung = [('M1', 3788, 3788, 'a.DST', T0), ('M1', 1, 3788, 'a.DST', T0 + 2),
             ('M1', 60, 3788, 'a.DST', T0 + 4)]
    _, ra = chay(khung)
    t = gom(ra)
    ca('tấm mới -> cho chứ không phải dung', t['dung'] == 0 and t['cho'] == 2)

    # 10) khoảng trống dài hơn NGUNG -> `mat`, không phải `dung`
    khung = [('M1', 100, 5000, 'a.DST', T0), ('M1', 100, 5000, 'a.DST', T0 + 300),
             ('M1', 100, 5000, 'a.DST', T0 + 302)]
    _, ra = chay(khung)
    t = gom(ra)
    ca('im lâu -> mat chứ không phải dung', t['mat'] >= 290 and t['dung'] <= 4)

    # 11) khoảng vắt qua nửa phút phải bị CẮT, không dồn hết về một bên
    khung = [('M1', 100, 5000, 'a.DST', T0 + 58), ('M1', 130, 5000, 'a.DST', T0 + 62)]
    _, ra = chay(khung)
    p = {x['at']: x for x in ra}
    ca('cắt đúng mốc phút',
       p[gio_iso(T0)]['chay'] == 2 and p[gio_iso(T0 + 60)]['chay'] == 2)

    # 12) nhiều khung cùng MỘT giây (broker nhả cả cụm) -> không có thời gian, nhưng mũi vẫn cộng
    khung = [('M1', 6472, 17880, 'a.DST', T0), ('M1', 6494, 17880, 'a.DST', T0),
             ('M1', 6515, 17880, 'a.DST', T0), ('M1', 6537, 17880, 'a.DST', T0 + 2)]
    _, ra = chay(khung)
    t = gom(ra)
    ca('cụm cùng giây -> cộng đủ mũi', t['mui'] == 6537 - 6472)
    ca('cụm cùng giây -> không đẻ thêm giây', t['chay'] == 2)

    # 13) khung lệch thứ tự thì bỏ, đừng làm bẩn mốc trước
    khung = [('M1', 100, 5000, 'a.DST', T0 + 10), ('M1', 90, 5000, 'a.DST', T0 + 4),
             ('M1', 160, 5000, 'a.DST', T0 + 12)]
    _, ra = chay(khung)
    t = gom(ra)
    ca('khung lệch thứ tự bị bỏ', t['chay'] == 2 and t['dung'] == 0)

    # 14) nhiều máy cùng lúc -> mỗi máy một dòng, không lẫn số của nhau
    khung = []
    for i in range(0, 31):
        khung.append(('M1', 100 + i * 30, 5000, 'a.DST', T0 + i * 2))
        khung.append(('M2', 100, 5000, 'b.DST', T0 + i * 2))
    _, ra = chay(khung)
    ca('hai máy không lẫn số',
       gom(ra, 'M1')['chay'] == 60 and gom(ra, 'M1')['dung'] == 0
       and gom(ra, 'M2')['dung'] == 60 and gom(ra, 'M2')['chay'] == 0)

    # 15) HAI MÁY XEN KẼ, chốt phút chạy trong lúc đang nạp — bẫy đã cắn thật lúc viết: máy đi
    #     sau trong cùng một giây bị chốt mất khoảng cuối, `dung` hụt 2 giây mà không ai báo.
    khung = []
    for i in range(0, 91):
        khung.append(('M1', 100 + i * 30, 5000, 'a.DST', T0 + i * 2))
        khung.append(('M2', 100, 5000, 'b.DST', T0 + i * 2))
    d, ra = chay(khung)
    ca('không có khoảng nào tới muộn', d.muon == 0)
    ca('máy đi sau không hụt giây', gom(ra, 'M2')['dung'] == 180)
    ca('máy đi trước vẫn đủ giây', gom(ra, 'M1')['chay'] == 180)

    # 16) hai ngưỡng chép tay phải khớp `soi-lan-dung.py` — đọc thẳng file kia ra so
    try:
        src = io.open(BO_DO, encoding='utf-8').read()
        kia = dict(re.findall(r'^(LUI_TOI_DA|VE_DAU) = ([0-9.]+)', src, re.M))
        ca('LUI_TOI_DA khớp soi-lan-dung', float(kia.get('LUI_TOI_DA', -1)) == LUI_TOI_DA)
        ca('VE_DAU khớp soi-lan-dung', float(kia.get('VE_DAU', -1)) == VE_DAU)
    except OSError:
        ca('đọc được soi-lan-dung.py để đối chiếu ngưỡng', False)

    # 17) giờ VN, không phải giờ máy chủ (Mini chạy UTC-7 — dùng localtime là lệch nửa ngày)
    trua_vn = calendar.timegm(time.strptime('2026-09-04T05:00:00', '%Y-%m-%dT%H:%M:%S'))
    dem_vn = calendar.timegm(time.strptime('2026-09-04T18:00:00', '%Y-%m-%dT%H:%M:%S'))
    ca('12h trưa VN là trong giờ', trong_gio_lam(trua_vn))
    ca('1h sáng VN là ngoài giờ', not trong_gio_lam(dem_vn))

    TONG = 36
    for x in loi:
        print('HỎNG:', x)
    print('%d/%d ca đạt' % (TONG - len(loi), TONG))
    return 1 if loi else 0


# --------------------------------------------------------------------------- tóm tắt / đối chiếu
def _hms(giay):
    giay = int(round(giay))
    return '%2dh%02d\'%02d"' % (giay // 3600, giay % 3600 // 60, giay % 60)


def tom_tat(gom, ten_may):
    tong = collections.defaultdict(_ro)
    for x in gom:
        t = tong[x['may']]
        for k in ('chay', 'dung', 'cho', 'ngan', 'dai', 'so_ngan', 'so_nhay', 'so_dai',
                  'mui', 'lui'):
            t[k] += x[k]
        t['mat'] = t.get('mat', 0) + x['mat']
    print('%-14s %-9s %10s %10s %10s %10s | %10s %5s %5s %10s %5s' % (
        'máy', 'tên', 'thêu', 'dừng', 'chờ', 'mất tin', 'dừng<1\'', 'lần', '(thoáng)',
        'dừng>=1\'', 'lần'))
    for may in sorted(tong):
        t = tong[may]
        print('%-14s %-9s %10s %10s %10s %10s | %10s %5d %5d %10s %5d' % (
            may, (ten_may.get(may) or {}).get('ten', '')[:9],
            _hms(t['chay']), _hms(t['dung']), _hms(t['cho']), _hms(t['mat']),
            _hms(t['ngan']), t['so_ngan'], t['so_nhay'], _hms(t['dai']), t['so_dai']))
    c = collections.Counter()
    for t in tong.values():
        for k in ('chay', 'dung', 'cho', 'mat', 'ngan', 'dai', 'so_ngan', 'so_nhay', 'so_dai'):
            c[k] += t[k]
    print('-' * 106)
    print('%-24s %10s %10s %10s %10s | %10s %5d %5d %10s %5d' % (
        'CẢ XƯỞNG', _hms(c['chay']), _hms(c['dung']), _hms(c['cho']), _hms(c['mat']),
        _hms(c['ngan']), c['so_ngan'], c['so_nhay'], _hms(c['dai']), c['so_dai']))
    print()
    print('Kiểm: dừng = ngắn + dài ?  %d = %d + %d  (lệch %d giây — đúng bằng phần lần dừng còn '
          'dở ở hai mép cửa sổ)' % (c['dung'], c['ngan'], c['dai'],
                                    c['dung'] - c['ngan'] - c['dai']))


def doi_chieu(gom, n):
    """So số lần dừng đếm được ở đây với `va-mau` — hai bộ đọc cùng một log bằng hai lối khác nhau."""
    try:
        import importlib.util
        sp = importlib.util.spec_from_file_location('soi', BO_DO)
        m = importlib.util.module_from_spec(sp)
        sp.loader.exec_module(m)
    except Exception as e:                      # noqa: BLE001 — chỉ là bộ đối chiếu, hỏng thì báo
        print('không nạp được soi-lan-dung.py:', e)
        return
    duoi = subprocess.run(['tail', '-n', str(n), LOG], capture_output=True, text=True).stdout
    bo, sk = m.Bo(), []
    for d in duoi.splitlines():
        m.nap(bo, d, sk.append)
    xong = [x for x in sk if x['viec'] == 'dong'
            and x['nghi'] in ('nghi-dut-chi', 'dung-ngan', 'dung-lau', 'dung-han')]
    vm_ngan = [x for x in xong if x['giay'] < NGAN_GIAY]
    day = collections.Counter()
    for x in gom:
        day['so_ngan'] += x['so_ngan']
        day['so_dai'] += x['so_dai']
    print('bên này  : %3d lần < 1 phút · %3d lần >= 1 phút' % (day['so_ngan'], day['so_dai']))
    print('va-mau   : %3d lần < 1 phút · %3d lần >= 1 phút'
          % (len(vm_ngan), len(xong) - len(vm_ngan)))
    print('(va-mau bỏ qua lần dừng chỉ hiện ra trong đúng một nhịp đo, và tính thêm ~2 giây tới '
          'khung máy chạy lại — nên hai cột không bằng nhau tuyệt đối là ĐÚNG.)')


# --------------------------------------------------------------------------- chạy
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tu-kiem', action='store_true')
    ap.add_argument('--lich-su', type=int, metavar='N',
                    help='đọc N dòng cuối của broker.log rồi thôi')
    ap.add_argument('--tep', nargs='+', metavar='TEP',
                    help='đọc trọn các file này theo thứ tự (nhận cả .gz)')
    ap.add_argument('--tom-tat', action='store_true', help='in bảng gộp thay vì từng dòng JSON')
    ap.add_argument('--doi-chieu', action='store_true', help='so số lần dừng với va-mau')
    ap.add_argument('--bu', action='store_true',
                    help='nối phần cũ vào %s, chỉ những dòng SỚM HƠN dòng đầu đã có' % RA_TEP)
    a = ap.parse_args()

    if a.tu_kiem:
        return tu_kiem()

    ten_may = doc_ten_may()
    dem = Dem(ten_may=ten_may)

    if a.lich_su or a.tep or a.bu:
        gom = []
        if a.tep:
            for p in a.tep:
                with mo_tep(p) as f:
                    for d in f:
                        nap(dem, d, gom.append)
        else:
            n = a.lich_su or 400000
            duoi = subprocess.run(['tail', '-n', str(n), LOG],
                                  capture_output=True, text=True).stdout
            for d in duoi.splitlines():
                nap(dem, d, gom.append)
        gom += dem.chot(het=True)
        if a.bu:
            try:
                dau = json.loads(io.open(RA_TEP, encoding='utf-8').readline())['at']
            except (OSError, ValueError, KeyError):
                print('chưa có dòng nào trong %s — chạy bộ đếm sống trước đã' % RA_TEP)
                return 1
            cu = [x for x in gom if x['at'] < dau]
            with io.open(RA_TEP, 'a', encoding='utf-8') as f:
                for x in cu:
                    f.write(json.dumps(x, ensure_ascii=False) + '\n')
            print('mốc cắt: %s · đã bù %d dòng (%d dòng đọc được, %d bị bỏ vì tới muộn)'
                  % (dau, len(cu), len(gom), dem.muon))
            return 0
        if a.tom_tat:
            tom_tat(gom, ten_may)
            if dem.muon:
                print('⚠ %d khoảng tới sau khi phút của nó đã chốt — tăng TRE_GIAY' % dem.muon)
            if a.doi_chieu:
                print()
                doi_chieu(gom, a.lich_su or 400000)
        else:
            for x in gom:
                print(json.dumps(x, ensure_ascii=False))
        return 0

    # chạy sống
    p = subprocess.Popen(['tail', '-n', '0', '-F', LOG], stdout=subprocess.PIPE, text=True)
    muon = 0
    for d in p.stdout:
        nap(dem, d, lambda x: (sys.stdout.write(json.dumps(x, ensure_ascii=False) + '\n'),
                               sys.stdout.flush()))
        # Khoảng tới sau khi phút của nó đã chốt = số liệu bị vứt IM LẶNG. Phải kêu ra stderr,
        # không thì bảng thiếu giây mà không ai biết. Chữa bằng cách tăng TRE_GIAY.
        if dem.muon > muon:
            muon = dem.muon
            sys.stderr.write('[TRE] %d khoang toi muon — tang TRE_GIAY (dang %d giay)\n'
                             % (muon, dem.tre))
            sys.stderr.flush()
    return 0


if __name__ == '__main__':
    sys.exit(main())
