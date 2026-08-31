#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Đẩy TÌNH TRẠNG MÁY (thứ trang `xem/` hiển thị) vào Loki, để Grafana đọc được cùng con số.

VÌ SAO CẦN CÁI NÀY

Grafana đọc `broker.log` — log thô của broker. Trong đó chỉ có mã trạng thái máy tự khai
(`state=0/2/15/-1`) và số mũi. Nó KHÔNG có: máy còn kết nối không, bridge có đọc nổi máy không,
có cảnh báo nặng nào không, mẫu đã thêu xong hay đang dở. Trang `test.phonh.io.vn` biết mấy thứ đó
vì nó gọi `/api/v2/fleet` của bridge — nơi đã tính sẵn.

Nên "Grafana hiện đang chạy / lỗi giống trang xem" không sửa được bằng cách viết truy vấn LogQL khéo
hơn. Thiếu dữ liệu thì truy vấn nào cũng chịu. Cách đúng là mang chính kết quả bridge đã tính vào
Loki, rồi Grafana chỉ việc đếm. Một nguồn sự thật, hai màn hình — không phải hai bộ logic tự lệch
nhau sau vài tuần.

BẢN CHÉP LẠI CỦA `tinhTrang()`

Hàm `tinh_trang()` dưới đây là bản chép **nguyên luật** từ `xem/index.html` (hàm `tinhTrang`,
`trangThai`, `jobCua`, bảng `KHOP_MOC`). Đây là chỗ dễ lệch nhất về sau: **sửa một bên phải sửa bên
kia**. Đã để `KIEM_TRA_LUAT` ở cuối file làm bộ ca thử, chạy `--tu-kiem` là biết bản chép còn khớp
với những gì đã thống nhất hay không.

Luật, viết lại cho người đọc:

  - máy không `online`/`stale`  → `off`   (mất kết nối thì trạng thái cũ không còn là câu trả lời)
  - bridge đọc máy không nổi     → `loi`
  - trạng thái thô là `fault`    → `loi`
  - có cảnh báo mức `critical`   → `loi`
  - trạng thái thô `running`     → `chay`
  - không phải `stopped/paused`  → `chuaro`  (KHÔNG suy thành "dừng" — nói hộ máy là sai)
  - mũi hiện tại ≥ tổng mũi      → `hoanthanh`
  - mũi hiện tại > 0             → `dung`    (dừng khi mẫu còn dở — thứ đáng đứng dậy đi xem)
  - còn lại                      → `cho`

MỘT ĐIỀU PHẢI NÓI THẲNG: `loi` Ở ĐÂY KHÔNG PHẢI MÃ LỖI CỦA MÁY

Đã soi 224 016 khung trạng thái thật trong `catalog.json`: khung của máy A15 chỉ có đúng 8 trường
(`mesgNo`, `version`, `state`, `machineName`, `patternName`, `curStitch`, `patternStitch`,
`patternNetID`) và 4 giá trị `state` (`-1`, `0`, `2`, `15`). **Không có trường nào là mã lỗi, cũng
không có trường mô tả lỗi.** Máy đứt chỉ hay gãy kim thì báo trên màn hình HMI của nó, chứ không
đẩy lý do ra mạng. Nên `loi` ở đây nghĩa là "đường đo có vấn đề / bridge tự thấy bất thường", còn
"máy hỏng vì cái gì" thì phải đọc trên HMI hoặc nhập tay.

BÁO LỖI: TRƯỚC 27/08 Ô "LỖI" KHÔNG THỂ KHÁC 0, VÀ MỌI CẢNH BÁO ĐỀU BỊ NUỐT

Đây là chỗ vá ngày 27/08. Ba sự thật đo được, cái nào cũng đủ để một mình làm ô "Lỗi" chết cứng:

  1. `state_to_status()` bên `broker.py` chỉ trả `running` / `stopped` / `unknown` — **không đường
     nào trả `fault`**. Nhánh `t == 'fault'` dưới kia là mã chết, giữ lại chỉ để phòng adapter khác.
  2. `controller_state_event()` cố ý đặt `severity: 'info'`, mà `alerts.mjs` bỏ qua đúng mức ấy.
     `maintenance` rỗng ở cả 13 máy, `threadBreakWarnPer1000` để `null`. ⇒ **`deriveAlerts()` không
     có đường nào sinh ra `critical`.**
  3. `telemetryError` là `null` ở cả 13 máy.

Ba cái cộng lại: `tinh_trang()` **chưa từng và không thể** trả `loi`. Đo 24 giờ: `loi` = 0/3600 mẫu.
Trong khi đó bridge ĐANG giữ 5 cảnh báo `warning` có câu chữ đầy đủ ("Máy C54F54: đã dừng 26 phút.",
"Host còn phản hồi cổng TCP nhưng adapter ngừng trả dữ liệu hợp lệ 3715s.") mà không câu nào lên tới
màn hình. Xưởng nhìn thấy số 0 và tin là không có gì.

Nên từ 27/08 mỗi dòng mang thêm một **mức** tách hẳn khỏi tình trạng, kèm **nguyên văn câu chữ** và
**ai là người nói ra câu đó**:

    muc 0 thường · muc 1 cảnh báo · muc 2 lỗi
    loi_text  — nguyên văn của bridge, KHÔNG viết lại
    loi_nguon — controller (máy tự khai) / sensor / bridge (bridge suy ra) / dashboard (sổ sách)
    loi_do    — mã ngắn để đếm, loi_so — còn mấy cảnh báo đang mở

`loi_nguon` là chỗ phải giữ cho thẳng: `alerts.mjs` đã cố ý phân biệt lời máy tự khai với phán đoán
của bridge, vì *"in nhãn 'Controller báo' lên phán đoán đó là bảo thợ rằng máy đã tự khai, và thợ sẽ
mở máy tìm một lỗi mà controller chưa hề báo"*. Chép sang đây thì phải chép cả ý đó.

Ô "MÁY OFF" CŨNG CHƯA TỪNG NÓI ĐÚNG

Đo 24 giờ: `off` xảy ra 185 lượt, **cả 185 đều là `ket_noi='unknown'`, không lượt nào `offline`**.
Tức mã 2 xưa nay chưa một lần nghĩa là "máy tắt" — nó luôn nghĩa là *bridge mất số liệu sống của máy
này, mà host thì vẫn phản hồi*. Hai chuyện khác hẳn nhau ngoài xưởng: một cái đi bật máy, một cái đi
cắm lại dây. Nên mã 2 giữ nguyên số (đổi số là làm sai cả lịch sử đã nằm trong Loki) nhưng **gọi
đúng tên là "mất tín hiệu"**, và thêm mã 7 `tat-han` cho trường hợp `offline` thật — trường hợp chưa
xảy ra lần nào, nên không có lịch sử nào bị gán sai.

NGOÀI GIỜ LÀM, MÁY IM LÀ CHUYỆN BÌNH THƯỜNG (27/08)

Mã 2 tên là "mất tín hiệu" — đúng trong giờ làm, nhưng 7 giờ tối tới 6 giờ sáng thì cả xưởng rút
điện, và một bảng bôi đỏ 13 máy suốt đêm dạy người ta bỏ qua màu đỏ. Nên thêm mã 8 `ngoai-gio`.

Chỗ này KHÔNG được đoán bằng mỗi cái đồng hồ, nên có hai căn cứ đo được:

  1. **Máy A15 cắm điện thì nói 24/24, kể cả khi rảnh.** Đo trên `602602704E7B` (`mch-a15-mqtt`):
     1 799 khung/giờ, mọi giờ, suốt 25→27/08, nội dung `cur=0 tot=0 pat=` — không mẫu, không mũi,
     vẫn đẩy khung mỗi 2 giây. ⇒ Máy im **không bao giờ** nghĩa là "máy rảnh"; nó nghĩa là mất
     điện hoặc mất mạng. Đó là lý do được phép suy "im + ngoài giờ = đã tắt máy".
  2. **Vách giờ đo được**, đếm số máy phát khung theo giờ VN ngày 27/08:
     00–06h: 1 máy · 07h: 5 · 08–17h: 11–14 · 18h: 12 (nửa giờ đầu) · 19–23h: 1.
     Cửa mặc định để **06:00–19:00** chứ không phải 08:00–18:00 mà xưởng nói: rộng hơn thực tế
     một tiếng mỗi đầu, để nếu có sai thì sai về phía *báo thừa* chứ không phải *giấu*.

Đổi khung giờ bằng biến môi trường `GIO_LAM` (ví dụ `GIO_LAM=08:00-18:00`), ngày nghỉ bằng
`NGAY_NGHI` (`0`=Thứ Hai … `6`=Chủ Nhật, ví dụ `NGAY_NGHI=6`). Mặc định làm cả tuần.

LUẬT: **đồng hồ chỉ được nói khi máy đã im.** Máy còn `online`/`stale` thì trạng thái thật luôn
thắng — ca đêm chạy tới 2 giờ sáng vẫn hiện `chay`, không có chuyện đồng hồ đè lên số liệu sống.

CÒN MỘT CHỖ ĐỒNG HỒ KHÔNG CỨU ĐƯỢC, PHẢI NÓI THẲNG: nếu broker chết lúc 2 giờ sáng thì mọi máy
cũng im, và dòng này sẽ ghi `ngoai-gio` — y hệt lúc xưởng tắt máy thật. Đồng hồ không phân biệt
được hai cái đó, chỉ có **Last Will** của chính máy mới phân biệt được (máy tự báo chết ⇒ im mà
không có Will nghĩa là đường đo đứt). Kênh đó firmware A15 CÓ khai mà broker đang vứt; chừng nào
chưa nối thì đây là giới hạn thật của con số này, đừng bán nó như thứ nó không phải.

