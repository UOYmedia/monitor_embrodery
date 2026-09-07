# Tầng quan sát — Loki + Grafana

Bộ này **không thay** trang xem của thợ. Nó là màn hình cho người trông hệ thống.

| | Trang xem (`test.phonh.io.vn`) | Grafana (bộ này) |
|---|---|---|
| Cho ai | Thợ đứng máy, quản lý xưởng | Người trông tuyến kỹ thuật |
| Trả lời | "Máy đang chạy hay dừng?" | "Vì sao lúc 3 giờ sáng máy ngừng nói?" |
| Đường vào | Internet, không đăng nhập | **Chỉ tailnet** `http://100.105.80.93:3000` |
| Thấy gì | Con số đã xử lý | Log thô — nên **không đưa ra Internet** |

> ⚠️ **IP tailnet KHÔNG cố định.** Ngày 04/09/2026 nó đổi `100.107.219.95` → `100.105.80.93`
> và bridge + Grafana + tunnel chết cùng lúc vì cả ba đều ghi cứng IP cũ. Con số ghi trong
> tài liệu này chỉ là **ví dụ tại thời điểm 07/09/2026**. Muốn địa chỉ đang có thì hỏi máy:
> `tailscale ip -4` (hoặc `bash ~/dahao-gateway/dia-chi-tailnet.sh`), đừng chép số trong doc.

## Đang chạy bằng gì (26/08)

**Bản native, cài bằng brew, launchd trông.** OrbStack không khởi động nổi trên Mini
không màn hình (xem cuối file), nên bỏ hẳn đường container. Ba dịch vụ:

| Job launchd | Tiến trình | Nghe ở | Cấu hình |
|---|---|---|---|
| `com.dahao.loki` | `loki` 3.7.6 | `127.0.0.1:3100` | `native/loki.yml` |
| `com.dahao.alloy` | `alloy` 1.19.1 | `127.0.0.1:12345` | `native/config.alloy` |
| `com.dahao.grafana` | `grafana` 13.2.0 | `100.105.80.93:3000` | `native/grafana.ini` |

Cả ba đều `KeepAlive` — giết tiến trình thì launchd dựng lại (đã thử thật: giết PID
Grafana, 25 giây sau có PID mới, `runs = 2`).

```bash
# xem trạng thái
launchctl print gui/501/com.dahao.grafana | grep -E "state = |pid = |runs = "
# khởi động lại
launchctl kickstart -k gui/501/com.dahao.alloy
# tắt hẳn một dịch vụ
launchctl bootout gui/501/com.dahao.loki
```

Mật khẩu admin Grafana nằm ở `quan-sat/grafana-admin.env` (chmod 600), do
`native/chay-grafana.sh` nạp vào — **không** chép vào plist, vì plist ai cũng liệt kê được.
Xem bảng thì không cần đăng nhập (`auth.anonymous` = Viewer); sửa thì phải.

**Thư mục `native/` khác thư mục gốc đúng hai chỗ:** đường dẫn `/nhat-ky/…` (điểm gắn
của container) thành đường thật `/Users/phong/dahao-gateway/…`, và `http://loki:3100`
(tên dịch vụ trong mạng compose) thành `http://127.0.0.1:3100`. Mọi thứ khác — regex,
nhãn, chính sách giữ log — dùng chung. File JSON của bảng cũng dùng chung
(`grafana/dashboards/dahao-tuyen.json`), sửa một chỗ hai bản cùng thấy.

`docker-compose.yml` và các file cạnh nó **giữ lại nguyên vẹn** để sau này muốn quay
về container thì có sẵn — chưa xoá, chưa sửa ngoài phần vá regex chung.

## Thứ tầng quan sát vừa cho thấy ngay hôm bật lên

Xưởng **không chỉ có một máy**. Trong 3 phút đầu tiên có dữ liệu, Loki đã tách ra
**13 định danh máy khác nhau** cùng đẩy vào broker, nhiều máy đang thêu thật
(`state=-1`, số mũi tăng, tên file `.DST` thật). Nhưng `may.json` mới khai đúng một máy
(`602602704E7B` → `mch-a15-mqtt`), nên bridge **từ chối** khung của những máy còn lại
với lý do `machine_id_missing`.

Đó là hành vi đúng của bản vá "nhiều máy": thà báo lỗi to còn hơn cộng dồn số mũi của
mười mấy máy vào một máy.

**Đã khai xong cùng ngày.** Chủ xưởng xác nhận đó là máy vừa lắp thêm. Cả 13 máy giờ có
bản ghi trong fleet và một dòng trong `may.json`; bộ đếm từ chối `machine_id_missing`
về **0**, và trang thợ hiện đủ 13 thẻ với mẫu + số mũi riêng từng máy.

Tên máy là tên TẠM (`Máy C54F54` — sáu ký tự cuối mã máy), vì đã giải mã kiểm và **cả 13
máy đều để `machineName` rỗng** trên HMI. Cố ý không đánh số `Máy 1…13`: thứ tự mã máy
không liên quan tới vị trí ngoài xưởng, số sai còn tệ hơn không số. Sửa tên là sửa trường
`name`, định danh không đổi.

## Ba điều bộ này cố ý KHÔNG làm

1. **Không ghi vào thư mục gateway.** Bản container gắn `~/dahao-gateway` kiểu `:ro` để
   chặn hộ. Bản native **không có cái chặn đó** — Alloy chạy dưới người dùng `phong` nên
   về nguyên tắc ghi được. Vậy nên: đừng bao giờ thêm component nào của Alloy có ghi file
   vào thư mục ấy. Một bộ quan sát làm hỏng thứ nó quan sát là bộ quan sát tệ nhất.
