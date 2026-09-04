# -*- coding: utf-8 -*-
"""Nối phần `dahao-gio-may` vào quan-sat/README.md."""
import io

p = 'README.md'
s = io.open(p, encoding='utf-8').read()
if 'dahao-gio-may' in s:
    print('README đã có phần này rồi — không nối nữa')
    raise SystemExit(0)

a = "| `dahao-mot-may` | thợ đứng tại máy | riêng máy này đang ra sao | 10s | 12h |"
assert a in s
s = s.replace(a, a + "\n| `dahao-gio-may` | **chủ xưởng, kế toán** | **một ngày trôi đi đâu: "
                    "thêu / dừng / chờ** | 1m | hôm nay |", 1)

MOI = u"""
## `dahao-gio-may` — một ngày của máy trôi đi đâu (04/09)

Câu hỏi: *trong một ngày, máy đó thêu bao lâu, dừng và chờ bao lâu, dừng dưới 1 phút bao lâu,
dừng từ 1 phút trở lên bao lâu.* Không bảng nào cũ trả lời được, và **LogQL cũng không**.

### Vì sao phải viết bộ đếm riêng chứ không hỏi thẳng Loki

| nguồn sẵn có | vì sao không dùng được |
|---|---|
| `job="tinh-trang"` | chỉ ghi **khi đổi** + nhịp tim 20 giây. Khoảng cách hai dòng 2–22 giây, không đều — cộng lại ra thời lượng là bịa. |
| `job="va-mau"` | **cố ý mù** đúng phần người hỏi cần: nó bỏ qua lúc `cur == 0` hoặc `cur >= tot` (tức toàn bộ thời gian **chờ việc**), và vứt hẳn những lần dừng ≤ 4 giây. |
| LogQL trần | không có phép **so hai mẫu liền nhau**. Muốn biết "giữa khung này và khung trước máy có chạy không" thì phải đi qua từng cặp — việc của một tiến trình, không phải của một truy vấn. |

Nên có `dem-gio-may.py`: đọc thẳng `broker.log`, mỗi máy mỗi phút nhả **một dòng JSON** chia đúng
60 giây ấy vào bốn rổ. Bất biến của cả bộ đếm: **`chay + dung + cho + mat == 60`**, mỗi máy mỗi
phút, không trừ trường hợp nào. Sai bất biến này thì mọi con số phía trên đều vô nghĩa, nên nó là
ca thử số một trong `--tu-kiem` (36 ca).

| rổ | máy khai gì |
|---|---|
| `chay` — đang thêu | số mũi **tăng** giữa hai khung |
| `dung` — dừng giữa tấm | số mũi **đứng yên hoặc lùi** trong khi `0 < cur < tot` |
| `cho` — chờ việc | `cur == 0`, hoặc `cur >= tot` (xong tấm), hoặc chưa nạp mẫu, hoặc vừa đổi mẫu |
| `mat` — mất tín hiệu | phần còn lại của phút: máy **không gửi khung nào**. Khoảng hở > 120 giây không cộng cho rổ nào khác. |

Lần dừng được tính vào phút nó **KẾT THÚC**, và chia hai theo độ dài: `ngan`/`so_ngan` (< 60 giây)
và `dai`/`so_dai` (≥ 60 giây). Cộng thêm `so_nhay` — số lần dừng ≤ 4 giây, là **tập con** của
`so_ngan`. Đo thật: 588 lần dừng ngắn thì 497 lần chỉ thoáng đúng một nhịp đo (cắt chỉ tự động),
nên nếu không tách ra thì cột "số lần" chẳng nói lên điều gì. `soi-lan-dung.py` vứt hẳn nhóm này
— đó chính là lý do số lần bên `va-mau` bao giờ cũng nhỏ hơn bên đây, không phải ai sai.

### ⚠ Bẫy: `broker.log` KHÔNG xếp đúng thứ tự giờ, chốt sớm là mất số IM LẶNG

Broker nhả log theo cụm; khoảng của máy đi sau có thể tới **hàng phút** sau khi phút của nó đã
trôi qua. Chốt phút ngay lúc đồng hồ sang phút mới thì những khoảng ấy bị vứt, **không log, không
lỗi**. Nên bộ đếm giữ lại `TRE_GIAY` giây rồi mới chốt. Đo trên 75.493 dòng thật:

| TRE_GIAY | khoảng bị vứt |
|---|---|
| 45 | 33 |
| 90 | 6 |
| **180 (đang dùng)** | **3** |
| 300 · 900 | 3 — không giảm nữa |

Ba khoảng cuối là dòng lệch giờ hàng chục phút, không lối chờ nào cứu. Đổi lại: bảng **trễ ~4
phút** so với thực tại. Số khoảng bị vứt được đếm và bắn ra `logs/gio-may.err` (`[TRE] ...`).

### Chạy và kiểm

```bash
python3 -B quan-sat/dem-gio-may.py --tu-kiem      # 36/36
python3 -B quan-sat/dem-gio-may.py --lich-su 400000 --tom-tat --doi-chieu
python3 -B quan-sat/dem-gio-may.py --bu           # nối phần cũ vào logs/gio-may.out
python3 -B quan-sat/kiem-bang-gio-may.py          # dựng lại bảng ở dòng lệnh, 0 = sạch
```

`kiem-bang-gio-may.py` đọc **thẳng file bảng**, thay biến, hỏi Loki, ghép ngoài theo `may` rồi đổi
tên cột — làm hộ đúng phần Grafana làm trong trình duyệt. Nó soi bốn thứ: máy nào ra hai dòng, ô
nào trống, ô nào NaN, và **ô chữ to có khớp tổng cột trong bảng không**. Đặt `GIO=trong-gio` hoặc
`KHOANG=24h` để soi góc khác.

Ô "Tỷ lệ thêu" **được phép trống** khi máy không gửi lấy một khung: mẫu số lọc `> 0` cố tình bỏ
series đi. Trống đọc là *"không biết"* — đúng hơn hẳn số 0, vì 0 sẽ vu cho máy là "chạy 0 %"
trong khi thật ra mình không có một phép đo nào về nó.

### Đọc bảng: đừng giật mình vì cột "Mất tín hiệu"

Đo ngày 04/09, cửa sổ 6 giờ: mỗi máy có ~2 giờ "mất tín hiệu" **ngay trong giờ làm**. Kiểm lại
`broker.log` thì đó là một lỗ duy nhất **11:34 -> 00:57 UTC (18:34 -> 07:57 giờ VN)** — cả xưởng
tắt máy sau giờ làm và bật lại lúc gần 8 giờ sáng, trong khi `GIO_LAM` đang khai `06:00-19:00`.
Tức con số đúng, chỉ là **cửa giờ làm đang rộng hơn giờ xưởng thật gần 2 tiếng**. Sửa `GIO_LAM`
thì cột này về đúng nghĩa "máy đáng lẽ phải chạy mà im".

### Đường đi của số liệu

```
broker.log  ->  dem-gio-may.py (launchd com.dahao.giomay)  ->  logs/gio-may.out
            ->  Alloy loki.process "gio_may"  ->  Loki job="gio-may"  ->  bảng dahao-gio-may
```

Nhãn: `may`, `ten`, `gio` (`trong-gio`/`ngoai-gio`) — 19 x 2 = 38 luồng. `ten` lên nhãn được vì nó
dính một-một với `may` nên không đẻ thêm luồng nào, đổi lại bảng `sum by (ten)` đọc ra tên người
chứ không phải MAC. Mọi con số là structured metadata.

File bảng do `tao-bang-gio-may.py` đẻ ra — sửa script rồi chạy lại, đừng sửa tay JSON.
"""

b = "### ⚠ Bẫy: `allowUiUpdates: true`"
assert b in s, 'khong tim thay moc chen'
s = s.replace(b, MOI.lstrip('\n') + "\n" + b, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('README:', len(s.splitlines()), 'dong')
