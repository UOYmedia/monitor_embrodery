# -*- coding: utf-8 -*-
"""Vá ô "Máy off" trên màn hình vận hành.

Ô này ra đời lúc mọi máy im đều mang một mã duy nhất là `off`. Từ lúc tách thang bằng chứng
(`ngoai-gio`/`cum-im`/`tat-han`/`tat-may`), câu `tt === 'off'` chỉ còn bắt đúng cái nhánh CUỐI
CÙNG — nhánh "không đủ dữ kiện để nói gì". Nghĩa là: cả xưởng cúp điện thì ô đọc 0, đúng lúc
người ta cần nó nhất. `scripts/xem-tu-vung.mjs` bắt được.

Đếm bằng `TT_IM` — cùng một bảng mà `chuLau()` và `theMay()` đang dùng để biết "máy này đang im".
Thêm mã im mới sau này thì ô tự đúng theo, không phải nhớ sửa hai chỗ.
"""
import io, sys

P = '/Users/phong/dahao-gateway/xem/index.html'
s = io.open(P, encoding='utf-8').read()

VA = [
 (
  "      if (tt === 'chay') dem.chay++\n      else if (tt === 'off') dem.off++\n",
  "      if (tt === 'chay') dem.chay++\n"
  "      // Đếm bằng `TT_IM` chứ KHÔNG bằng `tt === 'off'`. `off` giờ chỉ là nhánh cuối của thang\n"
  "      // bằng chứng (\"im mà chưa đủ dữ kiện để nói vì sao\"); máy tắt thật phần lớn rơi vào\n"
  "      // `tat-han`/`tat-may`, cả xưởng cúp điện thì rơi vào `cum-im`, còn ban đêm là `ngoai-gio`.\n"
  "      // Giữ câu cũ thì ô này đọc 0 đúng vào lúc cần nó nhất.\n"
  "      else if (TT_IM[tt]) dem.off++\n"
 ),
 (
  "      ['off', dem.off, 'Máy off', 'Off', 'Máy không còn đẩy dữ liệu về (tắt máy, hoặc đứt mạng). Số trên thẻ là số cũ.'],",
  "      ['off', dem.off, 'Máy off', 'Off', 'Máy không còn đẩy dữ liệu về. Gồm cả bốn lý do: tắt ngoài giờ làm, cả xưởng cùng im (cúp điện/đứt mạng), thợ tắt máy sau khi thêu xong, và mất tín hiệu giữa chừng. Thẻ máy ghi rõ từng cái. Số trên thẻ là số cũ.'],",
 ),
]

for cu, moi in VA:
    if s.count(cu) != 1:
        sys.stderr.write('KHONG khop dung mot lan (%d): %r\n' % (s.count(cu), cu[:70]))
        raise SystemExit(1)
    s = s.replace(cu, moi)

io.open(P, 'w', encoding='utf-8').write(s)
print('da va 2 cho')
