import { describe, expect, it } from 'vitest'
import { deriveAlerts, highestSeverity, maintenanceForMachine, maintenanceStatus } from './alerts.mjs'

/**
 * alerts.mjs là chỗ DUY NHẤT biến mã lỗi và bộ đếm mũi thành câu chữ mà thợ đứng máy đọc.
 * Sai ở đây không làm sập gì cả — nó chỉ khiến người ta đi mở nhầm máy, bỏ qua mốc bảo trì,
 * hoặc tin vào một con số mà bridge chưa hề đọc được. Nên phần lớn test dưới đây hỏi đúng một
 * câu: "nếu dòng chữ này sai thì ai ở xưởng chịu thiệt?"
 */

const observedAt = '2026-08-14T07:00:00Z'

/** Mốc bảo trì đúng dạng machine-record.mjs chuẩn hoá ra: `lastServiceOdometer` là số hoặc null. */
const plan = (overrides = {}) => ({
  id: 'dau-may',
  title: 'Tra dầu đầu máy',
  intervalStitches: 100_000,
  lastServiceOdometer: 0,
  lastServiceAt: null,
  lastServiceBy: null,
  history: [],
  ...overrides,
})

/** Sự kiện đúng dạng contract.mjs trả về: `needle` là số 0..64 hoặc null, `source` mặc định controller. */
const event = (overrides = {}) => ({
  id: 'e1',
  occurredAt: observedAt,
  code: 'E-021',
  severity: 'warning',
  message: null,
  needle: null,
  source: 'controller',
  observedAt,
  ...overrides,
})

const reading = (value) => ({ value, observedAt, source: 'dahao-http', quality: 'verified' })
const telemetry = (overrides = {}) => ({ observedAt, events: [], odometer: null, threadBreakWindow: null, ...overrides })
const machine = (overrides = {}) => ({ id: 'may-01', maintenance: [], acknowledgements: {}, ...overrides })

describe('maintenanceStatus', () => {
  it('chưa đọc được bộ đếm mũi thì nói thẳng là chưa đọc được, không hiện 0 mũi đã dùng', () => {
    // "0 mũi đã dùng kể từ lần bảo trì" và "không biết đã dùng bao nhiêu" là hai chuyện khác hẳn.
    // Trả 0 ở đây là ru ngủ: quản đốc nhìn thấy mốc còn nguyên chu kỳ trong khi thật ra máy có thể
    // đã chạy quá hạn từ lâu.
    const status = maintenanceStatus(plan(), null)
    expect(status.dueState).toBe('unknown')
    expect(status.consumedStitches).toBeNull()
    expect(status.remainingStitches).toBeNull()
    expect(status.reason).toContain('Chưa đọc được')
  })

  it('không nhầm bộ đếm 0 mũi thành chưa đọc được: máy mới lắp vẫn phải theo dõi bảo trì', () => {
    const status = maintenanceStatus(plan(), 0)
    expect(status.dueState).toBe('ok')
    expect(status.consumedStitches).toBe(0)
    expect(status.remainingStitches).toBe(100_000)
    expect(status.reason).toBeNull()
    // Mã và tên mốc phải đi theo, nếu không thợ đọc được "tới hạn" mà không biết tới hạn cái gì.
    expect(status).toMatchObject({ id: 'dau-may', title: 'Tra dầu đầu máy' })
  })

  it('chưa từng bảo trì lần nào thì tính từ mũi số 0, không bỏ qua mốc', () => {
    const status = maintenanceStatus(plan({ lastServiceOdometer: null }), 95_000)
    expect(status.consumedStitches).toBe(95_000)
    expect(status.remainingStitches).toBe(5_000)
    expect(status.dueState).toBe('due')
  })

  it('bộ đếm tụt về (thay bo, reset máy) không sinh ra số mũi âm', () => {
    // Đầu máy vừa thay bảng điều khiển thì odometer về gần 0 trong khi mốc cũ ghi 500.000.
    // Nếu để số âm chạy tiếp, "còn -499.000 mũi" sẽ hiện thành quá hạn giả trên cả xưởng.
    const status = maintenanceStatus(plan({ lastServiceOdometer: 500_000 }), 1_000)
    expect(status.consumedStitches).toBe(0)
    expect(status.remainingStitches).toBe(100_000)
    expect(status.dueState).toBe('ok')
  })

  it('còn đúng 10% chu kỳ đã phải nhắc thợ chuẩn bị, không đợi sát nút', () => {
    expect(maintenanceStatus(plan(), 90_000).dueState).toBe('due')
    expect(maintenanceStatus(plan(), 89_999).dueState).toBe('ok')
  })

  it('hết đúng chu kỳ là quá hạn ngay, không đợi vượt thêm mũi nào', () => {
    expect(maintenanceStatus(plan(), 100_000).dueState).toBe('overdue')
    expect(maintenanceStatus(plan(), 100_000).remainingStitches).toBe(0)
    expect(maintenanceStatus(plan(), 130_000).remainingStitches).toBe(-30_000)
  })
})

