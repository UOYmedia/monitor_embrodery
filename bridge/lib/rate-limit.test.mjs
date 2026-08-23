import { describe, expect, it } from 'vitest'
import { RateLimiter } from './rate-limit.mjs'

/**
 * Bộ chặn tần suất đứng chắn đúng hai cửa có thể làm nghẽn Wi-Fi xưởng: quét dải mạng và ghép
 * máy hàng loạt (bridge/index.mjs → limitOr429). Hai bất biến người ở xưởng thật sự chịu hậu quả:
 *   1. Chặn đúng lúc vượt ngưỡng — không chặn sớm (kỹ thuật viên đang chữa máy bị cắt lượt quét),
 *      không chặn muộn (mạng xưởng chết vì một nút bấm giữ).
 *   2. Cửa sổ phải trôi — chờ hết hạn là gọi lại được. Bộ chặn không bao giờ khoá vĩnh viễn.
 *
 * Module cho tiêm đồng hồ, nên không test nào ở đây ngủ thật; mỗi test dựng đồng hồ riêng để
 * không test nào phụ thuộc thứ tự chạy.
 */
const dungDongHo = (batDau = Date.parse('2026-08-22T01:00:00Z')) => {
  let hienTai = batDau
  return { now: () => hienTai, troi: (ms) => { hienTai += ms } }
}

describe('chặn đúng lúc vượt ngưỡng', () => {
  it('cho đi trọn hạn ngạch rồi mới chặn, không cắt sớm của kỹ thuật viên một lượt nào', () => {
    // 6 = scanPerMinute mặc định trong bridge/lib/config.mjs.
    const dongHo = dungDongHo()
    const limiter = new RateLimiter({ windowMs: 60_000, now: dongHo.now })
    for (let lan = 1; lan <= 6; lan += 1) {
      expect(limiter.take('scan:ky-thuat-b:192.168.1.40', 6)).toMatchObject({ allowed: true, retryAfterMs: 0 })
    }
    expect(limiter.take('scan:ky-thuat-b:192.168.1.40', 6)).toMatchObject({ allowed: false, retryAfterMs: 60_000 })
  })

  it('ngưỡng 1 lần/phút thì lần thứ hai bị chặn ngay, không nới thêm một lần "cho phải phép"', () => {
    const dongHo = dungDongHo()
    const limiter = new RateLimiter({ windowMs: 60_000, now: dongHo.now })
    expect(limiter.take('mut:quan-doc-a:10.0.0.5', 1).allowed).toBe(true)
    expect(limiter.take('mut:quan-doc-a:10.0.0.5', 1).allowed).toBe(false)
  })

  it('remaining đếm đúng số lượt còn lại, để giao diện không hứa lượt đã hết', () => {
    // Nếu remaining nói "còn 1" mà lần gọi kế bị chặn thì người bấm nút mất niềm tin vào con số.
    const dongHo = dungDongHo()
    const limiter = new RateLimiter({ windowMs: 60_000, now: dongHo.now })
    const conLai = [0, 1, 2].map(() => limiter.take('scan:a', 3).remaining)
    expect(conLai).toEqual([2, 1, 0])
    expect(limiter.take('scan:a', 3)).toMatchObject({ allowed: false, remaining: 0 })
  })

  it('lúc bị chặn không bao giờ vừa báo còn lượt vừa từ chối', () => {
    const dongHo = dungDongHo()
    const limiter = new RateLimiter({ windowMs: 60_000, now: dongHo.now })
    limiter.take('scan:a', 1)
    for (let lan = 0; lan < 5; lan += 1) {
      const phanQuyet = limiter.take('scan:a', 1)
      expect(phanQuyet.allowed).toBe(false)
      expect(phanQuyet.remaining).toBe(0)
    }
  })
})

