# Triển khai E2 lên Mac Mini — sổ tay từng bước

Áp dụng cho `PRD_LICH_SU_LOI_MAY.md` mục E2 (broker chuyển lời máy sang bridge) và các thay đổi
enumerator A1–A3 (`firstSeen`, nạp lại catalog khi khởi động, `enum-growth.csv`).

## 0. Thay đổi thật sự là gì

**Đúng MỘT file: `broker.py`.** Đã đối chiếu gói cài với cây nguồn hôm nay:

| Thành phần | Gói cũ (đang chạy) vs hiện tại |
| --- | --- |
| `bridge/` | **khớp từng byte** — không đổi |
| `dist/` (dashboard) | **khớp từng byte** — không đổi |
| `broker.py` | 13.977 → **36.502 byte** |

Nên **không cần chạy `install.sh`**. `install.sh` làm `rsync --delete` cả `bridge/` lẫn `dist/`
rồi nạp lại cả ba launchd agent — tức là dừng luôn cái bridge đang phục vụ dashboard, để đổi
một thứ không hề đổi. Đường dưới đây chỉ đụng broker.

Gói `dahao-gateway.tar.gz` **đã được đóng lại** (22/08) và có test canh (`scripts/deploy-mini-sync.test.mjs`).
Gói cũ giữ lại nguyên vẹn ở `dahao-gateway.PRE-E2.tar.gz` — đó là hiện vật lùi về.

---

## 1. Trước khi đụng vào Mini — chạy trên máy này

```bash
npm run verify                      # phải exit 0
```

Hôm 22/08: 53 file / 825 test, build, bridge:check, hai self-test Python — xanh.

## 2. Chép gói sang Mini

```bash
scp deploy-mini/dahao-gateway.tar.gz  <mini>:~/Downloads/
```

## 3. Trên Mini — kiểm TRƯỚC khi đổi

```bash
cd ~/Downloads && rm -rf deploy-mini && tar xzf dahao-gateway.tar.gz && cd deploy-mini

python3 -m py_compile broker.py                 # exit 0, không in gì
python3 tests/test_enumerator.py                # == ENUM SELF-TEST PASS ==
python3 tests/test_frame.py                     # == FRAME SELF-TEST PASS ==
```

Ba lệnh này chạy **offline**, không đụng máy thêu, không đụng broker đang chạy. Một trong ba
trượt ⇒ **DỪNG**, không đổi gì cả.

Ghi lại hiện trạng để lát nữa đối chiếu:

```bash
python3 - <<'PY'
import json; d=json.load(open('/Users/'+__import__('os').getlogin()+'/dahao-gateway/catalog.json'))
print('TRUOC:', len(d.get('topics',{})),'topic |',len(d.get('states',{})),'state |',len(d.get('fields',{})),'field')
PY
```

## 4. Đổi broker — có đường lùi trước khi có đường tiến

```bash
APP=~/dahao-gateway
cp "$APP/broker.py" "$APP/broker.py.pre-e2.bak"     # ĐƯỜNG LÙI — làm trước, không bỏ qua
cp ~/Downloads/deploy-mini/broker.py "$APP/broker.py"
launchctl kickstart -k gui/$(id -u)/com.dahao.broker
```

## 5. Xác minh — theo đúng thứ tự này

```bash
# 5.1 Broker sống lại
launchctl list | grep dahao

# 5.2 A2 hợp nhất được catalog cũ (KHÔNG mất độ phủ đã tích luỹ)
grep "nạp lại catalog cũ" ~/dahao-gateway/logs/broker.out | tail -1
#   mong đợi: "[ENUM] nạp lại catalog cũ: N topic, M state, K field (lần chạy thứ 1)"
#   N/M/K phải KHỚP số ghi ở bước 3. Lệch = A2 hỏng ⇒ lùi ngay.

# 5.3 Máy thêu nối lại và bridge vẫn nhận
tail -20 ~/dahao-gateway/logs/broker.out | grep -E "STATE|forward|ENUM"
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8790/api/health   # 200

# 5.4 Dashboard vẫn xanh: mở http://100.105.80.93:8790 — máy phải là `online`
```

