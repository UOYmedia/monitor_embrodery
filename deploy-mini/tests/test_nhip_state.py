#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Self-test cho bộ đo nhịp `state` (S‑11 min/max, K‑20c tỉ lệ dòng lặp).
#
# Vì sao cần đo: nhịp TRUNG BÌNH đã có (1,54 s/bản, suy từ tổng bản tin / dải thời gian), nhưng
# trung bình là con số vô hại nhất trong ba con số. Một tuyến đứng im 40 giây rồi phun 30 bản
# trong một giây vẫn cho ra đúng 1,54 s/bản — nhìn vào bảng thì thấy "đều", nhìn vào máy thì
# thấy dashboard đứng hình 40 giây. Chỉ MIN và MAX mới phân biệt được hai tình huống đó.
#
# Vì sao bài này chạy CÁCH LY, không đụng broker production: nó gọi thẳng `nhip_state()` với
# đồng hồ giả, và trỏ `NHIP_CSV` vào thư mục tạm. Không mở socket, không publish, không để lại
# một dòng nào trong `nhip-state.csv` thật — file đó là số liệu bàn giao.
#
#   N‑1  Bản ĐẦU TIÊN của một máy trả Δ '-', KHÔNG phải '0.000s' (chưa đo được thì đừng bịa).
#   N‑2  Các bản sau trả đúng khoảng cách thật, mốc là ISO có `Z`.
#   N‑3  Đủ 5 phút thì chốt MỘT dòng CSV: min/giữa/max đúng, số bản đúng.
#   N‑4  Đếm dòng lặp theo chữ ký nội dung — đúng thứ K‑20c cần, không phải đếm mù.
#   N‑5  Hai máy đo độc lập nhau (nhịp máy A không lẫn vào máy B).
#   N‑6  Cửa sổ mới nối liền cửa sổ cũ — không đánh rơi khoảng giữa hai dòng CSV.
#   N‑7  Dòng log `*** STATE` vẫn giữ nguyên tiền tố cũ (các bài đo khác đếm theo tiền tố này).
#   N‑8  Không ghi được CSV thì chỉ mất số liệu đo, KHÔNG được giết luồng `state`.
#
# ⚠ Nếu dùng bài này làm ĐỐI CHỨNG ÂM (bẻ broker.py nhiều lần liên tiếp rồi chạy lại): phải xoá
# `deploy-mini/__pycache__` và chạy với `PYTHONDONTWRITEBYTECODE=1`. Bộ kiểm tra `.pyc` chỉ so
# (mtime theo GIÂY, kích thước file), nên hai lần bẻ ra file cùng kích thước trong cùng một giây
# sẽ chạy lại bytecode của lần TRƯỚC — và bảng kết quả in ra một ca đỏ trông hợp lý nhưng thuộc
# về mutation khác. Đã cắn thật ngày 25/08 khi làm chính bài này.
#
# Chạy:  PYTHONDONTWRITEBYTECODE=1 python3 tests/test_nhip_state.py
import importlib.util, os, re, sys, tempfile, time as _time_that

HERE = os.path.dirname(os.path.abspath(__file__))
GOC = os.environ.get('DAHAO_BROKER_SRC') or os.path.join(HERE, '..', 'broker.py')
spec = importlib.util.spec_from_file_location('broker', GOC)
broker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broker)

TAM = tempfile.mkdtemp(prefix='nhip-')
broker.NHIP_CSV = os.path.join(TAM, 'nhip-state.csv')
broker.LOG = os.path.join(TAM, 'broker.log')      # ca N‑8 gọi `log()`; đừng để nó bẩn log thật


class GioGia:
    """Đồng hồ giả. Bài này đo KHOẢNG CÁCH giữa các bản tin, nên nếu dùng đồng hồ thật thì phải
    `sleep` hàng phút để kiểm cửa sổ 5 phút — và kết quả vẫn phụ thuộc vào máy chạy test đang
    bận hay rảnh. Chỉ thay `time()`, mọi thứ khác (`strftime`, `gmtime`) vẫn là hàng thật."""
    def __init__(self): self.t = 1756000000.0
    def time(self): return self.t
    def troi(self, giay): self.t += giay
    def __getattr__(self, ten): return getattr(_time_that, ten)


def dat_lai():
    gio = GioGia()
    broker.time = gio
    broker._nhip.clear()
    if os.path.exists(broker.NHIP_CSV): os.remove(broker.NHIP_CSV)
    return gio


def doc_csv():
    if not os.path.exists(broker.NHIP_CSV): return []
    with open(broker.NHIP_CSV) as f:
        return [d.strip() for d in f if d.strip()]


VAN = ('15', 0, 46453, 'MAU80')          # chữ ký nội dung: state, cur, tot, pat
loi = []


def kiem(ten, dieu_kien, chi_tiet=''):
    print(('  ok   ' if dieu_kien else '  ĐỎ   ') + ten + (('  — ' + chi_tiet) if chi_tiet and not dieu_kien else ''))
    if not dieu_kien: loi.append(ten)


