import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Dựng một bridge THẬT trên cổng trống, cho test tích hợp.
 *
 * Vì sao cần: `bridge/index.mjs` không export gì và `import` nó sẽ đọc config rồi `listen`.
 * Cách duy nhất kiểm được bề mặt thật là chạy nó như một tiến trình, đúng như lúc ở xưởng.
 *
 * Dùng `auth.mode = 'token'`: `single-admin` coi mọi người gọi là admin nên không phân biệt
 * được 401 với 403 — tức là không kiểm được thứ đáng kiểm nhất.
 */

const repo = fileURLToPath(new URL('../..', import.meta.url))

/** >=16 ký tự: `bridge/lib/config.mjs` từ chối token ngắn hơn, ngay lúc khởi động. */
export const TOKENS = {
  viewer: 'tok-viewer-chi-de-test-0001',
  tech: 'tok-ky-thuat-chi-de-test-0002',
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

export async function startBridge(overrides = {}) {
  const port = await freePort()
  const dir = mkdtempSync(join(tmpdir(), 'bridge-live-'))
  mkdirSync(join(dir, 'data'))

  const config = {
    host: '127.0.0.1',
    port,
    logLevel: 'error',
    sites: [{ id: 'test-1', name: 'Xưởng test', timeZone: 'Asia/Ho_Chi_Minh', allowedCidrs: ['127.0.0.0/8'], freshSeconds: 30, staleSeconds: 90 }],
    poll: { intervalMs: 600000, concurrency: 2, timeoutMs: 500 },
    scan: { allowLoopback: true, allowPublicRanges: false, maxHosts: 8, timeoutMs: 200 },
    ingest: { enabled: false },
    // Ngưỡng cố ý THẤP để kiểm 429 mà không phải bắn hàng trăm phát.
    limits: { maxMachines: 10, maxBatchPairing: 5, maxBodyBytes: 65536, scanPerMinute: 2, mutationPerMinute: 30 },
    auth: {
      mode: 'token',
      tokens: [
        { id: 't-viewer', actor: 'nguoi-xem', role: 'viewer', tokenEnv: 'BRIDGE_TOKEN_VIEWER' },
        { id: 't-tech', actor: 'ky-thuat', role: 'technician', tokenEnv: 'BRIDGE_TOKEN_TECH' },
      ],
    },
    allowedOrigins: [`http://127.0.0.1:${port}`],
    dataPath: join(dir, 'data', 'fleet-store.json'),
    auditPath: join(dir, 'data', 'audit.jsonl'),
    productionPath: join(dir, 'data', 'production.json'),
    ...overrides,
  }
  const configPath = join(dir, 'bridge.config.json')
  writeFileSync(configPath, JSON.stringify(config))

  let log = ''
  const child = spawn(process.execPath, [join(repo, 'bridge', 'index.mjs')], {
    cwd: dir,
    env: { ...process.env, BRIDGE_CONFIG: configPath, BRIDGE_TOKEN_VIEWER: TOKENS.viewer, BRIDGE_TOKEN_TECH: TOKENS.tech },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (d) => { log += d })
  child.stderr.on('data', (d) => { log += d })

  const baseUrl = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) {
        return { baseUrl, port, dir, stop: () => child.kill('SIGTERM'), log: () => log }
      }
    } catch { /* chưa lắng nghe */ }
    await new Promise((r) => setTimeout(r, 50))
  }
  child.kill('SIGTERM')
  throw new Error(`Bridge không lên sau 5s. Log:\n${log}`)
}