2. **Không gom `state.log`.** File ấy 46 MB và mỗi dòng là base64 đã mã hoá. Đẩy vào Loki thì tốn đĩa mà tra cứu không ra gì — muốn đọc được phải mang khoá vào tầng quan sát, và đó là chỗ khoá không nên có mặt. Mọi thứ cần biết đã có ở dạng đọc được trong `broker.log`.
3. **Không đặt tên cho mã trạng thái chưa từng gặp.** Bảng hiện số trần chứ không dịch sang chữ. Ô "Giá trị trạng thái đã gặp" nhảy lên một bậc là tín hiệu mở sổ ghi, không phải chỗ để đoán tên.

## Chỗ hở đã biết, nói trước

**`broker.log` không có dấu giờ trên phần lớn các dòng.** Hàm `log()` trong `broker.py` ghi thẳng chuỗi, không thêm mốc thời gian; chỉ dòng `*** STATE` tự mang `@<ISO8601>` ở cuối. Nên:

- dòng `STATE` vào Loki với **giờ thật của máy**;
- dòng `CONNECT` / `[ENUM]` / `[CTRL]` vào với **giờ lúc Alloy đọc được**.

Khi tuyến đang chạy thì hai giờ lệch nhau chưa tới một giây, không sao. Nhưng **lúc gom lại một file log cũ** thì mọi dòng không phải STATE sẽ đóng dấu giờ "hôm nay" — sai. Muốn sửa tận gốc thì thêm dấu giờ vào `log()` của `broker.py`, mà đó là sửa file production nên phải hỏi chủ máy trước.

## Cái bẫy regex đã cắn thật (26/08)

Biểu thức tách dòng STATE lúc đầu viết `pat=(?P<mau>\S*)`. Tên file mẫu thật **có dấu cách**:

```
*** STATE dev=3CE4B0C54F54 cur=35854 tot=35854 state=15 pat=4153725796 front(1).DST @2026-08-26T09:34:09Z
```

`\S*` dừng ở dấu cách → `@(?P<thoi_diem>…)` hết khớp → **cả biểu thức trượt** → dòng ấy
vào Loki **không có nhãn nào**. Máy biến mất khỏi bảng mà không có lỗi nào để đọc.
Đúng kiểu hỏng im lặng. Đã sửa thành `(?P<mau>.*?)` ở cả bản native lẫn bản container.

Bài học chung: mọi nhóm bắt trong regex này bám định dạng THẬT đã xem tận mắt. Ai sửa
`broker.py` phần in log thì phải kiểm lại đúng câu truy vấn ở cuối file này.

## Bảng gọn cho người xem + tài khoản chỉ-xem (27/08)

`dahao-tinh-trang` có 18 ô, quá nửa là ô chẩn đoán (log broker, mã thô, nhịp số liệu, sổ lỗi
tuyến đo). Người đứng xưởng không cần, mà lại phải cuộn qua chúng. Nên tách hẳn bảng thứ hai:

| | `dahao-tinh-trang` | `dahao-xem-nhanh` |
|---|---|---|
| số ô | 18 | **6** |
| dành cho | người sửa hệ thống | người xem xưởng |
| ô đếm | 8 ô `w=3` | **4 ô `w=6`, nền màu, chữ 64px** |
| bảng máy | 9 cột | **6 cột** (bỏ mã máy, mũi hiện tại, mũi tổng) |
| có log broker / mã thô / nhịp số liệu | có | **không** |
| `editable` | `true` | **`false`** |

Dựng bằng `dung-bang-xem-nhanh.py` — **không viết truy vấn mới**, chép nguyên ô đã kiểm chứng từ
`dahao-tinh-trang` rồi chỉ đổi khung/tên/cỡ chữ. Chạy lại được:

```sh
cd ~/dahao-gateway/quan-sat
python3 -B dung-bang-xem-nhanh.py \
  grafana/dashboards/dahao-tinh-trang.json grafana/dashboards/dahao-xem-nhanh.json 1
```

### Tài khoản `xem`

`tao-tai-khoan-xem.py` tạo (hoặc đặt lại mật khẩu) tài khoản `xem`, vai trò **Viewer**, và đặt
luôn `dahao-xem-nhanh` làm trang chủ của tài khoản ấy — đăng nhập là thấy ngay, khỏi mò menu.

- **Mật khẩu sinh trên Mini, ghi vào `grafana-viewer.env` (chmod 600), không in ra màn hình.**
- Grafana **chỉ nghe trên địa chỉ tailnet** (`grafana.ini` → `http_addr = 100.105.80.93`), nên
  script phải gọi `http://100.105.80.93:3000`; `127.0.0.1:3000` **connection refused**.
- Kiểm bằng `thu-tai-khoan-xem.py`: đăng nhập được cả tailnet lẫn công khai, đọc bảng 200, còn
  ghi đè bảng / `/api/admin/settings` / `/api/org/users` đều **403**. `/api/datasources` trả 200
  nhưng chỉ có tên + URL, không có trường bí mật — Grafana che sẵn.

### ⚠ `.gitignore` gốc KHÔNG che được `*.env` ở đây

`.gitignore` của repo chỉ có `.env` và `.env.*`, tức khớp đúng file **tên là** `.env`. Nó
**không** khớp `grafana-admin.env`, `mcp-grafana.env`, `grafana-viewer.env`. Lần commit
`quan-sat/` đầu tiên là mật khẩu admin lọt thẳng vào lịch sử git. Đã thêm `quan-sat/.gitignore`
với `*.env` (27/08). Kiểm lại trước khi commit:

```sh
cd ~/dashboarddahao && git check-ignore -v quan-sat/grafana-admin.env
```

## Bốn bảng, mỗi bảng một việc (27/08)

