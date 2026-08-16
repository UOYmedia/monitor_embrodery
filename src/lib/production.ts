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
  stitches: number
  runSeconds: number
  amount: number | null
  rows: ProductionRow[]
  verified: boolean
  anomalies: number
}

/**
 * Payroll is settled per machine over the whole period, so that is the default grouping.
 * `amount` is null only when *no* row in the group had a rate — a partially priced group
 * still sums what it can and the row list shows which days are missing a rate.
 */
export function groupByMachine(rows: ProductionRow[]): ProductionGroup[] {
  const groups = new Map<string, ProductionGroup>()
  for (const row of rows) {
    const existing = groups.get(row.machineId) ?? {
      key: row.machineId,
      label: row.machineName ?? row.machineId,
      sublabel: row.assetTag,
      stitches: 0,
      runSeconds: 0,
      amount: null,
      rows: [],
      verified: row.verified,
      anomalies: 0,
    }
    existing.stitches += row.stitches
    existing.runSeconds += row.runSeconds
    if (row.amount !== null) existing.amount = (existing.amount ?? 0) + row.amount
    existing.anomalies += row.anomalies + row.resets
    existing.rows.push(row)
    groups.set(row.machineId, existing)
  }
  return [...groups.values()].sort((a, b) => b.stitches - a.stitches)
}

export function groupByShift(rows: ProductionRow[]): ProductionGroup[] {
  const groups = new Map<string, ProductionGroup>()
  for (const row of rows) {
    const key = `${row.date}|${row.shiftId}`
    const existing = groups.get(key) ?? {
      key,
      label: `${row.date} · ${row.shiftName}`,
      sublabel: null,
      stitches: 0,
      runSeconds: 0,
      amount: null,
      rows: [],
      verified: true,
      anomalies: 0,
    }
    existing.stitches += row.stitches
    existing.runSeconds += row.runSeconds
    if (row.amount !== null) existing.amount = (existing.amount ?? 0) + row.amount
    existing.anomalies += row.anomalies + row.resets
    existing.rows.push(row)
    groups.set(key, existing)
  }
  return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key))
}

const CSV_HEADERS = [
  'Ngày', 'Ca', 'Xưởng', 'Chuyền', 'Mã tài sản', 'Máy', 'Số mũi', 'Giờ chạy (giây)',
  'Đơn giá /1000 mũi (đ)', 'Thành tiền (đ)', 'Đã xác minh', 'Bộ đếm bất thường', 'Tính vào tổng',
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
      cell(row.runSeconds),
      cell(row.pricePer1000Stitches),
      cell(row.amount),
      cell(row.verified ? 'có' : 'chưa'),
      cell(row.anomalies + row.resets),
      cell(row.countedInTotals ? 'có' : 'không'),
    ].join(csvSeparator))
  }
  lines.push('')
  lines.push([cell('TỔNG (chỉ máy đã xác minh)'), '', '', '', '', '', cell(report.totals.stitches), cell(report.totals.runSeconds), '', cell(report.totals.amount)].join(csvSeparator))
  lines.push(cell(`Kỳ ${report.range.from} → ${report.range.to}, xuất lúc ${report.generatedAt}`))
  return csvDocument(lines)
}

export function csvFileName(report: ProductionReport): string {
  return `san-luong-${report.range.from}_${report.range.to}.csv`
}
