import { memo, useEffect, useState } from 'react'
import { describeDesign } from '../lib/design'
import type { BridgeApi, DesignEntry } from '../services/bridgeApi'

/**
 * Ảnh mẫu thêu trong ô máy — dựng lại từ file `.DST` trong **thư viện của xưởng**, khớp theo tên
 * mà controller báo lên.
 *
 * Ba điều phải nói thẳng, vì hiểu nhầm ở đây là hiểu nhầm nguy hiểm:
 *
 *  1. **Đây không phải ảnh đọc từ máy.** Controller chỉ gửi lên cái tên file. Không có ảnh nào
 *     đi qua mạng từ máy thêu về đây, và cũng không có file nào đi ngược lại. Nếu ai đó nạp mẫu
 *     khác vào máy bằng USB mà tên file trùng, ảnh này vẫn hiện — nó nói về *cái tên*, không
 *     nói về sợi chỉ đang chạy.
 *  2. **Không có màu.** File DST không chứa màu chỉ; màu trên màn hình controller là do máy gán
 *     kim → chỉ. Nên ảnh ở đây là nét một màu. Tô bảy màu cho giống ảnh chụp là bịa.
 *  3. **Không có ảnh thì nói vì sao.** "Chưa cấu hình thư viện", "không có file tên này" và
 *     "nhiều mẫu trùng tên rút gọn" là ba việc phải làm khác nhau. Ô nhỏ chỉ đủ chỗ cho nhãn
 *     ngắn nên nguyên câu nằm ở `title` và ở panel chi tiết.
 */

/**
 * Cache dùng chung cho cả lưới: hai mươi máy chạy chung một mẫu thì tải một lần.
 *
 * Giữ `Promise` chứ không giữ kết quả, để hai ô cùng gọi một lúc không tạo ra hai request. URL
 * blob cố ý **không** thu hồi: nó sống theo vòng đời trang, mà một mẫu chỉ vài KB — thu hồi
 * sớm là ảnh vỡ ở ô còn đang dùng chung đúng cái URL đó.
 */
const blobCache = new Map<string, Promise<string>>()

function loadThumbnail(api: BridgeApi, file: string): Promise<string> {
  const hit = blobCache.get(file)
  if (hit) return hit
  const pending = api.designSvg(file)
    .then((svg) => URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })))
    .catch((error: Error) => { blobCache.delete(file); throw error })
  blobCache.set(file, pending)
  return pending
}

export const DesignThumb = memo(function DesignThumb({
  api, fileName, entry, size = 'card',
}: {
  api: BridgeApi
  fileName: string | null
  entry: DesignEntry | undefined
  size?: 'card' | 'detail'
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const ready = entry?.status === 'found' && fileName !== null

  useEffect(() => {
    if (!ready || fileName === null) { setSrc(null); setFailed(false); return }
    let alive = true
    setFailed(false)
    loadThumbnail(api, fileName)
      .then((url) => { if (alive) setSrc(url) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [api, fileName, ready])

  const described = describeDesign(entry, fileName)
  const className = `design-thumb design-thumb-${size}`

  if (ready && src !== null && !failed) {
    return (
      <span className={className}>
        <img src={src} alt={`Hình mẫu ${entry?.matchedFile ?? fileName}`} title={described.full} loading="lazy" />
        {/* Khớp theo tiền tố là "gần đúng", không phải "đúng". Dấu ~ nói ra điều đó ngay trên ô. */}
        {entry?.viaPrefix && <span className="design-thumb-approx" title={described.full} aria-hidden="true">~</span>}
      </span>
    )
  }

  const label = failed ? 'Lỗi ảnh' : described.short
  const full = failed ? 'Bridge không dựng được ảnh từ file mẫu này.' : described.full
  return (
    <span className={`${className} design-thumb-empty`} title={full} role="img" aria-label={full}>
      <span aria-hidden="true">{label}</span>
    </span>
  )
})