Một bảng ôm hết mọi thứ thì ai mở ra cũng phải tự lọc bằng mắt. Nên tách theo **việc người xem
định làm**, chứ không theo loại dữ liệu:

| uid | Cho ai | Trả lời câu gì | Nhịp | Cửa sổ |
|---|---|---|---|---|
| `dahao-tinh-trang` | người dựng hệ thống | mọi thứ, 19 ô | 5s | 6h |
| `dahao-xem-nhanh` | người xem chung | xưởng đang thế nào | 10s | 6h |
| `dahao-can-xu-ly` | **tổ trưởng / thợ máy** | **máy nào cần ra tay, và làm gì** | 10s | 1h |
| `dahao-dut-chi` | quản đốc, kỹ thuật | đứt chỉ ở đâu, mẫu nào hay đứt | 30s | 24h |
| `dahao-mot-may` | thợ đứng tại máy | riêng máy này đang ra sao | 10s | 12h |
| `dahao-gio-may` | **chủ xưởng, kế toán** | **một ngày trôi đi đâu: thêu / dừng / chờ** | 1m | hôm nay |

> Con số **"lùi N mũi"** của `dahao-dut-chi` là **suy đoán**, không phải máy báo — máy A15
> không có trường lỗi nào. Cách suy, bằng chứng đo thật, và **chỗ nó đang đọc cao gấp ~4 lần
> vì trận dồn khung**: [`docs/lui-mui.md`](../docs/lui-mui.md).

### `dahao-can-xu-ly` — chia theo LOẠI VIỆC, không chia theo mã

Ba bảng riêng, vì ba việc phải làm khác hẳn nhau:

- 🟠 **ĐANG DỪNG GIỮA MẪU** (`ma == 1`) — dở tấm mà đứng im. Ra xem ngay. Có cột "Vì sao dừng".
- 🔴 **MẤT TÍN HIỆU** (`ma ∈ {0,2,7}`) — máy không còn gửi tin. Có thể máy tắt, rớt mạng, **hoặc
  chính đường đo hỏng**. Cột "Bridge nói gì" chép nguyên văn nhận xét của bridge, để khỏi đổ oan
  cho máy.
- ⚪ **KHÔNG CHẠY NHƯNG BÌNH THƯỜNG** (`ma ∈ {3,4,5}`) — xong tấm / chờ việc. Cần **nạp mẫu**,
  không phải sửa máy.

### Chữ to: tên máy ghim cứng, giá trị thì tuỳ loại

Thợ đứng xa bảng chứ không ngồi trước màn hình, nên ba nhóm việc của `dahao-can-xu-ly` hiện
bằng **ô chữ lớn** (mỗi máy một thẻ, tên máy ở trên, sự cố / thời gian ở dưới); bảng chữ nhỏ
đầy đủ cột bị đẩy xuống hàng gấp lại **"Chi tiết"**, bấm mới mở.

- **`titleSize: 22` ghim cứng ở cả ba ô.** Để Grafana tự co là nó ưu tiên giá trị và bóp tên
  máy bé lại — mà tên máy chính là thứ người ta cần đọc để biết đi tới máy nào.
- **`valueSize: 34` chỉ cho hai ô hiện SỐ** (🔴 mất tín hiệu, ⚪ xong tấm — giá trị dạng
  "1.4 giờ"). Ô 🟠 hiện **câu** ("đang dừng — chưa rõ vì sao", 25 chữ) thì **bỏ hẳn
  `valueSize`** để Grafana tự co; ghim cứng ở đó là câu tràn khỏi thẻ hẹp và bị cắt cụt.
- **Chiều cao ô không được dưới 6 hàng lưới.** Đo trường hợp xấu nhất (cả 13 máy dồn vào một
  nhóm): Grafana xếp lưới 2×7, mỗi thẻ ~197×113px — 22px tên + 34px giá trị vừa lọt.

⚠ Không chụp được ảnh Grafana từ máy chủ: **không có plugin `grafana-image-renderer`**
(`/api/plugins/grafana-image-renderer/settings` → 404, `/render/d-solo/...` → 500), và Grafana
nay **bắt đăng nhập**. Cách đã dùng để đo: `rut-the.py` đọc thẳng `dahao-can-xu-ly.json`, chạy
chính target của nó vào Loki, rồi dựng lại lưới thẻ ngoài Grafana theo đúng hình học ô
(`h × 30px + (h-1) × 8px`, trừ ~32px thanh tiêu đề).

### ⚠ Chặn ở LogQL, đừng lọc ở tầng bảng

`joinByField` ghép kiểu **outer** ⇒ chỉ cần MỘT target quên chặn là máy lạ vẫn hiện thành hàng,
dù cột "Tình trạng" đã lọc nó đi. Nên **mọi** target đều phải kèm:

```
and on (may) ((last_over_time({job="tinh-trang", may=~"$may"} | json | unwrap ma [3m]) by (may) == 1))
```

Cố ý **không** dùng transformation `filterByValue`: sai tên cột là nó âm thầm không lọc gì —
đúng kiểu hỏng im lặng mà dự án này đã dính mấy lần.

### Dựng lại và kiểm

```sh
python3 -B dung-bang-xuong.py grafana/dashboards/dahao-tinh-trang.json grafana/dashboards
python3 -B kiem-bang-xuong.py        # 0 = sạch
```

`kiem-bang-xuong.py` **không tin file JSON**: nó tự dựng lại tình trạng đội máy từ Loki, chạy
từng target vào Loki rồi so tập máy trả về với tập mong đợi (bắt rò rỉ outer-join), và hỏi lại
Grafana xem bảng đã nạp thật chưa. Ô log và ô đồ thị phải hỏi **kiểu range** — hỏi kiểu instant
thì Loki trả `400 log queries are not supported as an instant query type`, dễ tưởng bảng hỏng.

