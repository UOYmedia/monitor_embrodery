#!/usr/bin/env node
/**
 * Đọc file bắt gói dial-in và **mô tả** nó. Không giải mã, không đoán giao thức.
 *
 * Khi controller Dahao gọi vào bridge mà khung không phải JSON kết thúc bằng `\n`, bridge ghi
 * nguyên hex ra `capturePath`. Công cụ này biến file đó thành thứ người đọc được: hex dump kèm
 * ASCII, phân bố độ dài khung, tiền tố/hậu tố lặp lại giữa các khung.
 *
 * Nó cố ý dừng ở mức mô tả. Mọi câu kiểu "đây là Modbus" hay "byte 5 là số mũi" phải do người
 * đối chiếu với máy thật mà kết luận — PRD cấm bịa giao thức, và một suy đoán sai ở tầng này sẽ
 * biến thành con số sai trên bảng lương khoán.
 *
 *   node scripts/xem-capture.mjs [đường-dẫn] [--limit N] [--full]
 */

import { readFile } from 'node:fs/promises'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const path = args.find((arg) => !arg.startsWith('-')) ?? './bridge-data/dial-in-capture.jsonl'
const limitArg = args.indexOf('--limit')
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 12
const showAll = flag('--full')

let raw
try {
  raw = await readFile(path, 'utf8')
} catch (error) {
  console.error(`Không đọc được ${path}: ${error.message}`)
  console.error('Chưa có khung nào bị bắt, hoặc ingest.capture đang tắt trong bridge.config.')
  process.exit(1)
}

const frames = []
for (const [index, line] of raw.split('\n').entries()) {
  if (!line.trim()) continue
  try {
    const entry = JSON.parse(line)
    frames.push({ ...entry, buffer: Buffer.from(entry.hex ?? '', 'hex') })
  } catch {
    console.error(`Bỏ qua dòng ${index + 1}: không phải JSON.`)
  }
}

if (frames.length === 0) {
  console.error(`${path} rỗng. Máy chưa gọi vào, hoặc mọi khung đều là JSON hợp lệ nên không bị bắt.`)
  process.exit(1)
}

// ------------------------------------------------------------------ tổng quan

const lengths = frames.map((frame) => frame.buffer.length)
const reasons = {}
for (const frame of frames) reasons[frame.reason] = (reasons[frame.reason] ?? 0) + 1

console.log(`\n=== ${path} ===`)
console.log(`Khung        : ${frames.length}`)
console.log(`Thời gian    : ${frames[0].at} → ${frames.at(-1).at}`)
console.log(`Máy          : ${[...new Set(frames.map((f) => f.machineId))].join(', ')}`)
console.log(`Nguồn (IP)   : ${[...new Set(frames.map((f) => f.remote))].join(', ')}`)
console.log(`Lý do        : ${Object.entries(reasons).map(([key, count]) => `${key}×${count}`).join(', ')}`)
console.log(`Độ dài (byte): nhỏ nhất ${Math.min(...lengths)}, lớn nhất ${Math.max(...lengths)}, ${new Set(lengths).size} giá trị khác nhau`)

// ------------------------------------------------------------------ mẫu lặp

/** Số byte đầu giống nhau trên MỌI khung — dấu hiệu của một header cố định. */
function commonPrefix(buffers) {
  const shortest = Math.min(...buffers.map((buffer) => buffer.length))
  let length = 0
  while (length < shortest && buffers.every((buffer) => buffer[length] === buffers[0][length])) length += 1
  return buffers[0].subarray(0, length)
}

function commonSuffix(buffers) {
  const shortest = Math.min(...buffers.map((buffer) => buffer.length))
  let length = 0
  while (length < shortest
    && buffers.every((buffer) => buffer[buffer.length - 1 - length] === buffers[0][buffers[0].length - 1 - length])) length += 1
  return buffers[0].subarray(buffers[0].length - length)
}

