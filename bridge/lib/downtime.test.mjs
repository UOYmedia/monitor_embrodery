/**
 * Nhóm L (báo lỗi máy + đo thời gian ngừng) — các ca chạy được HÔM NAY, không cần máy, không cần
 * người ở xưởng: L‑07, L‑08, L‑09, L‑10.
 *
 * Đây là bốn hàm quyết định con số cuối cùng người ta đọc trên báo cáo: "máy X lỗi 12 phút 30
 * giây, mã E12". Không hàm nào trong số này chạm vào mạng, nên nếu chúng sai thì cái sai đi thẳng
 * vào sổ audit dưới danh nghĩa sự thật đo được — không có lớp nào phía sau bắt lại.
 *
 * ⚠ Ranh giới: bài này chứng minh PHÉP TÍNH đúng, không chứng minh SỐ LIỆU ĐẦU VÀO đúng. Máy A15
 * từ 21/08 tới nay chỉ phát `state=15` (idle) và chưa từng gửi một lần `fault` nào, nên nhánh
 * "máy vào lỗi thật" vẫn chưa có dữ liệu thật chạy qua — đó là L‑30…L‑33, cần ca máy chạy ở xưởng.
 */

import { describe, expect, it } from 'vitest'
import { DOWNTIME_STATUSES, durationSeconds, formatSpokenDuration, isDowntime, isImmediateDowntime, latestSignificantEvent } from './downtime.mjs'

/** Đúng năm trạng thái hợp đồng cho phép — xem `machineStatuses` trong `contract.mjs`. */
const NAM_TRANG_THAI = ['running', 'fault', 'stopped', 'paused', 'unknown']

describe('phân loại trạng thái ngừng', () => {
  it('coi fault/stopped/paused là ngừng, running/unknown thì không', () => {
    expect([...DOWNTIME_STATUSES].sort()).toEqual(['fault', 'paused', 'stopped'])
    expect(isDowntime('fault')).toBe(true)
    expect(isDowntime('running')).toBe(false)
    expect(isDowntime('unknown')).toBe(false)
  })

  it('chỉ fault mới đáng ghi ngay, dừng thường phải chờ ngưỡng', () => {
    expect(isImmediateDowntime('fault')).toBe(true)
    expect(isImmediateDowntime('stopped')).toBe(false)
    expect(isImmediateDowntime('paused')).toBe(false)
  })

  it('L‑07 · trả lời dứt khoát cho CẢ NĂM trạng thái, không sót cái nào', () => {
    // Liệt kê thành bảng chứ không kiểm lẻ từng cái: thêm một trạng thái mới vào hợp đồng mà quên
    // xếp nó vào "ngừng" hay "không ngừng" thì ca này đỏ ngay, thay vì lặng lẽ rơi vào "không".
    expect(Object.fromEntries(NAM_TRANG_THAI.map((s) => [s, isDowntime(s)]))).toEqual({
      running: false, fault: true, stopped: true, paused: true, unknown: false,
    })
    expect(Object.fromEntries(NAM_TRANG_THAI.map((s) => [s, isImmediateDowntime(s)]))).toEqual({
      running: false, fault: true, stopped: false, paused: false, unknown: false,
    })
  })

  it('L‑07 · `unknown` KHÔNG phải ngừng — mất tín hiệu không phải là máy đứng', () => {
    // Nếu xếp `unknown` vào ngừng thì mỗi lần rớt mạng sẽ đẻ một lần "máy ngừng" trong sổ, và
    // tổng thời gian ngừng của xưởng biến thành thước đo chất lượng đường mạng của chúng ta.
    expect(isDowntime('unknown')).toBe(false)
    expect(isImmediateDowntime('unknown')).toBe(false)
  })

  it('L‑07 · "ghi ngay" luôn là tập con của "ngừng", và chuỗi lạ thì không lọt', () => {
    for (const status of NAM_TRANG_THAI) {
      if (isImmediateDowntime(status)) expect(isDowntime(status)).toBe(true)
    }
    // Trạng thái tới từ hợp đồng nên luôn viết thường, không khoảng trắng. Chốt lại ở đây để nếu
    // mai có adapter nào gửi `"Fault"` thì nó rơi vào nhánh "không ngừng" một cách công khai —
    // và ca này là chỗ ghi rằng ta đã biết và đã chọn, chứ không phải sơ ý.
    for (const rac of ['Fault', ' fault ', 'FAULT', '', null, undefined, 0, {}]) {
      expect(isDowntime(rac)).toBe(false)
      expect(isImmediateDowntime(rac)).toBe(false)
    }
  })
})

