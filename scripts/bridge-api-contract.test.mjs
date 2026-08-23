import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TOKENS, startBridge } from './lib/live-bridge.mjs'

/**
 * Hợp đồng của API bridge — thứ mà bên làm giao diện (hoặc một agent tích hợp vào web riêng)
 * sẽ dựa vào.
 *
 * Từ khi dashboard bị gỡ, bridge KHÔNG còn client nào trong repo này. Nghĩa là không còn ai
 * vô tình phát hiện việc đổi tên một trường: không có màn hình để trắng, không có test lib nào
 * gãy. Bài này là chỗ duy nhất giữ hình dạng phản hồi đứng yên.
 *
 * Hình dạng đầy đủ, có chú thích, nằm ở `docs/api/fleet-types.ts`.
 */

let bridge
const goi = (duong, { token, method = 'GET', body } = {}) =>
  fetch(`${bridge.baseUrl}/api/v2${duong}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

const json = async (...args) => {
  const r = await goi(...args)
  return { status: r.status, body: await r.json() }
}

let may

beforeAll(async () => {
  bridge = await startBridge()
  const { body } = await json('/machines', {
    token: TOKENS.tech, method: 'POST',
    body: { machines: [{ assetTag: 'TS-01', name: 'Máy thêu test', siteId: 'test-1', zone: 'Chuyền 1', ipAddress: '127.0.0.1', adapter: 'manual' }] },
  })
  may = body.machines[0]
}, 30000)

afterAll(() => bridge?.stop())

describe('phiên và quyền', () => {
  it('/session nói ra đúng bộ quyền để bên tích hợp biết ẩn/hiện gì', async () => {
    const { body } = await json('/session', { token: TOKENS.tech })
    expect(body.role).toBe('technician')
    expect(body.permissions).toContain('fleet:read')
    expect(body.permissions).not.toContain('user:manage')
  })

  it('không token thì 401 — KHÔNG phải 200 với danh sách rỗng', async () => {
    // 200 rỗng là kiểu hỏng nguy hiểm nhất: bên tích hợp sẽ vẽ "xưởng không có máy nào".
    expect((await goi('/fleet')).status).toBe(401)
  })

  it('sai vai thì 403, và nói ra vai nào thiếu quyền', async () => {
    const { status, body } = await json('/scan', { token: TOKENS.viewer, method: 'POST', body: { siteId: 'test-1', cidr: '127.0.0.1/32', ports: [80] } })
    expect(status).toBe(403)
    expect(body.error).toMatch(/viewer/)
  })
})

describe('hình dạng một máy', () => {
  it('mang đủ các nhánh đã công bố ở docs/api/fleet-types.ts', () => {
    for (const nhanh of ['identity', 'connection', 'thresholds']) expect(may[nhanh], nhanh).toBeTruthy()
    expect(Array.isArray(may.alerts)).toBe(true)
    expect(typeof may.identity.id).toBe('string')
    expect(may.identity.adapter).toBe('manual')
    expect(typeof may.thresholds.freshSeconds).toBe('number')
    expect(typeof may.thresholds.stopEscalationMinutes).toBe('number')
    expect(may.connection).toHaveProperty('state')
    expect(may.connection).toHaveProperty('reason')
  })

  it('máy chưa có số đọc nào thì trạng thái kết nối KHÔNG phải online', () => {
    expect(may.connection.state).not.toBe('online')
    expect(typeof may.connection.reason).toBe('string')
  })
})

describe('số gõ tay', () => {
  it('lượt đầu là mốc, không đẻ ra sản lượng từ hư không', async () => {
    const { body } = await json(`/machines/${may.identity.id}/manual-reading`, {
      token: TOKENS.tech, method: 'POST',
      body: { odometer: 12_000, observedAt: new Date().toISOString(), status: 'stopped' },
    })
    expect(body.reading.baseline).toBe(true)
    expect(body.reading.delta).toBeNull()
    // Số người gõ ép trạng thái kết nối về `unknown`: một người gõ một lần không chứng minh
    // được máy đang nối. Đây là hợp đồng bên tích hợp phải hiểu để không vẽ nhầm chấm xanh.
    expect(body.machine.connection.state).toBe('unknown')
    expect(body.machine.connection.reason).toMatch(/gõ tay/)
  })

  it('lượt thứ hai ra chênh lệch và tốc độ ngụ ý, để bắt lỗi thừa một chữ số', async () => {
    const { body } = await json(`/machines/${may.identity.id}/manual-reading`, {
      token: TOKENS.tech, method: 'POST',
      body: { odometer: 12_600, observedAt: new Date().toISOString(), status: 'running' },
    })
    expect(body.reading.delta).toBe(600)
    expect(body.reading.baseline).toBe(false)
    expect(body.reading.previous.odometer).toBe(12_000)
    expect(body.reading.impliedStitchesPerMinute).not.toBeNull()
  })
})

describe('cảnh báo suy ra', () => {
  it('API phục vụ sẵn nhóm cảnh báo suy ra — bên tích hợp không phải tự nghĩ lại', async () => {
    // Trước khi bỏ dashboard, nhóm này được tính trong trình duyệt. Để nguyên vậy nghĩa là mỗi
    // bên tích hợp tự viết lại logic "máy lỗi / mất tín hiệu / dừng quá lâu" theo một kiểu khác
    // nhau, và không ai kiểm được kiểu nào đúng.
    const { body } = await json('/fleet', { token: TOKENS.viewer })
    const m = body.machines[0]
    expect(Array.isArray(m.derivedAlerts), 'thiếu derivedAlerts trong hình dạng máy').toBe(true)
  })

  it('không nhóm nào trong đó xác nhận được — bridge sẽ trả 400 nếu thử', async () => {
    const { body } = await json('/fleet', { token: TOKENS.viewer })
    for (const m of body.machines) {
      for (const a of m.derivedAlerts) expect(a.acknowledged, a.id).toBeNull()
    }
  })
})
