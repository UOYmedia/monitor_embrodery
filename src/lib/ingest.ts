import type { DialInCaller, IngestStatus } from '../types/fleet'

/**
 * Đọc trạng thái cổng "máy tự gọi vào" thành câu tiếng Việt.
 *
 * Màn hình này chỉ có một việc: trả lời câu hỏi của người đang đứng cạnh máy sau khi vừa
 * đặt `C44 Server IP` trỏ về bridge — "máy đã gọi tới chưa?". Ba câu trả lời khác hẳn nhau
 * và dẫn tới ba việc phải làm khác nhau:
 *
 *  - chưa có địa chỉ nào gọi vào → vấn đề nằm ở đường mạng hoặc ở tham số trên controller;
 *  - có địa chỉ gọi vào nhưng bị từ chối → mạng thông rồi, chỉ còn thiếu ghép máy;
 *  - gọi vào được nhưng byte không giải mã được → đấu nối xong, giao thức là việc khác.
 *
 * Gộp ba trường hợp đó thành "chưa có dữ liệu" là cách nhanh nhất để người ta đi kéo lại
 * dây trong khi mọi thứ đã chạy.
 */

export type IngestTone = 'off' | 'waiting' | 'rejected' | 'undecoded' | 'ok'

export interface IngestVerdict {
  tone: IngestTone
  headline: string
  detail: string
}

/** Lý do bridge từ chối, nói bằng tiếng của xưởng chứ không phải tiếng của log. */
export const ingestReasonLabels: Record<string, string> = {
  unknown_source: 'Địa chỉ chưa ghép máy nào',
  ambiguous_source: 'Hai máy cùng khai một địa chỉ',
  outside_allowlist: 'Địa chỉ ngoài dải cho phép của xưởng',
  cooldown: 'Đang bị tạm khoá sau lỗi trước',
  idle_timeout: 'Mở kết nối rồi im lặng quá lâu',
  frame_too_large: 'Khung dữ liệu vượt giới hạn',
  rate_limited: 'Gửi quá dày, đã chặn bớt',
  machine_id_mismatch: 'Khung khai machineId của máy khác',
  not_json: 'Byte không phải JSON',
  not_object: 'JSON không phải một object',
  no_newline: 'Không có ký tự xuống dòng ngăn khung',
  partial_frame: 'Khung đứt giữa chừng khi ngắt kết nối',
}

export function ingestReasonLabel(reason: string | null): string {
  if (!reason) return '—'
  return ingestReasonLabels[reason] ?? reason
}

/** Một dòng trong bảng địa chỉ, đã quy ra trạng thái để tô màu và ghi chữ. */
export interface CallerVerdict {
  tone: 'ok' | 'undecoded' | 'pending' | 'blocked'
  label: string
  hint: string
  /** Còn thiếu bước ghép máy ở địa chỉ này. */
  pairable: boolean
}

/** Lý do bridge cắt ngay ở mức kết nối — chưa đọc được byte nào của lần gọi đó. */
const refusedAtConnection = new Set(['unknown_source', 'ambiguous_source', 'outside_allowlist', 'cooldown'])

/** Lý do "có byte nhưng không đúng hợp đồng" — khác hẳn với bị chặn ngoài cửa. */
const undecodedReasons = new Set(['not_json', 'not_object', 'no_newline', 'partial_frame'])

/**
 * Trạng thái của một địa chỉ, tính theo **lần gọi gần nhất** chứ không theo bộ đếm cộng dồn.
 *
 * Bộ đếm cộng dồn nói dối ở đúng tình huống đáng lo nhất: một máy đang chạy tốt rồi bị lưu
 * kho, bị tắt, hoặc bị thu hẹp dải cho phép — controller vẫn gọi vào và vẫn bị từ chối,
 * nhưng `framesAccepted` của nó thì mãi mãi lớn hơn 0. Lấy bộ đếm làm chuẩn thì dòng đó vẫn
 * ghi "đang nhận dữ liệu" trong khi thực tế đã đứt.
 */
