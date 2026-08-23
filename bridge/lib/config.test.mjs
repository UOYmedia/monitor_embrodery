import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configWarnings, loadConfig } from './config.mjs'

/**
 * Nạp cấu hình là chỗ cuối cùng bridge còn dừng lại được. Qua khỏi `loadConfig`, mọi con số sai
 * đã trở thành con số hiển thị trên dashboard, và người đứng ở xưởng không có cách nào phân biệt
 * "ngưỡng tươi 30 giây" với "ngưỡng tươi 30 giây vì file cấu hình hỏng nên bridge tự lấy mặc định".
 * Nên gần hết test dưới đây kiểm đúng một việc: cấu hình sai phải NÉM LỖI kèm câu đọc được,
 * không được trả về một object trông rất bình thường.
 */

let dir
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'bridge-config-')) })
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.BRIDGE_TOKEN_TEST_KTV
})

const configPath = () => join(dir, 'bridge.config.json')

/** `loadConfig` đọc đĩa thật, nên fixture cũng phải nằm trên đĩa thật. */
async function load(raw) {
  await writeFile(configPath(), typeof raw === 'string' ? raw : JSON.stringify(raw), 'utf8')
  return loadConfig(configPath())
}

const site = (overrides = {}) => ({ id: 'hn-1', name: 'Xưởng Hà Nội', allowedCidrs: ['192.168.10.0/24'], ...overrides })
/** Cấu hình tối thiểu chạy được: một site có dải IP. Mọi thứ khác để mặc định. */
const oneSite = (siteOverrides = {}, rest = {}) => ({ sites: [site(siteOverrides)], ...rest })

describe('file cấu hình không đọc được', () => {
  it('thiếu file thì dừng hẳn và chỉ đúng đường dẫn đang tìm, không chạy với đội máy rỗng', async () => {
    const missing = join(dir, 'khong-ton-tai.json')
    // Chạy tiếp với `{}` nghĩa là dashboard mở ra trắng trơn mà không ai biết vì sao.
    await expect(loadConfig(missing)).rejects.toThrow(missing)
    await expect(loadConfig(missing)).rejects.toThrow('bridge.config.example.json')
  })

  it('JSON gõ thừa một dấu phẩy thì báo lỗi, không âm thầm rơi về cấu hình mặc định', async () => {
    await expect(load('{ "sites": [{ "id": "hn-1" }], }')).rejects.toThrow(/Không đọc được/)
  })
})

describe('site và dải IP được phép chạm tới', () => {
  it('chưa cấp dải IP nào thì bridge không khởi động, để không đi quét bừa mạng xưởng', async () => {
    await expect(load({})).rejects.toThrow(/ít nhất một site/)
    await expect(load({ sites: [] })).rejects.toThrow(/ít nhất một site/)
  })

  it('site không khai allowedCidrs thì dừng, chứ không mặc định là "quét tất"', async () => {
    await expect(load({ sites: [{ id: 'hn-1' }] })).rejects.toThrow(/chưa có allowedCidrs/)
    await expect(load(oneSite({ allowedCidrs: [] }))).rejects.toThrow(/chưa có allowedCidrs/)
  })

  it('CIDR gõ sai thì dừng và in lại đúng chuỗi sai để người ta biết sửa dòng nào', async () => {
    await expect(load(oneSite({ allowedCidrs: ['192.168.10.0/33'] }))).rejects.toThrow('192.168.10.0/33')
  })

  it('hai site trùng mã thì dừng, vì máy sẽ bị gán nhầm xưởng mà không ai thấy', async () => {
    await expect(load({ sites: [site(), site({ name: 'Xưởng khác' })] })).rejects.toThrow(/trùng/)
  })

  it('CIDR viết kèm bit host vẫn phủ cả dải, không thu lại còn đúng một máy', async () => {
    // Người ta hay chép IP của máy bridge rồi thêm /24. Nếu bridge giữ nguyên chuỗi đó thì
    // allowlist lệch đi và những máy còn lại của cùng subnet bị coi là ngoài dải.
    const config = await load(oneSite({ allowedCidrs: ['192.168.10.55/24'] }))
    expect(config.sites[0].allowedCidrs).toEqual(['192.168.10.0/24'])
  })
})

