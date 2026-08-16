import { describe, expect, it } from 'vitest'
import { auditFileName, describeRetention, formatBytes, toAuditCsv, toAuditJson } from './audit'
import type { AuditEntry, AuditRetention } from '../types/fleet'

const meta = { generatedAt: '2026-08-16T02:30:00.000Z', truncated: false, filters: { 'Người thực hiện': 'ktv.an' } }

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'e-1',
    at: '2026-08-16T02:00:00.000Z',
    actor: 'ktv.an',
    role: 'technician',
    action: 'machine.rename',
    targetType: 'machine',
    targetId: 'm-1',
    result: 'allowed',
    correlationId: 'cid-1',
    remote: '192.168.7.20',
    message: null,
    before: { name: 'Máy 1' },
    after: { name: 'Máy 1B' },
    ...overrides,
  }
}

describe('toAuditCsv', () => {
  it('keeps a comma inside one cell instead of shifting every later column', () => {
    const csv = toAuditCsv([entry({ message: 'đổi tên, theo yêu cầu tổ trưởng' })], meta)
    const row = csv.split('\r\n')[1]
    expect(row).toContain('"đổi tên, theo yêu cầu tổ trưởng"')
    expect(row.split(';')).toHaveLength(12)
  })

  /**
   * Nội dung do người dùng gõ vào (ghi chú, tên máy) đi thẳng vào file này. Excel chạy ô bắt
   * đầu bằng `=` như một công thức, nên đây là lỗ hổng thật chứ không phải chuyện thẩm mỹ.
   */
  it('defuses a cell that Excel would otherwise run as a formula', () => {
    const csv = toAuditCsv([entry({ message: '=HYPERLINK("http://x","bấm")' })], meta)
    expect(csv).toContain(`'=HYPERLINK`)
  })

  it('flattens before/after so the row stays readable in a spreadsheet', () => {
    const csv = toAuditCsv([entry()], meta)
    expect(csv).toContain('name=Máy 1')
    expect(csv).toContain('name=Máy 1B')
  })

  it('starts with a BOM, so Excel does not render Vietnamese as mojibake', () => {
    expect(toAuditCsv([entry()], meta).startsWith('﻿')).toBe(true)
  })

  it('prints the filters that produced it, so a printed copy says what it is', () => {
    expect(toAuditCsv([entry()], meta)).toContain('Người thực hiện: ktv.an')
  })

  /** Bản xuất thiếu mà im lặng sẽ bị đọc như "khoảng này không ai làm gì". */
  it('says inside the file when the export is incomplete', () => {
    const csv = toAuditCsv([entry()], { ...meta, truncated: true })
    expect(csv).toContain('CẢNH BÁO')
    expect(toAuditCsv([entry()], meta)).not.toContain('CẢNH BÁO')
  })
})

describe('toAuditJson', () => {
  it('keeps before/after intact, which is the whole point of the JSON copy', () => {
    const parsed = JSON.parse(toAuditJson([entry()], meta))
    expect(parsed.entries[0].before).toEqual({ name: 'Máy 1' })
    expect(parsed).toMatchObject({ count: 1, truncated: false, generatedAt: meta.generatedAt })
  })
})

describe('auditFileName', () => {
  it('avoids the colons that Windows refuses in a file name', () => {
    expect(auditFileName(meta, 'csv')).toBe('nhat-ky-kiem-toan-2026-08-16-02-30-00.csv')
  })
})

describe('describeRetention', () => {
  const base: AuditRetention = {
    maxBytes: 8_388_608,
    retentionDays: null,
    segments: [{ name: 'audit-log.jsonl', bytes: 2048, modifiedAt: meta.generatedAt, rotatedAt: null, active: true }],
    totalBytes: 2048,
    oldestAt: null,
    expiring: [],
  }

  it('says keep-forever in words, not as a blank', () => {
    expect(describeRetention(base)).toContain('Giữ mãi')
  })

  it('names the number of days when a limit is configured', () => {
    expect(describeRetention({ ...base, retentionDays: 180 })).toContain('Giữ 180 ngày')
  })
})

describe('formatBytes', () => {
  it('scales the unit so a size is readable at a glance', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5_242_880)).toBe('5.0 MB')
  })
})