describe('cửa sổ phải trôi', () => {
  it('chờ đúng số mili giây bộ chặn hứa là gọi được lại, không phải chờ thêm', () => {
    // Bridge in thẳng con số này ra thông báo 429 ("Thử lại sau Xs"). Nếu chờ đủ Xs mà vẫn bị từ
    // chối thì thông báo đang nói dối và người dùng sẽ bấm lại liên tục.
    const dongHo = dungDongHo()
    const limiter = new RateLimiter({ windowMs: 60_000, now: dongHo.now })
    limiter.take('scan:a', 2)
    dongHo.troi(10_000)
    limiter.take('scan:a', 2)
    const biChan = limiter.take('scan:a', 2)
    expect(biChan.allowed).toBe(false)
    dongHo.troi(biChan.retryAfterMs)
    expect(limiter.take('scan:a', 2).allowed).toBe(true)
  })

  it('sớm hơn hạn 1 mili giây thì vẫn chặn, hạn ngạch không rò qua ranh giới', () => {
    const dongHo = dungDongHo()
    const limiter = new RateLimiter({ windowMs: 60_000, now: dongHo.now })
    limiter.take('scan:a', 1)
    const biChan = limiter.take('scan:a', 1)
    dongHo.troi(biChan.retryAfterMs - 1)
    expect(limiter.take('scan:a', 1)).toMatchObject({ allowed: false, retryAfterMs: 1 })
  })

  it('cửa sổ mới cấp lại trọn hạn ngạch, người vừa bị chặn không phải trả nợ lượt cũ', () => {
    // Kỹ thuật viên bị chặn lúc 8:00:30 phải quét được đủ 3 lượt lúc 8:01:00, chứ không phải
    // chỉ được 1 lượt vì những lần bấm hụt trước đó.
    const dongHo = dungDongHo()
    const limiter = new RateLimiter({ windowMs: 60_000, now: dongHo.now })
    for (let lan = 0; lan < 3; lan += 1) limiter.take('scan:a', 3)
    for (let lan = 0; lan < 10; lan += 1) expect(limiter.take('scan:a', 3).allowed).toBe(false)
    dongHo.troi(60_000)
    const sauKhiMo = [0, 1, 2].map(() => limiter.take('scan:a', 3).allowed)
    expect(sauKhiMo).toEqual([true, true, true])
    expect(limiter.take('scan:a', 3).allowed).toBe(false)
  })

  it('bấm liên tục trong lúc bị chặn không đẩy mốc mở khoá ra xa, nên không ai bị khoá vĩnh viễn', () => {
    // Đây là hành vi thật của người dùng bực mình: bấm lại mỗi giây. Nếu mỗi lần bị chặn lại gia
    // hạn cửa sổ thì càng bấm càng không bao giờ mở.
    const dongHo = dungDongHo()
    const limiter = new RateLimiter({ windowMs: 60_000, now: dongHo.now })
    limiter.take('scan:a', 1)
    for (let giay = 1; giay <= 59; giay += 1) {
      dongHo.troi(1000)
      expect(limiter.take('scan:a', 1)).toMatchObject({ allowed: false, retryAfterMs: 60_000 - (giay * 1000) })
    }
    dongHo.troi(1000)
    expect(limiter.take('scan:a', 1).allowed).toBe(true)
  })

  it('không bao giờ bảo "thử lại sau 0 giây" trong lúc vẫn còn chặn', () => {
    // Bridge làm tròn lên: Math.ceil(retryAfterMs / 1000). retryAfterMs = 0 lúc đang chặn sẽ thành
    // câu "Thử lại sau 0s" — mời người dùng bấm lại ngay để bị từ chối tiếp.
    const dongHo = dungDongHo()
    const limiter = new RateLimiter({ windowMs: 60_000, now: dongHo.now })
    limiter.take('scan:a', 1)
    for (let daTroi = 0; daTroi < 60_000; daTroi += 997) {
      const phanQuyet = limiter.take('scan:a', 1)
      expect(phanQuyet.allowed).toBe(false)
      expect(phanQuyet.retryAfterMs).toBeGreaterThan(0)
      expect(phanQuyet.retryAfterMs).toBeLessThanOrEqual(60_000)
      expect(Math.ceil(phanQuyet.retryAfterMs / 1000)).toBeGreaterThanOrEqual(1)
      dongHo.troi(997)
    }
  })

  it('cửa sổ mặc định đúng 60 giây, để câu "lần/phút" trong thông báo 429 không nói sai', () => {
    const dongHo = dungDongHo()
    const limiter = new RateLimiter({ now: dongHo.now })
    limiter.take('scan:a', 1)
    expect(limiter.take('scan:a', 1).retryAfterMs).toBe(60_000)
    dongHo.troi(59_999)
    expect(limiter.take('scan:a', 1).allowed).toBe(false)
    dongHo.troi(1)
    expect(limiter.take('scan:a', 1).allowed).toBe(true)
  })

  it('tôn trọng cửa sổ tuỳ chỉnh chứ không cứng nhắc một phút', () => {
    const dongHo = dungDongHo()
    const limiter = new RateLimiter({ windowMs: 5_000, now: dongHo.now })
    limiter.take('scan:a', 1)
    expect(limiter.take('scan:a', 1).retryAfterMs).toBe(5_000)
    dongHo.troi(5_000)
    expect(limiter.take('scan:a', 1).allowed).toBe(true)
  })
})

describe('mỗi khoá một hạn ngạch riêng', () => {
  it('một người quét nhiều không làm người bên cạnh bị vạ lây', () => {
    // Khoá ở bridge là `scan:<người>:<địa chỉ>`. Chặn nhầm cả xưởng vì một máy tính là kiểu hỏng
    // tệ nhất: người không làm gì cả cũng mất quyền quét.
    const dongHo = dungDongHo()
    const limiter = new RateLimiter({ windowMs: 60_000, now: dongHo.now })
    limiter.take('scan:ky-thuat-b:192.168.1.40', 1)
    expect(limiter.take('scan:ky-thuat-b:192.168.1.40', 1).allowed).toBe(false)
    expect(limiter.take('scan:quan-doc-a:192.168.1.41', 1)).toMatchObject({ allowed: true, remaining: 0 })
    expect(limiter.take('mut:ky-thuat-b:192.168.1.40', 1).allowed).toBe(true)
  })

  it('mỗi khoá có đồng hồ mở khoá riêng, không ai bị mở sớm hay mở muộn theo người khác', () => {
    const dongHo = dungDongHo()
    const limiter = new RateLimiter({ windowMs: 60_000, now: dongHo.now })
    limiter.take('scan:a', 1)
    dongHo.troi(30_000)
    limiter.take('scan:b', 1)
    dongHo.troi(30_000)
    expect(limiter.take('scan:a', 1).allowed).toBe(true)
    expect(limiter.take('scan:b', 1)).toMatchObject({ allowed: false, retryAfterMs: 30_000 })
  })
})

