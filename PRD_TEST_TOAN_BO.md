# PRD — Kiểm thử toàn bộ hệ thống Dahao

[PRD]

Tài liệu này đứng trên `PRD_DO_THOI_GIAN_DAY_CATALOG.md` (một phép đo cụ thể) và dưới
`PRD_CLAUDE_READONLY_FLEET.md` (sản phẩm). Nó trả lời câu hỏi bao trùm: **dựa vào đâu để tin
bản đang chạy là đúng?**

## 0. Câu trả lời ngắn

- Bộ test hiện tại **xanh, nhanh, và lệch chỗ**: 813 test / 50 file / **1,35 giây**, pass 100%.
  Nhưng nó phủ gần như toàn bộ ở **tầng hàm thuần**, và trống ở đúng ba chỗ lỗi thật sẽ xảy ra.
- Ba lỗ hổng là **cấu trúc**, không phải thiếu công sức: (1) không có môi trường DOM nên
  21 component + 3 hook **không thể** test; (2) `bridge/index.mjs` — 492 dòng, 20 route, chính
  là chỗ thực thi phân quyền — không có một test nào; (3) `broker.py` nằm **ngoài** cổng
  `npm run verify`.
- Một rủi ro âm thầm: **15 trong 50 file test là bản sao của nhau**.
- Kết luận về hướng đi: dự án này **không cần nhiều test hơn, cần test đúng chỗ**.

---

## 1. Hiện trạng đo được (chạy thật 22/08/2026, không suy đoán)

### 1.1 Con số

| Lệnh | Kết quả |
| --- | --- |
| `npx vitest run` | **50 file / 813 test**, pass hết, 1,35 s |
| `python3 deploy-mini/tests/test_enumerator.py` | **10/10 pass**, offline — nhưng **không** nằm trong `npm run verify` |
| `npm run verify` | `test && lint && build && bridge:check` — **không chạm** `broker.py` |

### 1.2 Phủ theo tầng

| Tầng | Module | Có test | Trạng thái |
| --- | ---: | ---: | --- |
| `src/lib` (logic thuần) | 14 | 13 | Tốt. Thiếu `csv.ts` |
| `bridge/lib` | 22 | 15 | Thiếu `adapters`, `alerts`, `network`, `rate-limit`, `config`, `atomic-file`, `logger` |
| `scripts/lib` | 5 | 5 | Đủ |
| `firmware/esp32-stitch-node` | — | 1 | `stitch-logic` |
| **`src/components`** | **21** | **0** | **Trống hoàn toàn** |
| **`src/hooks`** | **3** | **0** | **Trống hoàn toàn** |
| **`bridge/index.mjs`** | **1** (492 dòng) | **0** | **Trống hoàn toàn** |
| `src/services` | 2 | 1 | `bridgeApi.ts` không có test |
| `deploy-mini/broker.py` | 1 | 1 | Có, nhưng ngoài cổng |

### 1.3 Vì sao component "không thể" test chứ không phải "chưa" test

`package.json` devDependencies **không có** `@testing-library/react`, **không có** `jsdom`,
**không có** `happy-dom`. `vite.config.ts` **không có khối `test`**. Nghĩa là hôm nay không tồn
tại môi trường DOM nào để render một component. Đây là việc phải **dựng** (T5), không phải việc
phải **viết thêm**.

### 1.4 Chỗ thực thi phân quyền không có test

`bridge/index.mjs:377`:

```js
if (route.permission) assertPermission(session, route.permission)
```

Bảng route ở dòng 141 có **20 route**, hôm nay **20/20 đều khai `permission`** (đã đếm), 9 route
có `limiter`. `authz.mjs` được test kỹ ở tầng lib. Nhưng **việc gắn** authz vào route thì không
có test nào. Câu `if (route.permission)` nghĩa là: route **quên khai** `permission` sẽ đi thẳng
qua, không lỗi, không cảnh báo. Bộ test vẫn xanh.

### 1.5 `deploy-mini/bridge/` là bản sao nguyên si của `bridge/`

