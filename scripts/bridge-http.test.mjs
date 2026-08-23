import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TOKENS, startBridge } from './lib/live-bridge.mjs'

/**
 * Bề mặt HTTP THẬT của bridge (T4 trong PRD_TEST_TOAN_BO.md).
 *
 * `bridge/index.mjs` là 492 dòng, 20 route, và là chỗ thực thi phân quyền — trước bài này nó
 * không có một test nào. `scripts/bridge-routes.test.mjs` chỉ ĐỌC file như văn bản: nó khoá
 * được "mọi route đều khai permission", nhưng không chứng minh được khai xong thì thật sự chặn.
 *
 * Việc dựng bridge nằm ở `src/test/liveBridge.ts`, dùng chung với test hợp đồng client-server.
 */

let bridge

beforeAll(async () => {
  // scanPerMinute = 2 để kiểm 429 mà không phải bắn hàng trăm phát.
  bridge = await startBridge()
}, 30000)

afterAll(() => bridge?.stop())

const goi = (duong, { token, method = 'GET', origin, body } = {}) =>
  fetch(`${bridge.baseUrl}${duong}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(origin ? { origin } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

describe('bridge HTTP — cửa mở', () => {
  it('/api/health trả lời mà không cần token, để máy dò biết bridge còn sống', async () => {
    const r = await goi('/api/health')
    expect(r.status).toBe(200)
    expect((await r.json()).status).toBe('ok')
  })

  it('/api/v2/session trả lời cho người chưa có token, và nói thẳng là chưa xác thực', async () => {
    const r = await goi('/api/v2/session')
    expect(r.status).toBe(200)
    const s = await r.json()
    expect(s.authenticated).toBe(false)
    expect(s.permissions).toEqual([])
  })
})

describe('bridge HTTP — rào quyền', () => {
  it('KHÔNG có token thì không xem được đội máy (401, không phải 200 rỗng)', async () => {
    // 200 kèm danh sách rỗng là kiểu hỏng nguy hiểm nhất: trông như "xưởng không có máy nào".
    const r = await goi('/api/v2/fleet')
    expect(r.status).toBe(401)
  })

  it('token bịa cũng là không có token', async () => {
    expect((await goi('/api/v2/fleet', { token: 'tok-bia-dat' })).status).toBe(401)
  })

  it('viewer xem được đội máy', async () => {
    const r = await goi('/api/v2/fleet', { token: TOKENS.viewer })
    expect(r.status).toBe(200)
    expect(await r.json()).toHaveProperty('machines')
  })

  it('viewer KHÔNG được quét mạng — đó là quyền của kỹ thuật (403, khác hẳn 401)', async () => {
    const r = await goi('/api/v2/scan', { token: TOKENS.viewer, method: 'POST', body: { cidr: '127.0.0.1/32' } })
    expect(r.status).toBe(403)
    expect((await r.json()).error).toMatch(/viewer/)
  })
})

describe('bridge HTTP — hình dạng yêu cầu', () => {
  it('đường không có thì 404, không phải 200 với trang trắng', async () => {
    expect((await goi('/api/v2/khong-ton-tai', { token: TOKENS.tech })).status).toBe(404)
  })

  it('đúng đường nhưng sai phương thức thì 405, và nói ra phương thức nào sai', async () => {
    const r = await goi('/api/v2/fleet', { token: TOKENS.tech, method: 'DELETE' })
    expect(r.status).toBe(405)
    expect((await r.json()).error).toMatch(/DELETE/)
  })

  it('origin ngoài allowlist bị chặn TRƯỚC khi chạm tới quyền hay dữ liệu', async () => {
    const r = await goi('/api/v2/fleet', { token: TOKENS.tech, origin: 'http://ke-la.example' })
    expect(r.status).toBe(403)
    expect((await r.json()).error).toMatch(/allowedOrigins/)
  })
})

describe('bridge HTTP — chặn tần suất', () => {
  it('quét dồn dập bị chặn 429 sau khi vượt ngưỡng xưởng đặt', async () => {
    // scanPerMinute = 2 trong config test. Phát thứ ba trở đi phải bị chặn.
    const ma = []
    for (let i = 0; i < 4; i += 1) {
      const r = await goi('/api/v2/scan', { token: TOKENS.tech, method: 'POST', body: { cidr: '127.0.0.1/32' } })
      ma.push(r.status)
    }
    expect(ma.filter((m) => m === 429).length).toBeGreaterThan(0)
    expect(ma[0]).not.toBe(429)
  }, 20000)
})

describe('chế độ thuần API (uiPath = null)', () => {
  it('nói thẳng là không phục vụ giao diện, thay vì "chưa build giao diện"', async () => {
    // Hai tình huống khác hẳn nhau: "chưa build" là lỗi triển khai cần sửa; "thuần API" là
    // lựa chọn kiến trúc. Trả nhầm thông điệp làm bên tích hợp đi tìm một bản build không tồn tại.
    const thuanApi = await startBridge({ uiPath: null })
    try {
      const r = await fetch(`${thuanApi.baseUrl}/`)
      expect(r.status).toBe(404)
      expect((await r.json()).error).toMatch(/thuần API/)
      // API vẫn phải chạy bình thường.
      expect((await fetch(`${thuanApi.baseUrl}/api/health`)).status).toBe(200)
    } finally {
      thuanApi.stop()
    }
  }, 30000)
})
