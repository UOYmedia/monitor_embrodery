#!/usr/bin/env node
/**
 * Brings the whole printer test rig up with one command: probe + bridge, one Ctrl-C to stop.
 *
 * Two processes in two terminals is enough friction that the rig stops getting used, and a
 * probe left running after the bridge is gone is worse than nothing — it looks alive. So they
 * live and die together here.
 *
 * The printer address is NOT hard-coded: it comes from the `_printer` block of the bridge
 * config, which is a local, gitignored file. Someone else's printer is someone else's config.
 *
 *   npm run may-in                                  # dùng ./bridge.config.may-in.json
 *   BRIDGE_CONFIG=./khac.json npm run may-in
 *
 * Xem docs/test-may-in.md.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const configPath = process.env.BRIDGE_CONFIG ?? './bridge.config.may-in.json'
const here = (name) => fileURLToPath(new URL(name, import.meta.url))

let config
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'))
} catch (error) {
  console.error(`Không đọc được ${configPath}: ${error.message}`)
  console.error('Tạo file cấu hình theo mục 4 của docs/test-may-in.md.')
  process.exit(1)
}

const printer = config._printer ?? {}
if (!/^ipps?:\/\/[^/]+\/.+/.test(printer.uri ?? '')) {
  console.error(`Thiếu khối "_printer" trong ${configPath}. Thêm vào:`)
  console.error(JSON.stringify({ _printer: { uri: 'ipp://10.0.0.5:631/printers/Ten_Hang_Doi', bind: '10.0.0.9', port: 9110 } }, null, 2))
  console.error('Tìm hàng đợi:  curl -s http://<ip>:631/printers/ | grep -o "printers/[A-Za-z0-9_-]*"')
  process.exit(1)
}

const children = []
let stopping = false

function start(name, args, env) {
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, ...env } })
  children.push({ name, child })
  // One dying means the rig is half up, which is the state that produces confusing readings.
  // Tear the other one down instead of leaving it to answer for a machine nobody is polling.
  child.on('exit', (code, signal) => {
    if (stopping) return
    console.error(`\n[may-in] ${name} đã thoát (${signal ?? `mã ${code}`}). Dừng cả bộ.`)
    stop(code ?? 1)
  })
  return child
}

function stop(code) {
  if (stopping) return
  stopping = true
  for (const { child } of children) if (child.exitCode === null) child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 300).unref()
}

start('probe', [
  here('printer-probe.mjs'),
  `--printer=${printer.uri}`,
  `--bind=${printer.bind ?? '127.0.0.1'}`,
  `--port=${printer.port ?? 9110}`,
  ...(printer.timeoutMs ? [`--timeout=${printer.timeoutMs}`] : []),
])
start('bridge', [here('../bridge/index.mjs')], { BRIDGE_CONFIG: configPath })

console.log(`[may-in] Bảng điều khiển: http://${config.host ?? '127.0.0.1'}:${config.port ?? 8790}/`)
console.log('[may-in] Ctrl-C để tắt cả probe lẫn bridge.')

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0))
