import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Canh `deploy-mini/bridge/` không lệch `bridge/`.
 *
 * Vì sao cần: `install.sh` rsync **bản sao**, không phải `bridge/` gốc — Mini chạy bản sao.
 * 15 file test cũng được chép theo, nên nếu hai bên lệch thì `npx vitest run` vẫn xanh ở cả
 * hai bên trong khi máy đã cài chạy code cũ. Không có gì khác trong repo canh việc này.
 *
 * Vì sao đặt ở `scripts/` chứ không ở `bridge/lib/`: mọi thứ trong `bridge/` đều bị chép sang
 * `deploy-mini/bridge/`. Guard đặt trong đó sẽ có một bản sao **tự so mình với chính mình** —
 * luôn xanh, và xanh vì lý do vô nghĩa. `scripts/` không bao giờ được chép (`install.sh:22-27`).
 *
 * PHẠM VI: canh **cây nguồn staging** trong repo (khối 1) VÀ **gói cài đặt**
 * `dahao-gateway.tar.gz` (khối 2). Vẫn KHÔNG canh được thứ đang thật sự chạy trên Mac Mini —
 * cái đó chỉ kiểm được bằng bước xác minh sau triển khai trong `docs/trien-khai-mini-e2.md`.
 *
 * Khối 2 có vì gói này đã từng lạc hậu thật: 22/08 `broker.py` trong gói là 13.977 byte trong
 * khi trên đĩa là 36.502 — tức gói cài đặt không hề chứa enumerator. Cài lại từ gói lúc đó là
 * lặng lẽ lùi về bản cũ.
 */

const repo = fileURLToPath(new URL('..', import.meta.url))
const source = join(repo, 'bridge')
const copy = join(repo, 'deploy-mini', 'bridge')

function walk(root) {
  const files = []
  const stack = ['']
  while (stack.length > 0) {
    const rel = stack.pop()
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const next = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) stack.push(next)
      else files.push(next)
    }
  }
  return files.sort()
}

// `deploy-mini/` không nằm trong git. Bản clone sạch phải SKIP thấy được, chứ không được
// PASS giả (guard ngủ quên mà trông như đã canh) và cũng không FAIL cho người chưa deploy.
const deployed = existsSync(copy)

describe('deploy-mini/bridge (cây nguồn staging)', () => {
  it.skipIf(!deployed)('giữ đúng cùng một tập file như bridge/', () => {
    const missing = walk(source).filter((file) => !existsSync(join(copy, file)))
    const extra = walk(copy).filter((file) => !existsSync(join(source, file)))
    expect({ missing, extra }, 'Chạy lại deploy-mini/install.sh hoặc đồng bộ tay: rsync -a --delete bridge/ deploy-mini/bridge/')
      .toEqual({ missing: [], extra: [] })
  })

  it.skipIf(!deployed)('giữ từng file khớp đúng từng byte với bridge/', () => {
    const drifted = walk(source)
      .filter((file) => existsSync(join(copy, file)))
      .filter((file) => !readFileSync(join(source, file)).equals(readFileSync(join(copy, file))))
    expect(drifted, 'Các file này đã lệch giữa bridge/ và deploy-mini/bridge/ — Mini đang chạy bản sao, nên lệch là chạy sai âm thầm.')
      .toEqual([])
  })
})

// ---------------------------------------------------------------- gói cài đặt

const goi = join(repo, 'deploy-mini', 'dahao-gateway.tar.gz')
const coGoi = existsSync(goi)
let giaiNen = null
if (coGoi) {
  giaiNen = mkdtempSync(join(tmpdir(), 'dahao-pkg-'))
  execFileSync('tar', ['xzf', goi, '-C', giaiNen])
}

describe('dahao-gateway.tar.gz (gói cài lên Mini)', () => {
  it.skipIf(!coGoi)('chứa đúng broker.py đang có trong repo', () => {
    const trongGoi = readFileSync(join(giaiNen, 'deploy-mini', 'broker.py'))
    const trongRepo = readFileSync(join(repo, 'deploy-mini', 'broker.py'))
    expect(trongGoi.length, 'Gói lạc hậu — cài lại từ gói này là lùi broker.py về bản cũ. Đóng gói lại.')
      .toBe(trongRepo.length)
    expect(trongGoi.equals(trongRepo)).toBe(true)
  })

  it.skipIf(!coGoi)('chứa đúng bridge/ đang có trong repo', () => {
    const goc = join(giaiNen, 'deploy-mini', 'bridge')
    const thieu = walk(source).filter((file) => !existsSync(join(goc, file)))
    const lech = walk(source)
      .filter((file) => existsSync(join(goc, file)))
      .filter((file) => !readFileSync(join(source, file)).equals(readFileSync(join(goc, file))))
    expect({ thieu, lech }).toEqual({ thieu: [], lech: [] })
  })

  it.skipIf(!coGoi)('KHÔNG kèm giao diện — đây là dịch vụ thuần API', () => {
    // Bất biến này thay cho "dist/ phải khớp bản build" của thời còn dashboard. Ship kèm một
    // bản build cũ lên Mini là mời người ta mở một màn hình không còn ai bảo trì.
    const coUi = ['dist', 'index.html'].filter((x) => existsSync(join(giaiNen, 'deploy-mini', x)))
    expect(coUi).toEqual([])
  })
})