`diff -rq bridge deploy-mini/bridge` → **rỗng**, 38 file mỗi bên (đã kiểm hôm nay, hai bên đang
khớp). `install.sh:22` `rsync -a --delete "$HERE/bridge/" "$APP/bridge/"` — Mini chạy **bản
copy**, không phải `bridge/` gốc. 15 file test được copy theo, nên vitest chạy chúng **hai lần**
(30 trong 50 file là test bridge, một nửa là bản sao).

Hệ quả nếu hai bên lệch: sửa `bridge/`, quên đồng bộ, **suite vẫn xanh cả hai bên**, và Mini
chạy code cũ. Không có gì canh việc này.

---

## 2. Kịch bản hỏng mà bộ test hiện tại KHÔNG bắt

Không phải rủi ro chung chung — từng dòng là một đường hỏng cụ thể trên code hiện có.

| # | Kịch bản | Lẽ ra ai bắt | Vì sao lọt |
| --- | --- | --- | --- |
| K1 | Thiếu dữ liệu controller, component hiển thị **`0`** thay vì *"Chưa đọc được từ controller"* | test component | Không có tầng nào |
| K2 | Thêm route thứ 21, quên `permission:` → mở API cho người không quyền | test bề mặt HTTP | `index.mjs` không có test; `if` bỏ qua im lặng |
| K3 | `bridgeApi.ts` đọc sai tên field bridge trả về → UI trắng | test hợp đồng | Test lib dùng `src/test/factories.ts`, không đối chiếu `contract.mjs` thật |
| K4 | `deploy-mini/bridge/` lệch `bridge/` → Mini chạy code cũ | guard bản sao | Không tồn tại |
| K5 | Sửa `broker.py` làm gãy enumerator | self-test python | Có test, nhưng `verify` không gọi |
| K6 | `bridge/lib/alerts.mjs` bắn sai ngưỡng cảnh báo | unit test | Module không có test |
| K7 | `rate-limit.mjs` không chặn → quét dồn dập lọt | unit + HTTP test | Module không có test |

K1 nghiêm trọng nhất vì nó phá **bất biến sản phẩm cốt lõi**: dashboard chỉ được hiện số đọc
được từ controller, thiếu thì phải nói thiếu, không bao giờ suy đoán. Bất biến đó hiện **không
có một test nào** bảo vệ ở tầng nhìn thấy được.

---

## 3. Tầng kiểm thử mục tiêu

| Tầng | Nội dung | Hiện có |
| --- | --- | --- |
| L1 — hàm thuần | `src/lib`, `bridge/lib`, `scripts/lib` | **Tốt, giữ nguyên.** Không cần thêm cho vui |
| L2 — hợp đồng | UI đọc đúng thứ bridge ghi ra (`contract.mjs` ↔ `bridgeApi.ts`) | Không |
| L3 — bề mặt HTTP | Dựng bridge thật trên cổng ephemeral, gọi bằng `fetch` | Không |
| L4 — giao diện | Render component thật, khẳng định bất biến hiển thị | Không (thiếu môi trường) |
| L5 — tại xưởng | Người thật, ca thật, sổ ca | Thủ công; xem PRD đo bão hoà |

---

## 4. Việc phải làm

