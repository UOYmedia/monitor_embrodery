# Lùi mũi — cách đoán ra một lần vá đứt chỉ

Con số **"lùi N mũi"** trên bảng Grafana không phải máy báo. Máy A15 **không có** trường nào
nói "đứt chỉ". Con số ấy là **suy ra** từ một dấu vết duy nhất mà máy để lại trên dây: số mũi
đang thêu **tụt xuống** giữa chừng một mẫu.

Tài liệu này nói rõ: dấu vết ấy là gì, vì sao nó đáng tin, đo thật ra bao nhiêu, và
**nó sai ở chỗ nào** — phần cuối quan trọng nhất, vì hiện tại ba phần tư số liệu trên bảng là rác.

| | |
|---|---|
| Bộ dò | `quan-sat/soi-lan-dung.py` — LaunchDaemon `com.dahao.landung` |
| Nguồn vào | `~/dahao-gateway/broker.log`, các dòng `*** STATE dev=… cur=… tot=… pat=… @…` |
| Nguồn ra | `logs/va-mau.out` → Alloy → Loki `job="va-mau"` |
| Chỗ xem | Grafana **[dahao-dut-chi](https://grafana.phonh.io.vn/d/dahao-dut-chi)**, ô 207 *"Từng lần dừng — nguyên văn"* |
| Tự kiểm | `python3 -B quan-sat/soi-lan-dung.py --tu-kiem` → 20/20 ca |
| Xem lại quá khứ | `python3 -B quan-sat/soi-lan-dung.py --lich-su 400000 --tom-tat` |
| ⚠ Độ tin | **suy đoán**, không phải máy báo. Mọi nhãn mở đầu bằng `nghi-` là vì thế. |

---

## 1. Vì sao phải đoán: máy không gửi mã lỗi

Đã chốt trên **224.016 khung** telemetry thật:

| Phép đo | Kết quả |
|---|---|
| Khung telemetry | luôn đúng **8 trường**, không thừa không thiếu |
| Trường `state` | đúng **4 giá trị** (`-1`, `0`, `2`, `15`) — không giá trị nào là mã lỗi |
| Catalog tự phát từ broker | 4 topic, 17 field — **không field nào** mang lý do dừng |
| Nhật ký kiểm toán 24→27/08 | **120/120 lần ngừng** là `stopped`, đúng **0 lần** `fault` |

Mã `EC` (EC05, EC07…) mà thợ nhìn thấy chỉ hiện **trên màn hình HMI tại máy**. Không có đường
nào để nó đi ra dây. Nên muốn biết máy dừng vì cái gì thì chỉ còn hai cửa: **thợ nhập tay**,
hoặc **suy từ số mũi** — cửa thứ hai chính là tài liệu này.

Xem thêm: [`docs/so-lan-loi.md` §1](so-lan-loi.md).

---

## 2. Sổ tay nói gì

Hai mục trong sổ tay BECS-A15, ghép lại thành cả câu chuyện:

> **§2.6 — đứt chỉ trên / hết suốt dưới → MÁY TỰ DỪNG.**
> Thợ không phải bấm gì cả, máy phát hiện rồi dừng lấy.

> **§2.4 — nút lùi khung.** Nguyên văn: *"The purpose of returning is for patching"* —
> mục đích của việc lùi là để vá. Thợ giữ nút lùi, khung chạy **ngược theo đúng đường đã thêu**,
> lùi qua chỗ hỏng, xỏ lại chỉ, rồi bấm chạy tiếp.

Ghép hai mục: **đứt chỉ ⇒ máy dừng ⇒ thợ lùi khung ⇒ chạy tiếp.** Chuỗi ba bước ấy là
thao tác vá tiêu chuẩn, và bước giữa — lùi khung — là bước **duy nhất nhìn thấy được qua mạng**.

---

## 3. Dấu vết trên dây

Mỗi ~2 giây máy đẩy một khung có `cur` (mũi đang thêu) và `tot` (tổng mũi của mẫu):

```
*** STATE dev=602602911CB8 cur=8594 tot=15301 state=0 pat=4161~.DST @2026-09-04T01:27:30Z Δ2.001s
```

Khi thêu bình thường `cur` **chỉ tăng**. Khi thợ bấm dừng, `cur` **đứng yên**. Chỉ có đúng một
việc làm `cur` **giảm giữa một mẫu**: có người bấm nút lùi.

```
cur  8594 → 8624 → 8594 → 8594 → 8651
            ↑ thêu   ↑ LÙI 30   ↑ đứng   ↑ chạy tiếp
                     └────── một lần vá ──────┘
```

Bộ dò gộp đúng chuỗi ấy thành **một lần dừng**, cộng dồn tổng số mũi đã lùi qua mọi nhịp đo
(giữ nút lùi 3 nhịp × 50 mũi = một lần, `lui=150`), rồi đóng lại khi `cur` tăng trở lại.

---

## 4. Bằng chứng: độ lùi không phải nhiễu

Nếu con số này là nhiễu đường truyền thì độ lùi sẽ rải đều và ngẫu nhiên. Đo thật thì không.

**Cửa sổ đo: 2026-09-03T11:17 → 2026-09-04T04:06 UTC · 90.356 khung · 19 máy.**
Sau khi lọc rác (§5), còn **82 lần lùi sạch**:

| Độ lùi | Số lần |
|---|---|
| 30 mũi | 45 |
| 20 mũi | 15 |
| 50 mũi | 6 |
| 60 mũi | 3 |
| 40 mũi | 2 |
| khác (80, 90, 100, 141, 170, 300, 546…) | 11 |

**76/82 lần (92,7 %) là bội của 10.** Từng máy còn đều hơn nữa — mỗi máy có **bước lùi riêng**,
đúng kiểu "một nhịp giữ nút" của §2.4:

| Máy | Số lần | Bước lùi (ƯCLN) | Các giá trị thấy được |
|---|---|---|---|
| Máy 05 | 19 | 20 | 20×13, 40×2, 50×2, 141, 546 |
| Máy 14 | 7 | **30** | 30×6, 60 |
| Máy 04 | 7 | 2 | 20×2, 50×3, 66, 100 |
| Máy 01 | 6 | **30** | 30×5, 60 |
| Máy 15 | 6 | **30** | 30×6 |
| Máy 09 | 6 | 1 | 30×4, 60, 83 |
| Máy 08 | 5 | **30** | 30×3, 90, 300 |
| Máy 13 | 5 | **30** | 30×5 |
| Máy 16 | 5 | **30** | 30×5 |
| Máy 11 | 5 | 10 | 30×4, 170 |
| Máy 02 | 5 | 5 | 5, 15, 30×3 |
| Máy 03 | 3 | **30** | 30×3 |
| Máy 06 | 2 | 10 | 50, 80 |
| Máy 12 | 1 | **30** | 30 |

**8/14 máy có bước lùi đúng bằng 30 mũi**, 4 máy nữa là bội của 5 hoặc 10. Máy 05 chạy bước 20.
Nhiễu không tạo ra bảng như thế này.

**Thời gian đứng để vá** (80 lần, bỏ 2 lần vắt qua đêm tắt máy):

| | |
|---|---|
| trung vị | **48 giây** |
| p90 | 322 giây (5 phút rưỡi) |
| tổng | **138 phút** trong 16 giờ 49 phút, trên cả 19 máy |

---

## 5. ⚠ Chỗ con số này đang SAI: trận dồn khung

**Đây là phần quan trọng nhất của tài liệu.**

Khi một máy mất kết nối một lúc, nó **xếp khung vào hàng đợi**, rồi nối lại được thì **trút cả
đống ra một lượt**. Trong lượt trút ấy, khung **không giữ đúng thứ tự**. Thấy tận mắt trong
`broker.log`, máy 01 lúc 01:21:12 — để ý cột `Δ` tụt xuống 0,001 giây, và hai dãy `cur` **cài
răng lược vào nhau**:

```
cur=1092  Δ0.002s     ← dãy A
cur=912   Δ0.001s     ← dãy B chen vào  ⇒ bộ dò đọc thành "lùi 180 mũi"
cur=1115  Δ0.189s     ← dãy A
cur=927   Δ0.002s     ← dãy B           ⇒ "lùi 188 mũi"
cur=1140  Δ0.001s
cur=943   Δ0.001s                       ⇒ "lùi 197 mũi"
```

Tám "lần vá" trong đúng một giây, độ lùi 180 → 233, mỗi lần `dừng 0s`. Không có thợ nào vá được
như thế. Đây là **thứ tự khung bị loạn**, không phải nút lùi.

Đo mức độ ảnh hưởng — coi một giây là "trận dồn" nếu có ≥ 3 khung của cùng một máy rơi vào đó
(bình thường 2 giây mới có 1 khung):

| | |
|---|---|
| `nghi-dut-chi` bộ dò sinh ra | **321 lần** |
| trong đó rơi vào trận dồn | **239 lần (74,5 %)** ← **rác** |
| ngoài trận dồn | **82 lần (25,5 %)** ← đáng tin |
| giây-máy bị dồn | 1.374 / 80.808 (1,7 % thời gian) |

**Nghĩa là ô "lùi mũi" trên bảng đang đọc cao gấp khoảng 4 lần sự thật.** Chỉ 1,7 % thời gian bị
dồn khung, nhưng nó đẻ ra 3/4 số cảnh báo, vì một trận dồn 20 khung sinh cả chục lần lùi giả.

Nhận ra rác bằng mắt cũng được, có ba dấu:

1. **`dừng 0s` hoặc `1s`** — vá thật trung vị 48 giây; không ai vá xong trong 0 giây.
2. **Nhiều dòng cùng một máy trong cùng một giây.**
3. **Độ lùi là số lẻ và tăng dần** (180, 188, 197, 206…) thay vì bội của 30.

> **Cách đọc bảng cho tới khi vá xong:** bỏ mọi dòng `dừng ≤ 2s`, và bỏ chùm dòng dày đặc cùng
> một giây. Còn lại là số thật. Cách chữa tận gốc: chặn ở `soi-lan-dung.py`, không cho `cur` tụt
> tính là lùi khi khung tới với `Δ < 0,5 giây`, vì máy thêu **không thể** chạy nhanh hơn nhịp
> 2 giây của chính nó.

Một ghi chú nữa: ghi chú cũ trong đầu file `soi-lan-dung.py` nói *"độ lùi **luôn** là bội của một
bước cố định"* — đo trên 13 lần. Ở 321 lần thì câu ấy **không còn đúng**; nó chỉ đúng **sau khi
lọc rác** (§4). Chỗ nào còn thấy câu khẳng định tuyệt đối ấy thì đọc kèm mục này.

---

## 6. Bảy cái nhãn

Bộ dò không chỉ tìm lùi mũi; nó đặt tên cho **mọi** lần dừng. Thứ tự xét từ trên xuống, gặp
cái nào đúng trước thì lấy:

| Nhãn | `ma_nghi` | Khi nào | Nghĩa |
|---|---|---|---|
| `mat-ket-noi` | 5 | máy ngưng gửi tin quá 120 s giữa mẫu | Đường đo có vấn đề, **không** kết luận gì về máy |
| `doi-mau` | 4 | tên mẫu đổi giữa chừng | Bỏ dở mẫu này, nhảy sang mẫu khác |
| `khoi-dong-lai` | 6 | `cur` nhảy về gần 0 sau khi đã xong mẫu | Thêu tấm tiếp theo — **không phải sự cố** |
| **`nghi-dut-chi`** | **0** | **`lui > 0`** | **Có người lùi khung rồi chạy tiếp — thao tác vá §2.4** |
| `dung-han` | 1 | dừng giữa mẫu rồi thôi, chưa chạy lại | Máy còn đứng tại thời điểm đọc |
| `dung-lau` | 2 | dừng > 60 s rồi chạy tiếp, **không lùi** | Chờ việc, chỉnh khung, thợ rời máy |
| `dung-ngan` | 3 | dừng ≤ 60 s rồi chạy tiếp, **không lùi** | Đổi màu, cắt chỉ, chỉnh nhanh |

Điểm cốt lõi: **`dung-lau` và `dung-ngan` KHÔNG bị gọi là đứt chỉ.** Không lùi mũi thì không
nghi vá, dù máy có đứng bao lâu. Ca thử số 5 trong `--tu-kiem` giữ đúng ranh giới ấy.

Đếm thật trên cùng cửa sổ 16 giờ 49 phút: 498 lần dừng đáng kể — `nghi-dut-chi` 321,
`dung-ngan` 102, `mat-ket-noi` 31, `dung-lau` 26, `doi-mau` 13, `dung-han` 5.

---

## 7. Hai chốt chặn khỏi đọc nhầm

`cur` tụt **không phải lúc nào cũng** là lùi khung. Hai trường hợp đã cắn thật, đã chặn:

**(a) Thêu xong tấm rồi thêu lại chính mẫu ấy.** Ca thật: máy 08 lúc 02:38:27, `cur` đi
`3788/3788 → 1`. Trước khi vá, bộ dò đọc thành *"lùi 3787 mũi"*. Nay chặn bằng hai điều kiện:

```python
LUI_TOI_DA = 1000       # tụt hơn 1000 mũi trong một nhịp = nhảy về đầu mẫu, không phải vá
VE_DAU     = 0.05       # đang ở cuối mẫu mà nhảy về dưới 5% tổng mũi = tấm mới
```

Rơi vào đó thì đóng nhãn `khoi-dong-lai`, không phải `nghi-dut-chi`.

**(b) Nhưng vá đúng ở mũi cuối thì vẫn phải là vá.** Ngưỡng trên không được nuốt cái thật:
`3758 → 3788 → 3758 → 3788` trên mẫu 3788 mũi vẫn ra `nghi-dut-chi`, `lui=30`.
Ca thử 11b giữ chỗ này.

Chốt thứ ba, nhỏ hơn: dừng thoáng ≤ 4 giây mà **không** lùi thì bỏ, khỏi lấp đầy nhật ký —
nhưng **có lùi mũi thì giữ, dù ngắn tới đâu**.

---

## 8. Đọc một dòng trên Grafana

Ô 207 của bảng `dahao-dut-chi` in nguyên văn từng lần dừng:

```
{job="va-mau", viec="dong", may=~"$may"}
| line_format "{{.may}}  {{.nghi}}  |  lùi {{.lui}} mũi  |  ở {{.mui}}/{{.tong}}  |  dừng {{.giay}}s  |  {{.mau}}  —  {{.y_nghia}}"
```

Ví dụ một dòng thật:

```
602602911CB8  nghi-dut-chi  |  lùi 30 mũi  |  ở 8594/15301  |  dừng 78s  |  4161~.DST
—  Có người lùi khung 30 mũi rồi cho chạy tiếp — đúng thao tác vá của sổ tay §2.4.
   Gần như chắc là đứt chỉ hoặc hết suốt; máy không nói rõ cái nào.
```

Đọc là: **Máy 15**, đang thêu mẫu `4161~.DST`, tới mũi **8.594 trên tổng 15.301**, dừng
**78 giây**, trong đó thợ lùi khung **30 mũi** rồi chạy tiếp. ⇒ gần như chắc là vá một chỗ đứt chỉ.

Nhãn `UNK` màu xám bên trái mỗi dòng là **của Grafana**, không phải của dữ liệu — nó chỉ có
nghĩa "dòng log này không khai mức nghiêm trọng". Bỏ qua.

Mỗi lần dừng sinh ra tối đa ba dòng, phân biệt bằng trường `viec`:

| `viec` | Lúc nào |
|---|---|
| `mo` | vừa phát hiện, máy **còn đang** dừng |
| `dang` | nhắc lại mỗi 30 giây trong lúc còn dừng |
| `dong` | **đã xong** — số liệu chốt |

Ô 207 lọc `viec="dong"` nên chỉ thấy dòng chốt, không bị đếm trùng.

---

## 9. Đường dữ liệu

```
máy A15  ──MQTT:3865──▶  broker.py  ──▶  broker.log
                                            │  (tail -F)
                                            ▼
                                   soi-lan-dung.py            ← LaunchDaemon com.dahao.landung
                                            │  1 dòng JSON / sự kiện
                                            ▼
                                   logs/va-mau.out
                                            │
                                       Alloy (config.alloy)
                                            ▼
                                   Loki  job="va-mau"
                                            │
                                            ▼
                          Grafana  dahao-dut-chi  ô 207
```

Trường của mỗi dòng JSON: `at`, `viec`, `may`, `nghi`, `ma_nghi`, `giay`, `lui`, `mui`, `tong`,
`mau`, `ket`, `tu_luc`, `y_nghia`.

---

## 10. Cái này KHÔNG nói được gì

Ranh giới phải nói thẳng, kẻo người dùng tin quá mức:

| Trả lời được | **Không** trả lời được |
|---|---|
| Có người đang vá hay không | Đứt chỉ **trên** hay hết suốt **dưới** hay gãy kim |
| Vá ở mũi thứ mấy, mẫu nào | Đứt ở **kim nào** trong 9/12/15 kim |
| Vá mất bao lâu | Đứt vì **chỉ**, vì **kim**, hay vì **vải** |
| Máy nào phải vá nhiều nhất | Mã `EC` mà thợ nhìn thấy trên HMI |
| | Vá xong có đạt hay không |

Và một giới hạn nữa: **thợ lùi khung vì lý do khác** (canh lại vị trí, thêu thử) cũng ra
`nghi-dut-chi`. Bộ dò không phân biệt được. Chữ `nghi-` đứng đầu nhãn là để nhắc điều đó
mỗi lần đọc.

---

## 11. Muốn biết chắc thì làm gì

Ba đường, xếp theo công sức:

1. **Thợ nhập tay** — form `ManualReadingForm` đã có, ghi vào sổ lần lỗi với `nguon: "nhap-tay"`.
   Đây là đường **duy nhất** được phép mang mã `dahao-ec`.
2. **Đọc HMI tại máy** — chính xác nhất, nhưng không tự động được.
3. **Cảm biến ngoài** (node ESP32-C3 đã dựng) — bắt trực tiếp tín hiệu đứt chỉ, không qua Dahao.

Trong lúc chưa có ba thứ trên thì `nghi-dut-chi` là thứ tốt nhất đường mạng cho được — miễn là
đọc kèm §5.

---

## Đổi gì thì sửa ở đâu

| Muốn đổi | Chỗ sửa |
|---|---|
| Ranh giới dừng ngắn / dừng lâu (60 s) | `NGAN_GIAY` |
| Nhịp nhắc lại khi đang dừng (30 s) | `NHIP_GIAY` |
| Bao lâu im thì coi là mất kết nối (120 s) | `NGUNG_GIAY` |
| Chặn "nhảy về đầu mẫu" (1000 mũi / 5 %) | `LUI_TOI_DA`, `VE_DAU` |
| Thêm nhãn mới | `MA_NGHI` **và** `doan()` — ca thử 10 bắt buộc hai chỗ khớp nhau |

Sửa xong **phải** chạy `python3 -B quan-sat/soi-lan-dung.py --tu-kiem` (`-B` bắt buộc: bỏ đi thì
Python có thể chạy lại bytecode cũ và in ra bảng kết quả sai mà không báo lỗi).
