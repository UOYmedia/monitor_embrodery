import assert from 'node:assert/strict'
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { EventQueue } from '../lib/json-store.mjs'
import { HttpError } from '../lib/redthread-client.mjs'
import { RepairTailer, repairEventId, repairPayload } from '../lib/repair-tailer.mjs'

// Dòng thật từ logs/va-mau.out trên mini (9/9).
const LINE_DONG = '{"at": "2026-08-27T03:04:37Z", "viec": "dong", "may": "602602A6F22B", "nghi": "nghi-dut-chi", "ma_nghi": 0, "giay": 66, "lui": 30, "mui": 520, "tong": 4804, "mau": "4152~.DST", "ket": "chay-tiep", "tu_luc": "2026-08-27T03:03:31Z", "y_nghia": "Có người lùi khung 30 mũi rồi cho chạy tiếp — đúng thao tác vá của sổ tay §2.4. Gần như chắc là đứt chỉ hoặc hết suốt; máy không nói rõ cái nào."}'
const LINE_MO = '{"at": "2026-08-27T03:05:14Z", "viec": "mo", "may": "C0D60A8F4D52", "nghi": "nghi-dut-chi", "ma_nghi": 0, "giay": 50, "lui": 30, "mui": 7976, "tong": 18918, "mau": "#FLW~.DST", "ket": "dang-dung", "tu_luc": "2026-08-27T03:04:24Z", "y_nghia": "Có người lùi khung 30 mũi rồi cho chạy tiếp."}'
const LINE_DONG_2 = '{"at": "2026-08-27T03:05:18Z", "viec": "dong", "may": "C0D60A8F4D52", "nghi": "nghi-dut-chi", "ma_nghi": 0, "giay": 54, "lui": 30, "mui": 7976, "tong": 18918, "mau": "#FLW~.DST", "ket": "chay-tiep", "tu_luc": "2026-08-27T03:04:24Z", "y_nghia": "Có người lùi khung 30 mũi rồi cho chạy tiếp."}'
const LINE_DUNG_NGAN = '{"at": "2026-09-09T01:15:12Z", "viec": "dong", "may": "6026029613C2", "nghi": "dung-ngan", "ma_nghi": 3, "giay": 5, "lui": 0, "mui": 45015, "tong": 46195, "mau": "4160915675_1_Front.DST", "ket": "chay-tiep", "tu_luc": "2026-09-09T01:15:07Z", "y_nghia": "Dừng 5 giây rồi chạy tiếp."}'

const SERIAL_MAP = { '602602A6F22B': 1, C0D60A8F4D52: 2 }

function fakeLogger() {
  const warnings = []
  const errors = []
  return { warnings, errors, info: () => {}, warn: (m) => warnings.push(m), error: (m) => errors.push(m) }
}