describe('maintenanceForMachine', () => {
  it('máy chưa gửi telemetry: mọi mốc là chưa rõ, tuyệt đối không tự kết luận tới hạn', () => {
    const record = machine({ maintenance: [plan(), plan({ id: 'kim', title: 'Thay kim' })] })
    const result = maintenanceForMachine(record, null)
    expect(result).toHaveLength(2)
    for (const item of result) {
      expect(item.dueState).toBe('unknown')
      expect(item.remainingStitches).toBeNull()
    }
  })

  it('bộ đếm 0 mũi vẫn là số đọc được, không bị nuốt thành chưa rõ', () => {
    // `?? null` chứ không phải `|| null` — nếu chỗ này lệch một ký tự thì mọi máy mới lắp đều
    // báo "chưa đọc được bộ đếm" dù controller đang trả về số đàng hoàng.
    const result = maintenanceForMachine(machine({ maintenance: [plan()] }), telemetry({ odometer: reading(0) }))
    expect(result[0].dueState).toBe('ok')
    expect(result[0].consumedStitches).toBe(0)
  })

  it('máy chưa cấu hình mốc bảo trì nào thì trả danh sách rỗng chứ không hỏng cả trang', () => {
    expect(maintenanceForMachine({ id: 'may-02' }, telemetry({ odometer: reading(10_000) }))).toEqual([])
  })
})

describe('deriveAlerts — sự kiện từ máy', () => {
  it('sự kiện info không lọt vào danh sách ngoại lệ, để cảnh báo thật khỏi bị loãng', () => {
    const telemetryIn = telemetry({ events: [event({ id: 'e-info', severity: 'info', message: 'Đã nạp mẫu thêu.' })] })
    expect(deriveAlerts(machine(), telemetryIn, [])).toEqual([])
  })

  it('phán đoán của node cảm biến không được in thành lời khai của controller', () => {
    // Node cảm biến chỉ thấy trục ngừng quay, nó không biết vì sao. Gắn nhãn controller lên phán
    // đoán đó là bảo thợ rằng máy đã tự khai lỗi — thợ sẽ mở máy tìm một lỗi không hề tồn tại.
    const telemetryIn = telemetry({ events: [event({ source: 'sensor', code: 'S-STOP' })] })
    const [alert] = deriveAlerts(machine(), telemetryIn, [])
    expect(alert.kind).toBe('sensor-event')
    expect(alert.source).toBe('sensor')
    expect(alert.title).toContain('node cảm biến')
    expect(alert.title).not.toContain('controller')
  })

  it('sự kiện của controller giữ đúng nguồn controller để thợ biết máy đã tự khai', () => {
    const [alert] = deriveAlerts(machine(), telemetry({ events: [event()] }), [])
    expect(alert).toMatchObject({ id: 'event:e1', kind: 'controller-event', source: 'controller', severity: 'warning', since: observedAt })
  })

  it('sự kiện không kèm lời mô tả vẫn có tiêu đề đọc được, không để trống dòng cảnh báo', () => {
    const [alert] = deriveAlerts(machine(), telemetry({ events: [event({ message: '' })] }), [])
    expect(alert.title).toContain('E-021')
    expect(alert.title.length).toBeGreaterThan(5)
  })

  it('có số kim thì chỉ thẳng kim đó, thợ khỏi dò cả 15 kim', () => {
    const [alert] = deriveAlerts(machine(), telemetry({ events: [event({ needle: 5 })] }), [])
    expect(alert.detail).toContain('kim #5')
  })

  it('không có số kim thì không bịa ra một số kim nào cả', () => {
    const [alert] = deriveAlerts(machine(), telemetry({ events: [event({ needle: null })] }), [])
    expect(alert.detail).toBe('Mã E-021')
    expect(alert.detail).not.toContain('kim')
  })

  // LỖI ĐÃ BIẾT (chưa sửa, chỉ phơi bày): `event.needle ? ...` coi kim số 0 là không có kim.
  // contract.mjs cho phép needle 0..64 và MachineDetail.tsx in đúng bằng `!== null`, nên riêng
  // kim 0 bị rơi mất ở danh sách cảnh báo: thợ đọc "Mã E-021" trơ trọi rồi đi dò lại từ đầu.
  it('kim số 0 cũng là một cây kim thật, phải hiện trong chi tiết cảnh báo', () => {
    const [alert] = deriveAlerts(machine(), telemetry({ events: [event({ needle: 0 })] }), [])
    expect(alert.detail).toContain('kim #0')
  })
})