Mỗi dòng vì thế mang thêm `tinh_trang_tho`/`ma_tho` (trạng thái nếu coi như đang trong giờ),
`trong_gio`, và `nguon_tt` (`may-day` = máy khai · `suy-luan` = đồng hồ/bridge suy ra) — đội nhận
mã đọc một dòng là biết ngay con số nào do máy nói, con số nào do mình đoán.

GHI GÌ, GHI KHI NÀO

Mỗi máy một dòng JSON. Chỉ ghi khi **tình trạng đổi**, cộng thêm một nhịp tim mỗi 20 giây để Grafana
luôn có điểm mới trong cửa sổ ngắn. Ghi mọi vòng lặp thì mỗi ngày vài trăm nghìn dòng mà không thêm
thông tin gì.

GHI RA ĐÂU: **stdout**, để launchd hứng vào `logs/tinh-trang.out`. Không tự mở file, không tự cắt
file. Lý do: `com.dahao.xoaylog` đã xoay sẵn mọi `logs/*.out` bằng lối chép-rồi-cắt-tại-chỗ — lối
duy nhất đã chứng minh là an toàn với fd `O_APPEND` của launchd. Tự viết vòng xoay thứ hai cho
riêng file này là thêm một chỗ để sai, trong khi cái có sẵn dùng được ngay.

