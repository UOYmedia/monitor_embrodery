import { useEffect, useMemo, useState } from 'react'
import { andonSummary, andonTiles, attentionPages, pageCount, pageOf, stitchesByMachine, toneLabels } from '../lib/andon'
import type { AndonTile } from '../lib/andon'
import { needsAttention } from '../lib/fleet'
import { UNREAD, formatAge, formatNumber } from '../lib/format'
import type { BridgeApi } from '../services/bridgeApi'
import type { MachineView, Site } from '../types/fleet'

/**
 * Andon wall board — the screen that hangs over the workshop floor.
 *
 * Read-only like the rest of the dashboard, and deliberately dumb: it paints the machines
 * the WebSocket already pushed, so putting it on a TV costs the bridge one more viewer, not
 * one more poll of every controller. The only extra request is today's stitch total, once a
 * minute; if that fails the tiles simply say "chưa có số" instead of the board going down.
 *
 * A wall board must never imply "everything is fine" when it actually knows nothing, so an
 * unreadable machine is painted as an attention state, not left blank.
 */

const ROTATE_MS = 15_000
const STITCH_REFRESH_MS = 60_000
const PAGE_SIZES = [8, 12, 24, 40]

function todayIn(timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function clock(nowMs: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('vi-VN', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .format(new Date(nowMs))
}

export function AndonBoard({
  machines, sites, api, nowMs, kiosk = false,
}: {
  machines: MachineView[]
  sites: Site[]
  api: BridgeApi
  nowMs: number
  kiosk?: boolean
}) {
  const [siteId, setSiteId] = useState<string>('all')
  const [zone, setZone] = useState<string>('all')
  const [pageSize, setPageSize] = useState<number>(12)
  const [rotate, setRotate] = useState(true)
  const [page, setPage] = useState(0)
  const [stitches, setStitches] = useState<Map<string, number>>(new Map())
  const [stitchError, setStitchError] = useState<string | null>(null)

  const site = sites.find((entry) => entry.id === siteId)
  const timeZone = site?.timeZone ?? sites[0]?.timeZone

  const scoped = useMemo(
    () => machines.filter((machine) =>
      (siteId === 'all' || machine.identity.siteId === siteId)
      && (zone === 'all' || machine.identity.zone === zone)),
    [machines, siteId, zone],
  )
  const zones = useMemo(
    () => [...new Set(machines
      .filter((machine) => siteId === 'all' || machine.identity.siteId === siteId)
      .map((machine) => machine.identity.zone))].sort((left, right) => left.localeCompare(right, 'vi')),
    [machines, siteId],
  )

  const tiles = useMemo(() => andonTiles(scoped, stitches, nowMs), [scoped, stitches, nowMs])
  const summary = useMemo(() => andonSummary(tiles), [tiles])
  // "Cần xử lý" trên tường phải bằng đúng "Cần xử lý" ở tab Tổng quan, nên dùng chung một hàm
  // thay vì đếm lại theo tone. Phần rộng hơn (dữ liệu cũ, chưa rõ) đứng riêng ở ô kế bên.
  const attention = useMemo(() => scoped.filter((machine) => needsAttention(machine, nowMs)).length, [scoped, nowMs])
  const pages = pageCount(tiles.length, pageSize)

  // Giữ trang khi có máy cần xử lý: xoay tiếp là giấu cái đang cháy đi 45 giây.
  const held = attentionPages(tiles, pageSize)
  const rotateWithin = held > 0 ? held : pages
  // Giữ trang chỉ chặn đồng hồ tự xoay; người đứng trước bảng vẫn bấm sang được mọi trang.
  const current = Math.min(page, pages - 1)
  const shown = pageOf(tiles, current, pageSize)

  // Today's stitches, refreshed on its own slow timer. Failure is not fatal: the board is
  // primarily a state board, the counter is a bonus.
  useEffect(() => {
    let cancelled = false
    const pull = async () => {
      const date = todayIn(timeZone)
      try {
        const report = await api.production({ from: date, to: date, siteId })
        if (cancelled) return
        setStitches(stitchesByMachine(report.rows))
        setStitchError(null)
      } catch {
        if (cancelled) return
        setStitchError('Chưa đọc được sản lượng ca từ bridge.')
      }
    }
    void pull()
    const timer = setInterval(() => void pull(), STITCH_REFRESH_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [api, siteId, timeZone])

  useEffect(() => {
    if (!rotate || rotateWithin <= 1) return
    const timer = setInterval(() => setPage((value) => (value + 1) % rotateWithin), ROTATE_MS)
    return () => clearInterval(timer)
  }, [rotate, rotateWithin])

  const toggleFullscreen = () => {
    const element = document.documentElement
    if (document.fullscreenElement) void document.exitFullscreen?.()
    else void element.requestFullscreen?.()
  }

  return (
    <section className={kiosk ? 'andon andon-kiosk' : 'andon'} aria-label="Bảng andon xưởng">
      <header className="andon-head">
        <div className="andon-title">
          <h2>{site?.name ?? 'Toàn bộ nhà xưởng'}{zone === 'all' ? '' : ` · ${zone}`}</h2>
          <p className="andon-clock" aria-label="Giờ xưởng">{clock(nowMs, timeZone)}</p>
        </div>

        <div className="andon-counts" role="group" aria-label="Tổng hợp trạng thái">
          <AndonCount label="Đang chạy" value={summary.running} tone="running" />
          <AndonCount label="Cần xử lý" value={attention} tone={attention > 0 ? 'fault' : 'idle'} />
          <AndonCount label="Dừng lâu" value={summary.longStop} tone="idle-long" />
          <AndonCount label="Dừng ngắn" value={summary.shortStop} tone="idle" />
          <AndonCount label="Chưa đọc được" value={summary.unreadable} tone="unknown" />
          <AndonCount label="Tổng máy" value={summary.total} tone="idle" />
        </div>
      </header>

      <div className="andon-controls">
        <label className="filter-field">
          <span>Xưởng</span>
          <select value={siteId} onChange={(event) => { setSiteId(event.target.value); setZone('all'); setPage(0) }}>
            <option value="all">Tất cả</option>
            {sites.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
        <label className="filter-field">
          <span>Chuyền</span>
          <select value={zone} onChange={(event) => { setZone(event.target.value); setPage(0) }}>
            <option value="all">Tất cả</option>
            {zones.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
        </label>
        <label className="filter-field">
          <span>Ô mỗi trang</span>
          <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0) }}>
            {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <label className="filter-check">
          <input type="checkbox" checked={rotate} onChange={(event) => setRotate(event.target.checked)} />
          <span>Tự chuyển trang mỗi 15 giây</span>
        </label>
        <button type="button" className="ghost" onClick={toggleFullscreen}>Toàn màn hình</button>
        {pages > 1 && (
          <span className="andon-page" aria-live="polite">
            Trang {current + 1}/{pages}
            <button type="button" className="ghost" onClick={() => setPage((current + pages - 1) % pages)}>‹</button>
            <button type="button" className="ghost" onClick={() => setPage((current + 1) % pages)}>›</button>
          </span>
        )}
      </div>

      {rotate && held > 0 && pages > held && (
        <p className="andon-hold" role="status">
          Đang giữ ở {held === 1 ? 'trang đầu' : `${held} trang đầu`} vì có {summary.abnormal} máy chưa bình thường
          (lỗi, mất kết nối, cảnh báo, dừng lâu, chưa đọc được). Bảng tự xoay hết {pages} trang trở lại khi mọi máy đều bình thường.
        </p>
      )}

      {tiles.length === 0 && (
        <p className="muted andon-empty">
          Không có máy nào trong phạm vi này. Ghép máy ở tab “Quét mạng &amp; ghép máy” trước khi treo bảng lên tường.
        </p>
      )}

      <div className="andon-grid" role="list">
        {shown.map((tile) => <AndonCard key={tile.id} tile={tile} />)}
      </div>

      <footer className="andon-foot reading-meta">
        Bảng chỉ đọc, số liệu do controller báo qua bridge · số mũi trong ca cập nhật mỗi phút ·
        thời lượng do dashboard tính từ lúc đổi trạng thái, riêng máy đang chạy là giờ chạy do máy báo ·
        một máy có thể nằm trong nhiều ô đếm (máy dừng lâu mà đang có cảnh báo được tính ở cả hai) ·
        bảng đếm cả máy chưa xác minh, khác với KPI sản xuất ở tab Tổng quan
        {stitchError ? ` · ${stitchError}` : ''}
      </footer>
    </section>
  )
}

function AndonCount({ label, value, tone }: { label: string; value: number; tone: AndonTile['tone'] }) {
  return (
    <div className={`andon-count andon-tone-${tone}`}>
      <span className="andon-count-value">{value}</span>
      <span className="andon-count-label">{label}</span>
    </div>
  )
}

function AndonCard({ tile }: { tile: AndonTile }) {
  return (
    <article className={`andon-card andon-tone-${tile.tone}`} role="listitem" aria-label={`${tile.name}: ${toneLabels[tile.tone]}`}>
      <header className="andon-card-head">
        <span className="andon-card-name">{tile.name}</span>
        {/* Thời lượng ở góc phải hàng đầu: từ xa, "dừng" và "dừng 40 phút" phải khác nhau. */}
        {tile.duration && <span className="andon-card-duration">{tile.duration}</span>}
      </header>
      <p className="andon-card-tag">{tile.assetTag} · {tile.zone}</p>

      <p className="andon-state">
        <span aria-hidden="true" className="andon-symbol">{tile.toneSymbol}</span>
        <span className="andon-state-text">{tile.toneLabel}</span>
      </p>
      <p className="andon-reason">{tile.reason}</p>

      <dl className="andon-metrics">
        <div>
          <dt>Mũi trong ca</dt>
          <dd>{tile.stitches === null ? 'Chưa có số' : formatNumber(tile.stitches)}</dd>
        </div>
        <div>
          <dt>Tốc độ</dt>
          <dd>{tile.rpm === null ? UNREAD : `${formatNumber(tile.rpm)} v/p`}</dd>
        </div>
        <div>
          <dt>Mẫu</dt>
          <dd>
            {tile.product ?? tile.job ?? UNREAD}
            {tile.progress === null ? '' : ` · ${tile.progress}%`}
          </dd>
        </div>
      </dl>

      <footer className="andon-card-foot">
        <span>{tile.ageSeconds === null ? 'Chưa có dữ liệu' : `Dữ liệu ${formatAge(tile.ageSeconds)}`}</span>
        {!tile.verified && <span className="badge badge-unverified">Chưa xác minh</span>}
      </footer>
    </article>
  )
}