describe('latestSignificantEvent', () => {
  it('bỏ qua sự kiện info', () => {
    expect(latestSignificantEvent([{ code: 'X', severity: 'info', occurredAt: '2026-08-24T00:00:00Z' }])).toBeNull()
    expect(latestSignificantEvent([])).toBeNull()
  })

  it('ưu tiên critical hơn warning dù warning mới hơn', () => {
    const event = latestSignificantEvent([
      { code: 'CRIT', severity: 'critical', occurredAt: '2026-08-24T00:00:00Z' },
      { code: 'WARN', severity: 'warning', occurredAt: '2026-08-24T01:00:00Z' },
    ])
    expect(event.code).toBe('CRIT')
  })

  it('trong cùng mức thì lấy cái mới nhất', () => {
    const event = latestSignificantEvent([
      { code: 'OLD', severity: 'critical', occurredAt: '2026-08-24T00:00:00Z' },
      { code: 'NEW', severity: 'critical', occurredAt: '2026-08-24T02:00:00Z' },
    ])
    expect(event.code).toBe('NEW')
  })

  it('L‑10 · rỗng / toàn info / không phải mảng đều ra null, và KHÔNG ném', () => {
    // Hàm này được gọi ngay trên đường ghi sổ lúc máy vào lỗi (`recordDowntimeOpen`). Nó mà ném
    // thì ta mất luôn dòng ghi nhận lần lỗi — hỏng đúng lúc cần nhất.
    expect(latestSignificantEvent([])).toBeNull()
    expect(latestSignificantEvent(undefined)).toBeNull()
    expect(latestSignificantEvent(null)).toBeNull()
    expect(latestSignificantEvent([
      { code: 'A', severity: 'info', occurredAt: '2026-08-24T00:00:00Z' },
      { code: 'B', severity: 'info', occurredAt: '2026-08-24T01:00:00Z' },
    ])).toBeNull()
  })

  it('L‑10 · một chuỗi truyền nhầm vào không được biến thành "sự kiện"', () => {
    // `for...of` duyệt chuỗi theo KÝ TỰ. Bản cũ trả về ký tự `'c'` như thể đó là một sự kiện, và
    // chỗ gọi in ra dòng audit "Controller báo máy lỗi · mã undefined" — một mã lỗi không hề tồn
    // tại, đóng dấu `actor: bridge` như thể máy đã khai ra nó.
    expect(latestSignificantEvent('critical')).toBeNull()
    expect(latestSignificantEvent({ code: 'E12', severity: 'critical' })).toBeNull()
  })

  it('L‑10 · lẫn critical giữa info và warning thì chọn đúng critical', () => {
    const event = latestSignificantEvent([
      { code: 'I1', severity: 'info', occurredAt: '2026-08-24T03:00:00Z' },
      { code: 'W1', severity: 'warning', occurredAt: '2026-08-24T02:00:00Z' },
      null,
      { code: 'C1', severity: 'critical', occurredAt: '2026-08-24T01:00:00Z' },
      undefined,
      { code: 'W2', severity: 'warning', occurredAt: '2026-08-24T04:00:00Z' },
    ])
    expect(event.code).toBe('C1')
  })

  it('L‑10 · mốc thời gian hỏng không được che mất một sự kiện thật đến sau', () => {
    const hong = { code: 'HONG-MOC', severity: 'warning', occurredAt: 'khong-phai-ngay' }
    const that = { code: 'THAT', severity: 'warning', occurredAt: '2026-08-24T02:00:00Z' }
    // Kết quả phải như nhau ở CẢ HAI thứ tự. `Date.parse` trả NaN cho mốc hỏng, mà mọi so sánh
    // với NaN đều false — nên bản cũ trả 'HONG-MOC' khi nó đứng trước và 'THAT' khi nó đứng sau:
    // mã lỗi báo cho xưởng phụ thuộc vào thứ tự adapter xếp mảng.
    expect(latestSignificantEvent([hong, that]).code).toBe('THAT')
    expect(latestSignificantEvent([that, hong]).code).toBe('THAT')
    // Nhưng nếu chỉ có mình nó thì vẫn phải nêu: mã lỗi là thật, chỉ mốc thời gian là không đọc được.
    expect(latestSignificantEvent([hong]).code).toBe('HONG-MOC')
  })

  it('L‑10 · sự kiện không có mã thì không nêu tên — thà thiếu còn hơn "mã undefined"', () => {
    expect(latestSignificantEvent([{ severity: 'critical', occurredAt: '2026-08-24T00:00:00Z' }])).toBeNull()
    expect(latestSignificantEvent([{ code: '   ', severity: 'critical', occurredAt: '2026-08-24T00:00:00Z' }])).toBeNull()
    // Có một cái không mã và một cái có mã thì phải lấy cái có mã, kể cả khi nó cũ hơn.
    const event = latestSignificantEvent([
      { severity: 'critical', occurredAt: '2026-08-24T05:00:00Z' },
      { code: 'E12', severity: 'critical', occurredAt: '2026-08-24T01:00:00Z' },
    ])
    expect(event.code).toBe('E12')
  })
})