# ---- N‑1 --------------------------------------------------------------------------------
gio = dat_lai()
moc, d = broker.nhip_state('DEV_A', VAN)
kiem("N‑1 bản đầu tiên trả Δ '-' chứ không phải '0.000s'", d == '-', 'nhận %r' % d)
kiem('N‑1 mốc là ISO kèm Z', bool(re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$', moc)), moc)

# ---- N‑2 --------------------------------------------------------------------------------
gio.troi(1.5)
_, d = broker.nhip_state('DEV_A', VAN)
kiem('N‑2 bản thứ hai đo đúng 1,5 s', d == '1.500s', 'nhận %r' % d)
gio.troi(40.25)
_, d = broker.nhip_state('DEV_A', VAN)
kiem('N‑2 khoảng nghỉ dài đo đúng 40,25 s', d == '40.250s', 'nhận %r' % d)
kiem('N‑2 chưa đủ 5 phút thì chưa ghi dòng nào', doc_csv() == [], repr(doc_csv()))

# ---- N‑3 + N‑4 --------------------------------------------------------------------------
gio = dat_lai()
# Bốn khoảng: 1,0 · 2,0 · 3,0 · 300,0 — bản cuối vượt cửa sổ nên chốt luôn tại đó.
# Chữ ký: A A A B A -> có 2 lần lặp liên tiếp (bản 2 và bản 3 trùng bản trước).
VAN_B = ('15', 12, 46453, 'MAU80')
for cach, van in ((0, VAN), (1.0, VAN), (2.0, VAN), (3.0, VAN_B), (300.0, VAN)):
    gio.troi(cach)
    broker.nhip_state('DEV_A', van)
hang = doc_csv()
kiem('N‑3 đủ 5 phút thì chốt đúng MỘT dòng', len(hang) == 2, repr(hang))     # 1 tiêu đề + 1 dòng
if len(hang) == 2:
    kiem('N‑3 có dòng tiêu đề', hang[0] == 'luc,dev,so_ban,giay_min,giay_giua,giay_max,so_lap', hang[0])
    c = hang[1].split(',')
    kiem('N‑3 đúng máy', c[1] == 'DEV_A', hang[1])
    kiem('N‑3 đếm đủ 5 bản tin', c[2] == '5', hang[1])
    kiem('N‑3 min = 1,0 s (KHÔNG phải 0 — bản đầu không có Δ để mà tính)', c[3] == '1.000', hang[1])
    kiem('N‑3 max = 300,0 s', c[5] == '300.000', hang[1])
    # Bốn khoảng [1, 2, 3, 300] -> `sorted(ds)[len//2]` = 3,0. Cột này CỐ Ý là trung vị chứ không
    # phải trung bình: trung bình của bốn khoảng đó là 76,5 s — một con số không hề mô tả tuyến này.
    kiem('N‑3 giữa = 3,0 s (trung vị, không phải trung bình)', c[4] == '3.000', hang[1])
    # Đây là con số K‑20c cần: 2/5 bản là máy nhắc lại y nguyên điều nó vừa nói.
    kiem('N‑4 đếm đúng 2 bản lặp (A A A B A)', c[6] == '2', hang[1])

# ---- N‑5 --------------------------------------------------------------------------------
gio = dat_lai()
broker.nhip_state('DEV_A', VAN)
gio.troi(10.0)
broker.nhip_state('DEV_B', VAN)          # máy B lần đầu -> phải là '-', không mượn nhịp của A
_, d = broker.nhip_state('DEV_B', VAN)
kiem('N‑5 máy B đo riêng, không lẫn nhịp của máy A', d == '0.000s', 'nhận %r' % d)
gio.troi(0.5)
_, d = broker.nhip_state('DEV_A', VAN)
kiem('N‑5 máy A vẫn giữ mốc riêng của nó (10,5 s)', d == '10.500s', 'nhận %r' % d)

# ---- N‑6 --------------------------------------------------------------------------------
gio = dat_lai()
broker.nhip_state('DEV_A', VAN)
gio.troi(301.0); broker.nhip_state('DEV_A', VAN)      # chốt cửa sổ 1 tại đây
gio.troi(7.0)
_, d = broker.nhip_state('DEV_A', VAN)
# Nếu cửa sổ mới đặt `truoc=None` thì khoảng 7 giây này biến mất khỏi mọi thống kê — mỗi 5 phút
# đánh rơi một khoảng, và đúng cái khoảng nằm ngay sau một lần chốt.
kiem('N‑6 khoảng nối giữa hai cửa sổ không bị đánh rơi', d == '7.000s', 'nhận %r' % d)

# ---- N‑7 --------------------------------------------------------------------------------
src = open(GOC, encoding='utf-8').read()
kiem("N‑7 dòng log vẫn bắt đầu bằng '*** STATE dev='", "'*** STATE dev=%s cur=%s tot=%s state=%s pat=%s @%s" in src)
kiem('N‑7 không chèn gì vào giữa STATE và dev=', "log('*** STATE dev=" in src)

# ---- N‑8 --------------------------------------------------------------------------------
gio = dat_lai()
broker.NHIP_CSV = os.path.join(TAM, 'khong-co-thu-muc-nay', 'nhip.csv')
try:
    broker.nhip_state('DEV_C', VAN)
    gio.troi(301.0)
    _, d = broker.nhip_state('DEV_C', VAN)
    kiem('N‑8 CSV hỏng thì vẫn trả Δ bình thường, không ném', d == '301.000s', 'nhận %r' % d)
except Exception as e:
    kiem('N‑8 CSV hỏng thì vẫn trả Δ bình thường, không ném', False, 'ném %r' % e)
finally:
    broker.NHIP_CSV = os.path.join(TAM, 'nhip-state.csv')

print()
if loi:
    print('THẤT BẠI: %d ca' % len(loi))
    for t in loi: print('   - ' + t)
    sys.exit(1)
print('TẤT CẢ ĐẠT')