describe('ngưỡng tươi — ngưỡng sai thì cả dashboard nói dối', () => {
  it('staleSeconds không lớn hơn freshSeconds thì dừng: không còn trạng thái "cũ" nào tồn tại được', async () => {
    await expect(load(oneSite({}, { freshness: { freshSeconds: 60, staleSeconds: 60 } }))).rejects.toThrow(/staleSeconds phải lớn hơn/)
    await expect(load(oneSite({}, { freshness: { freshSeconds: 90, staleSeconds: 30 } }))).rejects.toThrow(/staleSeconds phải lớn hơn/)
  })

  it('site khai freshSeconds vượt mốc stale chung thì dừng và gọi tên đúng site đó', async () => {
    // Ngưỡng của site chỉ khai một nửa là ca hỏng có tiền lệ: fresh 200 đè lên stale 90 chung
    // sẽ cho ra một site mà mọi máy nhảy thẳng từ "online" sang "offline", bỏ hẳn "cũ".
    await expect(load(oneSite({ freshSeconds: 200 }))).rejects.toThrow(/site hn-1/)
  })

  it('freshSeconds = 0 là lỗi cấu hình, không phải "luôn tươi"', async () => {
    await expect(load(oneSite({}, { freshness: { freshSeconds: 0, staleSeconds: 90 } }))).rejects.toThrow(/số dương/)
    await expect(load(oneSite({ staleSeconds: -1 }))).rejects.toThrow(/số dương/)
  })

  it('site không khai ngưỡng thì thừa hưởng ngưỡng chung, không tụt về 0 hay undefined', async () => {
    const config = await load(oneSite({}, { freshness: { freshSeconds: 45, staleSeconds: 150 } }))
    expect(config.sites[0]).toMatchObject({ freshSeconds: 45, staleSeconds: 150 })
  })
})

describe('nhịp hỏi máy', () => {
  it('jitterRatio = 0 nghĩa là tắt jitter, không bị coi là bỏ trống rồi thay bằng 0.2', async () => {
    const config = await load(oneSite({}, { poll: { jitterRatio: 0 } }))
    expect(config.poll.jitterRatio).toBe(0)
  })

  it('jitterRatio ngoài khoảng 0–1 thì dừng, không âm thầm cắt về biên', async () => {
    await expect(load(oneSite({}, { poll: { jitterRatio: 1.5 } }))).rejects.toThrow(/0–1/)
  })
})

describe('nhật ký kiểm toán — thứ dùng để đối chiếu lương', () => {
  it('không khai hạn giữ nghĩa là giữ mãi, không phải giữ 0 ngày', async () => {
    const config = await load(oneSite())
    expect(config.audit.retentionDays).toBeNull()
    expect(configWarnings(config).some((warning) => warning.includes('retentionDays'))).toBe(false)
  })

  it('hạn giữ 0 ngày bị chặn, không được hiểu thành "giữ mãi" cũng không thành "xoá sạch"', async () => {
    await expect(load(oneSite({}, { audit: { retentionDays: 0 } }))).rejects.toThrow(/30 ngày trở lên/)
  })

  it('hạn giữ ngắn hơn 30 ngày bị chặn: bằng chứng lương phải sống lâu hơn một kỳ trả lương', async () => {
    await expect(load(oneSite({}, { audit: { retentionDays: 7 } }))).rejects.toThrow(/30 ngày trở lên/)
  })

  it('khai hạn giữ thì phải cảnh báo rõ là nhật ký cũ sẽ bị xoá, kèm số ngày', async () => {
    const config = await load(oneSite({}, { audit: { retentionDays: 90 } }))
    expect(config.audit.retentionDays).toBe(90)
    const warning = configWarnings(config).find((entry) => entry.includes('retentionDays'))
    expect(warning).toContain('90')
    expect(warning).toContain('xoá')
  })

  it('maxBytes quá nhỏ bị chặn để nhật ký không vỡ vụn thành hàng trăm mảnh', async () => {
    await expect(load(oneSite({}, { audit: { maxBytes: 1024 } }))).rejects.toThrow(/65536/)
  })
})

