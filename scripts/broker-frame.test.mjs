import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizeTelemetry } from '../bridge/lib/contract.mjs'

/**
 * Đầu nối Python↔JS: frame do `deploy-mini/broker.py` sinh ra phải qua được `normalizeTelemetry`
 * của bridge.
 *
 * Vì sao cần: đây là hai ngôn ngữ, hai file, hai người sửa, không có kiểu chung nào ràng buộc.
 * Test đơn lẻ mỗi bên đều xanh trong khi bridge TỪ CHỐI CẢ GÓI ngoài thực địa — và một gói bị
 * từ chối trên Mac Mini thì không ai nhìn thấy. Bài test này đã bắt được đúng một lỗi như vậy:
 * `id` sự kiện dài 106 ký tự, vượt trần 80 của `contract.mjs:236`.
 */

const broker = fileURLToPath(new URL('../deploy-mini/broker.py', import.meta.url))

function moiTruongDu() {
  if (!existsSync(broker)) return false
  try {
    execFileSync('python3', ['-c', 'import Crypto'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const du = moiTruongDu()

const SINH = [
  'import importlib.util, sys, json',
  'sys.argv = ["broker"]',
  `spec = importlib.util.spec_from_file_location("broker", ${JSON.stringify(broker)})`,
  'b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)',
  'base = {"patternName": "AO-01", "curStitch": 120, "patternStitch": 9538}',
  'cases = {',
  '  "may_im_lang": dict(base),',
  '  "may_tu_noi": dict(base, stateID=3, wstrStatusDesc="Thread break"),',
  '  "mo_ta_rat_dai": dict(base, stateID="X"*100, wstrStatusDesc="Y"*900),',
  '  "dau_tieng_viet": dict(base, state=15, wstrStatusDesc="Máy đang nghỉ"),',
  '}',
  'b._prev.clear()',
  'print(json.dumps({k: b.build_frame("dev-"+k, v) for k, v in cases.items()}))',
].join('\n')

const frames = du ? JSON.parse(execFileSync('python3', ['-c', SINH], { encoding: 'utf8' })) : {}
const machine = { id: 'm-1', adapter: 'dial-in' }
const nhan = (frame) => normalizeTelemetry(frame, { machine, receivedAt: '2026-08-22T10:00:00Z' })

describe('frame của broker.py qua hợp đồng của bridge', () => {
  it.skipIf(!du)('nhận frame khi máy im lặng, không đẻ sự kiện nào', () => {
    const snapshot = nhan(frames.may_im_lang)
    expect(snapshot.events).toEqual([])
    expect(snapshot.job).not.toBeNull()
  })

  it.skipIf(!du)('chuyển lời máy sang nguyên văn, ở mức info', () => {
    const [event] = nhan(frames.may_tu_noi).events
    expect(event.message).toBe('Thread break')
    expect(event.code).toBe('3')
    expect(event.source).toBe('controller')
    // Mức 'info' là bất biến: bridge/lib/alerts.mjs bỏ qua đúng mức này, nên nhịp tim của máy
    // không biến thành cảnh báo. Đổi mức ở broker phải làm đỏ chỗ này.
    expect(event.severity).toBe('info')
  })

  it.skipIf(!du)('không bị từ chối khi máy trả mô tả dài bất thường', () => {
    expect(() => nhan(frames.mo_ta_rat_dai)).not.toThrow()
  })

  it.skipIf(!du)('giữ nguyên dấu tiếng Việt qua đường Python → JSON → bridge', () => {
    expect(nhan(frames.dau_tieng_viet).events[0].message).toBe('Máy đang nghỉ')
  })

  it.skipIf(!du)('giữ ba trường cũ của frame không đổi', () => {
    for (const frame of Object.values(frames)) {
      expect(Object.keys(frame)).toEqual(expect.arrayContaining(['observedAt', 'status', 'job']))
      expect(['running', 'stopped', 'unknown']).toContain(frame.status)
    }
  })
})
