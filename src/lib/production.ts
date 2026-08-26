import { csvCell as cell, csvDocument, csvSeparator } from './csv'
import type { ProductionReport, ProductionRow } from '../types/fleet'

/**
 * Presentation and export helpers for the shift production report.
 *
 * The bridge already did the arithmetic that decides money; this module only groups, formats
 * and writes it out. Nothing here recomputes an amount, so what a person sees on screen and
 * what lands in the payroll file cannot drift apart.
 */

const moneyFormat = new Intl.NumberFormat('vi-VN')

/** VND, whole đồng. Blank rate stays blank — an unset rate is not a zero rate. */
export function formatVnd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return 'Chưa đặt đơn giá'
  return `${moneyFormat.format(Math.round(amount))} đ`
}

export function formatHours(seconds: number): string {
  const hours = Math.floor(Math.max(0, seconds) / 3600)
  const minutes = Math.round((Math.max(0, seconds) % 3600) / 60)
  return `${hours}g ${String(minutes).padStart(2, '0')}p`
}

export interface ProductionGroup {
  key: string
  label: string
  sublabel: string | null
  /** Mũi máy tự khai. */
  stitches: number
  /** Mũi người gõ tay. Giữ riêng để không dòng nào trên màn hình gộp hai làn mà không nói ra. */
  manualStitches: number
  /** `stitches + manualStitches`: cơ sở của cột tiền, và là chỗ duy nhất hai làn được cộng. */
  stitchesBilled: number
  runSeconds: number
  amount: number | null
  rows: ProductionRow[]
  /**
   * Phần của nhóm KHÔNG nằm trong dòng tổng, vì máy chưa được xác minh tại chỗ.
   *
   * Là ba con số chứ không phải một chữ `verified`, vì một nhóm có thể bị loại một phần: gộp theo
   * ngày thì một ca có bốn máy đã xác minh và một máy chưa, và lúc đó "nhóm này chưa xác minh" sai
   * y như "nhóm này đã xác minh". Cái người đọc cần là chênh lệch giữa cột tiền của nhóm và dòng
   * tổng — nên nhóm phải mang sẵn đúng con số đó.
   *
   * `rows === 0` là nhóm sạch. `rows === group.rows.length` là nhóm bị loại trọn.
   */
  excluded: { rows: number; stitchesBilled: number; amount: number }
  anomalies: number
}

/**
 * One accumulator for both groupings, deliberately.
 *
 * These were two near-identical loops, and they drifted exactly where it hurt: the machine
 * grouping seeded its verified flag from the row while the shift grouping hardcoded `true`, so a
 * day mixing a verified machine with an unverified one printed 17.160 đ with no marker under a KPI
 * that said 14.760 đ. A group is a sum of rows; how the rows are keyed must not change what the
 * sum claims about itself.
 */
function accumulate(
  rows: ProductionRow[],
  keyOf: (row: ProductionRow) => string,
  headingOf: (row: ProductionRow) => { label: string; sublabel: string | null },
): ProductionGroup[] {
  const groups = new Map<string, ProductionGroup>()
  for (const row of rows) {
    const key = keyOf(row)
    const existing = groups.get(key) ?? {
      key,
      ...headingOf(row),
      stitches: 0,
      manualStitches: 0,
      stitchesBilled: 0,
      runSeconds: 0,
      amount: null,
      rows: [],
      excluded: { rows: 0, stitchesBilled: 0, amount: 0 },
      anomalies: 0,
    }
    existing.stitches += row.stitches
    existing.manualStitches += row.manualStitches
    existing.stitchesBilled += row.stitchesBilled
    existing.runSeconds += row.runSeconds
    if (row.amount !== null) existing.amount = (existing.amount ?? 0) + row.amount
    // Nhóm vẫn cộng cả dòng bị loại: cột của nó là sản lượng của nhóm, không phải số đã được duyệt.
    // Nhưng cộng vào rồi im lặng thì thành con số thứ hai chỏi với dòng tổng, nên phần bị loại được
    // giữ nguyên ở đây để dòng nhóm nói ra được đúng bằng bao nhiêu.
    if (!row.countedInTotals) {
      existing.excluded.rows += 1
      existing.excluded.stitchesBilled += row.stitchesBilled
      existing.excluded.amount += row.amount ?? 0
    }
    existing.anomalies += row.anomalies + row.resets
    existing.rows.push(row)
    groups.set(key, existing)
  }
  return [...groups.values()]
}