Đo lúc 27/08: 13 máy (1 dừng, 7 mất tín hiệu, 5 hoàn thành), không target nào rò rỉ.

## Lỗi MÁY và lỗi TUYẾN ĐO là hai chuyện — bảng phải xếp đúng thứ tự (27/08)

Câu hỏi của xưởng: *"tưởng nó có nhiều lỗi khác nữa chứ đâu phải mỗi lỗi kết nối"*. Trả lời làm
hai vế, vì hai vế khác nhau hẳn.

**Vế 1 — máy KHÔNG gửi mã lỗi ra mạng. Cái này đã đếm xong, không còn gì để đoán.**
`catalog.json` (enumerator tự phát) tới 27/08 có **280.017 khung trạng thái của 14 máy**, và mục
`states` cho thấy cả bốn giá trị `state` (`-1`/`0`/`2`/`15`) đều mang **y hệt 8 khoá**:

```
header.mesgNo  header.version  body.state  body.machineName
body.patternName  body.curStitch  body.patternStitch  body.patternNetID
```

Không một khung nào, của một máy nào, từng mang thêm trường lạ. 54 topic gom đúng 4 họ
(`auth/encode`, `auth/login`, `pattern/data/ack`, `state`) — không họ nào là alarm/fault. Và
`netstat -an -p tcp` cho thấy 13 máy **chỉ nối đúng cổng 3865**, tức không có kênh thứ hai để mà
giấu mã lỗi. Trường duy nhất nghe như lý do là `body.reason` (`"success"`), nhưng nó nằm ở
`pattern/data/ack` — **biên nhận đẩy file**, không phải trạng thái máy.

**Vế 2 — nhưng "không có trường lỗi" KHÔNG có nghĩa là không biết máy lỗi gì.** Suy từ số mũi thì
biết khá nhiều, và `soi-lan-dung.py` đã chạy sẵn (`job="va-mau"`, launchd `com.dahao.landung`):

| nhãn | ý nghĩa | đo được |
|---|---|---|
| `nghi-dut-chi` | có người **lùi khung** rồi cho chạy tiếp — đúng thao tác vá §2.4 | 65 lượt |
| `dung-ngan` | dừng vài giây, không lùi — đổi màu / cắt chỉ / chỉnh nhanh | 57 lượt |
| `dung-lau` | dừng lâu, không lùi mũi | 19 lượt |
| `doi-mau` | bỏ dở, nhảy sang mẫu khác | 13 lượt |
| `dung-han` | dừng giữa mẫu rồi thôi, chưa chạy lại | 8 lượt |

**Vấn đề thật không phải thiếu tính năng, mà là thiếu THỨ TỰ.** Năm ô đọc nguồn ấy (12, 13, 14,
15, 16) vốn nằm ở `y=83..105` — sau NĂM ô cao 10–15 hàng. Trên điện thoại thì coi như không tồn
tại, nên người xem kết luận "dashboard chỉ biết mỗi lỗi kết nối". Đã xếp lại:

```
y=0   8 ô đếm w=3: Tổng máy · Đang chạy · Đang lỗi · Cảnh báo ·
                   Nghi đứt chỉ · Lần dừng · Mất tín hiệu · Nhịp số liệu
y=4   ô 18  Máy nào đang báo lỗi — và lỗi gì      (thêm cột "Lần dừng gần nhất")
y=11  ô 15  Vì sao máy dừng — SUY TỪ SỐ MŨI       <- LỖI MÁY, nguyên văn từng lần
y=21  ô 14 + ô 16  Máy hay phải vá / lý do theo thời gian
y=30  ô 19  Sổ báo lỗi TUYẾN ĐO                   <- lỗi kết nối, để sau
y=38  ô 7, rồi 5, 6, 10, 9, 8
```

Cột "Lần dừng gần nhất" của ô 18 phải chốt bằng `and on (may) (…muc_ten!="thuong"…)`, vì
`joinByField` ghép kiểu **outer**: hỏi `va-mau` trần thì mọi máy vừa dừng trong 30 phút đều lọt
vào bảng, kể cả máy đang chạy ngon. Đây đúng lối target G của ô 7.

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

### Bốn ô nhìn theo TỪNG MÁY

Câu "máy **đó** chạy bao lâu" được trả lời ở bốn chỗ, mỗi chỗ hợp một kiểu người xem:

| ô | kiểu | trả lời |
|---|---|---|
| 430 `Từng máy — một ngày trôi đi đâu` | bảng | 19 dòng × 12 cột — số chính xác, cộng chân bảng |
| 450 `Từng máy chạy bao lâu — xếp cạnh nhau` | thanh ngang | so bằng mắt, mỗi máy một thanh chia bốn khúc màu |
| 460 `Từng máy thêu vào những giờ nào` | cột chồng theo giờ | máy nào thêu vào lúc nào; cột **Total** ở chú giải = tổng giờ thêu của từng máy |
| ô `Máy` trên đầu bảng | bộ lọc | chọn một máy thì **mọi ô** phía trên cũng chỉ tính máy ấy |

Ô 450 xếp máy **theo số**, không xếp theo giá trị — để lần nào mở cũng tìm được máy của mình ở
đúng chỗ cũ. Thanh của mọi máy **dài bằng nhau** (đúng bằng khoảng đang xem) vì bất biến bốn rổ;
cái đáng nhìn là **tỷ lệ màu**, không phải độ dài.

Ô 460 chỉ vẽ rổ `chay`, xếp chồng — chiều cao cả cột là giây thêu của cả xưởng, mỗi dải là một
máy. Cả cột tụt = cả xưởng cùng nghỉ; **một** dải biến mất trong khi các dải khác vẫn dày = riêng
máy ấy có chuyện.