describe('đăng nhập — mặc định "ai cũng là admin" phải kêu to', () => {
  it('mode "token" mà chưa khai token nào thì dừng, không tụt về chế độ ai cũng vào được', async () => {
    await expect(load(oneSite({}, { auth: { mode: 'token', tokens: [] } }))).rejects.toThrow(/chưa khai báo auth.tokens/)
  })

  it('thiếu secret hoặc secret quá ngắn thì dừng, không mở bridge không mật khẩu', async () => {
    const withEnv = { mode: 'token', tokens: [{ id: 't-ktv', actor: 'ktv.an', role: 'technician', tokenEnv: 'BRIDGE_TOKEN_TEST_KTV' }] }
    // Biến môi trường chưa đặt: đây là ca hỏng thật khi quên `--env-file`. Nếu bridge vẫn chạy,
    // nó chạy với đúng 0 token hợp lệ và không ai vào được — hoặc tệ hơn, với token rỗng.
    await expect(load(oneSite({}, { auth: withEnv }))).rejects.toThrow(/16 ký tự/)
    await expect(load(oneSite({}, { auth: { mode: 'token', tokens: [{ role: 'admin', token: 'ngan' }] } }))).rejects.toThrow(/16 ký tự/)
  })

  it('token lấy từ biến môi trường, để secret không phải nằm trong file cấu hình', async () => {
    process.env.BRIDGE_TOKEN_TEST_KTV = 'ktv-token-0123456789'
    const config = await load(oneSite({}, {
      auth: { mode: 'token', tokens: [{ id: 't-ktv', actor: 'ktv.an', role: 'technician', tokenEnv: 'BRIDGE_TOKEN_TEST_KTV' }] },
    }))
    expect(config.auth.tokens).toEqual([{ id: 't-ktv', actor: 'ktv.an', role: 'technician', token: 'ktv-token-0123456789' }])
  })

  it('vai trò gõ sai không được lặng lẽ thành viewer hay admin', async () => {
    const tokens = [{ id: 't-1', actor: 'ai-do', role: 'Admin', token: 'token-dai-0123456789' }]
    await expect(load(oneSite({}, { auth: { mode: 'token', tokens } }))).rejects.toThrow(/viewer\|technician\|admin/)
  })

  it('mode gõ sai thì dừng, không rơi về single-admin là chế độ dễ dãi nhất', async () => {
    await expect(load(oneSite({}, { auth: { mode: 'tokens' } }))).rejects.toThrow(/auth.mode/)
  })

  it('để mặc định thì phải cảnh báo mọi request trong LAN đều được coi là admin', async () => {
    const config = await load(oneSite())
    expect(config.auth.mode).toBe('single-admin')
    expect(configWarnings(config).some((warning) => warning.includes('single-admin'))).toBe(true)
  })
})

describe('đường dẫn dữ liệu', () => {
  it('đường dẫn tương đối tính theo thư mục chứa file cấu hình, không theo thư mục đang gõ lệnh', async () => {
    // Nếu tính theo cwd thì chạy bridge từ chỗ khác sẽ tạo một kho dữ liệu RỖNG mới:
    // dashboard mở ra không còn máy nào, mà file cũ vẫn nằm nguyên chỗ cũ.
    const config = await load(oneSite())
    expect(config.dataPath).toBe(join(dir, 'bridge-data', 'fleet-store.json'))
    expect(config.auditPath).toBe(join(dir, 'bridge-data', 'audit-log.jsonl'))
    expect(config.productionPath).toBe(join(dir, 'bridge-data', 'production.json'))
    expect(config.uiPath).toBe(join(dir, 'dist'))
    expect(config.dataPath.startsWith(process.cwd())).toBe(false)
  })
})