Nếu 5.2 hoặc 5.3 sai ⇒ **lùi ngay** (mục 7), đừng chẩn đoán trên máy đang chạy.

## 6. Câu hỏi mà lần triển khai này SINH RA để trả lời

Đây mới là lý do triển khai, không phải bản thân việc đổi file.

```bash
# 6.1 Máy có tự gọi tên trạng thái của nó không? — quyết định E3 làm được hay không
grep -c wstrStatusDesc ~/dahao-gateway/catalog.json

# 6.2 Đã bắt được những trạng thái nào
python3 -c "import json;d=json.load(open('$HOME/dahao-gateway/catalog.json'));print(list(d['states']))"

# 6.3 Đường cong khám phá (A3) — mỗi 30s một dòng
tail -5 ~/dahao-gateway/enum-growth.csv
```

- **6.1 > 0** ⇒ máy tự khai bằng lời. E2 bắt đầu chuyển lời đó sang dashboard ngay, và E3 có
  cơ sở để nhận diện trạng thái nào là lỗi.
- **6.1 = 0** ⇒ máy **không** gửi `wstrStatusDesc`. E2 nằm im (đúng thiết kế: máy không nói
  thì không nói hộ), và "lỗi gì" sẽ phải suy từ số `state` — một việc khó hơn, và vẫn phải chờ
  một ca chạy thật để thấy số nào ứng với lỗi. Đây là kết quả **hợp lệ**, không phải thất bại.

Sau đó **để chạy qua trọn một ca sản xuất**. Đó là thứ `PRD_DO_THOI_GIAN_DAY_CATALOG.md` đang
đợi, và là thứ mở khoá E1 → E3 → phần còn lại của `PRD_LICH_SU_LOI_MAY.md`.

## 7. Lùi về — một lệnh

```bash
cp ~/dahao-gateway/broker.py.pre-e2.bak ~/dahao-gateway/broker.py
launchctl kickstart -k gui/$(id -u)/com.dahao.broker
```

Lùi broker **không** mất dữ liệu: `catalog.json` và `enum-growth.csv` nằm ngoài file bị đổi.
Bản cũ không đọc `enum-growth.csv` nên nó chỉ ngừng dài thêm.

Cần lùi cả gói (trường hợp đã lỡ chạy `install.sh`): dùng `deploy-mini/dahao-gateway.PRE-E2.tar.gz`.

## 8. Rủi ro đã cân nhắc

| Rủi ro | Xử lý |
| --- | --- |
| Frame mới có thêm `events[]` làm bridge từ chối cả gói | Đã chặn bằng test nối Python↔JS (`scripts/broker-frame.test.mjs`) — chính nó bắt được lỗi `id` dài 106 ký tự vượt trần 80. Chạy lại ở bước 1 |
| A2 nạp nhầm catalog rác rồi trộn vào dữ liệu thật | Catalog trên Mini là bản production thật; bước 3 ghi lại số trước, bước 5.2 đối chiếu |
| `install.sh` dừng bridge đang phục vụ dashboard | Không chạy `install.sh`. Chỉ đổi `broker.py` |
| Mỗi nhịp `state` thành một cảnh báo | Sự kiện phát ở mức `info`; `bridge/lib/alerts.mjs:37` bỏ qua đúng mức này. Có test khoá ở cả hai phía |
| Gói cài lạc hậu, cài lại là lùi âm thầm | `scripts/deploy-mini-sync.test.mjs` nay canh cả tarball; đã kiểm chứng ngược |

## 9. Điều KHÔNG làm trong lần triển khai này

- **Không** chạy `install.sh` (mục 0).
- **Không** đụng máy thêu: không đổi `C41`/`C44`, không bắn `enumprobe`, không gây lỗi để lấy mẫu.
- **Không** sửa `bridge/` — nó không đổi, và đổi nó là dừng dashboard.
- **Không** kết luận "đã xong tính năng báo lỗi". Lần này chỉ mở đường dữ liệu; phần lỗi
  (E3 trở đi) vẫn chờ một ca chạy thật.