> Máy 17/18/19 hiện đọc **100 % “mất tín hiệu”** — đã khai trong `may.json` nhưng chưa hề gửi
> khung nào. Đó là sự thật của xưởng, không phải ô hỏng; ô “Tỷ lệ thêu” của ba máy ấy để **trống**
> (mẫu số lọc `> 0`) vì "không biết" đúng hơn số 0.

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

### ⚠ Bẫy: `allowUiUpdates: true` làm Grafana LẶNG LẼ BỎ QUA file

`native/provisioning/dashboards/tu-dong.yml` bật `allowUiUpdates: true` (cho người vận hành sửa
nhanh trên giao diện). Hệ quả: provisioning **so `version` trong file với `version` trong DB, và
bỏ qua nếu file thấp hơn** — không một dòng log, không lỗi, `mtime` file mới tinh, mà bảng thật
không đổi gì. Đã cắn 27/08: file `version` 3 trong khi DB đang ở 10.

Quy tắc: **sửa file xong phải đặt `version` LỚN HƠN bản trong DB**, rồi đợi 30 s và kiểm bằng
chính API — đừng tin file, cũng đừng tin `kiem-bang-bao-loi.py` (nó đọc file).

```sh
cd ~/dahao-gateway/quan-sat
(set -a; . ./mcp-grafana.env; set +a; curl -s -A kiem/1.0 \
  -H "Authorization: Bearer $GRAFANA_SERVICE_ACCOUNT_TOKEN" \
  "$GRAFANA_URL/api/dashboards/uid/dahao-tinh-trang" | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["dashboard"]["version"])')
```

## Báo lỗi: ô "Lỗi" từng KHÔNG THỂ khác 0, và ô "Máy off" chưa từng đúng (vá 27/08)

Hai ô đếm trên cùng bảng `dahao-tinh-trang` đều nói sai, mỗi ô sai một kiểu, và **không ô nào báo
lỗi gì cả** — chúng chỉ lặng lẽ trả về một con số trông có vẻ bình thường.

**Ô "Lỗi" hỏi một câu không bao giờ có câu trả lời.** Nó đếm `ma == 0` (`tinh_trang == 'loi'`), mà
`'loi'` là kết quả *không thể đạt được* với đường dữ liệu hiện nay. Ba đường độc lập, cả ba đều cụt:

1. `state_to_status()` trong `broker.py` chỉ trả `unknown` / `running` / `stopped` — **không nhánh
   nào trả `fault`**. Nhánh `t == 'fault'` bên `tinh_trang()` là mã chết.
2. `controller_state_event()` đóng cứng `severity: 'info'`, mà `alerts.mjs` bỏ qua đúng mức ấy
   (`if (event.severity === 'info') continue`). `maintenance` rỗng cả 13 máy, `threadBreakWarnPer1000`
   là `null`. ⇒ `deriveAlerts()` **không có đường nào ra `critical`**.
3. `telemetryError` là `null` ở cả 13 máy.

Đo lại 24 giờ trong Loki: `loi` xuất hiện **0 lần trên ~3.600 mẫu**. Đây là lỗi định tuyến mức
nặng-nhẹ, không phải lỗi hiển thị — và nó nuốt luôn **mọi cảnh báo mức `warning`** mà bridge vẫn
đang sinh ra đều đặn.

**Ô "Máy off" đếm đúng số nhưng gọi sai tên.** Đối chiếu chéo `ket_noi` × `tinh_trang` trong 24 giờ:
`off` xảy ra **185 lần, cả 185 đều là `ket_noi='unknown'`, không lần nào là `offline`**. Mà
`freshness.mjs:67` cố ý phân biệt hai cái, vì ngoài xưởng là hai việc khác nhau:

| bridge nói | nghĩa thật | thợ phải làm gì |
|---|---|---|
| `unknown` + `reachable=true` | host còn nhấc máy, adapter thôi trả số liệu hợp lệ | đi cắm lại dây / xem adapter |
| `offline` | bridge gọi, không ai nhấc | đi bật máy |

Bảo "máy off" cho vế thứ nhất là sai người sai việc: thợ đi bật một cái máy đang bật.

### Cách vá

Thêm một trục **mức nặng-nhẹ tách hẳn khỏi tình trạng** — `MA_MUC = {'thuong':0, 'canh-bao':1,
'loi':2}`. Tách vì một máy đang thêu ngon vẫn có thể đang có cảnh báo, và một máy `hoanthanh` nằm
26 phút vẫn đáng gọi người: `tinh_trang` một mình không nói được cả hai chuyện.

`bao_loi()` trả `(muc, loi_do, loi_text, loi_nguon, loi_so)`, trong đó `loi_text` là **nguyên văn
câu bridge nói**, không viết lại. Thứ tự xét: `telemetryError` → `fault` thô → cảnh báo `critical`
→ adapter câm → cảnh báo `warning` → máy tắt hẳn.

`loi_nguon` chép thẳng trường `source` của `alerts.mjs` (`controller` / `sensor` / `bridge` /
`dashboard`) và **phải giữ nguyên**. Gọi một suy đoán của bridge là "controller báo" là đẩy thợ đi
mở máy tìm một cái lỗi mà controller chưa từng khai. Tới hôm nay **mọi dòng đều là `bridge`** —
giao thức A15 không có trường lỗi (224.016 khung, luôn đúng 8 trường; 51 topic chia 4 họ, không họ
nào là alarm). Máy đứt chỉ, gãy kim thì báo trên màn hình HMI của nó.

