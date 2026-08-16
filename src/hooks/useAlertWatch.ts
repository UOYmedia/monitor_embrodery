import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isActionable, newAlerts, titleBadge } from '../lib/alerts'
import type { AlertDigest, FleetAlert } from '../lib/alerts'

/**
 * Trông chừng cảnh báo mới và đẩy lên hai kênh không cần ai đang nhìn vào bảng:
 * thẻ nổi ở góc màn hình, và con số trên tiêu đề tab trình duyệt.
 *
 * **Cố tình không có chuông báo.** `PRD_UI_MONITORING.md` §14 đã loại âm thanh khỏi bảng
 * andon và lý do vẫn đúng ở đây: xưởng ồn, loa máy tính thường bị tắt, và trình duyệt chặn
 * phát tiếng khi người dùng chưa bấm vào trang — nên một hệ thống "có kêu" mà thực tế không
 * kêu tạo cảm giác an toàn giả, nguy hiểm hơn hẳn không có gì. Con số trên tiêu đề tab thì
 * kiểm được bằng mắt: nhìn là biết nó có đang chạy hay không.
 *
 * Ba quy tắc để thông báo còn đáng tin:
 *
 *  - **Lần tải đầu không nổ.** Mọi cảnh báo đang có lúc mở trang được ghi thẳng vào "đã
 *    thấy". Một màn hình bị 12 thẻ dội vào lúc F5 là một màn hình sẽ bị tắt thông báo.
 *  - **`info` không bao giờ nổi lên** (`newAlerts` lọc sẵn): dữ liệu cũ thoáng qua mà cũng
 *    nổ thì người dùng học được cách bỏ qua tất cả.
 *  - **Cảnh báo tự hết thì rời khỏi "đã thấy".** Máy mất kết nối, trở lại, rồi lại mất là
 *    một sự kiện mới chứ không phải cùng một sự kiện — và bản thân việc chập chờn cũng là
 *    thứ cần thấy.
 */

/** Tối đa từng này thẻ trên màn hình; phần dồn lại chỉ hiện thành một dòng đếm. */
const maxToasts = 4

/** `warning` tự rút sau khoảng này; `critical` nằm lại tới khi có người bấm. */
const warningTtlMs = 30_000

export interface AlertWatch {
  toasts: FleetAlert[]
  /** Số cảnh báo mới bị dồn lại ngoài `maxToasts`. */
  overflow: number
  dismiss: (key: string) => void
  dismissAll: () => void
  /** Mở trung tâm cảnh báo = đã xem hết: thẻ biến mất và không nổ lại. */
  markSeen: () => void
}

export function useAlertWatch(rows: FleetAlert[], digest: AlertDigest, ready: boolean, enabled = true): AlertWatch {
  const seenRef = useRef<Set<string>>(new Set())
  /** Mốc xuất hiện của mỗi thẻ, để rút thẻ `warning` quá hạn. Ref chứ không phải state: nó
   *  không vẽ ra gì cả, đưa vào state chỉ tạo thêm một vòng render. */
  const shownAtRef = useRef<Map<string, number>>(new Map())
  const primedRef = useRef(false)
  const [live, setLive] = useState<FleetAlert[]>([])

  useEffect(() => {
    if (!enabled || !ready) return

    const actionable = rows.filter(isActionable)
    const open = new Map(actionable.map((row) => [row.key, row] as const))

    // Cảnh báo đã tắt thì quên đi, để lần sau nó quay lại còn được báo.
    for (const key of seenRef.current) {
      if (!open.has(key)) { seenRef.current.delete(key); shownAtRef.current.delete(key) }
    }

    if (!primedRef.current) {
      primedRef.current = true
      for (const key of open.keys()) seenRef.current.add(key)
      return
    }

    const now = Date.now()
    const fresh = newAlerts(seenRef.current, actionable)
    for (const row of fresh) {
      seenRef.current.add(row.key)
      shownAtRef.current.set(row.key, now)
    }

    setLive((current) => {
      const kept = current.filter((row) => {
        // Thẻ của một cảnh báo đã tắt (máy trở lại, hoặc có người xác nhận) là thẻ nói dối
        // về hiện tại — bỏ, không đợi hết giờ.
        if (!open.has(row.key)) return false
        if (row.alert.severity === 'critical') return true
        return now - (shownAtRef.current.get(row.key) ?? now) <= warningTtlMs
      })
      if (!fresh.length && kept.length === current.length) return current
      const keptKeys = new Set(kept.map((row) => row.key))
      // Nội dung dòng cảnh báo (thời lượng dừng chẳng hạn) già đi theo từng nhịp, nên lấy
      // bản mới nhất từ `open` thay vì giữ ảnh chụp lúc thẻ hiện ra.
      return [...fresh.filter((row) => !keptKeys.has(row.key)), ...kept.map((row) => open.get(row.key) ?? row)]
    })
  }, [enabled, ready, rows])

  const dismiss = useCallback((key: string) => {
    setLive((current) => current.filter((row) => row.key !== key))
  }, [])

  const dismissAll = useCallback(() => setLive([]), [])

  const markSeen = useCallback(() => {
    for (const row of rows) {
      if (isActionable(row)) seenRef.current.add(row.key)
    }
    setLive([])
  }, [rows])

  useDocumentTitle(digest.open, enabled)

  const toasts = useMemo(() => live.slice(0, maxToasts), [live])
  return { toasts, overflow: Math.max(0, live.length - maxToasts), dismiss, dismissAll, markSeen }
}

/**
 * Số cảnh báo đang mở trên tiêu đề tab — kênh duy nhất còn thấy khi tab chạy nền.
 *
 * Nhận thẳng `open` chứ không nhận cả digest: digest là object mới sau mỗi nhịp 5 giây, nên
 * để nó vào dependency là viết lại `document.title` liên tục dù con số không đổi.
 */
function useDocumentTitle(open: number, enabled: boolean): void {
  const baseRef = useRef<string | null>(null)

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (baseRef.current === null) baseRef.current = document.title
    const base = baseRef.current
    document.title = enabled ? titleBadge(open, base) : base
    return () => { document.title = base }
  }, [open, enabled])
}