describe('formatSpokenDuration', () => {
  it('đọc giây/phút/giờ cho người ở xưởng', () => {
    expect(formatSpokenDuration(0)).toBe('0 giây')
    expect(formatSpokenDuration(45)).toBe('45 giây')
    expect(formatSpokenDuration(60)).toBe('1 phút')
    expect(formatSpokenDuration(750)).toBe('12 phút 30 giây')
    expect(formatSpokenDuration(3600)).toBe('1 giờ')
    expect(formatSpokenDuration(7500)).toBe('2 giờ 5 phút')
  })

  it('trả null khi số không hợp lệ, để chỗ gọi nói "không rõ"', () => {
    expect(formatSpokenDuration(-1)).toBeNull()
    expect(formatSpokenDuration(NaN)).toBeNull()
  })

  it('L‑09 · các mốc chuyển bậc đọc được, không có "0 phút 0 giây"', () => {
    const BANG = [
      [0, '0 giây'],
      [59, '59 giây'],
      [60, '1 phút'],
      [61, '1 phút 1 giây'],
      [3599, '59 phút 59 giây'],
      [3600, '1 giờ'],
      [86_400, '24 giờ'],
      [90_061, '25 giờ 1 phút'],
    ]
    for (const [giay, mong] of BANG) expect([giay, formatSpokenDuration(giay)]).toEqual([giay, mong])
    for (const [, mong] of BANG) {
      // Không chuỗi nào được chứa một bậc rỗng. "1 giờ 0 phút" / "0 phút 0 giây" là dấu hiệu
      // của phép nối máy móc, và người ở xưởng đọc nó thành "không có gì xảy ra".
      expect(mong).not.toMatch(/\S 0 (phút|giây)/)
      expect(mong).not.toMatch(/NaN|undefined|Infinity/)
    }
  })

  it('L‑09 · quá một giờ thì bỏ phần giây — có chủ ý, đừng "sửa" lại', () => {
    // 3601 giây = "1 giờ", mất 1 giây. Ở thang giờ, con số đáng quan tâm là "hơn một tiếng", còn
    // một giây lẻ chỉ làm dòng báo dài ra. Ghi lại ở đây để lần sau ai đọc code không tưởng là lỗi.
    expect(formatSpokenDuration(3601)).toBe('1 giờ')
    expect(formatSpokenDuration(3659)).toBe('1 giờ')
    expect(formatSpokenDuration(3660)).toBe('1 giờ 1 phút')
  })

  it('L‑09 · mọi đầu vào không phải số giây hữu hạn không âm đều ra null', () => {
    for (const rac of [-1, -0.4, NaN, Infinity, -Infinity, '750', null, undefined, {}, []]) {
      expect([rac, formatSpokenDuration(rac)]).toEqual([rac, null])
    }
  })
})