describe('cổng cho máy tự gọi vào', () => {
  it('không khai ingest thì cổng vẫn đóng và không có cảnh báo mở cổng nào', async () => {
    const config = await load(oneSite())
    expect(config.ingest.enabled).toBe(false)
    expect(configWarnings(config).some((warning) => warning.includes('ingest'))).toBe(false)
  })

  it('bật ingest thì cảnh báo phải nói rõ đang mở địa chỉ và cổng nào', async () => {
    const config = await load(oneSite({}, { ingest: { enabled: true, host: '192.168.10.5', port: 1600 } }))
    expect(configWarnings(config).some((warning) => warning.includes('192.168.10.5:1600'))).toBe(true)
  })

  it('cổng ingest ngoài dải 1–65535 thì dừng ngay, không đợi tới lúc mở socket mới hỏng', async () => {
    await expect(load(oneSite({}, { ingest: { port: 70000 } }))).rejects.toThrow(/1–65535/)
    await expect(load(oneSite({}, { ingest: { port: 0 } }))).rejects.toThrow(/số dương/)
  })

  it('bật capture thì phải cảnh báo, vì bridge đang ghi byte thô ra đĩa', async () => {
    const config = await load(oneSite({}, { ingest: { enabled: true, capture: true } }))
    expect(configWarnings(config).some((warning) => warning.includes('capture'))).toBe(true)
  })
})

describe('quét mạng', () => {
  it('nới rộng phạm vi quét thì phải có cảnh báo, không được lặng lẽ', async () => {
    const config = await load(oneSite({}, { scan: { allowLoopback: true, allowPublicRanges: true } }))
    const warnings = configWarnings(config)
    expect(warnings.some((warning) => warning.includes('allowLoopback'))).toBe(true)
    expect(warnings.some((warning) => warning.includes('allowPublicRanges'))).toBe(true)
  })
})

describe('ca làm việc — ranh giới ca sai là lương sai', () => {
  it('site chưa khai ca thì cảnh báo trước khi ai kịp dùng số liệu tính lương khoán', async () => {
    const config = await load(oneSite())
    expect(configWarnings(config).some((warning) => warning.includes('chưa khai báo ca'))).toBe(true)
  })

  it('ca chồng giờ nhau thì dừng: một mũi tính hai lần là trả tiền hai lần', async () => {
    const shifts = [
      { id: 'ca-1', name: 'Ca ngày', start: '06:00', end: '18:00' },
      { id: 'ca-2', name: 'Ca chiều', start: '14:00', end: '22:00' },
    ]
    await expect(load(oneSite({ shifts }))).rejects.toThrow(/chồng giờ/)
  })

  it('ca không phủ hết ngày thì cảnh báo, vì sản lượng ngoài ca vẫn phải cộng vào đâu đó', async () => {
    const shifts = [{ id: 'ca-1', name: 'Ca ngày', start: '06:00', end: '18:00' }]
    const config = await load(oneSite({ shifts }))
    expect(configWarnings(config).some((warning) => warning.includes('Ngoài ca'))).toBe(true)
  })

  it('ca phủ kín 24 giờ thì không còn cảnh báo nào về ca', async () => {
    const shifts = [
      { id: 'ca-1', name: 'Ca ngày', start: '06:00', end: '18:00' },
      { id: 'ca-2', name: 'Ca đêm', start: '18:00', end: '06:00' },
    ]
    const config = await load(oneSite({ shifts }))
    const warnings = configWarnings(config)
    expect(warnings.some((warning) => warning.includes('chưa khai báo ca'))).toBe(false)
    expect(warnings.some((warning) => warning.includes('Ngoài ca'))).toBe(false)
  })
})

