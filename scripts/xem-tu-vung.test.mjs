import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Chạy bộ khung thử của màn hình vận hành trong cùng một lượt `vitest` với mọi thứ khác.
 *
 * Vì sao là lớp bọc chứ không viết thẳng bằng vitest: `scripts/xem-tu-vung.mjs` rút khối
 * `<script>` **thẳng từ `deploy-mini/xem/index.html`** rồi chạy nó trong `node:vm` với một cái
 * DOM giả tối thiểu. Chép các hàm ấy sang tệp thử thì tệp thử sẽ trôi khỏi trang lúc nào không
 * biết — trang là một tệp HTML đơn, không có bước build nào để bắt lệch.
 *
 * Nó từng chỉ sống ở `/tmp`. Cùng lớp với chuyện `xem/index.html` chưa từng nằm trong git: mã
 * quan trọng ở một chỗ không ai sao lưu thì mất là mất hẳn.
 */

const repo = fileURLToPath(new URL('..', import.meta.url))

describe('man hinh van hanh: tu vung tinh trang', () => {
  it('ca bo khung thu deu dat', () => {
    let ra
    try {
      ra = execFileSync(process.execPath, [join(repo, 'scripts', 'xem-tu-vung.mjs')],
                        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      // In nguyên văn ra để biết bài nào đỏ, chứ không chỉ báo "exit 1".
      throw new Error('bo khung thu co bai do:\n' + (e.stdout || '') + (e.stderr || ''))
    }
    expect(ra).toMatch(/TAT CA \d+ PHEP THU DAT/)
    // Chặn trường hợp ai đó vô tình cắt bớt bộ thử mà vẫn thấy chữ "TAT CA ... DAT".
    const so = Number((ra.match(/TAT CA (\d+) PHEP THU DAT/) || [])[1])
    expect(so).toBeGreaterThanOrEqual(113)
  })
})
