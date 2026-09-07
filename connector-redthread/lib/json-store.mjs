import { mkdir, readFile, rename, writeFile, appendFile } from 'node:fs/promises'
import { dirname } from 'node:path'

async function ensureParent(filePath) {
  await mkdir(dirname(filePath), { recursive: true })
}

export async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

export async function writeJsonAtomic(filePath, value) {
  await ensureParent(filePath)
  const temporary = `${filePath}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, filePath)
}

export class EventQueue {
  #chain = Promise.resolve()

  constructor(filePath) {
    this.filePath = filePath
  }

  #serialized(operation) {
    const result = this.#chain.then(operation, operation)
    this.#chain = result.catch(() => {})
    return result
  }

  append(event) {
    return this.#serialized(async () => {
      await ensureParent(this.filePath)
      await appendFile(this.filePath, `${JSON.stringify(event)}\n`, { mode: 0o600 })
    })
  }

  readAll() {
    return this.#serialized(() => this.#readAllUnlocked())
  }

  async #readAllUnlocked() {
    try {
      const text = await readFile(this.filePath, 'utf8')
      return text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
  }

  replay(send) {
    return this.#serialized(async () => {
      const pending = await this.#readAllUnlocked()
      let sent = 0
      for (; sent < pending.length; sent += 1) {
        try {
          await send(pending[sent])
        } catch {
          break
        }
      }
      if (sent > 0) {
        await ensureParent(this.filePath)
        const remaining = pending.slice(sent)
        const temporary = `${this.filePath}.${process.pid}.tmp`
        await writeFile(temporary, remaining.map((event) => JSON.stringify(event)).join('\n') + (remaining.length ? '\n' : ''), { mode: 0o600 })
        await rename(temporary, this.filePath)
      }
      return { sent, remaining: pending.length - sent }
    })
  }
}
