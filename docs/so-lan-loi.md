# Sổ lần lỗi — bảng dữ liệu bàn giao

Bảng này ghi **những lần máy thêu ngừng chạy**. Nó **không** phải bảng "mã lỗi của máy", và
lý do phải đọc trước khi dùng — [§1](#1-máy-a15-không-gửi-mã-lỗi).

| | |
|---|---|
| Đường đọc | `GET /api/v2/machines/<machineId>/faults` — quyền `fleet:read` (viewer trở lên) |
| Đường sửa | `POST /api/v2/machines/<machineId>/faults/<episodeId>/reopen` — quyền `machine:update` |
| File gốc | `bridge-data/loi-<siteId>.jsonl` — mỗi dòng một JSON |
| Xoay vòng | mảnh đang ghi đầy **8 MiB** thì đổi tên thành `…jsonl.<ISO>`; **mọi mảnh cũ được giữ lại**, không xoá, và đường đọc gộp hết các mảnh |
| Site đang chạy | `xuong-a15` ⇒ file thật là `bridge-data/loi-xuong-a15.jsonl` (đừng lấy tên theo file cấu hình `bridge.config.dahao-mqtt.json`) |

Tham số truy vấn: `from`, `to` (ISO 8601, lọc theo `batDau`), `limit` (mặc định 100),
`nguon` (nhiều giá trị cách nhau bằng dấu phẩy; **không khai = trả hết**).

Ba loại dòng trên đĩa, phân biệt bằng `loai`: `episode` (mở), `episode-dong` (đóng),
`reopen` (mở lại). Đường API trả **bản hợp nhất**, không phải dòng thô.

---

## 1. Máy A15 không gửi mã lỗi

Chốt bằng ba phép đo độc lập — đừng mất công tìm lại:

| Phép đo | Kết quả |
|---|---|
| Khung telemetry thật | luôn đúng **8 trường**, đúng **4 giá trị trạng thái** (`-1`, `0`, `2`, `15`), **không một trường lỗi nào** |
| Catalog tự phát từ broker | 4 topic, 17 field — không field nào mang mã lỗi |
| Nhật ký kiểm toán 24→27/08 | **120/120 lần ngừng là `stopped`**, đúng **0 lần** `fault` |

Mã `EC` (EC05, EC07…) chỉ hiện trên **màn hình HMI** tại máy; không có đường nào để nó đi ra dây.
Vì thế sổ này **từ chối** ghi `heMa: "dahao-ec"` nếu nguồn không phải `nhap-tay` — ném lỗi ngay
tại chỗ gọi chứ không ghi im lặng.

> Hệ quả cho bên dùng: **`theoNguon["may-day"] === 0` là đúng sự thật**, không phải dấu hiệu
> đường dữ liệu hỏng. Đừng đi tìm cách "bật mã lỗi lên".

---

## 2. Trường nào nói gì

### 2.1 Nguồn gốc — đọc trường này TRƯỚC

`nguon` **không có mặc định**; thiếu nó là ném lỗi tại chỗ gọi, không ghi.

| `nguon` | Nghĩa |
|---|---|
| `may-day` | Máy tự khai qua telemetry. **Đáng tin nhất.** Hiện chưa từng có dòng nào. |
| `suy-luan` | **Bridge suy ra** — máy không nói gì, đây là kết luận từ đồng hồ và số mũi. |
| `duong-do` | Sự cố của hệ thống ĐO (mất tín hiệu, gateway chết) — **không phải của máy**. |
| `nhap-tay` | Người tại máy khai. Bắt buộc có `nguoi`. |

`heMa` cho biết `ma` thuộc hệ nào: `a15-state` \| `dahao-ec` \| `bridge`. Có `ma` thì bắt buộc
có `heMa` — một con số không thuộc hệ nào là con số vô nghĩa.

Mỗi gói trả về kèm `theoNguon`, đếm trên **toàn bộ tập đã lọc** chứ không phải trang đang trả:

```json
"theoNguon": { "may-day": 0, "suy-luan": 90, "duong-do": 0, "nhap-tay": 0, "khong-ro": 0 }
```

> **Đừng cộng `may-day` với `suy-luan` thành một con số "máy hỏng bao nhiêu lần".** Gần như
> toàn bộ dòng `suy-luan` là `dung-lau`, mà dừng lâu gồm cả nghỉ trưa, thay chỉ, đổi mẫu.

### 2.2 Mốc thời gian — chắc tới đâu

Phần dễ đọc sai nhất, nên có hẳn một câu tiếng Việt đi kèm: `cauMoc`.

| Trường | Nghĩa |
|---|---|
| `batDau` | Mốc **chắc chắn**: từ đây trở đi máy chắc chắn ở trạng thái đó. Lấy `observedAt` của controller, **không phải đồng hồ bridge**. |
| `batDauUocChung` | `true` ⇒ `batDau` chỉ là **cận dưới**; máy có thể đã ở trạng thái đó từ trước. |
| `batDauSomNhat` | **Cận trên**: mốc bridge đã *tận mắt thấy* máy ở đúng trạng thái này **trước** khoảng mù gần nhất. `null` nếu không có. |
| `ketThuc` | Mốc quan sát cuối. |
| `thoiLuongGiay` | Thời lượng **chắc chắn ít nhất** = `ketThuc − batDau`. **`null` khi đóng sổ mà không nhìn thấy máy đổi trạng thái.** |
| `thoiLuongToiDaGiay` | Thời lượng **nhiều nhất** = `ketThuc − batDauSomNhat`. `null` khi không có cận trên. |
| `mocDangNgo` | `true` ⇒ đồng hồ controller nhảy lùi; đừng tin hai mốc. |

**Vì sao phải là một cặp chứ không một số.** `unknown` không phải trạng thái của máy — nó nghĩa
là *adapter không đọc được*. Ra khỏi `unknown`, mốc mới chỉ là lúc ta **nhìn thấy lại**. Bản
bridge trước 27/08 đóng dấu "chính xác" cho mọi mốc kiểu đó. Đo được trên máy `3ce4b0c54f54`:

```
08:20:03  stopped   từ 03:11:21   ước chừng = false   ← bridge biết đúng
08:20:22  unknown                                      ← mất tín hiệu 4 giây
08:20:26  stopped   từ 08:20:26   ước chừng = FALSE    ← hơn 5 tiếng bốc hơi, không một cờ nào
```

Trên nhật ký 24→27/08: **91/120 lần ngừng mở ngay sau một khoảng mù, 87 trong số đó khai
"chính xác"** — khoảng **72,5 %** số liệu ngừng máy cũ có mốc bắt đầu bịa.

**Khoảng mù rộng cỡ nào.** Phát lại nhật ký trạng thái thật (6,7 giờ, 13 máy) cho ra:

| | |
|---|---|
| Số khoảng mù | **109** — khoảng **16 lần/giờ** toàn xưởng |
| Trạng thái giống nhau hai bên ⇒ **có** cận trên | **108/109** |
| Thời gian nằm trong khoảng mù — trung vị | **4,2 phút** |
| — phân vị 90 | **112 phút** |
| — dài nhất | **6,10 giờ** (máy `602602621948`, `stopped` 02:30:11 → 08:36:04) |
| Dưới 1 phút / trên 1 giờ | 19 / 11 |

Hai điều rút ra cho bên dùng: cận trên **gần như luôn có** (108/109), nhưng khoảng cách giữa hai
cận **không nhỏ** — trong 10 % trường hợp là hơn hai tiếng. Đừng hiển thị mỗi `thoiLuongGiay` rồi
coi như xong; một lần ngừng khai "6 phút" hoàn toàn có thể là **hơn hai tiếng**.

> **Số ghi trước 27/08 thì đừng dùng để tính thời lượng.** Nhận dạng bằng **sự vắng mặt của
> trường `batDauSomNhat`** trên chính dòng đó — dòng ghi từ 27/08 trở đi luôn có nó, kể cả khi
> giá trị là `null`. Đừng dùng `thoiLuongToiDaGiay` làm dấu hiệu: những lần lỗi mở bằng mã cũ
> nhưng **đóng** sau khi vá thì dòng đóng vẫn mang `thoiLuongToiDaGiay: null` trong khi mốc bắt
> đầu vẫn là mốc bịa — xem đúng trường hợp đó ở [§4](#4-hai-dòng-thật-chép-nguyên-từ-production).

### 2.3 Đóng sổ — "hết thấy lỗi" ≠ "đã sửa xong"

`lyDoDong` là `controller-bao-trang-thai-khac` (quan sát được) hoặc `chua-biet`. Khi `chua-biet`
thì `chuaBietVi` nói vì sao, và **`thoiLuongGiay` là `null`** — một con số ở đó sẽ bị đọc thành
"máy lỗi đúng chừng ấy" trong khi sự thật là "ta chỉ nhìn được tới đó".

| `chuaBietVi` | Nghĩa |
|---|---|
| `mat-tin-hieu` | Máy im giữa chừng. Im lặng không phải là hết lỗi. |
| `nhap-tay` | Người gõ tay, không phải controller báo. |
| `dong-bang-khoi-dong-lai` | Bridge khởi động lại giữa chừng. |

Trên production **79/91 lần đóng là `mat-tin-hieu`**, chỉ 12 lần thật sự thấy máy chạy lại. Nên
nếu lọc `thoiLuongGiay != null` thì còn rất ít dòng — đó là con số **đúng**, không phải lỗi truy vấn.

### 2.4 Sửa sổ thì ghi thêm, không sửa dòng cũ

Gọi `POST …/faults/<episodeId>/reopen`; sổ ghi một dòng `reopen` mới trỏ về `episodeId`, **dòng
cũ giữ nguyên trên đĩa**. Bản hợp nhất kèm `daMoLai`, `soLanMoLai`, `moLaiLuc`, `moLaiBoi`,
`lyDoMoLai`.

Các lần lỗi nối nhau của cùng một máy nối bằng `previousEpisodeId` — **không gộp theo ngưỡng thời
gian**, vì gộp cần một hằng số mà không dữ liệu nào ở xưởng đỡ nổi, và gộp sai thì che mất một
lần dừng máy có thật.

### 2.5 Hai câu tiếng Việt đi kèm

`cauNguon` và `cauMoc` **không phải chú thích trang trí** — chúng là cách duy nhất để một người
đọc bảng mà không đọc tài liệu này vẫn không hiểu sai. Nếu dựng dashboard, hãy hiện chúng cạnh
con số. `cauChu` là câu mô tả trạng thái lần lỗi.

---

## 3. Bốn cái bẫy

1. **`may-day: 0` không phải lỗi hệ thống** — máy A15 không gửi mã lỗi (§1).
2. **Đừng trừ `ketThuc − batDau` khi `batDauUocChung: true`** — dùng cặp `thoiLuongGiay` /
   `thoiLuongToiDaGiay`, hoặc đọc `cauMoc`.
3. **`dangMo: true` nghĩa là "chưa thấy trạng thái khác", không phải "máy đang hỏng".**
4. **Số liệu trước 27/08 có mốc bắt đầu không tin được** — §2.2.

---

## 4. Hai dòng thật, chép nguyên từ production

Lần lỗi **đang mở**, ghi lúc `2026-08-27T08:44:04Z` — chú ý `batDauUocChung: true`, cờ mà bản
bridge cũ không bao giờ bật:

```json
{"loai":"episode","episodeId":"ddb5ef75-e34d-4646-a01c-bbc8f36b1bbc",
 "machineId":"mch-60260298b4c7","siteId":"xuong-a15",
 "nguon":"suy-luan","heMa":"bridge","kieu":"long-stop","nguoi":null,
 "batDau":"2026-08-27T08:38:05.000Z","ketThuc":null,
 "thoiLuongGiay":null,"thoiLuongToiDaGiay":null,
 "dangMo":true,"lyDoDong":null,"chuaBietVi":null,"trangThaiSau":null,
 "ma":"dung-lau","moTa":"Dừng liên tục quá 5 phút — máy KHÔNG báo lý do.",
 "previousEpisodeId":null,"batDauUocChung":true,"batDauSomNhat":null,
 "mocDangNgo":false,"ghiLuc":"2026-08-27T08:44:04.368Z"}
```

Lần lỗi **đã đóng**, chính là máy `3ce4b0c54f54` trong §2.2 — đây là **dòng ghi bằng bản bridge
cũ**, giữ lại làm mẫu nhận dạng dữ liệu không tin được:

```json
{"loai":"episode-dong","episodeId":"8ba82cc9-6133-4865-9bac-443a83dd676a",
 "machineId":"mch-3ce4b0c54f54","siteId":"xuong-a15",
 "nguon":"suy-luan","heMa":"bridge","kieu":"long-stop","nguoi":null,
 "batDau":"2026-08-27T08:20:26.000Z","ketThuc":"2026-08-27T08:38:04.356Z",
 "thoiLuongGiay":null,"thoiLuongToiDaGiay":null,
 "dangMo":false,"lyDoDong":"chua-biet","chuaBietVi":"dong-bang-khoi-dong-lai",
 "trangThaiSau":null,"ma":"dung-lau",
 "previousEpisodeId":null,"batDauUocChung":false,"mocDangNgo":false,
 "daMoLai":false,"soLanMoLai":0,"moLaiLuc":null,"moLaiBoi":null,"lyDoMoLai":null,
 "cauChu":"Đang lỗi — chưa thấy controller báo trạng thái khác.",
 "cauNguon":"Bridge suy ra — máy KHÔNG báo lỗi, đây là kết luận từ đồng hồ và số mũi.",
 "cauMoc":"Mốc bắt đầu chắc chắn — bridge nhìn thấy máy chuyển vào trạng thái này.",
 "ghiLuc":"2026-08-27T08:38:04.356Z"}
```

Đọc dòng thứ hai cho đúng: `batDau` khai 08:20:26 và `cauMoc` nói "chắc chắn", **nhưng §2.2 chứng
minh máy đã dừng từ 03:11:21**. `thoiLuongGiay: null` vì bridge khởi động lại chứ không phải máy
chạy lại. Từ 27/08 dòng như thế này sẽ mang `batDauUocChung: true` và một `batDauSomNhat` thật.