describe('deriveAlerts — ngưỡng đứt chỉ', () => {
  const window = (overrides = {}) => telemetry({ threadBreakWindow: reading({ needle: null, breaks: 12, stitches: 2_000, ...overrides }) })

  it('xưởng chưa đặt ngưỡng thì bridge không tự dựng ra mức bình thường', () => {
    // Không đặt = không phán xét. Một mức "bình thường" do bridge tự nghĩ ra là mức không ai ở
    // xưởng kiểm chứng được, mà nó lại đủ sức bắt thợ dừng máy đi chỉnh.
    expect(deriveAlerts(machine(), window(), [])).toEqual([])
  })

  it('vượt ngưỡng thì cảnh báo và ghi rõ số liệu thô để thợ tự kiểm chứng được', () => {
    const [alert] = deriveAlerts(machine(), window(), [], { threadBreakWarnPer1000: 3 })
    expect(alert).toMatchObject({ id: 'thread-break-rate', severity: 'warning', kind: 'thread-break-rate' })
    expect(alert.title).toContain('6.0')
    expect(alert.detail).toContain('12')
    expect(alert.detail).toContain('2000')
    expect(alert.detail).toContain('3')
  })

  it('tỉ lệ đứt chỉ là phép tính của bridge, không được ký tên controller', () => {
    const [alert] = deriveAlerts(machine(), window(), [], { threadBreakWarnPer1000: 3 })
    expect(alert.source).toBe('bridge')
  })

  it('đúng bằng ngưỡng thì chưa báo, chỉ vượt mới báo', () => {
    expect(deriveAlerts(machine(), window({ breaks: 6 }), [], { threadBreakWarnPer1000: 3 })).toEqual([])
  })

  it('không có mũi nào trong cửa sổ thì không dựng ra tỉ lệ vô nghĩa', () => {
    // breaks/0 ra Infinity; in "Infinity lần / 1.000 mũi" lên bảng xưởng là vừa vô nghĩa vừa
    // che mất những cảnh báo có thật.
    expect(deriveAlerts(machine(), window({ breaks: 3, stitches: 0 }), [], { threadBreakWarnPer1000: 3 })).toEqual([])
  })

  it('không có cửa sổ đứt chỉ thì im lặng, không đoán thay controller', () => {
    expect(deriveAlerts(machine(), telemetry(), [], { threadBreakWarnPer1000: 3 })).toEqual([])
  })

  it('cửa sổ đứt chỉ có ghi kim thì nêu đúng kim đó', () => {
    const [alert] = deriveAlerts(machine(), window({ needle: 7 }), [], { threadBreakWarnPer1000: 3 })
    expect(alert.title).toContain('kim #7')
  })

  // LỖI ĐÃ BIẾT (chưa sửa): cùng một kiểu `window.needle ? ...` làm kim số 0 rơi mất luôn ở
  // cảnh báo đứt chỉ — thợ biết có nguy cơ đứt chỉ nhưng không biết ở kim nào.
  it('cảnh báo đứt chỉ ở kim số 0 phải nói ra là kim 0', () => {
    const [alert] = deriveAlerts(machine(), window({ needle: 0 }), [], { threadBreakWarnPer1000: 3 })
    expect(alert.title).toContain('kim #0')
  })
})

