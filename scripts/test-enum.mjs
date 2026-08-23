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
for (const ten of cacTest) {
  console.log(`--- ${ten}`)
  execFileSync('python3', [thuMuc + ten], { stdio: 'inherit' })
}