describe('đơn giá và ngưỡng đứt chỉ — chưa đặt thì để trống, không bịa', () => {
  it('chưa đặt đơn giá thì để trống; đặt 0 thì vẫn là 0 — hai chuyện khác nhau', async () => {
    expect((await load(oneSite())).sites[0].pricePer1000Stitches).toBeNull()
    expect((await load(oneSite({ pricePer1000Stitches: null }))).sites[0].pricePer1000Stitches).toBeNull()
    // 0 là đơn giá đã được khai (hàng gia công không tính công mũi), không phải "chưa khai".
    expect((await load(oneSite({ pricePer1000Stitches: 0 }))).sites[0].pricePer1000Stitches).toBe(0)
  })

  it('đơn giá âm hoặc lệch thang tiền thì dừng, không để lương khoán tính ra số vô lý', async () => {
    await expect(load(oneSite({ pricePer1000Stitches: -1 }))).rejects.toThrow(/VND/)
    await expect(load(oneSite({ pricePer1000Stitches: 99_000_000 }))).rejects.toThrow(/VND/)
  })

  it('chưa đặt ngưỡng đứt chỉ thì để trống, dashboard chỉ in con số đo được', async () => {
    expect((await load(oneSite())).sites[0].threadBreakWarnPer1000).toBeNull()
  })

  it('ngưỡng đứt chỉ 0 thì dừng: mọi máy sẽ vượt ngưỡng và cảnh báo thành vô nghĩa', async () => {
    await expect(load(oneSite({ threadBreakWarnPer1000: 0 }))).rejects.toThrow(/đứt trên 1.000 mũi/)
  })
})

describe('thư viện mẫu .DST', () => {
  it('không khai thư viện thì path = null, để ô máy ghi "chưa cấu hình" thay vì hiện ảnh nào đó', async () => {
    expect((await load(oneSite())).designLibrary.path).toBeNull()
    expect((await load(oneSite({}, { designLibrary: { path: null } }))).designLibrary.path).toBeNull()
  })

  it('khai thư viện thì cũng tính theo thư mục cấu hình, không theo thư mục đang gõ lệnh', async () => {
    const config = await load(oneSite({}, { designLibrary: { path: './mau-theu', maxFiles: 10 } }))
    expect(config.designLibrary).toMatchObject({ path: join(dir, 'mau-theu'), maxFiles: 10 })
  })

  it('path không phải chuỗi thì dừng, không lặng lẽ tắt thư viện', async () => {
    await expect(load(oneSite({}, { designLibrary: { path: 123 } }))).rejects.toThrow(/designLibrary.path/)
  })
})

// ---------------------------------------------------------------- hồi quy: ép kiểu âm thầm

describe('boolean phải là boolean thật', () => {
  it('"false" trong nháy KHÔNG được bật cổng nhận dữ liệu từ ngoài', async () => {
    // Đây là lỗi gõ JSON phổ biến nhất, và hậu quả của nó là mở rộng bề mặt phơi ra mạng:
    // trước bản vá, `Boolean("false")` = true làm bridge MỞ cổng lắng nghe cho thiết bị ngoài.
    await expect(load(oneSite({}, { ingest: { enabled: 'false' } })))
      .rejects.toThrow(/ingest.enabled phải là true hoặc false/)
  })

  it('"no" cũng không được bật quét loopback', async () => {
    await expect(load(oneSite({}, { scan: { allowLoopback: 'no' } })))
      .rejects.toThrow(/allowLoopback phải là true hoặc false/)
  })

  it('boolean thật vẫn chạy bình thường', async () => {
    const c = await load(oneSite({}, { ingest: { enabled: true }, scan: { allowLoopback: false } }))
    expect(c.ingest.enabled).toBe(true)
    expect(c.scan.allowLoopback).toBe(false)
  })
})

describe('khối cấu hình rỗng hoặc sai kiểu', () => {
  it('null không được lặng lẽ thành mặc định', async () => {
    // `null` là falsy và mảng có typeof 'object' — phép kiểm cũ để lọt cả hai, nên
    // `"freshness": null` cho bridge khởi động im lặng với ngưỡng mặc định.
    await expect(load(oneSite({}, { freshness: null }))).rejects.toThrow(/freshness phải là object/)
  })

  it('mảng cũng không phải object cấu hình', async () => {
    await expect(load(oneSite({}, { poll: [] }))).rejects.toThrow(/poll phải là object/)
  })
})

