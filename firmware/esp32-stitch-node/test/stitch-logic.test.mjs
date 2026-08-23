/**
 * Runs the firmware's host test as part of `npm test`, so the sensor node's decision layer is
 * covered by the same gate as the bridge. It compiles stitch_logic.h with the system C compiler
 * and asserts the test binary exits clean; the ESP32 toolchain is not involved.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = fileURLToPath(new URL('./stitch_logic_test.c', import.meta.url))

const hasCompiler = (() => {
  try {
    execFileSync('cc', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe('firmware node cảm biến: stitch_logic.h', () => {
  // Skipped rather than failed on a machine without a C compiler: the bridge test suite must
  // still be runnable there. CI and the workshop laptop both have one.
  it.skipIf(!hasCompiler)('biên dịch sạch và mọi kiểm tra logic đều đạt', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'stitch-logic-'))
    const binary = join(workDir, 'stitch_logic_test')
    try {
      execFileSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-o', binary, source], { stdio: 'pipe' })
      const output = execFileSync(binary, { encoding: 'utf8' })
      expect(output).toContain('tat ca kiem tra dat')
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  })
})