| # | Việc | Tầng | Chi phí | Chặn |
| --- | --- | --- | --- | --- |
| T1 | Guard bản sao: test khẳng định `bridge/` ≡ `deploy-mini/bridge/`, báo tên file lệch | — | Phút | — |
| T2 | Đưa self-test python vào `npm run verify` | — | Phút | — |
| T3 | Bất biến bảng route: **mọi** route phải khai `permission`; đọc thẳng bảng route | L3 | Phút | — |
| T4 | Test bề mặt HTTP thật: dựng server cổng 0, gọi đủ 20 route — 403 khi thiếu quyền, 404/405, CORS origin lạ, 429 khi vượt `limits` | L3 | Giờ | — |
| T5 | Dựng môi trường DOM: `happy-dom` + `@testing-library/react` + khối `test` trong `vite.config.ts` | L4 | Giờ | T6 |
| T6 | Test component cho **bất biến hiển thị** (K1). Ưu tiên: `MachineDetail`, `ProductionPanel`, `ManualReadingForm`, `AlertCenter`, `StateBadge` | L4 | Giờ | — |
| T7 | Test hợp đồng `bridgeApi.ts` ↔ `contract.mjs` **thật**, không qua factories | L2 | Giờ | — |
| T8 | Bù unit test `bridge/lib`: `alerts`, `rate-limit`, `network`, `config`, `adapters`, `atomic-file` | L1 | Giờ | — |
| T9 | Bật `@vitest/coverage-v8` để **nhìn**, không đặt ngưỡng chặn | — | Phút | — |

Thứ tự đề nghị: **T1, T2, T3** trước (rẻ nhất, chặn rủi ro production ngay) → **T4** → **T5**
rồi **T6** → **T7, T8** độc lập → **T9** cuối.

---

### Tình trạng 22/08/2026 — T1–T9 ĐÃ XONG

| | Việc | Kết quả |
| --- | --- | --- |
| T1 | Guard bản sao + **gói cài** | Lệch 1 byte → đỏ; gói lạc hậu → đỏ |
| T2 | Self-test Python vào cổng | Chạy mọi `test_*.py`; thiếu môi trường → bỏ qua, test trượt → exit 1 |
| T3 | Bất biến phân quyền | 20/20 route + ghim 2 endpoint ngoài bảng |
| T4 | Bề mặt HTTP thật | Dựng bridge thật: 401/403/404/405/CORS/429 |
| T5 | Môi trường DOM | `// @vitest-environment happy-dom` — **0 dòng đổi cấu hình** |
| T6 | Test component | 95 test cho 5 component; K1 lần đầu có lưới |
| T7 | Hợp đồng client↔bridge | Logic thuần chạy trên JSON bridge **thật** |
| T8 | Bù `bridge/lib` | 154 test cho 6 module; **tìm ra 30+ lỗi thật** |
| T9 | Độ phủ | `bridge/lib`: 85,75% câu lệnh, 80,67% nhánh, 90,23% dòng |

**50 file / 813 test → 73 file / 1293 test.**

## 5. Cổng — "xanh" nghĩa là gì

| | Hiện tại | Mục tiêu |
| --- | --- | --- |
| `npm run verify` | `test && lint && build && bridge:check` | thêm **self-test python** (T2) và **guard bản sao** (T1) |

Trước khi đạt mục tiêu, phải nói thẳng: `npm run verify` xanh **không** có nghĩa là broker trên
Mini còn chạy được.

---

## 6. Cố ý KHÔNG kiểm thử

- **Không mock giao thức Dahao** để giả vờ đã có adapter thật. Một bộ test xanh cho thứ chưa
  từng chạy với máy thật là sai lầm nguy hiểm nhất mà tài liệu này có thể gây ra.
- **Không snapshot toàn trang** — đổi một dòng CSS là đỏ, không nói lên điều gì.
- **Không đặt ngưỡng coverage chặn merge** — nó đẻ ra test viết cho con số.
- **Không kiểm thử lại đường mạng** đã chốt ở `PRD_NGUON_DU_LIEU_MAY_THEU.md`. Không hồi quy
  điều tra đã xong.

---

## 7. Điều kiện DỪNG

- Nếu T5 kéo theo phải đổi `tsconfig`/cấu hình build của app → **dừng, báo**, không tự quyết.
- **Không** sửa `bridge/index.mjs` cho dễ test nếu chỗ sửa chạm ranh giới quyền. Ranh giới quyền
  đổi vì lý do kiểm thử là đổi sai lý do.
- **Không** tự xoá hoặc ghi đè `deploy-mini/bridge/` để "hết trùng". T1 chỉ **canh**, không dọn.
  Việc gộp hai bản là quyết định triển khai, không phải quyết định kiểm thử.
