import { copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Durable JSON write shared by every store in the bridge.
 *
 * temp file -> fsync -> rename, with the previous good document kept as `.bak`. A power
 * cut in a workshop is not a rare event, and a half-written payroll or machine registry is
 * worse than a slightly stale one.
 */
/**
 * Hàng đợi theo từng đường dẫn.
 *
 * File tạm mang tên cố định `${filePath}.tmp` — cố ý, vì đó là thứ duy nhất cho phép lần ghi
 * sau dọn được rác của lần mất điện trước. Nhưng tên cố định nghĩa là hai lần ghi song song
 * (bridge có nhiều store + timer tự lưu) dùng chung một file tạm: một lần reject ENOENT ở bước
 * rename và mất hẳn nội dung, hoặc tệ hơn là trộn nội dung rồi rename vào chỗ thật.
 * Xếp hàng giữ được cả hai tính chất.
 */
const hangDoi = new Map()

export function writeJsonAtomic(filePath, document, options = {}) {
  const truoc = hangDoi.get(filePath) ?? Promise.resolve()
  const luot = truoc.then(() => ghiMotLuot(filePath, document, options), () => ghiMotLuot(filePath, document, options))
  hangDoi.set(filePath, luot.catch(() => {}))
  return luot
}

async function ghiMotLuot(filePath, document, { backup = true } = {}) {
  // `JSON.stringify(undefined)` trả về undefined, và template literal biến nó thành chữ
  // "undefined" — ghi ra rồi rename đè lên sổ tốt. Store nào lỡ truyền undefined sẽ tự huỷ
  // dữ liệu mà không ném lỗi nào. Chặn trước khi chạm vào đĩa.
  const body = JSON.stringify(document, null, 2)
  if (body === undefined) throw new TypeError('writeJsonAtomic: document không tuần tự hoá được (undefined).')
  const serialized = `${body}\n`
  await mkdir(dirname(filePath), { recursive: true })
  if (backup) {
    // CHỈ sao lưu bản đọc được. Kịch bản thật của bản cũ: file chính hỏng ⇒ store ghi log
    // "bản cũ vẫn còn ở .bak" rồi đặt dirty ⇒ lần lưu kế tiếp chép chính file hỏng đè lên
    // .bak, xoá mất bản sao lưu tốt duy nhất. Backup chỉ giữ một đời, nên chép mù là mất hẳn.
    const hienTai = await readJsonFile(filePath)
    if (hienTai.ok) {
      await copyFile(filePath, `${filePath}.bak`).catch((error) => { if (error?.code !== 'ENOENT') throw error })
    }
  }
  const temporaryPath = `${filePath}.tmp`
  try {
    const handle = await open(temporaryPath, 'w')
    try {
      await handle.writeFile(serialized, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporaryPath, filePath)
    // fsync THƯ MỤC CHA, không chỉ nội dung file tạm. Trên nhiều hệ file, bản thân `rename`
    // chưa bền: mất điện ngay sau đó có thể để lại mục thư mục cũ hoặc một file 0 byte. Docblock
    // của module này hứa "chịu được mất điện", nên phải giữ trọn lời hứa đó.
    const thuMuc = await open(dirname(filePath), 'r')
    try { await thuMuc.sync() } catch { /* vài hệ file không cho fsync thư mục — bỏ qua */ }
    finally { await thuMuc.close() }
  } catch (error) {
    // rename hỏng (khác volume, thiếu quyền) thì không được để rác nằm lại — đúng thứ hợp
    // đồng của module này hứa là không có.
    await unlink(temporaryPath).catch(() => {})
    throw error
  }
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