describe('allowedOrigins', () => {
  it('quên ngoặc vuông thì hỏng to, không âm thầm mở localhost trên máy ở xưởng', async () => {
    // Trước bản vá: origin thật của xưởng bị bỏ, còn hai origin dev localhost lại được mở.
    await expect(load(oneSite({}, { allowedOrigins: 'https://vi-du.example' })))
      .rejects.toThrow(/allowedOrigins phải là mảng/)
  })

  it('mảng đúng thì giữ nguyên, không trộn thêm mặc định', async () => {
    const c = await load(oneSite({}, { allowedOrigins: ['https://redthread.example'] }))
    expect(c.allowedOrigins).toEqual(['https://redthread.example'])
  })
})

describe('mức log', () => {
  it('gõ sai thì báo, không im lặng rơi về info giữa lúc đang dò lỗi tại xưởng', async () => {
    await expect(load(oneSite({}, { logLevel: 'warning' }))).rejects.toThrow(/logLevel phải là debug/)
    await expect(load(oneSite({}, { logLevel: 'DEBUG' }))).rejects.toThrow(/logLevel phải là debug/)
  })
})

describe('số phải là số', () => {
  it('true không phải là cổng 1', async () => {
    await expect(load(oneSite({}, { port: true }))).rejects.toThrow(/port phải là số dương/)
  })

  it('mảng chứa số cũng không phải số', async () => {
    await expect(load(oneSite({}, { port: ['30'] }))).rejects.toThrow(/port phải là số dương/)
  })
})

// ---------------------------------------------------------------- hồi quy: sai âm thầm

describe('khoá cấu hình không nhận ra', () => {
  it('gõ sai tên khoá phải được nói ra — giá trị bạn đặt KHÔNG hề được áp dụng', async () => {
    // `"poll": {"intervalMss": 5000}` từng cho ra intervalMs mặc định mà không một lời nào.
    // Cùng cơ chế đó, gõ nhầm freshSecond cho ra đúng cái module này sinh ra để chặn:
    // một ngưỡng tươi sai âm thầm.
    const c = await load(oneSite({}, { poll: { intervalMss: 5000 }, khongCoKhoaNay: 1 }))
    expect(c.khoaLa).toContain('poll.intervalMss')
    expect(c.khoaLa).toContain('khongCoKhoaNay')
    expect(configWarnings(c).join(' ')).toMatch(/Không nhận ra khoá cấu hình/)
  })

  it('khoá chú thích của chính repo KHÔNG bị kêu oan', async () => {
    // File mẫu cố ý mang `_comment`, `_shifts`, `//audit`. Chặn cứng sẽ làm hỏng tài liệu.
    const c = await load(oneSite({}, { _comment: 'ghi chú', '//audit': ['dòng'], poll: { _comment: 'x', intervalMs: 5000 } }))
    expect(c.khoaLa).toEqual([])
    expect(c.poll.intervalMs).toBe(5000)
  })

  it('cấu hình đúng thì không cảnh báo gì về khoá', async () => {
    const c = await load(oneSite({}, { poll: { intervalMs: 5000 }, limits: { maxMachines: 5 } }))
    expect(c.khoaLa).toEqual([])
  })
})

describe('câu lỗi phải chỉ đúng file đang nạp', () => {
  it('nạp bridge.config.xuong2.json thì lỗi nói tên file đó, không nói bridge.config.json', async () => {
    // Người ở xưởng đọc câu lỗi rồi đi sửa file — chỉ sai tên là họ sửa file KHÔNG chạy,
    // còn file đang chạy vẫn sai.
    const khac = join(dir, 'bridge.config.xuong2.json')
    await writeFile(khac, JSON.stringify(oneSite({ freshSeconds: 90, staleSeconds: 30 })), 'utf8')
    await expect(loadConfig(khac)).rejects.toThrow(/bridge\.config\.xuong2\.json/)
  })
})
