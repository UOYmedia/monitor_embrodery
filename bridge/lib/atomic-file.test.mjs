import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readJsonFile, writeJsonAtomic } from './atomic-file.mjs'

/**
 * Đây là lớp duy nhất đứng giữa "mất điện giữa lúc ghi" và sổ máy/sổ sản lượng của xưởng.
 * Nên phần đáng test không phải là "ghi ra đúng chữ", mà là ba lời hứa:
 *   1. ghi dở thì bản cũ vẫn đọc được nguyên vẹn (dữ liệu dở nằm ở đường tạm, không ở đường thật),
 *   2. xong việc không để lại file rác cho lần chạy sau nhặt phải,
 *   3. "chưa có sổ" và "có sổ nhưng hỏng" là hai chuyện khác nhau — nhầm cái sau thành cái trước
 *      là lặng lẽ bắt đầu lại từ số 0, đúng kiểu bịa dữ liệu mà cả repo này tránh.
 * Tất cả chạy trong thư mục tạm của hệ điều hành và dọn sau mỗi test.
 */

let dir
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'dahao-atomic-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const soPath = () => join(dir, 'so-san-luong.json')
const so = (overrides = {}) => ({
  schemaVersion: 3, updatedAt: '2026-08-14T07:00:00.000Z', cursors: {}, buckets: [], ...overrides,
})
const rac = async () => (await readdir(dir)).filter((ten) => ten.endsWith('.tmp'))

