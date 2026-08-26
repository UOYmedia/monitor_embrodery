import { useEffect, useState } from 'react'
import { NHAN_KET_THUC, dauMoLai, maNguyenVan, moTaThoiLuong, nghiaKetThuc, tienToBatDau } from '../lib/faultEpisodes'
import { formatTime } from '../lib/format'
import type { BridgeApi } from '../services/bridgeApi'
import { BridgeApiError } from '../services/bridgeApi'
import type { FaultEpisode, FaultEpisodePage } from '../types/fleet'

/**
 * Bảng **lần lỗi** của một máy: *lỗi gì · từ · đến · kéo dài*.
 *
 * Bảng này chỉ đọc. Nó không mở lại lần lỗi, không xác nhận, không gửi gì tới controller —
 * đường ghi (`POST …/faults/:id/reopen`) đã có ở tầng API và có sổ kiểm toán riêng; thêm một
 * cái nút vào đây là mở một cửa ghi thứ hai không ai yêu cầu.
 *
 * Việc khó nhất của cả bảng không phải là bày dữ liệu ra, mà là **không nói quá**. Ba trong bốn
 * cột đều có thể in ra một thứ trông như phép đo trong khi hệ thống không hề quan sát được nó:
 * mốc "đến" của một lần mất tín hiệu là lúc *ta thôi nhìn thấy*, không phải lúc *máy hết lỗi*;
 * và một khoảng không quan sát được mà in thành `0 phút` thì đọc y như "máy lỗi rồi hết ngay".
 * Mọi quyết định câu chữ nằm ở `lib/faultEpisodes.ts` để test chốt được từng ca.
 */
export function FaultEpisodeTable({ api, machineId, timeZone, limit = 100 }: {
  api: BridgeApi
  machineId: string
  timeZone?: string
  limit?: number
}) {
  const [page, setPage] = useState<FaultEpisodePage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.machineFaults(machineId, limit)
      .then((result) => { if (!cancelled) { setPage(result); setError(null) } })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof BridgeApiError ? cause.message : 'Không đọc được lịch sử lần lỗi từ bridge.')
        }
      })
    return () => { cancelled = true }
  }, [api, machineId, limit])

  return (
    <section className="detail-block" aria-label="Lần lỗi của máy">
      <h3>Lần lỗi của máy này</h3>
      <p className="block-note">
        Mỗi lần máy vào trạng thái lỗi là một dòng riêng — không gộp theo ngưỡng thời gian, vì gộp
        sai thì che mất một lần dừng máy có thật. Mã lỗi in đúng nguyên văn máy gửi, không dịch.
      </p>

      {error && <p className="detail-error" role="alert">{error}</p>}
      {!page && !error && <p className="muted">Đang tải…</p>}

      {page && page.episodes.length === 0 && (
        <p className="muted">
          Chưa ghi được lần lỗi nào cho máy này. Đây là một câu trả lời bình thường, không phải lỗi
          hệ thống — nhưng cũng chưa phải bằng chứng máy không hỏng lần nào.
        </p>
      )}

      {page && page.episodes.length > 0 && (
        <>
          <table className="mini-table">
            <thead>
              <tr>
                <th scope="col">Lỗi gì</th>
                <th scope="col">Từ</th>
                <th scope="col">Đến</th>
                <th scope="col">Kéo dài</th>
              </tr>
            </thead>
            <tbody>
              {page.episodes.map((episode) => (
                <HangLanLoi key={episode.episodeId} episode={episode} timeZone={timeZone} />
              ))}
            </tbody>
          </table>
          {page.truncated && (
            <p className="reading-meta">
              Đang hiện {page.episodes.length} lần lỗi gần nhất trong tổng {page.tongCong} lần đã ghi.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function HangLanLoi({ episode, timeZone }: { episode: FaultEpisode; timeZone?: string }) {
  const ma = maNguyenVan(episode)
  const doDai = moTaThoiLuong(episode)
  const moLai = dauMoLai(episode)
  const tienTo = tienToBatDau(episode)

  return (
    <tr>
      <td>
        {ma === null
          ? <span className="fault-unknown">Máy không gửi mã lỗi</span>
          : <span className="fault-code">{ma}</span>}
        {episode.moTa && <span className="row-sub">{episode.moTa}</span>}
        {moLai && (
          // Dấu này đứng CẠNH bản ghi cũ chứ không thay chỗ nó: mốc, thời lượng và mã lỗi ban đầu
          // vẫn nằm nguyên trên cùng một dòng. Người ta cần thấy được rằng đã có lúc hệ thống
          // tưởng máy chạy lại rồi — xoá đi thì cái bảng trông sạch hơn sự thật.
          <span className="row-sub">
            <span className="badge badge-unknown">đã mở lại</span>{' '}
            {moLai.soLan > 1 ? `${moLai.soLan} lần · ` : ''}
            {moLai.boi ?? 'không rõ ai'} lúc {formatTime(moLai.luc, timeZone)}
            {moLai.lyDo ? ` — ${moLai.lyDo}` : ''}
          </span>
        )}
      </td>
      <td>
        {tienTo && <span className="fault-unknown">{tienTo} </span>}
        {formatTime(episode.batDau, timeZone)}
        {tienTo && <span className="row-sub">Máy đã lỗi từ trước lúc bridge kịp nhìn thấy.</span>}
      </td>
      <td>
        {episode.ketThuc ? formatTime(episode.ketThuc, timeZone) : '—'}
        <span className="row-sub">{NHAN_KET_THUC[nghiaKetThuc(episode)]}</span>
      </td>
      <td>
        {doDai.laChu ? <span className="fault-unknown">{doDai.text}</span> : doDai.text}
        {doDai.vi && <span className="row-sub">{doDai.vi}</span>}
      </td>
    </tr>
  )
}
