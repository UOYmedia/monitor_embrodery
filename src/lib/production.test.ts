import { describe, expect, it } from 'vitest'
import { csvFileName, formatHours, formatVnd, groupByMachine, groupByShift, toCsv } from './production'
import type { ProductionReport, ProductionRow } from '../types/fleet'

/**
 * `stitchesBilled` tính lại sau khi trộn `overrides`, chứ không cố định trong bảng mặc định: nếu
 * không thì một test đổi `stitches` sẽ để lại một dòng mà số tính tiền không khớp hai làn cộng
 * lại — đúng cái sai mà cột này sinh ra để bắt.
 */
const row = (overrides: Partial<ProductionRow> = {}): ProductionRow => withBilled({
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
  manualStitches: 0,
  stitchesBilled: 12_000,
  runSeconds: 3_600,
  readings: 20,
  manualReadings: 0,
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
}, overrides)

function withBilled(base: ProductionRow, overrides: Partial<ProductionRow>): ProductionRow {
  return { ...base, stitchesBilled: overrides.stitchesBilled ?? base.stitches + base.manualStitches }
}

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
    manualStitches: rows.reduce((sum, entry) => sum + entry.manualStitches, 0),
    stitchesBilled: rows.reduce((sum, entry) => sum + entry.stitchesBilled, 0),
    runSeconds: rows.reduce((sum, entry) => sum + entry.runSeconds, 0),
    amount: rows.reduce((sum, entry) => sum + (entry.amount ?? 0), 0),
    rowsWithoutPrice: rows.filter((entry) => entry.amount === null).length,
    rowsWithManualEntry: rows.filter((entry) => entry.manualStitches > 0).length,
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

  it('giữ riêng hai làn và chỉ cộng chúng ở cột tính tiền', () => {
    const groups = groupByMachine([
      row({ stitches: 12_000 }),
      row({ key: 'b', date: '2026-08-13', stitches: 0, manualStitches: 8_000, manualReadings: 2, amount: 9_600 }),
    ])
    expect(groups[0]).toMatchObject({ stitches: 12_000, manualStitches: 8_000, stitchesBilled: 20_000, amount: 24_000 })
  })

  it('xếp theo số mũi được tính tiền, nên máy chỉ có số gõ tay không bị đẩy xuống cuối', () => {
    const groups = groupByMachine([
      row({ machineId: 'a', stitches: 5_000 }),
      row({ machineId: 'b', stitches: 0, manualStitches: 9_000 }),
    ])
    expect(groups.map((group) => group.key)).toEqual(['b', 'a'])
  })

  it('máy chưa xác minh: cả nhóm bị loại, và số bị loại bằng đúng số của nhóm', () => {
    const groups = groupByMachine([
      row({ verified: false, countedInTotals: false, stitches: 0, manualStitches: 2_000, amount: 2_400 }),
    ])
    expect(groups[0].excluded).toEqual({ rows: 1, stitchesBilled: 2_000, amount: 2_400 })
    expect(groups[0].excluded.rows).toBe(groups[0].rows.length)
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

  it('ca gồm cả máy đã và chưa xác minh: nhóm nói ra đúng khoản không vào tổng', () => {
    // Đây là ca đã sai một lần: nhóm theo ngày từng khai `verified: true` vô điều kiện, nên một
    // ngày có một máy chưa xác minh vẫn in ra tổng 17.160 đ trơn không dấu, ngay dưới KPI ghi
    // 14.760 đ. Hai con số chỏi nhau mà không ai giải thích thì người chốt lương đi tìm lỗi cộng.
    const groups = groupByShift([
      row({ machineId: 'a', stitches: 12_000, amount: 14_400 }),
      row({ machineId: 'b', verified: false, countedInTotals: false, stitches: 0, manualStitches: 2_000, amount: 2_400 }),
    ])
    expect(groups).toHaveLength(1)
    // Nhóm vẫn cộng cả hai dòng: cột của nó là sản lượng của cả ca.
    expect(groups[0]).toMatchObject({ stitchesBilled: 14_000, amount: 16_800 })
    // Nhưng phần không vào tổng phải đo được, và chỉ gồm dòng bị loại.
    expect(groups[0].excluded).toEqual({ rows: 1, stitchesBilled: 2_000, amount: 2_400 })
    expect(groups[0].excluded.rows).toBeLessThan(groups[0].rows.length)
  })

  it('ca chỉ có máy đã xác minh thì không có gì bị loại', () => {
    const groups = groupByShift([row({ machineId: 'a' }), row({ machineId: 'b' })])
    expect(groups[0].excluded).toEqual({ rows: 0, stitchesBilled: 0, amount: 0 })
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
    // Đơn giá và thành tiền là cột 11–12 kể từ khi có ba cột mũi; đọc theo tên cột thì test này
    // sẽ không im lặng trôi sang cột khác lần sau.
    const headers = csv.replace('\ufeff', '').split('\r\n')[0].split(';')
    expect([headers[11], headers[12]]).toEqual(['Đơn giá /1000 mũi (đ)', 'Thành tiền (đ)'])
    expect(dataLine.split(';').slice(11, 13)).toEqual(['', ''])
  })

  it('tách ba cột mũi và nói ra phần nào là số người gõ', () => {
    const csv = toCsv(report([row({ stitches: 4_000, manualStitches: 6_000, manualReadings: 2, amount: 12_000 })]))
    const headers = csv.replace('\ufeff', '').split('\r\n')[0].split(';')
    expect(headers.slice(6, 10)).toEqual(['Số mũi (máy khai)', 'Số mũi (người gõ)', 'Số mũi tính tiền', 'Lượt gõ tay'])
    expect(csv.split('\r\n')[1].split(';').slice(6, 10)).toEqual(['4000', '6000', '10000', '2'])
    // Dòng chú thích cuối file: người ký bảng lương phải đọc được điều này mà không cần mở dashboard.
    expect(csv).toContain('không phải số máy tự khai')
  })

  it('không thêm dòng chú thích khi cả kỳ không có số gõ tay', () => {
    expect(toCsv(report([row()]))).not.toContain('người gõ tay')
  })
})

describe('csvFileName', () => {
  it('names the file after the period so two exports never collide', () => {
    expect(csvFileName(report([]))).toBe('san-luong-2026-08-08_2026-08-14.csv')
  })
})