async function makeSetup(t, { resolve = (serial) => SERIAL_MAP[serial] ?? null, repair, sendBudget = 200 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'redthread-repair-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const filePath = join(directory, 'va-mau.out')
  const queueFile = join(directory, 'repair-queue.jsonl')
  const state = { repairCursor: 0, repairSerials: {} }
  const sentEvents = []
  const logger = fakeLogger()
  const saves = []
  const tailer = new RepairTailer({
    filePath,
    client: { repair: repair ?? (async (event) => sentEvents.push(event)) },
    queue: new EventQueue(queueFile),
    getState: () => state,
    saveState: async () => saves.push(state.repairCursor),
    resolveExternalId: resolve,
    logger,
    sendBudget,
  })
  return { directory, filePath, queueFile, state, sentEvents, logger, saves, tailer }
}

test('eventId ổn định và payload map đúng contract A2', () => {
  const line = JSON.parse(LINE_DONG)
  const first = repairPayload(line, 1)
  const second = repairPayload(JSON.parse(LINE_DONG), 1)
  assert.deepEqual(first, second)
  assert.equal(first.eventId, repairEventId('602602A6F22B', '2026-08-27T03:03:31Z'))
  assert.match(first.eventId, /^[0-9a-f]{64}$/)
  assert.deepEqual(first, {
    eventId: first.eventId,
    externalMachineId: 1,
    occurredAt: '2026-08-27T03:04:37Z',
    backSteps: 30,
    stopSeconds: 66,
    stitchAt: 520,
    totalStitches: 4804,
    fileName: '4152~.DST',
    reasonText: line.y_nghia,
  })
})

test('lọc đúng viec=dong && nghi=nghi-dut-chi trên dòng thật', async (t) => {
  const { filePath, sentEvents, tailer, state } = await makeSetup(t)
  await writeFile(filePath, [LINE_DONG, LINE_MO, LINE_DUNG_NGAN, LINE_DONG_2, ''].join('\n'))
  const result = await tailer.tick()
  assert.equal(result.sent, 2)
  assert.deepEqual(sentEvents.map((event) => event.externalMachineId), [1, 2])
  assert.equal(state.repairCursor, Buffer.byteLength([LINE_DONG, LINE_MO, LINE_DUNG_NGAN, LINE_DONG_2, ''].join('\n'), 'utf8'))
})

test('resume theo offset: tick sau chỉ đọc phần mới, restart không gởi lại', async (t) => {
  const setup = await makeSetup(t)
  await writeFile(setup.filePath, `${LINE_DONG}\n`)
  await setup.tailer.tick()
  assert.equal(setup.sentEvents.length, 1)

  await appendFile(setup.filePath, `${LINE_DONG_2}\n`)
  await setup.tailer.tick()
  assert.equal(setup.sentEvents.length, 2)
  assert.equal(setup.sentEvents[1].externalMachineId, 2)

  // "Restart": tailer mới dùng lại state đã lưu → không đọc lại gì.
  const restarted = new RepairTailer({
    filePath: setup.filePath,
    client: { repair: async () => assert.fail('không được gởi lại event cũ') },
    queue: new EventQueue(join(setup.directory, 'repair-queue-2.jsonl')),
    getState: () => setup.state,
    saveState: async () => {},
    resolveExternalId: () => null,
    logger: fakeLogger(),
  })
  assert.deepEqual(await restarted.tick(), { sent: 0 })
})

test('rotation: file nhỏ hơn cursor thì đọc lại từ đầu', async (t) => {
  const { filePath, sentEvents, tailer, state, logger } = await makeSetup(t)
  await writeFile(filePath, [LINE_DONG, LINE_DONG_2, ''].join('\n'))
  await tailer.tick()
  assert.equal(sentEvents.length, 2)

  await writeFile(filePath, `${LINE_DONG}\n`)
  await tailer.tick()
  assert.equal(sentEvents.length, 3)
  assert.equal(state.repairCursor, Buffer.byteLength(`${LINE_DONG}\n`, 'utf8'))
  assert.ok(logger.warnings.some((m) => m.includes('bị xoay')))
})

test('dòng JSON hỏng không giết tailer, dòng sau vẫn xử lý', async (t) => {
  const { filePath, sentEvents, tailer, logger } = await makeSetup(t)
  await writeFile(filePath, ['{"hong json', LINE_DONG, ''].join('\n'))
  const result = await tailer.tick()
  assert.equal(result.sent, 1)
  assert.equal(sentEvents[0].externalMachineId, 1)
  assert.ok(logger.warnings.some((m) => m.includes('Dòng vá hỏng')))
})

test('dòng cuối chưa có newline thì để lại cho tick sau', async (t) => {
  const { filePath, sentEvents, tailer, state } = await makeSetup(t)
  const partial = LINE_DONG_2.slice(0, 50)
  await writeFile(filePath, `${LINE_DONG}\n${partial}`)
  await tailer.tick()
  assert.equal(sentEvents.length, 1)
  assert.equal(state.repairCursor, Buffer.byteLength(`${LINE_DONG}\n`, 'utf8'))

  await appendFile(filePath, `${LINE_DONG_2.slice(50)}\n`)
  await tailer.tick()
  assert.equal(sentEvents.length, 2)
  assert.equal(sentEvents[1].externalMachineId, 2)
})

test('map serial qua fleet, cache lại cho lúc máy vắng, serial lạ bỏ qua', async (t) => {
  let fleetAvailable = true
  const { filePath, sentEvents, tailer, state, logger } = await makeSetup(t, {
    resolve: (serial) => (fleetAvailable ? SERIAL_MAP[serial] ?? null : null),
  })
  await writeFile(filePath, `${LINE_DONG}\n`)
  await tailer.tick()
  assert.equal(state.repairSerials['602602A6F22B'], 1)

  // Máy vắng khỏi fleet (mini mới khởi động) → vẫn map nhờ cache trong state.
  fleetAvailable = false
  await appendFile(filePath, `${LINE_DONG}\n`.replace('03:03:31Z', '04:03:31Z'))
  await tailer.tick()
  assert.equal(sentEvents.length, 2)

  // Serial chưa từng thấy → warn 1 lần rồi bỏ qua, không chặn dòng sau.
  const unknown = LINE_DONG_2.replaceAll('C0D60A8F4D52', 'FFFFFFFFFFFF')
  await appendFile(filePath, `${unknown}\n${LINE_DONG_2}\n`)
  fleetAvailable = true
  await tailer.tick()
  assert.equal(sentEvents.length, 3)
  assert.equal(sentEvents[2].externalMachineId, 2)
  assert.equal(logger.warnings.filter((m) => m.includes('FFFFFFFFFFFF')).length, 1)
})

test('HTTP lỗi mạng vào queue riêng, replay thành công xoá queue', async (t) => {
  let online = false
  const sent = []
  const { filePath, queueFile, tailer } = await makeSetup(t, {
    repair: async (event) => {
      if (!online) throw new Error('fetch failed')
      sent.push(event)
    },
  })
  await writeFile(filePath, `${LINE_DONG}\n`)
  await tailer.tick()
  const queued = (await readFile(queueFile, 'utf8')).trim().split('\n')
  assert.equal(queued.length, 1)
  assert.equal(JSON.parse(queued[0]).eventId, repairEventId('602602A6F22B', '2026-08-27T03:03:31Z'))

  online = true
  assert.deepEqual(await tailer.replayQueue(), { sent: 1, remaining: 0 })
  assert.equal(sent.length, 1)
  assert.equal((await readFile(queueFile, 'utf8')).trim(), '')
})

test('4xx vĩnh viễn bị bỏ, không làm kẹt queue', async (t) => {
  const accepted = []
  const { filePath, queueFile, tailer, logger } = await makeSetup(t, {
    repair: async (event) => {
      if (event.externalMachineId === 1) throw new HttpError('RedThread trả HTTP 409', 409)
      accepted.push(event)
    },
  })
  await writeFile(filePath, [LINE_DONG, LINE_DONG_2, ''].join('\n'))
  await tailer.tick()
  // Event 409 bị bỏ hẳn (không queue), event sau vẫn gởi bình thường.
  assert.equal(accepted.length, 1)
  assert.equal(await readFile(queueFile, 'utf8').catch(() => ''), '')
  assert.ok(logger.errors.some((m) => m.includes('409')))

  // Trong queue replay: 4xx được tiêu thụ thay vì chặn hàng đợi.
  const queue = new EventQueue(queueFile)
  await queue.append({ eventId: 'bad', externalMachineId: 1 })
  await queue.append({ eventId: 'good', externalMachineId: 2 })
  assert.deepEqual(await tailer.replayQueue(), { sent: 2, remaining: 0 })
  assert.equal(accepted.length, 2)
})

test('sendBudget chia backfill thành nhiều tick, cursor dừng đúng chỗ', async (t) => {
  const { filePath, sentEvents, tailer } = await makeSetup(t, { sendBudget: 2 })
  const lines = [LINE_DONG, LINE_DUNG_NGAN, LINE_DONG_2, LINE_DONG.replace('03:03:31Z', '05:03:31Z'), LINE_DONG_2.replace('03:04:24Z', '05:04:24Z')]
  await writeFile(filePath, `${lines.join('\n')}\n`)

  assert.deepEqual(await tailer.tick(), { sent: 2 })
  assert.equal(sentEvents.length, 2)
  assert.deepEqual(await tailer.tick(), { sent: 2 })
  assert.deepEqual(await tailer.tick(), { sent: 0 })
  assert.equal(sentEvents.length, 4)
  assert.equal(new Set(sentEvents.map((event) => event.eventId)).size, 4)
})

test('file chưa tồn tại: warn một lần, không crash', async (t) => {
  const { tailer, logger } = await makeSetup(t)
  assert.deepEqual(await tailer.tick(), { sent: 0 })
  assert.deepEqual(await tailer.tick(), { sent: 0 })
  assert.equal(logger.warnings.filter((m) => m.includes('Không thấy file vá')).length, 1)
})
