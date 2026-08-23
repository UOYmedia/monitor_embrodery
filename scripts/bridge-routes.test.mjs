import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Bất biến phân quyền của bridge, kiểm bằng cách ĐỌC `bridge/index.mjs` như văn bản.
 *
 * Vì sao không import: `bridge/index.mjs` không export gì (`grep -c export` = 0), `routes` là
 * const riêng của module, và import nó sẽ đọc `bridge.config.json` rồi `server.listen()`.
 * `PRD_TEST_TOAN_BO.md` cấm sửa `index.mjs` cho dễ test khi chỗ sửa chạm ranh giới quyền —
 * nên tách `routes` ra module riêng là lựa chọn bị loại, không phải lựa chọn chưa nghĩ tới.
 *
 * Cái bẫy phải khoá: chỗ thực thi là `if (route.permission) assertPermission(...)`. Một route
 * **quên** khai `permission` chạy y hệt một route **cố ý** công khai — không lỗi, không cảnh
 * báo, chỉ mất quyền. Nên bất biến phải là "có khoá `permission` của riêng nó", không phải
 * "`permission` khác rỗng"; và tập công khai phải được ghim thành tên, để mở thêm một đường
 * công khai buộc người sửa phải sửa test này.
 */

const source = readFileSync(fileURLToPath(new URL('../bridge/index.mjs', import.meta.url)), 'utf8')

const lines = source.split('\n')
const start = lines.findIndex((line) => line.startsWith('const routes = ['))
const end = lines.findIndex((line, index) => index > start && line === ']')
const block = lines.slice(start + 1, end)

/**
 * Một entry bắt đầu ở cột 2 bằng `{`. Không dùng bộ đếm ngoặc nhọn: 8/20 `pattern` chứa lớp
 * ký tự `[^/]`, và bộ lược regex ngây thơ (chạy tới dấu `/` chưa escape đầu tiên) sẽ kết thúc
 * regex ngay giữa lớp ký tự rồi nuốt luôn các khai báo `permission:` phía sau.
 */
const entries = []
for (const line of block) {
  if (/^ {2}\{/.test(line)) entries.push([line])
  else if (entries.length > 0) entries.at(-1).push(line)
}
const routes = entries.map((chunk) => chunk.join('\n'))

/** Regex literal có xử lý lớp ký tự `[...]` và dấu escape — đủ cho `/^\/api\/v2\/machines\/([^/]+)$/`. */
function patternOf(route) {
  const match = /pattern:\s*(\/(?:\\.|\[(?:\\.|[^\]])*\]|[^/\\])+\/)/.exec(route)
  return match ? match[1] : null
}

const hasOwnKey = (route, key) => new RegExp(`(?:^|[\\s,{])${key}:`, 'm').test(route)

describe('bảng route của bridge', () => {
  it('khai permission trên MỌI route, để một route mới không thể ra đời mà không có rào', () => {
    const unguarded = routes.filter((route) => !hasOwnKey(route, 'permission')).map(patternOf)
    expect(unguarded, 'Route thiếu khoá `permission` đi lọt qua `if (route.permission)` mà không báo gì.')
      .toEqual([])
  })

  it('giữ bề mặt công khai của bảng đúng bằng session và readiness', () => {
    const open = routes.filter((route) => /(?:^|[\s,{])permission:\s*null/.test(route)).map(patternOf)
    expect(open).toEqual(['/^\\/api\\/v2\\/session$/', '/^\\/api\\/v2\\/readiness$/'])
  })

  // Chốt chặn cho chính bộ quét: quét sai thì FAIL ồn ào, không PASS giả.
  it('tách được đúng một entry cho mỗi khai báo method', () => {
    const methods = block.filter((line) => /(?:^|[\s,{])method:/.test(line)).length
    expect(routes.length).toBe(methods)
    expect(routes.every((route) => hasOwnKey(route, 'method'))).toBe(true)
    expect(routes.length).toBeGreaterThan(15)
  })
})

describe('các đường /api NGOÀI bảng route', () => {
  /**
   * Tiền lệ "thêm endpoint bên ngoài bảng" đã tồn tại trong chính file này, nên ba bài test ở
   * trên chưa đủ: một người sau thêm `if (url.pathname === '/api/v2/xuat-nhat-ky')` ngay trên
   * `routes.find` và quên `assertPermission` sẽ không làm đỏ bài nào cả.
   */
  it('giữ đúng hai nhánh đi trước bảng route', () => {
    const branches = [...source.matchAll(/url\.pathname === '([^']+)'/g)].map((match) => match[1])
    expect(branches).toEqual(['/api/health', '/api/v2/designs/thumbnail'])
  })

  it('giữ đúng hai chỗ gọi assertPermission: bảng route và thumbnail', () => {
    const calls = [...source.matchAll(/^\s*(?:if \([^)]*\) )?assertPermission\(/gm)]
    expect(calls.length).toBe(2)
  })
})