`off` giữ nguyên **số 2** dù đổi tên hiển thị thành "mất tín hiệu", vì 185 điểm lịch sử trong Loki
đã mang số ấy — đánh số lại là làm sai ngược cả quá khứ. `tat-han` nối vào **đuôi** bảng thành số 7.

## Máy im rồi thì vì sao nó im — thang bằng chứng

Câu hỏi của xưởng, nguyên văn: *"tôi muốn nó phân biệt được lúc nào không làm và lúc nào nó mất
tín hiệu"*. Trước 28/08 mọi thứ im đều bị dán **một** chữ `off` = "mất tín hiệu". Phát lại nhật ký
27/08 đo được cái giá của việc ấy: **trưa 12h có 1 035 lượt `off`, trong đó 636 lượt (61,4 %)** là
máy đã thêu xong tấm rồi thợ tắt đi ăn cơm — báo động giả về hơn một nửa số lượt.

**Dữ kiện gốc cho phép suy:** máy A15 cắm điện thì đẩy khung **mỗi 2 giây, 24/7, kể cả lúc rảnh**
(đo trên `602602704E7B`: 1 799 khung/giờ suốt đêm). ⇒ **Máy im không bao giờ nghĩa là "máy rảnh"**;
nó nghĩa là mất điện, đứt mạng, hoặc có người tắt.

Trong nhánh `kn not in ('online','stale')`, xét lần lượt từ bằng chứng **chắc nhất** xuống:

| # | Hỏi gì | Ra mã | Số | Vì sao được phép kết luận |
|---|---|---|---|---|
| 1 | Ngoài giờ xưởng chạy? (`06:00-19:00` VN) | `ngoai-gio` | 8 | Cả xưởng về rồi thì im là đúng dự kiến |
| 2 | **Không còn một máy nào** đang nói? | `cum-im` | 9 | 13 cái máy không cùng hỏng một lúc ⇒ mất điện / đứt mạng / bộ ghi chết. Không quy được cho máy nào |
| 3 | Bridge nói `offline`? | `tat-han` | 7 | Lời của bridge mạnh hơn mọi suy luận của mình: gọi mà host không nhấc máy |
| 4 | Một mình nó im, **và** lần đọc cuối cho thấy **đã thêu hết tấm** | `tat-may` | 10 | Xong tấm rồi mới im = tắt có chủ ý |
| 5 | Còn lại | `off` | 2 | Im **giữa lúc mẫu còn dở** = mất tín hiệu thật; hoặc **chưa đủ số để nói** |

Hai chỗ **cố ý không suy tiếp**, đừng đi "sửa" thành thông minh hơn:

- Bước 2 chỉ nổ khi `noi == 0` **tuyệt đối**. Mọi ngưỡng kiểu "quá nửa số máy im" đều là một con
  số bịa, dữ liệu xưởng chưa đỡ nổi.
- Bước 5 gộp *"mất tín hiệu thật"* với *"không đủ số để nói"* vào cùng mã `off`. Muốn tách hai cái
  đó thì đọc `dang_do`: `True` = đang thêu dở (mất tín hiệu thật), `None` = chưa đọc được số nào.
  Đoán bừa `None` thành "chắc thợ tắt máy" là có ngày giấu mất một cái máy chết.

### Sổ nhớ số mũi — `quan-sat/nho-viec.json`

Thứ tách bước 4 khỏi bước 5 là **số mũi của lần đọc cuối**, mà số ấy nằm trong RAM của bridge
(`bridge-service.mjs` `this.telemetry = new Map()`, không nạp lại từ đĩa) và **mất sạch mỗi lần
bridge khởi động lại**. Đo thật lúc 16:42 ngày 28/08, ngay sau lần cúp điện: **4/4 máy đang im
không còn một số mũi nào** — đúng lúc cần phân biệt nhất thì lại mù nhất.

`SoNhoViec` chép số ấy ra đĩa. Luật:

- **chỉ ghi lời máy khai** (`mui`/`tong`), không ghi kết luận của mình;
- **không tự vứt mục cũ** — số của hôm kia vẫn là số đo được; ai cần lọc thì lọc bằng `dang_do_luc`;
- ghi ra file tạm rồi `os.replace` — cúp điện giữa chừng thì sổ cũ nguyên vẹn;
- hỏng thế nào cũng **không được làm chết bộ đẩy** (đường dẫn không ghi được ⇒ tắt sổ, chạy tiếp).

Máy im từ **trước** khi sổ ra đời thì sổ không có mục nào. Mồi lại từ nhật ký đã có:

```sh
cd ~/dahao-gateway/quan-sat
python3 -B mo-so-nho.py            # chạy thử, chỉ in
python3 -B mo-so-nho.py --that     # ghi thật
launchctl stop com.dahao.tinhtrang # KeepAlive bật lại, nạp sổ mới
```

Đo ngay sau khi mồi (28/08): `60260295C907` và `602602A6F22B` chuyển từ `off` sang `tat-may`
(`dang_do_nguon: nho`, `dang_do_luc: 2026-08-27T11:30Z` — thêu xong tấm lúc 18:30 VN tan ca);
`602602621948` và `A15-MQTT` **vẫn ở `off`** vì chưa từng có số mũi dùng được trong cả nhật ký —
đúng như thiết kế, không đủ số thì không bịa.

### Ba trường mới trên mỗi dòng

| Trường | Giá trị | Nghĩa |
|---|---|---|
| `dang_do` | `true` · `false` · `null` | đang thêu dở · xong tấm/chưa nạp mẫu · **không đủ số để nói** |
| `dang_do_nguon` | `song` · `nho` · `null` | số lấy từ khung đang chạy · từ sổ nhớ trên đĩa · không có |
| `dang_do_luc` | mốc ISO hoặc `null` | **số ấy đo lúc nào** — kết luận `tat-may` dựa vào số 3 ngày trước trông khác hẳn số 2 giây trước |