describe('durationSeconds', () => {
  it('tính khoảng cách hai mốc ISO, làm tròn, không âm', () => {
    expect(durationSeconds('2026-08-24T00:00:00Z', '2026-08-24T00:12:30Z')).toBe(750)
    // Mốc kết thúc trước mốc bắt đầu (đồng hồ nhảy lùi) không sinh thời lượng âm.
    expect(durationSeconds('2026-08-24T00:05:00Z', '2026-08-24T00:00:00Z')).toBe(0)
  })

  it('trả null khi một mốc không đọc được', () => {
    expect(durationSeconds('không-phải-ngày', '2026-08-24T00:00:00Z')).toBeNull()
    expect(durationSeconds('2026-08-24T00:00:00Z', null)).toBeNull()
  })

  it('L‑08 · cùng một khoảnh khắc viết ở múi giờ nào cũng ra một con số', () => {
    // Xưởng ở +07:00, bridge có thể chạy ở bất kỳ đâu. Một lần ngừng không được dài ra hay ngắn
    // đi chỉ vì adapter viết mốc theo giờ Việt Nam thay vì giờ Z.
    expect(durationSeconds('2026-08-24T07:00:00+07:00', '2026-08-24T00:12:30Z')).toBe(750)
    expect(durationSeconds('2026-08-23T17:00:00-07:00', '2026-08-24T00:12:30Z')).toBe(750)
    expect(durationSeconds('2026-08-24T07:00:00+07:00', '2026-08-24T07:12:30+07:00')).toBe(750)
  })

  it('L‑08 · mốc KHÔNG kèm múi giờ bị từ chối, không đoán theo giờ máy chủ', () => {
    // `Date.parse('2026-08-24T00:00:00')` không báo lỗi — nó đọc theo giờ ĐỊA PHƯƠNG. Cùng cặp mốc
    // dưới đây (thật ra là 12 phút 30 giây), bản cũ trả 25.950 giây ("7 giờ 12 phút") nếu bridge
    // chạy ở Việt Nam và 0 giây nếu chạy ở Los Angeles — hai con số bịa khác nhau, im lặng, và
    // ca kiểm thử chạy trên máy này sẽ không bao giờ nhìn thấy con số mà xưởng nhìn thấy.
    expect(durationSeconds('2026-08-24T00:00:00', '2026-08-24T00:12:30Z')).toBeNull()
    expect(durationSeconds('2026-08-24T00:00:00Z', '2026-08-24T00:12:30')).toBeNull()
    // Cả hai đều thiếu múi giờ thì phép trừ "tự triệt tiêu" và ra đúng 750 — vẫn phải từ chối:
    // đúng ở đây là ăn may, hai mốc có thể tới từ hai nguồn có hai giờ khác nhau.
    expect(durationSeconds('2026-08-24T00:00:00', '2026-08-24T00:12:30')).toBeNull()
  })

  it('L‑08 · các kiểu mốc sai khác đều ra null chứ không NaN lặng lẽ', () => {
    for (const rac of ['14/08/2026', '2026-08-24 00:00:00', '2026-08-24', '', ' ', null, undefined, 1_756_000_000_000, {}]) {
      expect([rac, durationSeconds(rac, '2026-08-24T00:12:30Z')]).toEqual([rac, null])
      expect([rac, durationSeconds('2026-08-24T00:00:00Z', rac)]).toEqual([rac, null])
    }
  })

  it('L‑08 · phần lẻ dưới giây được làm tròn, không cắt cụt', () => {
    expect(durationSeconds('2026-08-24T00:00:00.000Z', '2026-08-24T00:12:30.400Z')).toBe(750)
    expect(durationSeconds('2026-08-24T00:00:00.000Z', '2026-08-24T00:12:30.600Z')).toBe(751)
  })
})
