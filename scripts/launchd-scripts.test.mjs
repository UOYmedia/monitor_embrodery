import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Canh các script chạy dưới `launchd`.
 *
 * Vì sao cần: launchd KHÔNG nạp `~/.zshrc`. Nó cho đúng `PATH=/usr/bin:/bin:/usr/sbin:/sbin`.
 * `node` trên máy này nằm ở `~/node/bin/node` — ngoài PATH đó. Nên `command -v node` trả **rỗng**,
 * và `exec "$(command -v node)"` thành `exec ""`, chết câm bằng `exec: : not found`.
 *
 * Đây KHÔNG phải lo xa: 24/08 `siet-quyen.sh` đổi bridge sang chế độ token và bridge không lên
 * nổi, tự kiểm trả 000/000, script tự lùi. Dòng duy nhất trong `logs/bridge.err` là
 * `chay-bridge.sh: line 8: exec: : not found`. Cả đợt siết quyền hỏng vì một biến rỗng.
 *
 * Test chạy script thật dưới `env -i` với đúng PATH của launchd, nên nó bắt được lỗi này
 * kể cả khi ai đó viết lại wrapper bằng cách khác.
 */

const repo = fileURLToPath(new URL('..', import.meta.url))
const wrapper = join(repo, 'deploy-mini', 'cloudflare', 'chay-bridge.sh')

const PATH_LAUNCHD = '/usr/bin:/bin:/usr/sbin:/sbin'

describe('script chạy dưới launchd', () => {
  it('[1] không script nào tra chương trình bằng $(command -v ...) rồi exec thẳng', () => {
    const nguon = readFileSync(wrapper, 'utf8')
    // Cho phép nhắc `command -v` như MỘT ứng viên trong danh sách dự phòng; cấm dùng nó làm
    // nguồn DUY NHẤT của đường dẫn đem đi exec.
    expect(nguon).not.toMatch(/exec\s+"\$\(command -v/)
  })

  it('[2] chay-bridge.sh tìm được node dưới PATH tối thiểu của launchd', () => {
    const thuMuc = mkdtempSync(join(tmpdir(), 'launchd-'))
    // Thay `exec` bằng echo để test không thật sự dựng bridge (cổng 8790 đang có người dùng).
    const kich = readFileSync(wrapper, 'utf8').replace(/^exec "\$NODE".*$/m, 'echo "NODE=$NODE"; exit 0')
    const duong = join(thuMuc, 'thu.sh')
    writeFileSync(duong, kich)
    chmodSync(duong, 0o755)

    const ra = execFileSync('/usr/bin/env', ['-i', `HOME=${process.env.HOME}`, `PATH=${PATH_LAUNCHD}`, '/bin/bash', duong], { encoding: 'utf8' })
    expect(ra).toMatch(/^NODE=\/.+node\s*$/m)
    expect(ra).not.toMatch(/NODE=\s*$/m)
  })

  it('[3] bản viết kiểu cũ THẬT SỰ hỏng dưới PATH đó — test [2] không xanh vì may', () => {
    expect(() =>
      execFileSync('/usr/bin/env', ['-i', `PATH=${PATH_LAUNCHD}`, '/bin/bash', '-c', 'set -euo pipefail; exec "$(command -v node)" -e "0"'], { stdio: 'pipe' }),
    ).toThrow()
  })

  it('[4] plist gọi bridge bằng đường dẫn tuyệt đối, không dựa vào PATH', () => {
    const plist = readFileSync(join(repo, 'deploy-mini', 'cloudflare', 'com.dahao.bridge.token.plist'), 'utf8')
    const mang = plist.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)
    expect(mang, 'plist phải có ProgramArguments').not.toBeNull()
    const lenh = [...mang[1].matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1])
    expect(lenh.length).toBeGreaterThan(0)
    expect(lenh[0].startsWith('/'), `chương trình phải là đường dẫn tuyệt đối, nhận được: ${lenh[0]}`).toBe(true)
  })
})