⚠ **`xem/index.html` là bản chép tay của `tinh_trang()` — sửa một bên phải sửa bên kia.** Lời dặn
này đã từng bị bỏ qua: bản `xem/` đứng im suốt **4 mã liền**. Có bài đối chiếu chạy được:
sinh ma trận ca (`kn` × số mũi × trạng thái × giờ × bối cảnh đàn) rồi chấm bằng cả hai bản, so
từng ca. Lần chạy 28/08: **3 154/3 154 ca khớp**, phủ đủ 11 nhãn.

### Bẫy khi dựng bảng

- **`loi_text` KHÔNG được làm nhãn, và cũng không gộp nhóm được.** Câu của bridge có số giây đang
  chạy trong đó (`...hợp lệ 4302s.`), nên `by (may, ten, loi_do, loi_nguon, loi_text)` cho **một máy
  ra ba dòng** (4302s / 4323s / 4344s). Gộp theo `loi_do` (ít giá trị, đứng yên) rồi ánh xạ ra tiếng
  Việt bằng `mappings`; câu nguyên văn để ô nhật ký lo.
- **`muc_ten` làm nhãn thì an toàn**: 3 giá trị × 13 máy × 8 tình trạng = tối đa 312 luồng.
- **Target kiểu bảng phải có `format: "table"`.** Thiếu nó thì `joinByField` trên `may` không tìm
  thấy cột để ghép và bảng ra rỗng — **không lỗi nào để đọc**.
- **`doi_loi` chỉ bật khi thật sự CHUYỂN.** Lần đầu gặp một máy (bộ đẩy vừa restart) thì không có gì
  để so; nếu coi đó là "đổi" thì mỗi lần restart sổ báo lỗi nổ một tràng "đã hết báo lỗi" cho cả 13
  máy vốn chưa từng lỗi. Đã cắn thật lúc lên bản này.
- **`GRAFANA_URL` là đường công khai qua Cloudflare**, và Cloudflare trả 403 cho `Python-urllib/*`.
  Không phải token sai — cùng token ấy `curl` vẫn 200. Đặt `User-Agent` khác là xong.
- **`/api/ds/query` không trả bảng đã dàn cột.** Mỗi series là một frame `Time`+`Value`, nhãn nằm
  trong `schema.fields[…].labels`; chính Grafana ở trình duyệt mới trải nhãn thành cột. Đọc thô sẽ
  tưởng truy vấn hỏng trong khi bảng thật vẫn vẽ đúng.

### ⚠ Bẫy đã cắn: ô ĐẾM chỉ biết mã cũ thì lặng lẽ đọc 0

Tách năm mã im xong, ba chỗ **đếm** vẫn hỏi theo bảng cũ (`tt === 'off'`, hoặc `ma == 2 or
ma == 7`). Hậu quả: phần lớn máy im rơi ra ngoài mọi ô — **cả xưởng cúp điện mà ô đọc 0, đúng
vào lúc cần nó nhất**. Đo trên production lúc vá (28/08, 17:40 VN): **11/13 máy đang im**, ô cũ
đọc **3**.

Ba ô đã vá, và chúng **cố ý không giống nhau** vì trả lời ba câu khác nhau:

| Chỗ | Đếm gì | Vì sao |
|---|---|---|
| `xem/index.html` → `veTong()` ô "Máy off" | mọi mã trong bảng **`TT_IM`** | Đếm bằng chính bảng mà `chuLau()`/`theMay()` đang dùng ⇒ thêm mã im mới là ô tự đúng theo, không phải nhớ sửa hai chỗ |
| Grafana `dahao-tinh-trang` ô 4 — đổi tên **"Mất tín hiệu" → "Máy im"** | cả 5 mã: 2, 7, 8, 9, 10 | Bảng toàn cảnh hỏi *"có bao nhiêu máy đang không nói gì"*. Ban đêm ô này đọc gần bằng tổng số máy là ĐÚNG; dòng thời gian ngay dưới nói rõ từng máy im vì lý do nào |
| Grafana `dahao-can-xu-ly` ô 102 "Mất tín hiệu" | chỉ mã mức ≥ 1: 0, 2, 7, 9 | Bảng việc-cần-làm. **Cố ý bỏ 8 (ngoài giờ) và 10 (thợ tắt máy)** — hai cái đó mức 0 vì là chuyện bình thường; kéo vào thì đêm nào bảng cũng đỏ và người ta thôi nhìn nó |

Đừng "đồng bộ hoá" ba ô này thành một con số. Chúng không phải ba phần của một cái bánh.

Vá bằng `quan-sat/va-o-off.py` (trang) và `quan-sat/va-o-im.py` (Grafana) — cả hai sửa **thẳng
vào file**, chạy lại lần nữa thì báo `bỏ qua — đã đúng`. Grafana đọc file mỗi 30 giây; POST qua
API sẽ bị chính nó ghi đè lại.

### ⚠ Bẫy thứ hai: bài thử đo đúng chữ mà không đo con số

`scripts/xem-tu-vung.mjs` có một ca tên *"đồng hồ đếm từ bản tin CUỐI CÙNG, không từ
statusSince"* — nhưng hàm dựng máy của nó luôn đặt `lastTelemetryAt = bây giờ`, mà `tuoiGiay()`
đọc đúng trường ấy. Nên ca đó xưa nay chạy trên tuổi = 0 và chỉ so được **chữ đứng trước số**.
Đã thêm tham số `im` (giây đã im) và ghim luôn con số, kèm `tu: 99999` đặt lệch hẳn để nếu đồng
hồ lỡ đếm nhầm nguồn thì bài thử đỏ ngay thay vì im lặng đo sai.

