#!/usr/bin/env node
/**
 * Syntax-checks every bridge module.
 *
 * Discovered from disk rather than listed by hand: a hard-coded list silently stops
 * covering new modules, which is how a broken file reaches a workshop.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../bridge', import.meta.url))

function collect(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...collect(full))
    else if (entry.endsWith('.mjs')) found.push(full)
  }
  return found
}

const files = collect(root).sort()
if (files.length === 0) {
  console.error('Không tìm thấy module bridge nào để kiểm tra.')
  process.exit(1)
}

let failed = 0
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (error) {
    failed += 1
    console.error(`✗ ${relative(process.cwd(), file)}`)
    console.error(String(error.stderr ?? error.message).trim())
  }
}

console.log(`Đã kiểm tra cú pháp ${files.length} module bridge, lỗi: ${failed}.`)
process.exit(failed === 0 ? 0 : 1)
