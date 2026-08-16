import { describe, expect, it } from 'vitest'
import { csvFileName, formatHours, formatVnd, groupByMachine, groupByShift, toCsv } from './production'
import type { ProductionReport, ProductionRow } from '../types/fleet'

const row = (overrides: Partial<ProductionRow> = {}): ProductionRow => ({
  key: '2026-08-14|ca-1|mch-hn-001',
  date: '2026-08-14',
  shiftId: 'ca-1',
  shiftName: 'Ca ngày',
  machineId: 'mch-hn-001',
  machineName: 'Máy thêu 01',
  assetTag: 'HN-001',
  zone: 'Chuyền A',
  siteId: 'hn-1',
  siteName: 'Xưởng Hà Nội',
  stitches: 12_000,
  runSeconds: 3_600,
  readings: 20,
  resets: 0,
  anomalies: 0,
  firstAt: '2026-08-14T01:00:00.000Z',
  lastAt: '2026-08-14T02:00:00.000Z',
  archived: false,
  machineMissing: false,
  verified: true,
  pricePer1000Stitches: 1_200,
  amount: 14_400,
  countedInTotals: true,
  ...overrides,
})

const report = (rows: ProductionRow[]): ProductionReport => ({
  schemaVersion: 2,
  range: { from: '2026-08-08', to: '2026-08-14' },
  generatedAt: '2026-08-14T04:00:00.000Z',
  timeZone: 'Asia/Ho_Chi_Minh',
  shifts: [{ id: 'ca-1', name: 'Ca ngày', start: '06:00', end: '18:00' }],
  rows,
  totals: {
    machines: 1,
    stitches: rows.reduce((sum, entry) => sum + entry.stitches, 0),
    runSeconds: rows.reduce((sum, entry) => sum + entry.runSeconds, 0),
    amount: rows.reduce((sum, entry) => sum + (entry.amount ?? 0), 0),
    rowsWithoutPrice: rows.filter((entry) => entry.amount === null).length,
    anomalies: 0,
  },
  excluded: { unverifiedRows: 0, reason: '' },
})

describe('formatVnd', () => {
  it('says the rate is unset instead of showing 0 đ', () => {
    expect(formatVnd(null)).toBe('Chưa đặt đơn giá')
    expect(formatVnd(0)).toBe('0 đ')
    expect(formatVnd(14_400)).toBe('14.400 đ')
  })
})

describe('formatHours', () => {
  it('reads as workshop hours, not seconds', () => {
    expect(formatHours(3_600)).toBe('1g 00p')
    expect(formatHours(5_430)).toBe('1g 31p')
    expect(formatHours(0)).toBe('0g 00p')
  })
})

describe('groupByMachine', () => {
  it('sums a machine across days and keeps its rows', () => {
    const groups = groupByMachine([row(), row({ key: 'b', date: '2026-08-13', stitches: 8_000, amount: 9_600 })])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ label: 'Máy thêu 01', stitches: 20_000, amount: 24_000, runSeconds: 7_200 })
    expect(groups[0].rows).toHaveLength(2)
  })

  it('keeps the amount null only when no row in the group has a rate', () => {
    const noRate = groupByMachine([row({ pricePer1000Stitches: null, amount: null })])
    expect(noRate[0].amount).toBeNull()
    const partial = groupByMachine([row({ pricePer1000Stitches: null, amount: null }), row({ key: 'b' })])
    expect(partial[0].amount).toBe(14_400)
  })

  it('sorts the busiest machine first', () => {
    const groups = groupByMachine([
      row({ machineId: 'a', stitches: 1_000 }),
      row({ machineId: 'b', stitches: 9_000 }),
    ])
    expect(groups.map((group) => group.key)).toEqual(['b', 'a'])
  })
})

describe('groupByShift', () => {
  it('groups a date and shift across machines, newest first', () => {
    const groups = groupByShift([
      row({ machineId: 'a', date: '2026-08-13' }),
      row({ machineId: 'b' }),
      row({ machineId: 'c' }),
    ])
    expect(groups.map((group) => group.key)).toEqual(['2026-08-14|ca-1', '2026-08-13|ca-1'])
    expect(groups[0].stitches).toBe(24_000)
  })
})

describe('toCsv', () => {
  it('uses a BOM and semicolons so Vietnamese Excel opens it correctly', () => {
    const csv = toCsv(report([row()]))
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.split('\r\n')[0]).toContain('Ngày;Ca;Xưởng')
    expect(csv).toContain('Máy thêu 01')
  })

  it('quotes a value containing the separator instead of shifting the columns', () => {
    const csv = toCsv(report([row({ machineName: 'Máy 01; chuyền A' })]))
    expect(csv).toContain('"Máy 01; chuyền A"')
  })

  it('neutralises a cell Excel would treat as a formula', () => {
    const csv = toCsv(report([row({ machineName: '=SUM(A1:A9)' })]))
    expect(csv).toContain("'=SUM(A1:A9)")
  })

  it('carries the totals row and the period so a printed sheet is self-describing', () => {
    const csv = toCsv(report([row()]))
    expect(csv).toContain('TỔNG (chỉ máy đã xác minh)')
    expect(csv).toContain('Kỳ 2026-08-08 → 2026-08-14')
  })

  it('leaves the money cell empty for a row with no rate, never 0', () => {
    const csv = toCsv(report([row({ pricePer1000Stitches: null, amount: null })]))
    const dataLine = csv.split('\r\n')[1]
    expect(dataLine.split(';').slice(8, 10)).toEqual(['', ''])
  })
})

describe('csvFileName', () => {
  it('names the file after the period so two exports never collide', () => {
    expect(csvFileName(report([]))).toBe('san-luong-2026-08-08_2026-08-14.csv')
  })
})