Cùng lớp với chuyện ghim đồng hồ: `gioVN(g)` đẩy `lechDongHo`, **phải trả về 0 ngay sau đó** —
không trả thì mọi bài đo TUỔI phía dưới lệch đúng bằng chỗ đã đẩy, và trang đúng mà bài thử đỏ.

### Kiểm lại

```sh
cd ~/dahao-gateway/quan-sat
python3 -B dong-bo-tinh-trang.py --tu-kiem          # 74 ca, gồm 10 ca riêng cho sổ nhớ số mũi
(set -a; . ./mcp-grafana.env; set +a; python3 -B kiem-bang-bao-loi.py)
```

`kiem-bang-bao-loi.py` dựng lại ô 18 ở dòng lệnh và soi hộ hai thứ Grafana không cho xem: **máy nào
ra hai dòng** và **ô nào `NaN`/rỗng** (Grafana ghép bảng + ánh xạ chữ ở phía trình duyệt, không API
nào trả về bảng cuối cùng). Truyền số ô để soi ô khác, vd `... kiem-bang-bao-loi.py 7`.

## Nhãn dùng để lọc

| Nhãn | Giá trị | Dùng để |
|---|---|---|
| `job` | `broker`, `bridge`, `bridge-kiem-toan`, `tunnel`, `xoay-log` | chọn nguồn |
| `may` | định danh máy, vd `602602704E7B` | **tách từng máy thêu** |
| `trang_thai` | `-1`, `15` (tính tới nay) | lọc theo trạng thái |
| `muc_ten` | `thuong`, `canh-bao`, `loi` | **mức nặng-nhẹ, tách khỏi tình trạng** |
| `tinh_trang` | `loi` `dung` `off` `chuaro` `hoanthanh` `cho` `chay` `tat-han` `ngoai-gio` `cum-im` `tat-may` | kết luận của bridge (mã số 0…10, xem thang bằng chứng ở trên) |
| `loai` | `trang-thai`, `ket-noi`, `ngat-ket-noi`, `enum`, `mau-thieu`, `day-file` | bỏ nhiễu |

Số mũi (`mui_hien_tai`, `mui_tong`, `mau`) **cố ý không làm nhãn** — chúng chạy từ 0 tới hàng chục nghìn, làm nhãn là đẻ hàng vạn luồng và giết Loki. Chúng nằm ở structured metadata, vẫn tra được. Đã kiểm bằng `/loki/api/v1/labels`: danh sách nhãn thật không có chúng.

## Vài câu truy vấn hay dùng

```logql
# Server đang giữ mấy máy?
count(count by (may) (count_over_time({job="broker", loai="trang-thai"}[5m])))

# Máy nào vừa im?
sum by (may) (rate({job="broker", loai="trang-thai"}[1m]))

# Kiểm nhanh sau khi ai đó sửa broker: có dòng STATE nào MẤT nhãn `may` không?
# Nhìn danh sách nhóm trả về — HIỆN RA MỘT NHÓM KHÔNG CÓ NHÃN `may` là regex đã trượt
# (xem mục "cái bẫy regex" ở trên).
sum by (may) (count_over_time({job="broker", loai="trang-thai"} [15m]))

# ĐỪNG dùng `| may = ""` để đếm dòng mất nhãn: trong truy vấn metric nó trả về
# một con số khác 0 ngay cả khi mọi dòng đều có nhãn. Đã đo thật 26/08:
# `| may = ""` báo 45, còn `sum by (may)` cho thấy 13 nhóm và không nhóm nào rỗng.

# Đã có lần đẩy file nào chưa?
{job="broker", loai="day-file"}

# Bỏ 99% dòng lặp để còn nhìn thấy phần có tin
{job="broker"} != "*** STATE"

# Máy nào đang có chuyện, và bridge nói NGUYÊN VĂN là gì?
{job="tinh-trang", muc_ten!="thuong"} | json | line_format "{{.ten}} · {{.loi_do}} · {{.loi_text}}"

# Chỉ những lúc CHUYỂN vào/ra trạng thái báo lỗi (bỏ hết nhịp tim lặp)
{job="tinh-trang"} | json | doi_loi="true"

# Đếm máy đang lỗi / đang cảnh báo (đúng câu hai ô đếm đang dùng)
count(last_over_time({job="tinh-trang"} | json | unwrap muc [2m]) by (may) == 2) or vector(0)
count(last_over_time({job="tinh-trang"} | json | unwrap muc [2m]) by (may) == 1) or vector(0)
```

## Vì sao không dùng OrbStack

Đã gặp ngày 26/08 trên macOS 26.4 (25E246), OrbStack 2.2.3: `orb start` báo *"start VM: timed out waiting for VM to start"*, `vmgr.log` dừng ở `phase=create_vm` và không đi tiếp. Đã loại trừ:

- chữ ký app hỏng — `codesign --verify --deep --strict` sạch, `spctl` báo *Notarized Developer ID*;
- Gatekeeper chặn — `accepted`;
- thiếu tài nguyên — 16 GB RAM, 404 GB đĩa trống.

Stack của `vmgr` cho thấy luồng chính nằm im trong `_dispatch_semaphore_wait_slow`, và `lsof` cho thấy nó **chưa mở file đĩa VM nào** — tức là chưa từng tạo được máy ảo, chứ không phải tạo rồi treo. Phần cài đặt lần đầu của OrbStack cần màn hình và mật khẩu quản trị, mà Mini chạy không màn hình (`screencapture` báo *could not create image from display*).

Nên đã chọn đường brew — không máy ảo, không Docker, ít thứ hỏng hơn một tầng. Muốn quay lại container thì `docker-compose.yml` vẫn nằm nguyên trong thư mục này.