describe('prune giữ bộ nhớ mà không tha hạn ngạch', () => {
  it('không xoá hạn ngạch đang đếm dở, nếu không thì mỗi nhịp heartbeat 20 giây lại cấp lại quota', () => {
    // bridge/index.mjs gọi prune() trong heartbeat 20 giây. Nếu prune đụng vào bucket còn hạn thì
    // bộ chặn coi như không tồn tại: cứ 20 giây kẻ quét lại có đủ lượt.
    const dongHo = dungDongHo()
    const limiter = new RateLimiter({ windowMs: 60_000, now: dongHo.now })
    for (let lan = 0; lan < 6; lan += 1) limiter.take('scan:a', 6)
    for (let nhip = 1; nhip <= 2; nhip += 1) {
      dongHo.troi(20_000)
      limiter.prune()
      expect(limiter.take('scan:a', 6)).toMatchObject({ allowed: false, retryAfterMs: 60_000 - (nhip * 20_000) })
    }
  })

  it('dọn khoá đã hết hạn để bridge chạy dài ngày không phình một bucket cho mỗi máy khách', () => {
    // Đây chính là lời hứa ghi trong bình luận của prune(); nếu bỏ, bridge ở xưởng chạy hàng tháng
    // sẽ giữ một mục cho từng địa chỉ từng gọi vào.
    const dongHo = dungDongHo()
    const limiter = new RateLimiter({ windowMs: 60_000, now: dongHo.now })
    for (let i = 0; i < 50; i += 1) limiter.take(`scan:192.168.1.${i}`, 1)
    dongHo.troi(30_000)
    limiter.take('scan:con-song', 1)
    dongHo.troi(30_000)
    limiter.prune()
    expect(limiter.buckets.size).toBe(1)
    expect(limiter.take('scan:con-song', 1).allowed).toBe(false)
  })

  it('dọn đúng mốc hết hạn, cùng ranh giới với take chứ không lệch một nhịp', () => {
    const dongHo = dungDongHo()
    const limiter = new RateLimiter({ windowMs: 60_000, now: dongHo.now })
    limiter.take('scan:a', 1)
    dongHo.troi(59_999)
    limiter.prune()
    expect(limiter.buckets.size).toBe(1)
    dongHo.troi(1)
    limiter.prune()
    expect(limiter.buckets.size).toBe(0)
  })
})

describe('đồng hồ của máy chạy bridge', () => {
  it('đồng hồ nhảy lùi (NTP chỉnh giờ) không tự cấp thêm hạn ngạch', () => {
    // Máy mini ở xưởng đồng bộ giờ khi có mạng lại. Hỏng theo hướng an toàn là vẫn chặn; hỏng
    // theo hướng mở là cứ chỉnh giờ lùi lại quét được tiếp.
    const dongHo = dungDongHo()
    const limiter = new RateLimiter({ windowMs: 60_000, now: dongHo.now })
    limiter.take('scan:a', 1)
    dongHo.troi(-30_000)
    const phanQuyet = limiter.take('scan:a', 1)
    expect(phanQuyet.allowed).toBe(false)
    expect(phanQuyet.retryAfterMs).toBeGreaterThan(0)
    dongHo.troi(90_000)
    expect(limiter.take('scan:a', 1).allowed).toBe(true)
  })
})

// ---------------------------------------------------------------- hồi quy: hàng rào tắt âm thầm

describe('ngưỡng không hợp lệ', () => {
  it('KHÔNG được lặng lẽ tắt hàng rào — phải ném lỗi', () => {
    // `bucket.count >= undefined` và `>= NaN` đều false, nên trước bản vá mọi lần gọi đều
    // allowed:true và `remaining` là NaN. "Im lặng mở toang" nguy hơn hẳn "chặn nhầm".
    const bo = new RateLimiter({ windowMs: 60_000 })
    for (const xau of [undefined, null, NaN, 0, -1, 1.5, '6']) {
      expect(() => bo.take('k', xau), String(xau)).toThrow(/số nguyên >= 1/)
    }
  })

  it('ngưỡng hợp lệ vẫn chạy như cũ', () => {
    const bo = new RateLimiter({ windowMs: 60_000 })
    expect(bo.take('k', 1).allowed).toBe(true)
    expect(bo.take('k', 1).allowed).toBe(false)
  })
})