Không in token ra bất cứ đâu; đọc từ biến môi trường do `chay-tinh-trang.sh` nạp vào.
"""
import calendar
import json
import os
import sys
import time
import urllib.error
import urllib.request

URL = os.environ.get('FLEET_URL', 'http://100.107.219.95:8790/api/v2/fleet')
NHIP = float(os.environ.get('NHIP_GIAY', '2'))
NHIP_TIM = float(os.environ.get('NHIP_TIM_GIAY', '20'))


def _doc_gio_lam(s):
    """`"06:00-19:00"` → `(360, 1140)` tính bằng phút kể từ nửa đêm giờ VN.

    Ném ngay tại đây nếu viết sai, chứ đừng lặng lẽ lùi về mặc định: một biến môi trường gõ nhầm
    mà chương trình vẫn chạy ngon là kiểu hỏng không ai phát hiện ra trong nhiều tháng.
    """
    a, b = s.split('-')
    def phut(x):
        h, m = x.strip().split(':')
        return int(h) * 60 + int(m)
    return phut(a), phut(b)


# Giờ Việt Nam = UTC+7. Mini chạy ở UTC-7 nên TUYỆT ĐỐI không được dùng `localtime` — lệch 14 tiếng
# là đúng nửa ngày, ban ngày thành ban đêm và ngược lại. Cộng thẳng vào epoch rồi đọc bằng `gmtime`.
LECH_VN_GIAY = int(os.environ.get('LECH_MUI_GIO_GIAY', str(7 * 3600)))
GIO_LAM = _doc_gio_lam(os.environ.get('GIO_LAM', '06:00-19:00'))
# `0` = Thứ Hai … `6` = Chủ Nhật (đúng quy ước `tm_wday` của Python). Mặc định RỖNG = làm cả tuần:
# chưa đo được ngày nghỉ của xưởng, mà đoán bừa Chủ Nhật nghỉ thì một sự cố sáng Chủ Nhật sẽ bị
# nuốt trọn. Rỗng thì lỗi về phía báo thừa — đúng hướng đã chọn ở đầu file.
NGAY_NGHI = {int(x) for x in os.environ.get('NGAY_NGHI', '').replace(',', ' ').split()}

# `statusSince` của bridge nói về trạng thái THÔ. Chỉ được mượn nó làm mốc khi nó đang nói về đúng
# tình trạng đang hiện — không thì con số là đồng hồ của một chuyện khác. Chép từ `KHOP_MOC` bên JS.
# Grafana không lọc được theo "nhãn mới nhất" — muốn đếm "mấy máy đang chạy ngay lúc này" thì phải
# có một con SỐ để `unwrap … | last_over_time`. Nên mỗi tình trạng mang thêm một mã.
# Thứ tự lấy đúng thứ tự sắp xếp của trang `xem/` (nặng trước, nhẹ sau) để hai bên đọc cùng một
# bảng — đổi số ở đây là phải đổi cả `mappings` trong JSON bảng Grafana.
# `off` = 2 GIỮ NGUYÊN SỐ dù tên hiển thị đổi thành "mất tín hiệu": 185 điểm lịch sử trong Loki đã
# mang số 2, đánh số lại là làm sai ngược cả quá khứ. `tat-han` = 7 nối vào đuôi, không chen giữa.
# `ngoai-gio` = 8 nối vào đuôi cùng lý do như `tat-han` = 7: đánh số lại là làm sai ngược cả lịch
# sử đã nằm trong Loki.
# `cum-im` = 9 và `tat-may` = 10 (28/08) cũng nối đuôi, cùng một lý do.
MA_TT = {'loi': 0, 'dung': 1, 'off': 2, 'chuaro': 3, 'hoanthanh': 4, 'cho': 5, 'chay': 6,
         'tat-han': 7, 'ngoai-gio': 8, 'cum-im': 9, 'tat-may': 10}

# Số máy tối thiểu trong đàn để "cả đàn cùng im" được coi là bằng chứng. Một máy im một mình thì
# không có ai làm chứng — nói gì cũng là đoán, nên phải đủ hai máy trở lên mới dám kết luận.
CUM_TOI_THIEU = int(os.environ.get('CUM_TOI_THIEU', '2'))

# Mức nặng-nhẹ, TÁCH HẲN khỏi tình trạng. Một máy đang thêu ngon vẫn có thể đang có cảnh báo, và
# một máy `hoanthanh` để đó 26 phút cũng đáng gọi người — `tinh_trang` một mình không nói được.
MA_MUC = {'thuong': 0, 'canh-bao': 1, 'loi': 2}

KHOP_MOC = {
    'chay': ('running',),
    'dung': ('stopped', 'paused'),
    'hoanthanh': ('stopped', 'paused'),
    'cho': ('stopped', 'paused'),
    'loi': ('fault',),
    'chuaro': ('unknown',),
}


def _g(o, *duong):
    """Lấy sâu trong dict mà không nổ khi giữa đường gặp None."""
    for k in duong:
        if not isinstance(o, dict):
            return None
        o = o.get(k)
    return o


def trang_thai_tho(m):
    k = _g(m, 'connection', 'state')
    if k in ('online', 'stale'):
        return _g(m, 'telemetry', 'status', 'value') or 'unknown'
    return 'unknown'


def job_cua(m):
    return _g(m, 'telemetry', 'job', 'value') or None


# --------------------------------------------------------------------------- sổ nhớ số mũi
NHO_VIEC = os.environ.get(
    'NHO_VIEC', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'nho-viec.json'))
NHO_GIAN = float(os.environ.get('NHO_GIAN_GIAY', '60'))


class SoNhoViec:
    """Nhớ ra ĐĨA số mũi đọc được lần cuối của từng máy.

    VÌ SAO CẦN. Thứ duy nhất tách được "thợ tắt máy" khỏi "mất tín hiệu" là số mũi của lần đọc
    cuối. Số ấy nằm trong RAM của bridge (`bridge-service.mjs:68`, `new Map()`, không đọc lại từ
    đĩa) nên bridge khởi động lại là sạch trơn. Đo thật lúc 16:42 ngày 28/08, ngay sau khi bridge
    khởi động lại vì xưởng cúp điện: **4/4 máy đang im không còn một số mũi nào** — tức là đúng
    lúc cần phân biệt nhất thì lại mù nhất. Phát lại lịch sử cửa sổ ấy: có sổ này thì `tat-may`
    đọc ra 104 lượt thay vì 56.

    CHỈ GHI LỜI MÁY KHAI. `ghi()` bỏ qua mọi lần đọc không ra số dùng được, nên trong sổ không bao
    giờ có phán đoán của mình — chỉ có thứ máy đã thật sự nói, kèm giờ nó nói.

    KHÔNG TỰ VỨT MỤC CŨ. Một máy tắt ba ngày thì việc "ba ngày trước nó thêu xong tấm rồi mới im"
    vẫn là bằng chứng đúng y như lúc mới xảy ra. Cũ hay không để người đọc tự cân — mỗi dòng log
    đều mang `dang_do_luc`.

    KHÔNG ĐƯỢC LÀM CHẾT BỘ ĐẨY. Sổ này là thứ làm tốt thêm, không phải thứ chịu lực: đĩa hỏng,
    file rách, thư mục không ghi được — tất cả đều tụt về "không nhớ gì" chứ không ném lỗi lên.
    """

    def __init__(self, duong=None):
        self.duong = duong or NHO_VIEC
        self.may = {}
        self.ban = False        # có gì mới chưa lưu chưa
        self.lan_luu = 0.0
        self.tat = False        # đĩa không ghi được thì thôi, chạy bằng RAM
        try:
            with open(self.duong, 'r') as f:
                d = json.load(f)
            if isinstance(d, dict) and isinstance(d.get('may'), dict):
                for k, v in d['may'].items():
                    if isinstance(v, dict) and isinstance(v.get('tong'), (int, float)):
                        self.may[k] = v
        except Exception:
            pass                # chưa có sổ, hoặc sổ rách — bắt đầu lại từ trắng, không kêu

    def ghi(self, ma, m):
        """Chép lại số mũi máy VỪA khai. Không khai được thì không đụng vào mục cũ."""
        j = job_cua(m) or {}
        cur, tot = j.get('currentStitch'), j.get('totalStitches')
        if not isinstance(tot, (int, float)) or not isinstance(cur, (int, float)) or tot <= 0:
            return
        cu = self.may.get(ma)
        moi = {'mui': cur, 'tong': tot,
               'at': _g(m, 'telemetry', 'observedAt') or _g(m, 'telemetry', 'receivedAt'),
               'mau': j.get('fileName')}
        if cu != moi:
            self.may[ma] = moi
            self.ban = True

    def doc(self, ma):
        return self.may.get(ma)

    def luu(self, gio=None, ep=False):
        """Ghi xuống đĩa. Ghi ra file tạm rồi đổi tên: cúp điện giữa chừng thì sổ cũ vẫn nguyên
        vẹn chứ không thành file cụt — đúng cái tình huống mà sổ này sinh ra để chịu."""
        gio = time.time() if gio is None else gio
        if self.tat or not self.ban:
            return False
        if not ep and gio - self.lan_luu < NHO_GIAN:
            return False
        tam = self.duong + '.tam'
        try:
            with open(tam, 'w') as f:
                json.dump({'phien_ban': 1, 'luu_luc': time.strftime(
                    '%Y-%m-%dT%H:%M:%SZ', time.gmtime(gio)), 'may': self.may},
                    f, ensure_ascii=False)
            os.replace(tam, self.duong)
        except Exception:
            self.tat = True     # một lần hỏng là thôi, đừng thử lại mỗi 2 giây suốt đêm
            return False
        self.ban = False
        self.lan_luu = gio
        return True


def _dang_do_tu_so(cur, tot):
    """Luật gốc, tách riêng để lời máy khai lúc này và lời nhớ trong sổ đi qua ĐÚNG MỘT bộ luật."""
    if not isinstance(tot, (int, float)) or not isinstance(cur, (int, float)) or tot <= 0:
        return None
    if cur >= tot:
        return False            # thêu xong tấm rồi mới im — tắt máy có chủ ý
    if cur <= 0:
        return False            # chưa động vào mẫu nào — cũng là tắt máy có chủ ý
    return True                 # im giữa lúc mẫu còn dở — đây mới là chuyện đáng gọi người


def dang_do_kem_nho(m, ma=None, so=None):
    """Trả `(dang_do, nguon, luc)`. `nguon`: `song` = số máy đang khai · `nho` = lấy trong sổ đĩa
    · `None` = không có gì để nói. `luc` chỉ có khi lấy từ sổ, để người đọc tự cân số ấy cũ tới đâu.

    Xuất xứ phải đi kèm giá trị, không được để trống — cùng một kỷ luật với cột `nguon` của sổ lần
    lỗi. Một kết luận "thợ tắt máy" dựa trên số của ba ngày trước và một kết luận dựa trên số của
    hai giây trước không phải cùng một thứ, dù chữ in ra giống hệt nhau.
    """
    x = viec_dang_do(m)
    if x is not None:
        return x, 'song', None
    if so is None or ma is None:
        return None, None, None
    v = so.doc(ma)
    if not v:
        return None, None, None
    return _dang_do_tu_so(v.get('mui'), v.get('tong')), 'nho', v.get('at')


def trong_gio_lam(gio=None):
    """Thời điểm này có nằm trong giờ xưởng chạy không (giờ VN)."""
    vn = time.gmtime((time.time() if gio is None else gio) + LECH_VN_GIAY)
    if vn.tm_wday in NGAY_NGHI:
        return False
    phut = vn.tm_hour * 60 + vn.tm_min
    bd, kt = GIO_LAM
    # Cửa vắt qua nửa đêm (ví dụ `22:00-06:00` cho ca đêm) thì đảo phép so, đừng trả False cả ngày.
    return bd <= phut < kt if bd <= kt else (phut >= bd or phut < kt)


def khao_sat(ds):
    """Đếm CẢ ĐÀN một lượt trước khi phán từng máy. Trả `{'noi':…, 'im':…, 'tong':…}`.

    Đây là thứ thay cho đồng hồ. Đồng hồ chỉ biết mấy giờ; các máy khác biết chuyện gì đang xảy ra.
    Một máy im mà 12 máy bên cạnh vẫn nói thì đúng là chuyện của riêng nó; cả 13 cùng im trong một
    nhịp thì không đời nào là 13 cái máy cùng hỏng một lúc — là mất điện, mất mạng, hoặc chính bộ
    ghi này hỏng. Hai chuyện ấy phải ra hai chữ khác nhau.

    Không tốn thêm nguồn dữ liệu nào: `vong()` vốn đã cầm nguyên ảnh chụp `/api/v2/fleet` gồm mọi
    máy, chỉ là trước nay đem xét từng con một rồi vứt phần còn lại đi.
    """
    noi = im = 0
    for m in (ds or []):
        if _g(m, 'connection', 'state') in ('online', 'stale'):
            noi += 1
        else:
            im += 1
    return {'noi': noi, 'im': im, 'tong': noi + im}


def viec_dang_do(m):
    """Lúc máy này còn nói thì nó đang làm dở hay đã xong? `True` dở · `False` xong/chưa nạp mẫu
    · `None` không đủ số để nói.

    Bridge giữ nguyên `telemetry.job` của lần đọc CUỐI kể cả khi máy đã mất kết nối. Không phải suy
    đoán: `bridge-service.mjs:224` trả thẳng `this.telemetry.get(record.id)`, tính hoàn toàn tách
    khỏi `connection.state` — không nhánh nào xoá số liệu cũ khi máy im. (Khớp với lần đo trên
    `3CE4B0C54F54` lúc `ket_noi=unknown`: vẫn còn `mui=35816 tong=35816 mau=...`.) Nên không cần
    thêm trường mới nào ở bridge, cũng không cần bộ nhớ sống qua lần khởi động lại của bộ đẩy này.

    ⚠ NHƯNG bộ nhớ ấy là của BRIDGE và chỉ nằm trong RAM: `this.telemetry = new Map()` ở
    `bridge-service.mjs:68`, không hề đọc lại từ đĩa. Bridge khởi động lại là sạch trơn — **đã đo
    thật lúc 16:42 ngày 28/08, ngay sau lần cúp điện: 4/4 máy đang im không còn một số mũi nào.**
    Đó chính là lý do có `SoNhoViec` phía trên. Hàm này cố ý CHỈ nhìn lời máy đang khai; phần vá
    lỗ nằm ở `dang_do_kem_nho()`, tách hẳn ra để luật gốc còn thử được một mình.

    ⚠ `None` KHÔNG được quy về "chắc thợ tắt máy". Không biết thì phải nói là không biết —
    chỗ gọi bên dưới cố ý chỉ dám kết luận `tat-may` khi có bằng chứng dương.
    """
    j = job_cua(m) or {}
    return _dang_do_tu_so(j.get('currentStitch'), j.get('totalStitches'))


TU_TINH = object()      # "chưa ai đưa `dang_do` sẵn, tự tính lấy" — khác hẳn `None` = "đã tính, và
                        # câu trả lời là KHÔNG BIẾT". Dùng `None` làm mặc định thì hai nghĩa ấy lẫn
                        # vào nhau, và chỗ gọi không truyền được kết quả "không biết" xuống nữa.


def tinh_trang(m, trong_gio=True, dan=None, dd=TU_TINH):
    kn = _g(m, 'connection', 'state') or 'unknown'
    if kn not in ('online', 'stale'):
        # ---- THANG BẰNG CHỨNG (28/08). Máy A15 cắm điện thì đẩy khung mỗi 2 giây kể cả lúc rảnh
        # (đo trên `602602704E7B`: 1 799 khung/giờ suốt đêm, `cur=0 tot=0 pat=`). Nên im lặng
        # KHÔNG BAO GIỜ nghĩa là "máy rảnh" — nó nghĩa là mất điện hoặc mất mạng, và việc còn lại
        # là tách cho được: THỢ TẮT MÁY hay ĐƯỜNG ĐO ĐỨT. Xét từ bằng chứng chắc nhất xuống.
        #
        # Đồng hồ chỉ được nói ở đúng nhánh này, tức là SAU khi máy đã thôi phát; máy còn
        # `online`/`stale` thì trạng thái thật luôn thắng (ca đêm vẫn ra `chay`).
        if not trong_gio:
            return 'ngoai-gio'
        # (1) Không còn MỘT máy nào trong đàn đang nói ⇒ không thể quy cho máy nào cả. Mất điện
        #     cả xưởng, đứt mạng, hoặc chính broker/bộ ghi này chết — ba cái nhìn từ đây giống hệt
        #     nhau, nên đặt cho nó một chữ nói đúng cái mình biết chứ đừng bịa ra 13 lần "máy hỏng".
        #     Chỉ dám kết luận khi `noi == 0`: mọi ngưỡng kiểu "quá nửa số máy" đều là con số bịa,
        #     dữ liệu xưởng chưa đỡ nổi. Muốn tính theo tỉ lệ thì đã có sẵn `dan_*` trên mỗi dòng.
        if dan and dan.get('tong', 0) >= CUM_TOI_THIEU and dan.get('noi', 0) == 0:
            return 'cum-im'
        # (2) `offline` = bridge gọi mà host không nhấc máy → máy tắt hẳn / rút dây / mất điện.
        #     Lời của bridge mạnh hơn mọi suy luận của mình nên xét trước. (`freshness.mjs:67`.)
        if kn == 'offline':
            return 'tat-han'
        # (3) Một mình nó im trong khi các máy khác vẫn nói ⇒ chuyện của riêng nó. Tách tiếp bằng
        #     việc nó đang làm dở: xong tấm rồi mới im là thợ tắt máy (nghỉ trưa, hết việc, về);
        #     im giữa lúc mẫu còn dở mới là MẤT TÍN HIỆU thật. Không biết thì vẫn để `off` —
        #     "chưa đọc được" là câu trả lời thật thà, còn đoán bừa là thợ tắt máy thì có ngày
        #     giấu mất một cái máy chết giữa tấm hàng.
        return 'tat-may' if (viec_dang_do(m) if dd is TU_TINH else dd) is False else 'off'
    if m.get('telemetryError'):
        return 'loi'
    t = trang_thai_tho(m)
    if t == 'fault':
        return 'loi'
    for a in (m.get('derivedAlerts') or []):
        if isinstance(a, dict) and a.get('severity') == 'critical':
            return 'loi'
    if t == 'running':
        return 'chay'
    if t not in ('stopped', 'paused'):
        return 'chuaro'
    j = job_cua(m) or {}
    cur = j.get('currentStitch')
    tot = j.get('totalStitches')
    if isinstance(tot, (int, float)) and tot > 0 and isinstance(cur, (int, float)):
        if cur >= tot:
            return 'hoanthanh'
        if cur > 0:
            return 'dung'
    return 'cho'


# --------------------------------------------------------------------------------------- báo lỗi
TEN_MUC = {v: k for k, v in MA_MUC.items()}


def _cau(a):
    """Ghép `title` + `detail` của một cảnh báo thành một câu đọc được, bỏ chỗ trống."""
    p = [str(a.get(k) or '').strip() for k in ('title', 'detail')]
    return ' — '.join(x for x in p if x)[:400]


def _ly_do_kn(m):
    return str(_g(m, 'connection', 'reason') or '').strip()[:400]


def _canh_bao(m):
    """Gộp `alerts` (đã ghi sổ) với `derivedAlerts` (bridge tính tại chỗ), bỏ cái đã xác nhận.

    Đọc cả hai vì chúng là hai đường khác nhau: `alerts` sống qua nhiều vòng và có thể được thợ
    bấm xác nhận, `derivedAlerts` bridge tính lại mỗi lần trả lời. Chỉ đọc một bên là mất nửa số
    cảnh báo mà không có gì báo là đang mất.
    """
    ra = []
    for ten in ('alerts', 'derivedAlerts'):
        for a in (m.get(ten) or []):
            if isinstance(a, dict) and not a.get('acknowledged'):
                ra.append(a)
    return ra


def bao_loi(m, tt, dan=None, dd=TU_TINH, nho=None):
    """Trả `(muc, do, text, nguon, so)` — bất thường gì, AI nói ra, và NGUYÊN VĂN câu ấy.

    Xét nặng dần từ trên xuống, lấy cái nặng nhất làm câu hiển thị; `so` nói phía sau còn mấy cái
    nữa để không ai tưởng chỉ có đúng một.

    `nguon` giữ nguyên chữ của bridge (`controller` / `sensor` / `bridge` / `dashboard`) chứ không
    quy về một mối. `alerts.mjs` cố ý phân biệt lời máy tự khai với phán đoán của bridge; in nhãn
    "máy báo" lên một phán đoán là bảo thợ đi mở máy tìm cái lỗi mà controller chưa hề báo.

    Bình thường thì trả chuỗi rỗng, KHÔNG mượn `connection.reason` ("Telemetry mới 2s trước.") cho
    có chữ — nhét câu vô thưởng vô phạt vào cột lỗi là dạy người đọc bỏ qua cột lỗi.
    """
    ds = _canh_bao(m)
    so = len(ds)

    if tt == 'ngoai-gio':
        # Cả xưởng im sau 7 giờ tối là chuyện ĐÚNG như dự kiến, không phải bất thường ⇒ mức 0.
        # Đặt trước mọi nhánh khác một cách cố ý: `tinh_trang` chỉ trả `ngoai-gio` khi máy đã
        # thôi phản hồi, nên mọi câu chữ còn lại trong `m` đều là lời bình về một cái máy không
        # còn liên lạc — giữ chúng lại chỉ để lấp cột lỗi cho có chữ. Cái giá phải trả và đã
        # chấp nhận: broker chết lúc 3 giờ sáng cũng nằm im ở mức 0 (xem đầu file, phần Last Will).
        return 0, '', '', '', so

    if tt == 'tat-may':
        # Có BẰNG CHỨNG DƯƠNG là thợ tắt máy: nó im SAU khi đã thêu xong tấm (hoặc chưa nạp mẫu
        # nào), trong khi các máy khác vẫn đang nói. Nghỉ trưa, hết việc, đổi ca — không phải sự cố
        # ⇒ mức 0. Đây chính là chỗ chữa cái sai đã đo được: 12 giờ trưa có 46 % số lượt đo bị bôi
        # đỏ "mất tín hiệu" trong khi thợ chỉ đi ăn cơm.
        return 0, '', '', '', so

    if tt == 'cum-im':
        # CẢ ĐÀN cùng im. Vẫn phải kêu — mất điện lúc 10 giờ sáng là chuyện phải có người biết —
        # nhưng kêu MỘT tiếng ở mức 1, bằng một câu nói đúng phạm vi mình biết. Để mức 2 thì mỗi
        # lần cúp điện bảng "cần xử lý" đỏ rực 13 dòng "máy hỏng", và người ta sẽ thôi nhìn bảng.
        # KHÔNG chọn sẵn một nguyên nhân. Đo lần đầu nhãn này nổ thật (28/08, 17:29–17:36 VN):
        # 9 máy im rải trong BẢY PHÚT. Cúp điện thì 13 máy tắt cùng một giây; rải bảy phút
        # giống thợ tắt máy lần lượt rồi về hơn. Đường đo không tách được hai cái, nên câu
        # này chỉ được nói đúng cái nó biết: cả xưởng đang im.
        t = ('Cả %d máy cùng im — mất điện, đứt mạng, hết ca cùng tắt máy, hoặc chính bộ ghi '
             'hỏng. Chưa quy được cho máy nào.' % (dan.get('tong') if dan else 0))
        # `dashboard` chứ không phải `bridge`: câu này do chính bộ đẩy này suy ra từ việc so các
        # máy với nhau, bridge không hề nói thế. Dán nhãn `bridge` lên phán đoán của mình là bịa.
        return 1, 'ca-cum-im', t[:400], 'dashboard', so

    loi = m.get('telemetryError')
    if loi:
        # Trường này lúc là chuỗi lúc là vật thể tuỳ chỗ sinh ra nó (`xem/index.html:580` cũng
        # phải nhận cả hai) — ép về chuỗi ở đây chứ đừng để Grafana in ra `[object Object]`.
        t = loi if isinstance(loi, str) else (
            _g(loi, 'message') or _g(loi, 'code') or json.dumps(loi, ensure_ascii=False))
        return 2, 'bridge-khong-doc-duoc', ('Bridge không đọc được máy: %s' % t)[:400], 'bridge', so

    if trang_thai_tho(m) == 'fault':
        # Mã chết với adapter dial-in hiện nay — `state_to_status()` bên broker chỉ trả
        # running/stopped/unknown. Giữ lại cho adapter khác, đừng tưởng nhánh này đang chạy.
        return 2, 'may-bao-fault', 'Máy tự khai trạng thái hỏng.', 'controller', so

    for a in ds:
        if a.get('severity') == 'critical':
            return 2, str(a.get('kind') or 'canh-bao-nang')[:40], _cau(a), \
                str(a.get('source') or 'bridge')[:20], so

    if tt == 'off' and _g(m, 'connection', 'reachable') is True:
        # Chính nhánh `freshness.mjs:67`: host còn nhấc máy mà adapter thôi trả số liệu hợp lệ.
        # Máy đẩy khung mỗi 1-2 giây rồi im hàng nghìn giây ⇒ đường đo đứt thật, không phải nghi.
        return 2, 'adapter-cam', _ly_do_kn(m), 'bridge', so

    if tt == 'off' and (viec_dang_do(m) if dd is TU_TINH else dd) is True:
        # Máy im GIỮA LÚC mẫu còn dở, trong khi các máy khác vẫn đang nói. Đây mới đúng nghĩa
        # "mất tín hiệu" đáng gọi người: một tấm hàng đang thêu dở nằm đó mà không ai biết.
        # Trước 28/08 nhánh này lẫn với cả đống máy nghỉ trưa, nên nó chưa từng đáng tin.
        # Lấy số mũi để in ra câu: ưu tiên lời máy đang khai, hết mới đến sổ nhớ. Phải nói rõ
        # trong câu là số của lúc nào — người đọc cần biết "dở ở mũi 680" là chuyện hai giây
        # trước hay chuyện của hôm kia, vì hai cái ấy đòi hai cách xử lý khác nhau.
        j = job_cua(m) or {}
        cur, tot, khi = j.get('currentStitch'), j.get('totalStitches'), ''
        if not isinstance(tot, (int, float)) and nho:
            cur, tot = nho.get('mui'), nho.get('tong')
            khi = ' Số mũi là của lần đọc cuối lúc %s.' % (nho.get('at') or 'không rõ')
        t = ('Mất tín hiệu giữa lúc đang thêu dở (mũi %s/%s). Các máy khác vẫn gửi số liệu bình '
             'thường.%s' % (cur, tot, khi))
        return 2, 'mat-tin-hieu-dang-theu', t[:400], 'dashboard', so

    for a in ds:
        if a.get('severity') == 'warning':
            return 1, str(a.get('kind') or 'canh-bao')[:40], _cau(a), \
                str(a.get('source') or 'bridge')[:20], so

    if tt in ('off', 'tat-han'):
        # Còn lại của hai nhánh mất số liệu: chưa đủ căn cứ gọi là lỗi (máy tắt theo dõi trong
        # cấu hình bridge cũng rơi vào đây) nhưng vẫn phải nói ra lý do, đừng để trống.
        return 1, 'tat-han' if tt == 'tat-han' else 'chua-ket-luan', _ly_do_kn(m), 'bridge', so

    return 0, '', '', '', so


# --------------------------------------------------------------------------- bộ nhớ giữa hai vòng
mocs = {}     # may -> {'tt':…, 'luc':epoch, 'quan_sat':bool}  (quan_sat=True: tự mắt thấy lúc đổi)
lan_ghi = {}  # may -> epoch lần ghi gần nhất
loi_cu = {}   # may -> (muc, loi_do) lần trước, để cảnh báo mới được ghi ngay chứ không đợi nhịp tim
# Sổ này KHÁC ba cái trên ở đúng một chỗ, và đó là cả lý do nó tồn tại: nó sống qua lần khởi động
# lại. Ba cái trên mất là chỉ tiếc, sổ này mất là mù đúng lúc cúp điện — xem `SoNhoViec`.
so_nho = SoNhoViec()


def moc_cua(ma, tt, m, gio):
    """Trả `(tu_luc_iso_hoac_None, giay, xap_xi)` — bao lâu rồi máy ở tình trạng này."""
    ss_at = _g(m, 'statusSince', 'at')
    ss_tt = _g(m, 'statusSince', 'status')
    if ss_at and ss_tt in KHOP_MOC.get(tt, ()):
        try:
            # `timegm` chứ không phải `mktime`: chuỗi của bridge là giờ UTC, `mktime` lại hiểu theo
            # giờ máy — Mini đang ở UTC-7 nên nhầm là lệch bảy tiếng.
            t = calendar.timegm(time.strptime(ss_at[:19], '%Y-%m-%dT%H:%M:%S'))
            return ss_at, max(0.0, gio - t), bool(_g(m, 'statusSince', 'approximate'))
        except (ValueError, OverflowError):
            pass
    c = mocs.get(ma)
    if not c or c['tt'] != tt:
        return None, None, True
    return None, gio - c['luc'], not c['quan_sat']


def lay():
    r = urllib.request.Request(URL, headers={
        'Authorization': 'Bearer ' + os.environ['BRIDGE_TOKEN_VIEWER'],
        'Accept': 'application/json'})
    return json.load(urllib.request.urlopen(r, timeout=10))


def vong(f):
    gio = time.time()
    tg = trong_gio_lam(gio)
    d = lay()
    ds = d.get('machines') or []
    # Nhìn cả đàn MỘT lượt trước khi phán từng con. Phải làm ngoài vòng lặp: xét máy thứ nhất mà
    # đã cần biết máy thứ mười ba có đang nói không.
    dan = khao_sat(ds)
    ra = 0
    for m in ds:
        ma = _g(m, 'identity', 'assetTag') or _g(m, 'identity', 'serial') or _g(m, 'identity', 'id')
        if not ma:
            continue
        # Chép lời máy vừa khai vào sổ TRƯỚC khi phán, rồi mới hỏi sổ. Máy đang nói thì `ghi()`
        # vừa cập nhật xong; máy đang im thì `ghi()` không đụng gì và sổ trả lại lần đọc cuối.
        so_nho.ghi(ma, m)
        dd, dd_nguon, dd_luc = dang_do_kem_nho(m, ma, so_nho)
        tt = tinh_trang(m, tg, dan, dd)
        # Trạng thái NẾU coi như đang trong giờ — giữ lại nguyên vẹn thứ đồng hồ vừa che đi, để
        # đội sau muốn dựng lại con số theo khung giờ khác thì có đủ dữ kiện mà không phải chạy
        # lại lịch sử. Ngoài giờ mà `tho` là `off` hay `tat-han` cũng là một dữ kiện thật.
        tt_tho = tt if tg else tinh_trang(m, True, dan, dd)
        cu = mocs.get(ma)
        doi = (not cu) or cu['tt'] != tt
        if doi:
            # `quan_sat` False ở lần đầu gặp máy: lúc đó ta không thấy nó ĐỔI sang, chỉ thấy nó
            # đang ở đó. Con số "bao lâu" từ mốc ấy chỉ là cận dưới.
            mocs[ma] = {'tt': tt, 'luc': gio, 'quan_sat': cu is not None}
        muc, loi_do, loi_text, loi_nguon, loi_so = bao_loi(m, tt, dan, dd, so_nho.doc(ma))
        # Cảnh báo nổ mà tình trạng không đổi (máy vẫn `dung`, chỉ là vừa quá ngưỡng 5 phút) thì
        # luật cũ bắt đợi hết nhịp tim 20 giây mới ghi. Với một cột người ta nhìn để đi xử lý,
        # 20 giây im lặng là 20 giây sai. Nên coi mức-lỗi đổi cũng là một lần đổi.
        truoc = loi_cu.get(ma)
        # Lần đầu gặp một máy (bộ đẩy vừa khởi động lại) thì không có gì để so. Coi là "đổi" CHỈ
        # KHI máy đang thật sự có chuyện; nếu không thì mỗi lần restart, sổ báo lỗi lại nổ một
        # tràng "đã hết báo lỗi" cho cả 13 máy vốn chưa từng lỗi — đã cắn thật lúc lên bản này.
        doi_loi = (muc > 0) if truoc is None else (truoc != (muc, loi_do))
        loi_cu[ma] = (muc, loi_do)
        if not doi and not doi_loi and gio - lan_ghi.get(ma, 0) < NHIP_TIM:
            continue
        j = job_cua(m) or {}
        tu_luc, giay, xap_xi = moc_cua(ma, tt, m, gio)
        dong = {
            # `at` là giờ CỦA PHÉP ĐO, không phải giờ máy tự khai. Máy mất kết nối thì
            # `telemetry.observedAt` đứng lại một chỗ; lấy nó làm dấu giờ của dòng log thì dòng
            # "máy off" rơi tụt về quá khứ và biến mất khỏi mọi cửa sổ "bây giờ" — đúng lúc cần
            # nhìn thấy nó nhất. Giờ máy khai giữ riêng ở `do_luc`.
            'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(gio)),
            'do_luc': _g(m, 'telemetry', 'observedAt'),
            'may': ma,
            'ten': _g(m, 'identity', 'name') or ma,
            'khu': _g(m, 'identity', 'zone'),
            'tinh_trang': tt,
            'ma': MA_TT[tt],
            # --- xuất xứ của chính con số `tinh_trang` ở trên (27/08). Cùng bộ chữ với cột
            # `nguon` của sổ lần lỗi: `may-day` = máy khai qua khung telemetry · `suy-luan` =
            # bridge/đồng hồ suy ra từ chỗ máy THÔI khai. Một dòng đọc ra là biết ngay đang cầm
            # lời của máy hay lời phỏng đoán của mình — đừng bắt người sau đi đoán lại.
            'nguon_tt': 'may-day' if _g(m, 'connection', 'state') in ('online', 'stale')
                        else 'suy-luan',
            'trong_gio': tg,
            'tinh_trang_tho': tt_tho,
            'ma_tho': MA_TT[tt_tho],
            # --- BẰNG CHỨNG của lượt phán này (28/08): ngay lúc đo, cả đàn có mấy máy đang nói.
            # Ghi lên TỪNG dòng, cố ý, vì đây là thứ duy nhất tách được "thợ tắt máy" khỏi "mất
            # tín hiệu", và người đọc lại sổ sau này phải kiểm được kết luận chứ không phải tin.
            # Cũng để đội sau muốn dùng ngưỡng tỉ lệ khác (kiểu "quá nửa số máy im") thì tự dựng
            # lại được từ lịch sử, không phải xin phát lại.
            'dan_noi': dan['noi'],
            'dan_im': dan['im'],
            'dan_tong': dan['tong'],
            # Máy này lúc thôi phát đang thêu dở hay đã xong tấm. `None` = không đủ số để nói,
            # và lúc ấy khoá bị bỏ hẳn khỏi dòng (xem ghi chú `stage.json` phía dưới) — thiếu
            # khoá đọc ra là "chưa biết", đừng đọc thành "đã xong".
            'dang_do': dd,
            # Kết luận trên dựa vào số máy ĐANG khai (`song`) hay số nhớ trong sổ đĩa (`nho`), và
            # nếu là sổ thì số ấy đọc được lúc nào. Bắt buộc phải có: sau một lần cúp điện, mọi
            # kết luận về máy chưa bật lại đều là `nho` — người đọc phải thấy được điều đó chứ
            # đừng để chữ "thợ tắt máy" trông y hệt nhau ở hai độ tin cậy khác hẳn nhau.
            'dang_do_nguon': dd_nguon,
            'dang_do_luc': dd_luc,
            'tho': trang_thai_tho(m),
            'ket_noi': _g(m, 'connection', 'state'),
            'mui': j.get('currentStitch'),
            'tong': j.get('totalStitches'),
            'mau': j.get('fileName'),
            'tu_luc': tu_luc,
            'giay': None if giay is None else round(giay, 1),
            'xap_xi': xap_xi,
            'doi': doi,
            # --- báo lỗi (27/08). `muc` là SỐ để Grafana `unwrap` đếm được; ba trường chữ chỉ
            # ghi khi có thật, rỗng thì bỏ hẳn khoá (xem ghi chú `stage.json` ngay dưới).
            'muc': muc,
            'muc_ten': TEN_MUC[muc],
            # Cờ này để ô nhật ký lọc ra ĐÚNG lúc chuyển — vào lỗi và cả lúc hết lỗi. Không có
            # nó thì nhật ký là 20 giây một dòng lặp lại, đọc không ra chuyện gì đã xảy ra khi nào.
            'doi_loi': doi_loi,
            'loi_do': loi_do or None,
            'loi_text': loi_text or None,
            'loi_nguon': loi_nguon or None,
            'loi_so': loi_so,
        }
        # Bỏ hẳn khoá rỗng thay vì ghi `null`: `stage.json` bên Alloy gặp `null` thì đẩy chuỗi
        # rỗng vào metadata, rồi `unwrap` bên LogQL vấp phải chuỗi rỗng. Thiếu khoá thì cả hai
        # tầng đều bỏ qua gọn ghẽ.
        f.write(json.dumps({k: v for k, v in dong.items() if v is not None},
                           ensure_ascii=False) + '\n')
        lan_ghi[ma] = gio
        ra += 1
    f.flush()
    # Lưu ngoài vòng lặp và có giãn cách (mặc định 60 giây): sổ chỉ cần đủ mới để sống qua một lần
    # khởi động lại, không đáng để ghi đĩa 30 lần mỗi phút suốt ngày đêm.
    so_nho.luu(gio)
    return ra


# --------------------------------------------------------------------------- bộ ca tự kiểm
# Mỗi ca là `(ten, may, mong)`, `(ten, may, mong, trong_gio)` hoặc `(ten, may, mong, trong_gio, dan)`.
# Thiếu phần tử thứ tư nghĩa là ĐANG TRONG GIỜ LÀM; thiếu phần tử thứ năm nghĩa là KHÔNG BIẾT GÌ VỀ
# ĐÀN (`dan=None`) — cả hai mặc định giữ nguyên ý nghĩa của mọi ca viết trước, không phải sửa ca cũ.
KIEM_TRA_LUAT = [
    ('offline -> tat han (may thuc su tat)',
     {'connection': {'state': 'offline'}, 'telemetry': {'status': {'value': 'running'}}}, 'tat-han'),
    ('unknown -> off = MAT TIN HIEU, khong phai may tat',
     {'connection': {'state': 'unknown', 'reachable': True},
      'telemetry': {'status': {'value': 'running'}}}, 'off'),
    ('bridge doc khong noi -> loi',
     {'connection': {'state': 'online'}, 'telemetryError': 'timeout'}, 'loi'),
    ('trang thai tho fault -> loi',
     {'connection': {'state': 'online'}, 'telemetry': {'status': {'value': 'fault'}}}, 'loi'),
    ('canh bao nang -> loi',
     {'connection': {'state': 'online'}, 'telemetry': {'status': {'value': 'stopped'}},
      'derivedAlerts': [{'severity': 'critical'}]}, 'loi'),
    ('canh bao nhe KHONG phai loi',
     {'connection': {'state': 'online'}, 'telemetry': {'status': {'value': 'running'}},
      'derivedAlerts': [{'severity': 'warning'}]}, 'chay'),
    ('running -> chay',
     {'connection': {'state': 'stale'}, 'telemetry': {'status': {'value': 'running'}}}, 'chay'),
    ('unknown KHONG duoc suy thanh dung',
     {'connection': {'state': 'online'}, 'telemetry': {'status': {'value': 'unknown'}}}, 'chuaro'),
    ('mui = tong -> hoan thanh',
     {'connection': {'state': 'online'}, 'telemetry': {'status': {'value': 'stopped'},
      'job': {'value': {'currentStitch': 35854, 'totalStitches': 35854}}}}, 'hoanthanh'),
    ('mui do dang -> dung',
     {'connection': {'state': 'online'}, 'telemetry': {'status': {'value': 'stopped'},
      'job': {'value': {'currentStitch': 1200, 'totalStitches': 35854}}}}, 'dung'),
    ('dung o mui 0 -> cho, khong phai dung',
     {'connection': {'state': 'online'}, 'telemetry': {'status': {'value': 'stopped'},
      'job': {'value': {'currentStitch': 0, 'totalStitches': 35854}}}}, 'cho'),
    ('khong biet tong mui -> cho',
     {'connection': {'state': 'online'}, 'telemetry': {'status': {'value': 'paused'},
      'job': {'value': {'currentStitch': 500, 'totalStitches': 0}}}}, 'cho'),

    # --- giờ làm (27/08). Ba ca đầu là luật mới; ca thứ tư là CÁI CHỐT: đồng hồ không được
    # phép đè lên số liệu sống, không thì ca đêm chạy tới 2 giờ sáng bị bảng khai là đã tắt máy.
    ('ngoai gio + may im -> ngoai-gio, khong hu hoa mat tin hieu',
     {'connection': {'state': 'unknown', 'reachable': True},
      'telemetry': {'status': {'value': 'running'}}}, 'ngoai-gio', False),
    ('ngoai gio + offline cung -> ngoai-gio (ve nha rut dien)',
     {'connection': {'state': 'offline'}}, 'ngoai-gio', False),
    ('TRONG gio + may im -> van la mat tin hieu, dong ho khong che',
     {'connection': {'state': 'unknown', 'reachable': True},
      'telemetry': {'status': {'value': 'running'}}}, 'off', True),
    ('ngoai gio ma may VAN NOI -> trang thai that thang, ca dem van la chay',
     {'connection': {'state': 'online'}, 'telemetry': {'status': {'value': 'running'}}},
     'chay', False),
    ('ngoai gio + may noi + dung do dang -> van la dung, khong nuot',
     {'connection': {'state': 'stale'}, 'telemetry': {'status': {'value': 'stopped'},
      'job': {'value': {'currentStitch': 1200, 'totalStitches': 35854}}}}, 'dung', False),

    # --- THANG BẰNG CHỨNG (28/08): tách "không làm" khỏi "mất tín hiệu". Bộ ca quan trọng nhất
    # của bản này — mỗi ca ghim đúng một bậc, và mấy ca cuối ghim những chỗ KHÔNG được phép suy.
    ('ca dan cung im -> cum-im, khong phai 13 lan may hong',
     {'connection': {'state': 'unknown', 'reachable': True}},
     'cum-im', True, {'noi': 0, 'im': 13, 'tong': 13}),
    ('may khac van noi + da theu XONG tam -> tat-may (tho tat may, nghi trua)',
     {'connection': {'state': 'unknown', 'reachable': True},
      'telemetry': {'job': {'value': {'currentStitch': 35854, 'totalStitches': 35854}}}},
     'tat-may', True, {'noi': 12, 'im': 1, 'tong': 13}),
    ('may khac van noi + chua nap mau nao -> tat-may',
     {'connection': {'state': 'unknown', 'reachable': True},
      'telemetry': {'job': {'value': {'currentStitch': 0, 'totalStitches': 35854}}}},
     'tat-may', True, {'noi': 12, 'im': 1, 'tong': 13}),
    ('may khac van noi + dang theu DO DANG -> off = mat tin hieu that',
     {'connection': {'state': 'unknown', 'reachable': True},
      'telemetry': {'job': {'value': {'currentStitch': 1200, 'totalStitches': 35854}}}},
     'off', True, {'noi': 12, 'im': 1, 'tong': 13}),
    ('khong du so de noi -> van la off, KHONG doan bua la tho tat may',
     {'connection': {'state': 'unknown', 'reachable': True}},
     'off', True, {'noi': 12, 'im': 1, 'tong': 13}),
    ('dem ca xuong im: ngoai-gio van thang cum-im (dung nhu du kien, dung keu)',
     {'connection': {'state': 'unknown', 'reachable': True}},
     'ngoai-gio', False, {'noi': 0, 'im': 13, 'tong': 13}),
    ('dan chi co 1 may thi khong ai lam chung -> cam keu cum-im',
     {'connection': {'state': 'unknown', 'reachable': True},
      'telemetry': {'job': {'value': {'currentStitch': 1200, 'totalStitches': 35854}}}},
     'off', True, {'noi': 0, 'im': 1, 'tong': 1}),
    ('loi bridge manh hon suy luan cua minh: offline van ra tat-han',
     {'connection': {'state': 'offline'},
      'telemetry': {'job': {'value': {'currentStitch': 35854, 'totalStitches': 35854}}}},
     'tat-han', True, {'noi': 12, 'im': 1, 'tong': 13}),
    # Cố ý dựng `dan` mâu thuẫn với chính con máy này (`online` mà bảo ca dan im) để ghim thứ tự:
    # may CON NOI thi so lieu that thang, `dan` khong duoc xen mot chu nao.
    ('may VAN NOI thi dan khong duoc xen vao: xong tam la hoanthanh',
     {'connection': {'state': 'online'}, 'telemetry': {'status': {'value': 'stopped'},
      'job': {'value': {'currentStitch': 35854, 'totalStitches': 35854}}}},
     'hoanthanh', True, {'noi': 0, 'im': 13, 'tong': 13}),
]

# `viec_dang_do` đứng riêng một bộ ca vì nó là bản lề của cả thang bằng chứng: sai một cái ở đây là
# hoặc giấu mất máy chết giữa tấm hàng, hoặc bôi đỏ cả xưởng lúc nghỉ trưa.
KIEM_TRA_DANG_DO = [
    ('theu do dang',        {'currentStitch': 1200, 'totalStitches': 35854}, True),
    ('xong tam',            {'currentStitch': 35854, 'totalStitches': 35854}, False),
    ('vuot qua tong',       {'currentStitch': 35900, 'totalStitches': 35854}, False),
    ('chua bat dau',        {'currentStitch': 0, 'totalStitches': 35854}, False),
    ('khong co tong',       {'currentStitch': 1200, 'totalStitches': 0}, None),
    ('thieu han so mui',    {}, None),
    ('so mui la chuoi',     {'currentStitch': '1200', 'totalStitches': 35854}, None),
]

# Cửa giờ làm: `(chuoi_gio_lam, ngay_nghi, epoch_utc, mong)`. Epoch chọn theo giờ VN đã tính sẵn;
# `2026-08-27` là Thứ Năm (`tm_wday` = 3), `2026-08-30` là Chủ Nhật (`tm_wday` = 6).
KIEM_TRA_GIO = [
    ('05:59 VN -> ngoai gio',        '06:00-19:00', set(), '2026-08-27T05:59', False),
    ('06:00 VN -> vao gio (bien)',   '06:00-19:00', set(), '2026-08-27T06:00', True),
    ('12:00 VN -> trong gio',        '06:00-19:00', set(), '2026-08-27T12:00', True),
    ('18:59 VN -> con trong gio',    '06:00-19:00', set(), '2026-08-27T18:59', True),
    ('19:00 VN -> ra ngoai gio',     '06:00-19:00', set(), '2026-08-27T19:00', False),
    ('03:00 VN -> ngoai gio',        '06:00-19:00', set(), '2026-08-27T03:00', False),
    ('doi cua 08-18: 07:00 ngoai',   '08:00-18:00', set(), '2026-08-27T07:00', False),
    ('doi cua 08-18: 09:00 trong',   '08:00-18:00', set(), '2026-08-27T09:00', True),
    ('ngay nghi CN -> ca ngay ngoai', '06:00-19:00', {6}, '2026-08-30T10:00', False),
    ('ngay nghi CN khong dinh T5',   '06:00-19:00', {6}, '2026-08-27T10:00', True),
    # Ca đêm vắt qua nửa đêm: nếu phép so không đảo thì cửa này trả False suốt 24 giờ.
    ('ca dem 22-06: 23:00 trong gio', '22:00-06:00', set(), '2026-08-27T23:00', True),
    ('ca dem 22-06: 02:00 trong gio', '22:00-06:00', set(), '2026-08-27T02:00', True),
    ('ca dem 22-06: 12:00 ngoai gio', '22:00-06:00', set(), '2026-08-27T12:00', False),
]

# Ca thử cho phần BÁO LỖI. Mỗi ca chốt `(muc, loi_do, loi_nguon)`; câu chữ không so từng chữ vì nó
# là nguyên văn của bridge và bridge được phép sửa câu của mình — nhưng ca cuối bắt buộc phải thấy
# đúng câu ấy đi ra, không thì "nguyên văn" chỉ là lời hứa.
KIEM_TRA_LOI = [
    ('binh thuong -> khong bao gi',
     {'connection': {'state': 'online', 'reason': 'Telemetry mới 2s trước.'},
      'telemetry': {'status': {'value': 'running'}}}, (0, '', '')),
    ('bridge doc khong noi -> muc 2, nguon bridge',
     {'connection': {'state': 'online'}, 'telemetryError': 'ECONNRESET'},
     (2, 'bridge-khong-doc-duoc', 'bridge')),
    ('telemetryError la vat the -> van ra chu, khong ra [object Object]',
     {'connection': {'state': 'online'}, 'telemetryError': {'message': 'adapter timeout'}},
     (2, 'bridge-khong-doc-duoc', 'bridge')),
    ('canh bao nang giu nguyen nguon controller',
     {'connection': {'state': 'online'}, 'telemetry': {'status': {'value': 'stopped'}},
      'derivedAlerts': [{'severity': 'critical', 'kind': 'controller-event',
                         'source': 'controller', 'title': 'Kim gay'}]},
     (2, 'controller-event', 'controller')),
    ('adapter cam (host con phan hoi) -> muc 2, KHONG phai canh bao nhe',
     {'connection': {'state': 'unknown', 'reachable': True,
                     'reason': 'Host còn phản hồi cổng TCP nhưng adapter ngừng trả dữ liệu hợp lệ 3715s.'},
      'derivedAlerts': [{'severity': 'warning', 'kind': 'connection', 'source': 'bridge',
                         'title': 'chưa kết luận được'}]},
     (2, 'adapter-cam', 'bridge')),
    ('may tat han -> muc 1, khong keu la loi',
     {'connection': {'state': 'offline', 'reachable': False,
                     'reason': 'Mất liên lạc 90s, lần cuối bridge còn gọi được máy này.'}},
     (1, 'tat-han', 'bridge')),
    ('canh bao nhe -> muc 1',
     {'connection': {'state': 'online'}, 'telemetry': {'status': {'value': 'stopped'},
      'job': {'value': {'currentStitch': 10, 'totalStitches': 100}}},
      'derivedAlerts': [{'severity': 'warning', 'kind': 'connection', 'source': 'bridge',
                         'title': 'Máy X: đã dừng 26 phút.', 'detail': 'Quá ngưỡng 5 phút.'}]},
     (1, 'connection', 'bridge')),
    ('canh bao da xac nhan thi thoi keu',
     {'connection': {'state': 'online'}, 'telemetry': {'status': {'value': 'running'}},
      'derivedAlerts': [{'severity': 'warning', 'kind': 'connection', 'source': 'bridge',
                         'title': 'cu roi', 'acknowledged': '2026-08-27T00:00:00Z'}]},
     (0, '', '')),
]

# Ngoài giờ thì mức phải về 0. Đi qua `bao_loi(m, 'ngoai-gio')` thẳng, vì đây là ca của riêng
# `bao_loi` — phần `tinh_trang` đã có ca riêng ở `KIEM_TRA_LUAT`.
KIEM_TRA_LOI_NGOAI_GIO = [
    ('ngoai gio: may im -> muc 0, khong bôi do ca dem',
     {'connection': {'state': 'unknown', 'reachable': True,
                     'reason': 'Host còn phản hồi cổng TCP nhưng adapter ngừng trả dữ liệu 9000s.'}},
     (0, '', '')),
    ('ngoai gio: canh bao "da dung 26 phut" cung thoi keu',
     {'connection': {'state': 'offline'},
      'derivedAlerts': [{'severity': 'warning', 'kind': 'connection', 'source': 'bridge',
                         'title': 'Máy X: đã dừng 26 phút.'}]},
     (0, '', '')),
]

# Mức nặng-nhẹ của ba chữ mới. Mỗi ca là `(ten, may, dan, mong)`; đi thẳng qua `tinh_trang` rồi
# `bao_loi` để chốt luôn cả khúc nối — lỗi nằm ở khúc nối thì hai bài thử rời nhau không thấy.
KIEM_TRA_LOI_PHAN_BIET = [
    ('tho tat may (xong tam) -> muc 0, het boi do gio nghi trua',
     {'connection': {'state': 'unknown', 'reachable': True,
                     'reason': 'Host còn phản hồi nhưng adapter ngừng trả dữ liệu 4200s.'},
      'telemetry': {'job': {'value': {'currentStitch': 35854, 'totalStitches': 35854}}}},
     {'noi': 12, 'im': 1, 'tong': 13}, (0, '', '')),
    # `reachable: False` cố ý, để nhánh `adapter-cam` (đòi `reachable is True`) không nổ trước —
    # ca này soi đúng nhánh mới. Lúc `reachable` là True thì `adapter-cam` thắng, CŨNG mức 2,
    # chỉ khác câu chữ: giữ nguyên văn của bridge là luật đã chốt từ trước, đừng đi đổi.
    ('mat tin hieu giua luc theu do -> muc 2, nguon dashboard',
     {'connection': {'state': 'unknown', 'reachable': False},
      'telemetry': {'job': {'value': {'currentStitch': 1200, 'totalStitches': 35854}}}},
     {'noi': 12, 'im': 1, 'tong': 13}, (2, 'mat-tin-hieu-dang-theu', 'dashboard')),
    ('ca dan im -> ke MOT tieng muc 1, khong phai 13 dong muc 2',
     {'connection': {'state': 'unknown', 'reachable': True}},
     {'noi': 0, 'im': 13, 'tong': 13}, (1, 'ca-cum-im', 'dashboard')),
]

if __name__ == '__main__':
    if '--tu-kiem' in sys.argv:
        hong = 0
        tong = 0
        for ca in KIEM_TRA_LUAT:
            ten, m, mong = ca[0], ca[1], ca[2]
            tg = ca[3] if len(ca) > 3 else True
            dan_ca = ca[4] if len(ca) > 4 else None
            tong += 1
            duoc = tinh_trang(m, tg, dan_ca)
            if duoc != mong:
                print('  HONG  %-52s mong=%s duoc=%s' % (ten, mong, duoc))
                hong += 1
            else:
                print('  ok    %-52s -> %s' % (ten, duoc))

        print('')
        for ten, cua, nghi, moc, mong in KIEM_TRA_GIO:
            tong += 1
            # Chuỗi ghi theo GIỜ VN; trừ lệch múi giờ ra để lấy epoch UTC tương ứng.
            ep = calendar.timegm(time.strptime(moc, '%Y-%m-%dT%H:%M')) - LECH_VN_GIAY
            cu_cua, cu_nghi = GIO_LAM, NGAY_NGHI
            try:
                globals()['GIO_LAM'] = _doc_gio_lam(cua)
                globals()['NGAY_NGHI'] = nghi
                duoc = trong_gio_lam(ep)
            finally:
                globals()['GIO_LAM'], globals()['NGAY_NGHI'] = cu_cua, cu_nghi
            if duoc != mong:
                print('  HONG  %-52s mong=%s duoc=%s' % (ten, mong, duoc))
                hong += 1
            else:
                print('  ok    %-52s -> %s' % (ten, duoc))

        print('')
        for ten, m, mong in KIEM_TRA_LOI:
            tong += 1
            muc, do, _text, nguon, _so = bao_loi(m, tinh_trang(m))
            duoc = (muc, do, nguon)
            if duoc != mong:
                print('  HONG  %-52s mong=%s duoc=%s' % (ten, mong, duoc))
                hong += 1
            else:
                print('  ok    %-52s -> %s' % (ten, duoc))

        for ten, m, mong in KIEM_TRA_LOI_NGOAI_GIO:
            tong += 1
            muc, do, _text, nguon, _so = bao_loi(m, 'ngoai-gio')
            duoc = (muc, do, nguon)
            if duoc != mong:
                print('  HONG  %-52s mong=%s duoc=%s' % (ten, mong, duoc))
                hong += 1
            else:
                print('  ok    %-52s -> %s' % (ten, duoc))

        print('')
        for ten, cs, mong in KIEM_TRA_DANG_DO:
            tong += 1
            duoc = viec_dang_do({'telemetry': {'job': {'value': cs}}})
            if duoc is not mong:
                print('  HONG  %-52s mong=%s duoc=%s' % (ten, mong, duoc))
                hong += 1
            else:
                print('  ok    %-52s -> %s' % (ten, duoc))

        for ten, m, dan_ca, mong in KIEM_TRA_LOI_PHAN_BIET:
            tong += 1
            muc, do, _text, nguon, _so = bao_loi(m, tinh_trang(m, True, dan_ca), dan_ca)
            duoc = (muc, do, nguon)
            if duoc != mong:
                print('  HONG  %-52s mong=%s duoc=%s' % (ten, mong, duoc))
                hong += 1
            else:
                print('  ok    %-52s -> %s' % (ten, duoc))

        # Câu của `cum-im` phải mang ĐÚNG số máy đã đếm được. Nói "cả 13 máy cùng im" trong khi
        # đàn có 5 máy là bịa ra bằng chứng — mà bằng chứng chính là toàn bộ giá trị của chữ này.
        tong += 1
        _t = bao_loi({'connection': {'state': 'unknown'}}, 'cum-im',
                     {'noi': 0, 'im': 5, 'tong': 5})[2]
        if '5 máy' not in _t:
            print('  HONG  cau cum-im khong mang so may that: %s' % _t)
            hong += 1
        else:
            print('  ok    cau cum-im mang dung so may da dem')

        print('')
        # Nguyên văn phải đi ra được nguyên văn. Ca này canh đúng cái lời hứa của `loi_text`:
        # bịa lại câu, cắt cụt, hay thay bằng nhãn chung chung đều làm ca này đỏ.
        tong += 1
        cau = 'Host còn phản hồi cổng TCP nhưng adapter ngừng trả dữ liệu hợp lệ 3715s.'
        m = {'connection': {'state': 'unknown', 'reachable': True, 'reason': cau}}
        if bao_loi(m, tinh_trang(m))[2] != cau:
            print('  HONG  loi_text KHONG con nguyen van cua bridge')
            hong += 1
        else:
            print('  ok    loi_text giu nguyen van cua bridge')

        # Mọi tình trạng phải có mã, không thì dòng log rơi mất khoá `ma` và ô đếm bên Grafana
        # âm thầm bỏ sót đúng cái máy đang ở tình trạng ấy.
        tong += 1
        thieu = sorted({ca[2] for ca in KIEM_TRA_LUAT} - set(MA_TT))
        du = sorted(set(MA_TT) - {'chay', 'dung', 'hoanthanh', 'cho', 'loi', 'chuaro', 'off',
                                  'tat-han', 'ngoai-gio', 'cum-im', 'tat-may'})
        if thieu or du:
            print('  HONG  bang MA_TT lech: thieu=%s thua=%s' % (thieu, du))
            hong += 1
        else:
            print('  ok    bang MA_TT phu du 11 tinh trang')

        # Mã đã phát ra Loki thì VĨNH VIỄN không được đổi số: đổi là làm sai ngược cả lịch sử, và
        # `mappings` bên Grafana im lặng dán nhãn cũ lên số mới. Ca này ghim đúng bảng đang chạy.
        tong += 1
        chot = {'loi': 0, 'dung': 1, 'off': 2, 'chuaro': 3, 'hoanthanh': 4, 'cho': 5, 'chay': 6,
                'tat-han': 7, 'ngoai-gio': 8, 'cum-im': 9, 'tat-may': 10}
        if MA_TT != chot:
            print('  HONG  MA_TT da bi danh so lai: %s' % (MA_TT,))
            hong += 1
        else:
            print('  ok    MA_TT giu nguyen so cu, cum-im=9 tat-may=10 noi duoi')

        # ------------------------------------------------------------------ sổ nhớ ra đĩa
        # Lỗ này đo được trên máy thật, không phải nghĩ ra: 16:42 ngày 28/08, ngay sau khi bridge
        # khởi động lại vì cúp điện, 4/4 máy đang im không còn một số mũi nào. Nên bộ ca dưới đây
        # phải canh cả ba thứ: nhớ đúng, KHÔNG nhớ bậy, và không bao giờ làm chết bộ đẩy.
        print('')
        import tempfile
        _tam = tempfile.mkdtemp(prefix='nho-viec-')

        def _may(kn, cur=None, tot=None):
            m = {'connection': {'state': kn}}
            if tot is not None:
                m['telemetry'] = {'job': {'value': {'currentStitch': cur, 'totalStitches': tot}},
                                  'observedAt': '2026-08-28T05:00:00.000Z'}
            return m

        _ket = []
        s = SoNhoViec(os.path.join(_tam, 'so.json'))

        # 1. Máy đang nói và đã thêu xong tấm ⇒ vào sổ.
        s.ghi('M1', _may('online', 900, 900))
        _ket.append(('so nho lai duoc so mui may vua khai', s.doc('M1') == {
            'mui': 900, 'tong': 900, 'at': '2026-08-28T05:00:00.000Z', 'mau': None}))

        # 2. Máy im, không có số ⇒ KHÔNG được xoá mục cũ. Đây là cả điểm mấu chốt: lúc máy im
        #    chính là lúc cần cái số cũ ấy nhất.
        s.ghi('M1', _may('unknown'))
        _ket.append(('may im khong xoa mat muc cu trong so', s.doc('M1') is not None))

        # 3. Đọc được số 0/0 (máy rảnh, chưa nạp mẫu) ⇒ vẫn không ghi, vì `tot<=0` không nói lên
        #    điều gì. Ghi vào là tự tay biến "không biết" thành "đã xong".
        s.ghi('M2', _may('online', 0, 0))
        _ket.append(('so tu choi ghi lan doc 0/0 vo nghia', s.doc('M2') is None))

        # 4. Lưu rồi mở lại: sổ phải còn nguyên. Không có bước này thì cả sổ vô nghĩa.
        s.luu(ep=True)
        s2 = SoNhoViec(os.path.join(_tam, 'so.json'))
        _ket.append(('so song qua lan khoi dong lai', s2.doc('M1') == s.doc('M1')))

        # 5. Máy đang nói thì LỜI MÁY thắng sổ, và xuất xứ phải ghi là `song`.
        dd_, ng_, _lc = dang_do_kem_nho(_may('online', 5, 900), 'M1', s2)
        _ket.append(('may dang noi thi loi may thang so nho', (dd_, ng_) == (True, 'song')))

        # 6. Máy im, sổ nhớ nó đã xong tấm ⇒ `tat-may`, xuất xứ `nho`, kèm giờ của số ấy.
        dd_, ng_, lc_ = dang_do_kem_nho(_may('unknown'), 'M1', s2)
        _ket.append(('may im thi lay so trong so, ghi ro xuat xu',
                     (dd_, ng_, lc_) == (False, 'nho', '2026-08-28T05:00:00.000Z')))

        # 7. Nguyên cả chuỗi: đúng cái cảnh 16:42 hôm nay. Không sổ thì ra `off` (mất tín hiệu),
        #    có sổ thì ra `tat-may` (thợ tắt máy). Đây là con số mà việc thêm sổ mua được.
        _im = _may('unknown')
        _dan = {'noi': 8, 'im': 1, 'tong': 9}
        _ket.append(('khong so  -> off      (dung: chua biet gi)',
                     tinh_trang(_im, True, _dan) == 'off'))
        _ket.append(('co so     -> tat-may  (tho tat may sau khi xong tam)',
                     tinh_trang(_im, True, _dan, dang_do_kem_nho(_im, 'M1', s2)[0]) == 'tat-may'))

        # 8. Sổ rách thì mở ra rỗng, không nổ. Cúp điện giữa lúc ghi là chuyện sẽ xảy ra.
        _rach = os.path.join(_tam, 'rach.json')
        with open(_rach, 'w') as _f:
            _f.write('{"may": {"M1": ')
        _ket.append(('so rach thi mo ra rong chu khong no', SoNhoViec(_rach).doc('M1') is None))

        # 9. Đĩa không ghi được thì tự tắt, KHÔNG ném lỗi lên làm chết bộ đẩy. Sổ là thứ làm tốt
        #    thêm; để nó kéo sập đường đo thì thà đừng có.
        s3 = SoNhoViec(os.path.join(_tam, 'khong-co-thu-muc', 'so.json'))
        s3.ghi('M1', _may('online', 900, 900))
        _ket.append(('dia hong thi tu tat, khong lam chet bo day',
                     s3.luu(ep=True) is False and s3.tat is True))

        for _ten, _dat in _ket:
            tong += 1
            if _dat:
                print('  ok    %s' % _ten)
            else:
                print('  HONG  %s' % _ten)
                hong += 1

        import shutil
        shutil.rmtree(_tam, ignore_errors=True)

        # `muc` phải là số nằm trong MA_MUC, không thì `unwrap muc` bên LogQL vấp im lặng.
        print('')
        tong += 1
        if sorted(TEN_MUC) != [0, 1, 2] or set(MA_MUC.values()) != {0, 1, 2}:
            print('  HONG  bang MA_MUC lech: %s' % (MA_MUC,))
            hong += 1
        else:
            print('  ok    bang MA_MUC du 3 muc')

        print('\n%d/%d ca dat' % (tong - hong, tong))
        sys.exit(1 if hong else 0)

    if '--mot-lan' in sys.argv:
        n = vong(sys.stdout)
        sys.stderr.write('da ghi %d dong\n' % n)
        sys.exit(0)

    lien_tiep_hong = 0
    while True:
        try:
            vong(sys.stdout)
            lien_tiep_hong = 0
        except (urllib.error.URLError, OSError, ValueError, KeyError) as e:
            lien_tiep_hong += 1
            # Không ghi dòng nào khi hỏng: thà Grafana trống một lúc còn hơn ghi số cũ như số mới.
            if lien_tiep_hong in (1, 5, 30) or lien_tiep_hong % 300 == 0:
                sys.stderr.write('[tinh-trang] hong lan %d: %s\n' % (lien_tiep_hong, type(e).__name__))
                sys.stderr.flush()
        time.sleep(NHIP)
