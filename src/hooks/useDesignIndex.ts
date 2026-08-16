import { useEffect, useState } from 'react'
import type { BridgeApi, DesignEntry, DesignIndexResponse } from '../services/bridgeApi'

/**
 * Tra tên mẫu → có ảnh hay không, cho cả đội máy trong **một** request.
 *
 * Hai mươi máy trong xưởng thường chạy chung dăm ba mẫu, nên tra theo *tên mẫu duy nhất* chứ
 * không theo máy: 20 ô nhưng chỉ 4 tên thì chỉ hỏi 4 cái tên. Và chỉ hỏi lại khi **tập tên**
 * đổi, không phải mỗi lần telemetry nhảy — telemetry nhảy mỗi 15 giây.
 */

export interface DesignIndex {
  entries: Record<string, DesignEntry>
  library: DesignIndexResponse['library'] | null
  loading: boolean
  /** Bridge không trả lời được (mất mạng, hết quyền). Khác hẳn "thư viện không có mẫu này". */
  error: string | null
}

const empty: DesignIndex = { entries: {}, library: null, loading: false, error: null }

export function useDesignIndex(api: BridgeApi, fileNames: string[]): DesignIndex {
  // Khoá ổn định: cùng một tập tên (dù thứ tự khác) thì không gọi lại.
  const key = [...new Set(fileNames.filter(Boolean))].sort().join(',')
  const [state, setState] = useState<DesignIndex>(empty)

  useEffect(() => {
    if (!key) { setState(empty); return }
    let alive = true
    setState((previous) => ({ ...previous, loading: true, error: null }))
    api.designs(key.split(','))
      .then((result) => {
        if (!alive) return
        setState({ entries: result.entries ?? {}, library: result.library ?? null, loading: false, error: null })
      })
      .catch((error: Error) => {
        if (!alive) return
        // Giữ nguyên kết quả cũ: mất mạng một nhịp không nên làm cả lưới ảnh nhấp nháy biến mất.
        setState((previous) => ({ ...previous, loading: false, error: error.message }))
      })
    return () => { alive = false }
  }, [api, key])

  return state
}
