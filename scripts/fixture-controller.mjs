#!/usr/bin/env node
/**
 * Local development stand-in for a controller endpoint.
 *
 * This is NOT a Dahao simulator and it does not implement any Dahao protocol. It only
 * serves a fixture file over HTTP so the bridge's http-json adapter, the freshness
 * transitions and the malformed-payload path can be exercised without a real machine.
 *
 * It binds 127.0.0.1 only. Pairing a machine against it requires scan.allowLoopback,
 * which the bridge warns about at startup — deliberately, so this never ends up in a
 * workshop pretending to be a machine.
 *
 *   node scripts/fixture-controller.mjs <port> <fixture.json> [--freeze] [--silent-after=<s>]
 *
 *   --freeze              keep observedAt exactly as written in the fixture, so the
 *                         dashboard ages it into stale then offline
 *   --silent-after=<s>    stop answering after N seconds, to exercise offline detection
 *   --spm=<n>             advance the fixture's odometer by n stitches per minute, so the
 *                         production ledger has deltas to add up. Still a fixture, not a
 *                         machine: the number is whatever you pass on the command line.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const [, , portArg, fixtureArg, ...flags] = process.argv
const port = Number(portArg)
if (!Number.isInteger(port) || port <= 0 || !fixtureArg) {
  console.error('Dùng: node scripts/fixture-controller.mjs <port> <fixture.json> [--freeze] [--silent-after=<giây>]')
  process.exit(1)
}

const freeze = flags.includes('--freeze')
const silentAfter = Number(flags.find((flag) => flag.startsWith('--silent-after='))?.split('=')[1] ?? 0)
const stitchesPerMinute = Number(flags.find((flag) => flag.startsWith('--spm='))?.split('=')[1] ?? 0)
const fixture = JSON.parse(readFileSync(fixtureArg, 'utf8'))
const startedAt = Date.now()

const server = createServer((request, response) => {
  if (silentAfter > 0 && (Date.now() - startedAt) / 1000 > silentAfter) {
    request.destroy()
    return
  }
  const elapsedMinutes = (Date.now() - startedAt) / 60_000
  const moved = stitchesPerMinute > 0 && typeof fixture.odometer === 'number'
    ? { odometer: fixture.odometer + Math.floor(elapsedMinutes * stitchesPerMinute) }
    : {}
  const body = JSON.stringify(freeze ? fixture : { ...fixture, ...moved, observedAt: new Date().toISOString() })
  response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  response.end(body)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[fixture] Đang phục vụ ${fixtureArg} tại http://127.0.0.1:${port}/ (chỉ loopback, chỉ để phát triển).`)
  if (freeze) console.log('[fixture] --freeze: observedAt giữ nguyên, dữ liệu sẽ già đi thành stale rồi offline.')
  if (silentAfter > 0) console.log(`[fixture] --silent-after=${silentAfter}: sẽ ngừng trả lời sau ${silentAfter}s.`)
  if (stitchesPerMinute > 0) console.log(`[fixture] --spm=${stitchesPerMinute}: bộ đếm mũi tăng ${stitchesPerMinute} mũi/phút.`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { server.close(); process.exit(0) })
}