describe('deriveAlerts — bảo trì', () => {
  it('mốc chưa rõ vì chưa đọc được bộ đếm không được biến thành cảnh báo tới hạn', () => {
    const unknown = maintenanceStatus(plan(), null)
    const ok = maintenanceStatus(plan(), 1_000)
    expect(deriveAlerts(machine(), telemetry(), [unknown, ok])).toEqual([])
  })

  it('quá hạn là cảnh báo nghiêm trọng và hiện số mũi dương, không hiện số âm', () => {
    // Người đọc "quá hạn -12.345 mũi" sẽ hiểu ngược thành còn dư; số quá hạn phải đọc là số đã lố.
    const [alert] = deriveAlerts(machine(), telemetry(), [maintenanceStatus(plan(), 112_345)])
    expect(alert).toMatchObject({ id: 'maintenance:dau-may', severity: 'critical', kind: 'maintenance' })
    expect(alert.title).toMatch(/12[.,]345/)
    expect(alert.title).not.toContain('-')
  })

  it('mốc tới hạn là việc ghi sổ của dashboard, không phải lỗi máy tự khai', () => {
    // Đóng dấu "controller" lên một mốc bảo trì do người đặt ra là làm hỏng đúng thứ mà cột nguồn
    // sinh ra để giữ: phân biệt máy báo lỗi với xưởng nhắc việc.
    const [alert] = deriveAlerts(machine(), telemetry(), [maintenanceStatus(plan(), 95_000)])
    expect(alert).toMatchObject({ severity: 'warning', source: 'dashboard', kind: 'maintenance' })
    expect(alert.title).toContain('Tra dầu đầu máy')
  })

  it('chưa từng chốt bảo trì thì nói chưa ghi nhận, không nói đã bảo trì tại 0 mũi', () => {
    const status = maintenanceStatus(plan({ lastServiceOdometer: null }), 95_000)
    const [alert] = deriveAlerts(machine(), telemetry(), [status])
    expect(alert.detail).toContain('chưa ghi nhận')
  })

  it('mốc đã chốt đúng tại 0 mũi phải hiện là 0 mũi, không hoá thành chưa ghi nhận', () => {
    const status = maintenanceStatus(plan({ lastServiceOdometer: 0 }), 95_000)
    const [alert] = deriveAlerts(machine(), telemetry(), [status])
    expect(alert.detail).toContain('0 mũi')
    expect(alert.detail).not.toContain('chưa ghi nhận')
  })
})

describe('deriveAlerts — xác nhận', () => {
  it('cảnh báo đã có người xác nhận vẫn nằm nguyên trong danh sách, chỉ kèm dấu xác nhận', () => {
    // Xác nhận là "đã có người biết", không phải "đã hết lỗi". Giấu nó đi là giấu một máy đang lỗi.
    const record = machine({ acknowledgements: { 'event:e1': { by: 'ky-thuat-b', at: observedAt } } })
    const alerts = deriveAlerts(record, telemetry({ events: [event()] }), [])
    expect(alerts).toHaveLength(1)
    expect(alerts[0].acknowledged).toMatchObject({ by: 'ky-thuat-b' })
  })

  it('cảnh báo chưa ai xác nhận trả về null hẳn hoi, giao diện khỏi phải đoán', () => {
    const [alert] = deriveAlerts(machine(), telemetry({ events: [event()] }), [])
    expect(alert.acknowledged).toBeNull()
  })
})

describe('highestSeverity', () => {
  it('không có cảnh báo nào thì không được dựng ra mức nghiêm trọng', () => {
    expect(highestSeverity([])).toBe('info')
  })

  it('một cảnh báo nghiêm trọng lẫn giữa đám nhẹ vẫn phải nổi lên, bất kể thứ tự', () => {
    const mixed = [{ severity: 'info' }, { severity: 'critical' }, { severity: 'warning' }]
    expect(highestSeverity(mixed)).toBe('critical')
    expect(highestSeverity([...mixed].reverse())).toBe('critical')
  })

  it('chỉ có cảnh báo vàng thì không thổi lên thành nghiêm trọng', () => {
    expect(highestSeverity([{ severity: 'warning' }, { severity: 'info' }])).toBe('warning')
  })
})
