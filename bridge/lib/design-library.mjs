import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DstError, parseDst, renderDstSvg } from './dst.mjs'

/**
 * Thư viện mẫu của xưởng: một thư mục `.DST` trên máy chạy bridge, dùng để dựng ảnh mẫu.
 *
 * **Ảnh này không phải ảnh đọc từ controller.** Controller chỉ gửi lên cái tên file. Bridge lấy
 * đúng cái tên đó tìm trong thư viện của xưởng rồi vẽ lại. Vì thế mọi chỗ hiển thị đều phải nói
 * rõ nguồn là "thư viện mẫu, khớp theo tên file" — nếu người xem tưởng đây là ảnh chụp từ máy,
 * họ sẽ tin nó ngay cả khi máy đã đổi mẫu mà telemetry chưa kịp cập nhật.
 *
 * ## Cái tên bị cắt cụt, và vì sao không được đoán bừa
 *
 * Controller báo tên dạng 8.3 của DOS: `80_4127~.DST`. Dấu `~` nghĩa là "tên thật còn dài nữa",
 * nên `80_4127~` có thể là `80_4127_LogoAnhChi.DST` mà cũng có thể là `80_4127_LogoAnhHai.DST`.
 * Hai mẫu khác nhau, cùng một tên rút gọn. Đoán đại một cái là hiện **ảnh mẫu sai** ngay cạnh
 * tên máy — tệ hơn hẳn không có ảnh, vì người đứng máy không có cách nào biết là nó sai.
 *
 * Nên luật là: khớp đúng nguyên tên thì lấy; khớp tiền tố mà **duy nhất một** file thì lấy; từ
 * hai file trở lên thì trả `ambiguous` và giao diện ghi "nhiều mẫu trùng tên rút gọn".
 *
 * ## Ranh giới an toàn
 *
 * Yêu cầu từ trình duyệt chỉ đưa **tên**, không bao giờ đưa đường dẫn: bridge tra tên trong chỉ
 * mục đã dựng sẵn và chỉ đọc file nằm trong chỉ mục đó. Không ghép chuỗi thành đường dẫn thì
 * không có `../` nào leo ra ngoài được. Kèm chặn số lượng file và cỡ file.
 */

const dstName = /\.dst$/i
/** Tên hợp lệ theo controller: chữ, số, `_-.~ ()`. Ký tự khác là không tra, không phải là lọc. */
const safeName = /^[\p{L}\p{N}_\-.~ ()]{1,120}$/u

function normalizeKey(name) {
  return name.trim().toLowerCase()
}

/** `80_4127~.DST` → `80_4127`. Không có `~` thì trả null: đó là tên đủ, không phải tiền tố. */
function truncatedPrefix(name) {
  const base = name.replace(dstName, '')
  const tilde = base.indexOf('~')
  if (tilde <= 0) return null
  return base.slice(0, tilde).toLowerCase()
}

export function createDesignLibrary({ path, maxFiles = 5_000, maxFileBytes = 8_388_608, cacheEntries = 64, now = Date.now } = {}) {
  /** Chỉ mục: khoá là tên file viết thường → { path, size, mtimeMs }. */
  let index = new Map()
  let indexedAt = 0
  let indexError = null
  /** Cache SVG đã dựng, khoá gồm cả mtime+size nên sửa file là ảnh tự mới. */
  const cache = new Map()

  const enabled = Boolean(path)

  async function refreshIndex({ maxAgeMs = 30_000 } = {}) {
    if (!enabled) return
    if (now() - indexedAt < maxAgeMs && indexError === null) return
    try {
      const entries = await readdir(path, { withFileTypes: true })
      const next = new Map()
      for (const entry of entries) {
        if (next.size >= maxFiles) break
        if (!entry.isFile() || !dstName.test(entry.name)) continue
        const full = join(path, entry.name)
        const info = await stat(full).catch(() => null)
        if (info === null || info.size > maxFileBytes) continue
        next.set(normalizeKey(entry.name), { name: entry.name, path: full, size: info.size, mtimeMs: info.mtimeMs })
      }
      index = next
      indexError = null
    } catch (error) {
      index = new Map()
      indexError = error.code === 'ENOENT'
        ? `Không thấy thư mục thư viện mẫu: ${path}`
        : `Không đọc được thư viện mẫu: ${error.code ?? error.message}`
    }
    indexedAt = now()
  }

  /**
   * Trả về `{ status, entry?, candidates? }`. `status` là một trong:
   * `disabled` | `unreadable` | `found` | `missing` | `ambiguous` | `invalid-name`.
   */
  function resolve(rawName) {
    if (!enabled) return { status: 'disabled' }
    if (indexError) return { status: 'unreadable', reason: indexError }
    const name = String(rawName ?? '').trim()
    if (!safeName.test(name)) return { status: 'invalid-name' }

    const exact = index.get(normalizeKey(name))
    if (exact) return { status: 'found', entry: exact }

    const prefix = truncatedPrefix(name)
    if (prefix === null) return { status: 'missing' }
    const candidates = [...index.values()].filter((entry) => entry.name.toLowerCase().startsWith(prefix))
    if (candidates.length === 1) return { status: 'found', entry: candidates[0], viaPrefix: true }
    if (candidates.length > 1) return { status: 'ambiguous', candidates: candidates.map((entry) => entry.name).slice(0, 8) }
    return { status: 'missing' }
  }

  /** Dựng (hoặc lấy lại từ cache) SVG cho một mục trong chỉ mục. */
  async function renderEntry(entry, title) {
    const key = `${entry.path}:${entry.mtimeMs}:${entry.size}`
    const hit = cache.get(key)
    if (hit) return hit

    const buffer = await readFile(entry.path)
    if (buffer.length > maxFileBytes) throw new DstError('File vượt giới hạn cỡ của thư viện mẫu.')
    const design = parseDst(buffer)
    const svg = renderDstSvg(design, { title: title ?? entry.name })
    const value = {
      svg,
      meta: {
        file: entry.name,
        stitches: design.stitches,
        colorBlocks: design.colorBlocks,
        widthMm: Math.round(design.bounds.width / 10),
        heightMm: Math.round(design.bounds.height / 10),
        truncated: !design.ended,
      },
    }
    // Cache nhỏ và cũ nhất ra trước: một xưởng chỉ chạy vài chục mẫu cùng lúc, giữ cả 800 mẫu
    // trong RAM là phí bộ nhớ của con máy mini đang chạy bridge.
    if (cache.size >= cacheEntries) cache.delete(cache.keys().next().value)
    cache.set(key, value)
    return value
  }

  /** Đường vào duy nhất cho HTTP: tên vào, SVG hoặc lý do không có ảnh đi ra. */
  async function thumbnail(rawName) {
    await refreshIndex()
    const found = resolve(rawName)
    if (found.status !== 'found') return found
    try {
      const { svg, meta } = await renderEntry(found.entry, rawName)
      return { status: 'found', svg, meta, viaPrefix: found.viaPrefix === true }
    } catch (error) {
      if (error instanceof DstError) return { status: 'unreadable', reason: error.message }
      return { status: 'unreadable', reason: `Không đọc được file mẫu: ${error.code ?? error.message}` }
    }
  }

  return {
    enabled,
    path: path ?? null,
    thumbnail,
    resolve,
    refreshIndex,
    status() {
      return { enabled, path: path ?? null, files: index.size, error: indexError, indexedAt: indexedAt || null }
    },
  }
}