/**
 * Payroll is settled per machine over the whole period, so that is the default grouping.
 * `amount` is null only when *no* row in the group had a rate — a partially priced group
 * still sums what it can and the row list shows which days are missing a rate.
 */
export function groupByMachine(rows: ProductionRow[]): ProductionGroup[] {
  // Sắp theo số mũi được tính tiền, không theo riêng làn máy: nếu không thì một máy cả tuần chỉ
  // có số gõ tay sẽ tụt xuống cuối bảng đúng vào lúc người chốt lương cần thấy nó nhất.
  return accumulate(
    rows,
    (row) => row.machineId,
    (row) => ({ label: row.machineName ?? row.machineId, sublabel: row.assetTag }),
  ).sort((a, b) => b.stitchesBilled - a.stitchesBilled)
}

export function groupByShift(rows: ProductionRow[]): ProductionGroup[] {
  return accumulate(
    rows,
    (row) => `${row.date}|${row.shiftId}`,
    (row) => ({ label: `${row.date} · ${row.shiftName}`, sublabel: null }),
  ).sort((a, b) => b.key.localeCompare(a.key))
}

/**
 * Ba cột mũi chứ không một cột, và cột "tính tiền" đứng cạnh cột "gõ tay".
 *
 * File này là thứ được in ra rồi ký. Người ký phải thấy được phần nào của con số đến từ máy và
 * phần nào đến từ mắt người, ngay trên cùng một dòng — gộp lại thành một cột "Số mũi" là biến
 * một lời khai thành một phép đo, đúng chỗ khó phát hiện nhất.
 */
const CSV_HEADERS = [
  'Ngày', 'Ca', 'Xưởng', 'Chuyền', 'Mã tài sản', 'Máy',
  'Số mũi (máy khai)', 'Số mũi (người gõ)', 'Số mũi tính tiền', 'Lượt gõ tay',
  'Giờ chạy (giây)', 'Đơn giá /1000 mũi (đ)', 'Thành tiền (đ)', 'Đã xác minh',
  'Bộ đếm bất thường', 'Tính vào tổng',
]

/**
 * CSV for Excel in Vietnamese Windows: semicolon separator and a UTF-8 BOM, otherwise
 * Excel reads "Máy thêu" as mojibake and puts the whole row in one column.
 */
export function toCsv(report: ProductionReport): string {
  const lines = [CSV_HEADERS.join(csvSeparator)]
  for (const row of report.rows) {
    lines.push([
      cell(row.date),
      cell(row.shiftName),
      cell(row.siteName),
      cell(row.zone),
      cell(row.assetTag),
      cell(row.machineName ?? row.machineId),
      cell(row.stitches),
      cell(row.manualStitches),
      cell(row.stitchesBilled),
      cell(row.manualReadings),
      cell(row.runSeconds),
      cell(row.pricePer1000Stitches),
      cell(row.amount),
      cell(row.verified ? 'có' : 'chưa'),
      cell(row.anomalies + row.resets),
      cell(row.countedInTotals ? 'có' : 'không'),
    ].join(csvSeparator))
  }
  lines.push('')
  lines.push([
    cell('TỔNG (chỉ máy đã xác minh)'), '', '', '', '', '',
    cell(report.totals.stitches), cell(report.totals.manualStitches), cell(report.totals.stitchesBilled), '',
    cell(report.totals.runSeconds), '', cell(report.totals.amount),
  ].join(csvSeparator))
  if (report.totals.manualStitches > 0) {
    lines.push(cell(`${report.totals.rowsWithManualEntry} dòng có số do người gõ tay; ${report.totals.manualStitches} mũi trong tổng là số gõ tay, không phải số máy tự khai.`))
  }
  lines.push(cell(`Kỳ ${report.range.from} → ${report.range.to}, xuất lúc ${report.generatedAt}`))
  return csvDocument(lines)
}

export function csvFileName(report: ProductionReport): string {
  return `san-luong-${report.range.from}_${report.range.to}.csv`
}