export function describeCaller(caller: DialInCaller): CallerVerdict {
  if (caller.pairedCount > 1) {
    return {
      tone: 'blocked',
      label: 'Trùng khai báo',
      hint: `${caller.pairedCount} máy cùng khai địa chỉ này. Bridge không đoán máy nào, và sẽ không nhận dữ liệu cho tới khi sổ máy được sửa.`,
      pairable: false,
    }
  }

  if (caller.lastReason && refusedAtConnection.has(caller.lastReason)) {
    // Vừa ghép máy xong: controller thường phải gọi lại một lượt nữa mới có dữ liệu. Nói rõ
    // là "đang chờ" chứ không để nguyên chữ "chưa ghép" của lần gọi trước.
    if (caller.pairedMachineId) {
      return {
        tone: 'pending',
        label: 'Đã ghép, chờ máy gọi lại',
        hint: `Địa chỉ này đang khai cho ${caller.pairedMachineName ?? caller.pairedMachineId}. Controller Dahao gọi lại theo chu kỳ của nó; nếu lâu quá thì tắt/bật nguồn máy.`,
        pairable: false,
      }
    }
    return {
      tone: 'blocked',
      label: ingestReasonLabel(caller.lastReason),
      hint: caller.lastReason === 'unknown_source'
        ? 'Máy đã gọi tới đúng bridge. Chỉ còn thiếu bước ghép máy cho địa chỉ này.'
        : 'Lần gọi gần nhất bị từ chối ngay ở cửa, chưa đọc được byte nào.',
      pairable: caller.lastReason === 'unknown_source',
    }
  }

  if (caller.lastReason && undecodedReasons.has(caller.lastReason)) {
    return {
      tone: 'undecoded',
      label: 'Chưa giải mã được',
      hint: 'Máy có gửi byte nhưng không đúng JSON theo hợp đồng adapter. Đấu nối coi như xong.',
      pairable: false,
    }
  }

  if (caller.lastReason) {
    return {
      tone: 'blocked',
      label: ingestReasonLabel(caller.lastReason),
      hint: 'Kết nối vào được nhưng khung gần nhất bị bỏ. Xem log bridge nếu lặp lại.',
      pairable: false,
    }
  }

  if (caller.framesAccepted > 0) {
    return {
      tone: 'ok',
      label: 'Đang nhận dữ liệu',
      hint: `${caller.framesAccepted} khung đã đọc được.`,
      pairable: false,
    }
  }

  return {
    tone: 'pending',
    label: 'Đã kết nối, chưa gửi khung nào',
    hint: 'Bridge nhận địa chỉ này nhưng máy chưa gửi khung nào. Bridge không hỏi máy, nên phải chờ máy tự gửi.',
    pairable: false,
  }
}

/**
 * Câu tổng kết cho cả cổng, dựng từ chính các dòng bên dưới nên không bao giờ mâu thuẫn với
 * bảng: có dòng nào đang nhận thì là "đang nhận", còn lại thì lấy tình trạng xấu nhất.
 */
export function describeIngest(status: IngestStatus | null): IngestVerdict {
  if (!status || !status.enabled) {
    return {
      tone: 'off',
      headline: 'Cổng máy gọi vào đang tắt',
      detail: 'Bật khối "ingest" trong bridge.config.json rồi khởi động lại bridge. Controller Dahao cần C44 Server IP trỏ về bridge và C41 Server Port đúng cổng này.',
    }
  }
  const where = status.address ? `${status.address.host}:${status.address.port}` : 'chưa rõ cổng'
  if (status.callers.length === 0) {
    return {
      tone: 'waiting',
      headline: `Cổng đang mở tại ${where}, chưa có máy nào gọi tới`,
      detail: 'Chưa có một địa chỉ nào chạm tới cổng này. Kiểm tra C44/C41 trên controller, đường mạng tới bridge và tường lửa của máy chạy bridge.',
    }
  }

  const rows = status.callers.map((caller) => describeCaller(caller))
  const receiving = rows.filter((row) => row.tone === 'ok').length
  if (receiving > 0) {
    return {
      tone: 'ok',
      headline: `Đang nhận dữ liệu tại ${where}`,
      detail: `${receiving}/${rows.length} địa chỉ đang gửi được dữ liệu. Địa chỉ nào còn báo lỗi thì xem từng dòng bên dưới.`,
    }
  }
  if (rows.some((row) => row.tone === 'undecoded')) {
    return {
      tone: 'undecoded',
      headline: 'Máy có gửi dữ liệu, nhưng chưa giải mã được',
      detail: 'Đường mạng đã thông — phần còn lại là chuyện giao thức, không phải chuyện đấu nối. Byte đầu tiên hiện ở cột cuối; bật "capture" trong bridge.config.json nếu cần lưu lại để giải mã.',
    }
  }
  if (rows.some((row) => row.tone === 'blocked')) {
    return {
      tone: 'rejected',
      headline: 'Có máy gọi tới nhưng bị từ chối',
      detail: 'Mạng đã thông tới bridge. Xem cột "Tình trạng" bên dưới — thường chỉ còn thiếu bước ghép máy cho địa chỉ đó.',
    }
  }
  return {
    tone: 'waiting',
    headline: `Đã ghép xong, đang chờ máy gọi lại vào ${where}`,
    detail: 'Bridge không hỏi máy: controller Dahao tự gọi theo chu kỳ của nó. Chờ một lượt; lâu quá thì tắt/bật nguồn máy.',
  }
}

/** Byte đầu tiên, gọn lại vừa một ô bảng. */
export function formatCallerBytes(caller: DialInCaller, maxHexBytes = 8): string {
  if (!caller.lastBytes) return '—'
  const groups = caller.lastBytes.hex.split(' ')
  const head = groups.slice(0, maxHexBytes).join(' ')
  const more = groups.length > maxHexBytes || caller.lastBytes.truncated
  return `${head}${more ? '…' : ''} (${caller.lastBytes.bytes} byte)`
}

/** Số giây tính từ lần gọi gần nhất, để dùng với formatAge. */
export function callerAgeSeconds(caller: DialInCaller, nowMs: number): number | null {
  const at = Date.parse(caller.lastSeenAt)
  if (Number.isNaN(at)) return null
  return (nowMs - at) / 1000
}