describe('writeJsonAtomic', () => {
  it('ghi xong không để lại file .tmp cho lần chạy sau nhặt phải làm dữ liệu', async () => {
    await writeJsonAtomic(soPath(), so())
    expect(await rac()).toEqual([])
    expect(await readdir(dir)).toEqual(['so-san-luong.json'])
  })

  it('tự tạo thư mục cha, nên máy mới cài không mất trắng lần ghi đầu tiên', async () => {
    const sauNhieuTang = join(dir, 'du-lieu', 'xuong-hn', 'so-san-luong.json')
    await writeJsonAtomic(sauNhieuTang, so({ buckets: [{ machineId: 'mch-hn-001', stitches: 120 }] }))
    expect(await readJsonFile(sauNhieuTang)).toMatchObject({ ok: true, value: { buckets: [{ stitches: 120 }] } })
  })

  it('lần ghi đầu không đẻ ra .bak rỗng đánh lừa người đi khôi phục', async () => {
    // Chưa từng có sổ thì cũng chưa có gì để cứu. Một file .bak 0 byte nằm đó sẽ khiến người
    // xử lý sự cố tưởng mình đang cầm bản cũ, rồi chép đè lên bản thật.
    await writeJsonAtomic(soPath(), so())
    expect(await readdir(dir)).not.toContain('so-san-luong.json.bak')
    expect(await readJsonFile(`${soPath()}.bak`)).toMatchObject({ ok: false, missing: true })
  })

  it('đè lên sổ cũ vẫn giữ được bản trước ở .bak để còn cứu', async () => {
    await writeJsonAtomic(soPath(), so({ buckets: [{ machineId: 'mch-hn-001', stitches: 1000 }] }))
    await writeJsonAtomic(soPath(), so({ buckets: [{ machineId: 'mch-hn-001', stitches: 2000 }] }))
    expect((await readJsonFile(soPath())).value.buckets[0].stitches).toBe(2000)
    expect((await readJsonFile(`${soPath()}.bak`)).value.buckets[0].stitches).toBe(1000)
  })

  it('.bak là bản ngay trước, không phải bản từ đời nào', async () => {
    // Người khôi phục cần ca vừa mất, không cần ca tuần trước.
    for (const stitches of [1000, 2000, 3000]) {
      await writeJsonAtomic(soPath(), so({ buckets: [{ machineId: 'mch-hn-001', stitches }] }))
    }
    expect((await readJsonFile(`${soPath()}.bak`)).value.buckets[0].stitches).toBe(2000)
  })

  it('mặc định là có giữ bản sao: người gọi quên tuỳ chọn vẫn còn đường lùi', async () => {
    await writeJsonAtomic(soPath(), so({ updatedAt: 'cu' }))
    await writeJsonAtomic(soPath(), so({ updatedAt: 'moi' }))
    expect(await readdir(dir)).toContain('so-san-luong.json.bak')

    const khongBackup = join(dir, 'tam.json')
    await writeJsonAtomic(khongBackup, so({ updatedAt: 'cu' }), { backup: false })
    await writeJsonAtomic(khongBackup, so({ updatedAt: 'moi' }), { backup: false })
    expect(await readdir(dir)).not.toContain('tam.json.bak')
    expect((await readJsonFile(khongBackup)).value.updatedAt).toBe('moi')
  })

  it('ghi dở dang (mất điện trước bước rename) vẫn đọc được sổ cũ nguyên vẹn', async () => {
    await writeJsonAtomic(soPath(), so({ buckets: [{ machineId: 'mch-hn-001', stitches: 1000 }] }))
    // Đúng thứ mất điện để lại: nửa tài liệu nằm ở đường tạm, chưa kịp rename.
    await writeFile(`${soPath()}.tmp`, '{\n  "schemaVersion": 3,\n  "buc', 'utf8')

    const doc = await readJsonFile(soPath())
    expect(doc.ok).toBe(true)
    expect(doc.value.buckets[0].stitches).toBe(1000)
  })

  it('rác .tmp của lần mất điện trước không chặn lần ghi kế tiếp', async () => {
    await writeFile(`${soPath()}.tmp`, 'nua chung khong phai JSON', 'utf8')
    await writeJsonAtomic(soPath(), so({ buckets: [{ machineId: 'mch-hn-001', stitches: 2000 }] }))
    expect((await readJsonFile(soPath())).value.buckets[0].stitches).toBe(2000)
    expect(await rac()).toEqual([])
  })

  it('tài liệu không tuần tự hoá được thì ném ra, không đụng vào sổ đang tốt', async () => {
    await writeJsonAtomic(soPath(), so({ buckets: [{ machineId: 'mch-hn-001', stitches: 1000 }] }))
    const vong = { schemaVersion: 3 }
    vong.self = vong

    await expect(writeJsonAtomic(soPath(), vong)).rejects.toThrow()
    expect((await readJsonFile(soPath())).value.buckets[0].stitches).toBe(1000)
    expect(await rac()).toEqual([])
  })

  it('số 0, chuỗi rỗng, mảng rỗng và null qua vòng ghi–đọc không hoá thành nhau', async () => {
    // Ca hỏng có tiền lệ: 0 mũi là một số đo thật, null là chưa đọc được. Nếu vòng ghi–đọc
    // nuốt mất khoá `stitches: 0` thì lần load sau sẽ thành "chưa có số", tức là bịa.
    const goc = so({ buckets: [{ machineId: 'mch-hn-001', stitches: 0, note: '', alerts: [], lastReadAt: null }] })
    await writeJsonAtomic(soPath(), goc)

    const { value } = await readJsonFile(soPath())
    expect(value).toEqual(goc)
    const bucket = value.buckets[0]
    expect(bucket.stitches).toBe(0)
    expect(bucket.stitches).not.toBeNull()
    expect(Object.keys(bucket)).toContain('lastReadAt')
    expect(bucket.lastReadAt).toBeNull()
  })

  it('tên máy có dấu tiếng Việt đọc lại đúng, không thành ký tự lạ', async () => {
    await writeJsonAtomic(soPath(), so({ buckets: [{ machineId: 'mch-hn-001', name: 'Máy thêu số 1 – Chuyền A' }] }))
    const raw = await readFile(soPath(), 'utf8')
    expect(raw).toContain('Máy thêu số 1 – Chuyền A')
    expect((await readJsonFile(soPath())).value.buckets[0].name).toBe('Máy thêu số 1 – Chuyền A')
  })

  it('file trên đĩa là JSON hợp lệ, xuống dòng, để còn mở ra đọc tay lúc sự cố', async () => {
    await writeJsonAtomic(soPath(), so({ buckets: [{ machineId: 'mch-hn-001', stitches: 7 }] }))
    const raw = await readFile(soPath(), 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
    expect(raw.endsWith('\n')).toBe(true)
    expect(raw.split('\n').length).toBeGreaterThan(3)
  })
})

describe('readJsonFile', () => {
  it('phân biệt chưa có sổ với sổ hỏng: một bên là bình thường, một bên phải gọi người', async () => {
    expect(await readJsonFile(soPath())).toMatchObject({ ok: false, missing: true })

    await writeFile(soPath(), '{"schemaVersion": 3, "buckets": [', 'utf8')
    const hong = await readJsonFile(soPath())
    expect(hong.ok).toBe(false)
    expect(hong.missing).toBeFalsy()
    expect(hong.error).toBeInstanceOf(Error)
  })

  it('file rỗng 0 byte là hỏng, không phải sổ trống — không được lặng lẽ bắt đầu lại', async () => {
    // 0 byte là dấu vết kinh điển của lần ghi bị cắt ngang. Nếu chỗ này báo `missing` thì
    // store sẽ khởi tạo sổ mới mà không ai kịp biết cả ca sản lượng vừa biến mất.
    await writeFile(soPath(), '', 'utf8')
    const ketQua = await readJsonFile(soPath())
    expect(ketQua.ok).toBe(false)
    expect(ketQua.missing).toBeFalsy()
    expect(ketQua.error).toBeInstanceOf(Error)
  })

  it('đọc hỏng thì không kèm giá trị bịa ra để người gọi vô tình dùng', async () => {
    expect((await readJsonFile(soPath())).value).toBeUndefined()
    await writeFile(soPath(), 'khong-phai-json', 'utf8')
    expect((await readJsonFile(soPath())).value).toBeUndefined()
  })

  it('sổ chính hỏng thì .bak vẫn đọc ra đúng bản trước đó, đúng như lời hứa trong log', async () => {
    await writeJsonAtomic(soPath(), so({ buckets: [{ machineId: 'mch-hn-001', stitches: 1000 }] }))
    await writeJsonAtomic(soPath(), so({ buckets: [{ machineId: 'mch-hn-001', stitches: 2000 }] }))
    await writeFile(soPath(), '{"schemaVersion": 3, "buc', 'utf8')

    expect((await readJsonFile(soPath())).ok).toBe(false)
    expect((await readJsonFile(`${soPath()}.bak`)).value.buckets[0].stitches).toBe(1000)
  })

  it('thư mục nằm đúng chỗ file sổ bị báo là hỏng, không phải là chưa có', async () => {
    // Nếu trả `missing` thì lần ghi sau sẽ coi như chưa có sổ, ghi đè lên một chỗ sai
    // và người vận hành không bao giờ nghe được câu "cấu hình đường dẫn sai".
    const ketQua = await readJsonFile(dir)
    expect(ketQua.ok).toBe(false)
    expect(ketQua.missing).toBeFalsy()
    expect(ketQua.error).toBeInstanceOf(Error)
  })

  it('đọc lên giữ nguyên số 0 và false, không rơi về null hay bị bỏ khoá', async () => {
    await writeFile(soPath(), JSON.stringify({ stitches: 0, running: false, name: '' }), 'utf8')
    expect((await readJsonFile(soPath())).value).toEqual({ stitches: 0, running: false, name: '' })
  })
})

// ---------------------------------------------------------------- hồi quy: tự huỷ sổ dữ liệu

describe('tài liệu không tuần tự hoá được', () => {
  it('undefined phải ném lỗi, KHÔNG được ghi chữ "undefined" đè lên sổ tốt', async () => {
    const p = join(dir, 'so.json')
    await writeJsonAtomic(p, { machines: ['a'] })
    // Trước bản vá: JSON.stringify(undefined) là undefined, template literal biến thành chữ
    // "undefined", rồi rename đè lên sổ — store tự huỷ dữ liệu mà không ném lỗi nào.
    await expect(writeJsonAtomic(p, undefined)).rejects.toThrow(/không tuần tự hoá được/)
    const doc = await readJsonFile(p)
    expect(doc.ok).toBe(true)
    expect(doc.value).toEqual({ machines: ['a'] })
  })
})

describe('hai lần ghi song song cùng một đường dẫn', () => {
  it('không lần nào mất nội dung, và không để lại rác .tmp', async () => {
    // Bridge có nhiều store + timer tự lưu, nên hai lần lưu chồng nhau là chuyện xảy ra được.
    const p = join(dir, 'song-song.json')
    const ket = await Promise.allSettled([
      writeJsonAtomic(p, { lan: 1, day: 'x'.repeat(20_000) }),
      writeJsonAtomic(p, { lan: 2, day: 'y'.repeat(20_000) }),
      writeJsonAtomic(p, { lan: 3, day: 'z'.repeat(20_000) }),
    ])
    expect(ket.every((k) => k.status === 'fulfilled')).toBe(true)
    const doc = await readJsonFile(p)
    expect(doc.ok, 'nội dung trộn giữa hai luồng sẽ làm JSON hỏng').toBe(true)
    expect([1, 2, 3]).toContain(doc.value.lan)
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})