const buffers = frames.map((frame) => frame.buffer)
const prefix = commonPrefix(buffers)
const suffix = commonSuffix(buffers)
const printable = buffers.reduce((sum, buffer) => sum + buffer.filter((byte) => byte >= 0x20 && byte < 0x7f).length, 0)
const totalBytes = lengths.reduce((sum, value) => sum + value, 0)
const printableRatio = totalBytes === 0 ? 0 : printable / totalBytes

console.log('\n--- mẫu lặp giữa các khung ---')
console.log(`Tiền tố chung: ${prefix.length} byte${prefix.length ? ` = ${prefix.toString('hex')}` : ''}`)
console.log(`Hậu tố chung : ${suffix.length} byte${suffix.length ? ` = ${suffix.toString('hex')}` : ''}`)
console.log(`Tỷ lệ ký tự in được: ${(printableRatio * 100).toFixed(1)}%`)

console.log('\n--- điều quan sát được (KHÔNG phải kết luận về giao thức) ---')
const notes = []
if (printableRatio > 0.85) notes.push('Phần lớn là ký tự in được → khả năng là giao thức dạng chữ. Xem cột ASCII bên phải hex dump.')
if (printableRatio < 0.4) notes.push('Phần lớn là byte nhị phân → cần đối chiếu với tài liệu firmware hoặc thay đổi có kiểm soát trên máy.')
if (new Set(lengths).size === 1) notes.push(`Mọi khung dài đúng ${lengths[0]} byte → khung cố định, các trường nhiều khả năng ở vị trí cố định.`)
if (prefix.length >= 2) notes.push(`${prefix.length} byte đầu giống nhau ở mọi khung → nhiều khả năng là header/magic, không phải dữ liệu.`)
if (suffix.length >= 1) notes.push(`${suffix.length} byte cuối giống nhau ở mọi khung → có thể là ký tự kết thúc khung hoặc checksum cố định.`)
if (buffers.some((buffer) => buffer.includes(0x0d))) notes.push('Có byte 0x0d (CR) → khung có thể kết thúc bằng CRLF chứ không phải LF; bridge chỉ tách theo LF.')
if (notes.length === 0) notes.push('Chưa thấy quy luật nào rõ ràng. Cần thêm khung, hoặc thay đổi một thứ trên máy (đổi mẫu, dừng máy) rồi so hai lần bắt.')
for (const note of notes) console.log(`  • ${note}`)

// ------------------------------------------------------------------ hex dump

/** Hex dump 16 byte/dòng, cột ASCII bên phải — dạng ai cũng đọc được, không cần công cụ khác. */
function hexDump(buffer, indent = '    ') {
  const lines = []
  for (let offset = 0; offset < buffer.length; offset += 16) {
    const slice = buffer.subarray(offset, offset + 16)
    const hex = [...slice].map((byte) => byte.toString(16).padStart(2, '0')).join(' ').padEnd(47)
    const ascii = [...slice].map((byte) => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.')).join('')
    lines.push(`${indent}${offset.toString(16).padStart(4, '0')}  ${hex}  |${ascii}|`)
  }
  return lines.join('\n')
}

const shown = showAll ? frames : frames.slice(0, limit)
console.log(`\n--- ${shown.length}/${frames.length} khung đầu tiên${showAll ? '' : ' (thêm --full để xem hết)'} ---`)
for (const [index, frame] of shown.entries()) {
  console.log(`\n[${index + 1}] ${frame.at}  ${frame.buffer.length} byte  lý do=${frame.reason}`)
  console.log(hexDump(frame.buffer))
}

console.log('\nBước tiếp theo: thay đổi ĐÚNG MỘT thứ trên máy (dừng máy, đổi mẫu, để chạy thêm 1000 mũi),')
console.log('bắt lại, rồi so hai file. Byte nào đổi theo chính là trường đó. Đây là cách duy nhất')
console.log('chắc chắn khi không có tài liệu giao thức — và cũng là cách duy nhất PRD cho phép.\n')
