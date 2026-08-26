#!/usr/bin/env node
/**
 * Chạy self-test offline của enumerator (`deploy-mini/tests/test_enumerator.py`) trong `npm run verify`.
 *
 * Vì sao là wrapper chứ không phải nối thẳng `&& python3 …` vào `verify`: bản clone sạch KHÔNG
 * có `deploy-mini/` (không file nào được git theo dõi), và `test_enumerator.py` nạp `broker.py`
 * vốn `from Crypto.Cipher import AES` ngay đầu file — `pycryptodome` chỉ được cài như tác dụng
 * phụ của `install.sh`, không khai ở đâu trong repo. Nối thẳng là `verify` gãy chắc chắn trên
 * máy chưa deploy.
 *
 * Ranh giới của file này: **thiếu tiền đề thì bỏ qua và nói to; test trượt thì trả mã thoát**.
 * Nuốt mã thoát sẽ biến bước này thành bước ai cũng học cách phớt lờ.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Chạy MỌI test_*.py trong deploy-mini/tests, không ghim một tên: thêm một self-test mới mà
// phải nhớ sửa cả file này thì sớm muộn sẽ có một self-test không ai chạy.
const thuMuc = fileURLToPath(new URL('../deploy-mini/tests/', import.meta.url))

function bo_qua(vi_sao) {
  console.log(`BỎ QUA test enumerator: ${vi_sao}`)
  console.log('  (chạy deploy-mini/install.sh trên máy bridge nếu cần bước này chạy thật)')
  process.exit(0)
}

if (!existsSync(thuMuc)) bo_qua('không có deploy-mini/tests/ trong cây làm việc')
const cacTest = readdirSync(thuMuc).filter((ten) => /^test_.*\.py$/.test(ten)).sort()
if (cacTest.length === 0) bo_qua('deploy-mini/tests/ không có file test_*.py nào')

for (const [probe, vi_sao] of [
  [['--version'], 'không tìm thấy python3 trên PATH'],
  [['-c', 'import Crypto'], 'python3 chưa có pycryptodome (broker.py cần Crypto.Cipher.AES)'],
]) {
  try {
    execFileSync('python3', probe, { stdio: 'ignore' })
  } catch {
    bo_qua(vi_sao)
  }
}

// stdio kế thừa: người chạy thấy nguyên văn `== ENUM SELF-TEST PASS ==` hoặc chỗ trượt.
// execFileSync ném khi mã thoát khác 0 -> node thoát khác 0 -> `verify` đỏ. Đúng ý đồ.
//
// Trừ đúng một mã: **77 = tự bỏ qua**. Đó là quy ước của chính mấy self-test này
// (`test_tu_hoi_phuc.py`, `test_goi_hong.py`, `test_ben_vung_live.py` đều `sys.exit(77)` khi
// thiếu tiền đề), và nó cùng nghĩa với `bo_qua()` ở trên — chỉ khác là nó phát ra từ tiến
// trình con. Đọc 77 thành "trượt" làm `verify` đỏ VĨNH VIỄN trên mọi máy không đặt
// `DAHAO_CHO_PHEP_GIET=1`, tức là đỏ trên máy đội nhận mã ngay ngày đầu — mà cái cờ ấy cố ý
// khó bật, vì bài test sau nó giết tiến trình production thật. Một cổng luôn đỏ không bảo vệ
// được gì; nó chỉ dạy người ta cách đi vòng qua nó.
const MA_BO_QUA = 77
let soBoQua = 0
for (const ten of cacTest) {
  console.log(`--- ${ten}`)
  try {
    execFileSync('python3', [thuMuc + ten], { stdio: 'inherit' })
  } catch (error) {
    if (error?.status !== MA_BO_QUA) throw error
    soBoQua += 1
  }
}
// Bỏ qua thì phải NÓI TO, đúng ranh giới ghi ở đầu file: một bước lặng lẽ không chạy gì cả
// trông y hệt một bước chạy xong và xanh.
if (soBoQua > 0) {
  console.log(`(${soBoQua}/${cacTest.length} self-test tự bỏ qua vì thiếu tiền đề — xem các dòng "BỎ QUA:" ở trên)`)
}
