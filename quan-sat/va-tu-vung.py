# -*- coding: utf-8 -*-
"""Cập nhật `scripts/xem-tu-vung.mjs` theo thang bằng chứng mới.

Bộ khung này viết hồi mọi máy im đều mang đúng một mã `off`. Từ lúc tách được "không làm" khỏi
"mất tín hiệu", `off` chỉ còn là nhánh CUỐI (im mà chưa đủ dữ kiện), nên bốn ca dưới đây đỏ.
Bốn ca ấy đều là kỳ vọng cũ, KHÔNG phải lỗi mã — nhưng ca thứ năm (ô "Máy off" đếm 1) là lỗi
THẬT của trang, đã vá riêng ở `va-o-off.py`.

Ca nào đụng tới `offline` thì nay phải GHIM ĐỒNG HỒ, vì kết quả phụ thuộc giờ VN: trong giờ làm
ra `tat-han`, ngoài giờ ra `ngoai-gio`. Không ghim thì bài thử tự đỏ lúc 19h.
"""
import io, sys

P = '/Users/phong/dashboarddahao/scripts/xem-tu-vung.mjs'
s = io.open(P, encoding='utf-8').read()

VA = []

# 1. Mở cửa cho bài thử ghim đồng hồ.
VA.append((
  "    tinhTrang: tinhTrang, chuLau: chuLau, NHAN_TT: NHAN_TT,\n",
  "    tinhTrang: tinhTrang, chuLau: chuLau, NHAN_TT: NHAN_TT, TT_IM: TT_IM,\n"
  "    // Ghim đồng hồ: mọi kết luận về máy IM đều phụ thuộc giờ VN (trong giờ làm ra `tat-han`,\n"
  "    // ngoài giờ ra `ngoai-gio`). Không ghim thì bài thử tự đỏ lúc 19h.\n"
  "    datLech: function (x) { lechDongHo = x },\n"
))

# 2. Hai ca `offline`.
VA.append((
  "la('mat ket noi -> off, du so mui cu la do mau', tt({ kn: 'offline', cur: 500, tot: 1000 }), 'off')\n"
  "la('  off thang ca trang thai hong: so cu thi khong duoc ket luan gi', tt({ kn: 'offline', tt: 'fault' }), 'off')\n",
  "// Máy im KHÔNG còn ra một mã duy nhất. Bridge nói `offline` + đang trong giờ làm = `tat-han`;\n"
  "// cùng máy ấy sau 19h = `ngoai-gio`. Cả hai đều nằm trong `TT_IM`, nên vẫn là \"máy im\", chỉ\n"
  "// khác ở chỗ nói ĐƯỢC vì sao. Ghim giờ VN rồi mới hỏi.\n"
  "gioVN(12)\n"
  "la('mat ket noi trong gio lam -> tat-han, du so mui cu la do mau', tt({ kn: 'offline', cur: 500, tot: 1000 }), 'tat-han')\n"
  "la('  van thang ca trang thai hong: so cu thi khong duoc ket luan gi', tt({ kn: 'offline', tt: 'fault' }), 'tat-han')\n"
  "gioVN(22)\n"
  "la('  cung may ay sau gio lam -> ngoai-gio, khong ho \"mat tin hieu\"', tt({ kn: 'offline', cur: 500, tot: 1000 }), 'ngoai-gio')\n"
  "gioVN(12)\n"
  "la('  moi ma im deu nam trong TT_IM', ['off', 'tat-han', 'ngoai-gio', 'cum-im', 'tat-may'].every(function (k) { return !!A.TT_IM[k] }), true)\n"
))

# 3. Bảng nhãn: 7 mã -> 11 mã.
VA.append((
  "la('moi tinh trang deu co nhan tieng Viet', Object.keys(A.NHAN_TT).sort(),\n"
  "   ['chay', 'cho', 'chuaro', 'dung', 'hoanthanh', 'loi', 'off'])\n",
  "// 11 mã, không phải 7: bốn mã cuối là bốn lý do KHÁC NHAU khiến máy im, tách ra hồi 28/08.\n"
  "// Bảng này ghim cứng để không ai thêm mã mà quên đặt tên tiếng Việt cho nó.\n"
  "la('moi tinh trang deu co nhan tieng Viet', Object.keys(A.NHAN_TT).sort(),\n"
  "   ['chay', 'cho', 'chuaro', 'cum-im', 'dung', 'hoanthanh', 'loi', 'ngoai-gio', 'off', 'tat-han', 'tat-may'])\n"
))

# 4. Đồng hồ của máy im.
VA.append((
  "la('may off: dong ho dem tu ban tin CUOI CUNG, khong tu statusSince',\n"
  "   A.chuLau(may({ kn: 'offline', tu: 400 })).indexOf('off ') === 0, true)\n",
  "// Chuyện được ghim ở đây là NGUỒN của con số, không phải chữ đứng trước nó: máy im thì đồng hồ\n"
  "// đếm từ bản tin cuối cùng máy gửi (`tu: 400`), chứ không từ `statusSince` của bridge.\n"
  "gioVN(12)\n"
  "la('may im: dong ho dem tu ban tin CUOI CUNG, khong tu statusSince',\n"
  "   A.chuLau(may({ kn: 'offline', tu: 400 })), 'tắt hẳn 6 phút 40 giây')\n"
))

for cu, moi in VA:
    if s.count(cu) != 1:
        sys.stderr.write('KHONG khop dung mot lan (%d): %r\n' % (s.count(cu), cu[:80]))
        raise SystemExit(1)
    s = s.replace(cu, moi)

# Hàm ghim giờ VN, đặt ngay trước mục N.
moc = "console.log('\\n=== N. tinhTrang: mot bo tu vung cho ca trang ===')\n"
if s.count(moc) != 1:
    sys.stderr.write('khong thay moc muc N\n')
    raise SystemExit(1)
s = s.replace(moc, (
  "// Đẩy đồng hồ của trang tới đúng giờ VN muốn thử. Trang tính giờ VN bằng `Date.now() +\n"
  "// lechDongHo + 7h`, nên chỉ cần bù phần chênh giữa giờ VN hiện tại và giờ muốn tới.\n"
  "function gioVN(g) {\n"
  "  const nay = new Date(Date.now() + 7 * 3600 * 1000).getUTCHours()\n"
  "  A.datLech((g - nay) * 3600 * 1000)\n"
  "}\n\n" + moc))

io.open(P, 'w', encoding='utf-8').write(s)
print('da va %d cho + ham gioVN' % len(VA))
