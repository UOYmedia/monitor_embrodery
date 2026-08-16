/**
 * CSV cho Excel bản tiếng Việt trên Windows.
 *
 * Dùng chung cho mọi bản xuất trong dashboard. Tách ra thành module riêng vì hai chỗ xuất
 * file mà mỗi chỗ tự viết lại cách thoát ký tự thì sớm muộn cũng lệch nhau — và chỗ lệch
 * nguy hiểm nhất là cái chống chèn công thức bên dưới.
 */

/** Dấu phân cách. Excel bản tiếng Việt tách cột bằng dấu chấm phẩy, không phải dấu phẩy. */
export const csvSeparator = ';'

/**
 * Thoát một ô CSV.
 *
 * Hai việc: tên máy có dấu phẩy không được làm lệch mọi cột phía sau, và một ô bắt đầu bằng
 * `=`, `+`, `-` hay `@` không được biến thành công thức khi Excel mở file. Ô thứ hai là lỗ
 * hổng thật: nội dung do người dùng nhập (ghi chú, tên mẫu) đi thẳng vào file, và Excel sẽ
 * chạy nó.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n;]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

export function csvRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(csvCell).join(csvSeparator)
}

/**
 * Ghép các dòng thành nội dung file: BOM UTF-8 và xuống dòng CRLF.
 *
 * Thiếu BOM thì Excel đọc "Máy thêu" thành ký tự lỗi; thiếu CRLF thì một số bản Excel dồn
 * cả bảng vào một dòng.
 */
export function csvDocument(lines: string[]): string {
  return `﻿${lines.join('\r\n')}\r\n`
}
