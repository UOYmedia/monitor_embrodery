import { copyFile, mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Durable JSON write shared by every store in the bridge.
 *
 * temp file -> fsync -> rename, with the previous good document kept as `.bak`. A power
 * cut in a workshop is not a rare event, and a half-written payroll or machine registry is
 * worse than a slightly stale one.
 */
export async function writeJsonAtomic(filePath, document, { backup = true } = {}) {
  const serialized = `${JSON.stringify(document, null, 2)}\n`
  await mkdir(dirname(filePath), { recursive: true })
  if (backup) {
    await copyFile(filePath, `${filePath}.bak`).catch((error) => { if (error?.code !== 'ENOENT') throw error })
  }
  const temporaryPath = `${filePath}.tmp`
  const handle = await open(temporaryPath, 'w')
  try {
    await handle.writeFile(serialized, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporaryPath, filePath)
  return document
}

/** Reads a JSON document, distinguishing "not there yet" from "there but unreadable". */
export async function readJsonFile(path) {
  try {
    return { ok: true, value: JSON.parse(await readFile(path, 'utf8')) }
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, missing: true }
    return { ok: false, error }
  }
}
