import { andonTone } from './andon'
import type { AndonTone } from './andon'
import type { FleetFilter } from './fleet'
import type { MachineView } from '../types/fleet'

/**
 * Thành phần đội máy, dạng một thanh chồng đọc được từ xa.
 *
 * Dải chip phía trên trả lời "bao nhiêu máy lỗi" rất tốt, nhưng nó là chín con số rời — muốn
 * biết *tỉ lệ* thì người xem phải tự chia trong đầu. Câu hỏi đầu tiên của một người quản đốc
 * đi ngang màn hình lại đúng là câu tỉ lệ: "xưởng đang chạy được bao nhiêu phần?". Đó là dữ
 * liệu **một phần trên tổng thể**, và hình đúng cho nó là một thanh chồng ngang, không phải
 * biểu đồ tròn và cũng không phải thêm chín con số nữa.
 *
 * Ba quyết định đáng ghi lại:
 *
 *  - **Chia theo `andonTone`, không theo KPI.** Chỉ số KPI chồng lấn nhau (`idleLong` nằm
 *    trong `idle`, một máy vừa `fault` vừa `offline` được đếm hai lần), nên cộng lại không ra
 *    tổng số máy — dùng làm thanh phần trăm là sai số học. `andonTone` cho **đúng một** tông
 *    mỗi máy, nên năm khúc dưới đây rời nhau và cộng lại vừa đúng tổng.
 *  - **Gộp còn năm khúc.** Tám tông vẽ thành tám khúc thì khúc mỏng nhất chỉ còn vài pixel và
 *    không ai đọc được. Gộp theo *việc phải làm*: máy hỏng, máy không nhìn thấy được, máy cần
 *    để mắt, máy đang nghỉ, máy đang chạy. Muốn biết chi tiết trong một nhóm thì chip phía
 *    trên vẫn tách đủ tám.
 *  - **Hai khúc màu xám là cố ý.** Bộ kiểm màu coi màu xám là "chưa đủ sắc độ" với bảng phân
 *    loại, nhưng ở đây xám mang đúng nghĩa của nó: không có gì đang xảy ra, và không có gì để
 *    đọc. Ba trạng thái cần người thì có màu; hai trạng thái còn lại lùi ra sau. Đó là hình
 *    "làm nổi bật", không phải bảng phân loại.
 *  - **Đếm đúng tập hợp mà chip KPI đang đếm**: bỏ máy đã lưu trữ và máy chưa xác minh, y hệt
 *    `summarize`. Bản đầu tiên đếm cả đội, thế là chip ghi "9 đang chạy" còn thanh ngay dưới
 *    ghi "10" — hai con số cùng một chữ, lệch nhau một máy, và người xem không có cách nào
 *    biết cái nào đúng. Số bị loại không bị giấu: nó thành một dòng chữ cạnh thanh.
 */

export type CompositionKey = 'fault' | 'unreadable' | 'attention' | 'idle' | 'running'

export interface CompositionSegment {
  key: CompositionKey
  label: string
  /** Ký hiệu chữ: thanh vẫn đọc được khi in đen trắng hoặc khi người xem mù màu. */
  symbol: string
  count: number
  /** Phần trăm trên tổng, đã làm tròn — chỉ để hiển thị, bề rộng vẽ theo `count`. */
  percent: number
  hint: string
  /** Bấm vào khúc thì lọc đúng nhóm đó, giống hệt chip phía trên. */
  patch: Partial<FleetFilter>
}

/** Tông nào rơi vào khúc nào. Mọi tông đều phải có mặt, nếu không thanh sẽ hụt mất máy. */
const bucketOf: Record<AndonTone, CompositionKey> = {
  fault: 'fault',
  offline: 'unreadable',
  stale: 'unreadable',
  unknown: 'unreadable',
  alert: 'attention',
  'idle-long': 'attention',
  idle: 'idle',
  running: 'running',
}

/** Máy này thuộc khúc nào. Bộ lọc dùng chung hàm này với thanh, nên hai bên không thể lệch. */
export function compositionBucket(machine: MachineView, now = Date.now()): CompositionKey {
  return bucketOf[andonTone(machine, now).tone]
}

export const compositionLabel: Record<CompositionKey, string> = {
  fault: 'Lỗi máy',
  unreadable: 'Không đọc được',
  attention: 'Cần để mắt',
  idle: 'Dừng',
  running: 'Đang chạy',
}

/**
 * Thứ tự trái → phải: việc gấp nhất đứng trước, vì mắt đọc thanh từ trái.
 *
 * `patch` phải lọc ra **đúng** tập máy mà khúc vừa đếm, nếu không thì con số in trên nhãn và số
 * dòng hiện ra sau khi bấm sẽ khác nhau — và người xem không có cách nào biết bên nào đúng. Vì
 * thế nó lọc thẳng theo `tone` (cùng hàm phân khúc) và kèm `verification: 'verified'` (cùng luật
 * loại trừ). Bản đầu tiên lọc theo `status`/`attention` cho tiện, và "9 Đang chạy" ra 10 dòng vì
 * một máy chạy nhưng dữ liệu quá hạn vẫn khớp `status: 'running'`.
 */
const order: Omit<CompositionSegment, 'count' | 'percent'>[] = [
  {
    key: 'fault', label: compositionLabel.fault, symbol: '✕',
    hint: 'Controller tự báo lỗi và dữ liệu còn đọc được. Máy mất kết nối không tính vào đây.',
    patch: { tone: 'fault', verification: 'verified' },
  },
  {
    key: 'unreadable', label: compositionLabel.unreadable, symbol: '○',
    hint: 'Mất kết nối, dữ liệu đã quá hạn tươi, hoặc chưa từng đọc được trạng thái.',
    patch: { tone: 'unreadable', verification: 'verified' },
  },
  {
    key: 'attention', label: compositionLabel.attention, symbol: '▲',
    hint: 'Có cảnh báo chưa xác nhận, hoặc dừng liên tục quá ngưỡng của xưởng.',
    patch: { tone: 'attention', verification: 'verified' },
  },
  {
    key: 'idle', label: compositionLabel.idle, symbol: '■',
    hint: 'Dừng trong ngưỡng bình thường — thay khung, thay chỉ, hết ca.',
    patch: { tone: 'idle', verification: 'verified' },
  },
  {
    key: 'running', label: compositionLabel.running, symbol: '▶',
    hint: 'Controller báo đang chạy và dữ liệu còn tươi.',
    patch: { tone: 'running', verification: 'verified' },
  },
]

export interface Composition {
  /** Năm khúc rời nhau, cộng lại đúng bằng `counted`. */
  segments: CompositionSegment[]
  /** Số máy thật sự được vẽ trên thanh. */
  counted: number
  /** Bị loại vì kỹ thuật viên chưa ra tận máy đối chiếu — giống hệt luật của chip KPI. */
  unverified: number
  archived: number
}

/**
 * Khúc rỗng vẫn được trả về: người gọi cần biết "không máy nào lỗi" khác với "chưa tính".
 * Việc ẩn khúc rỗng là chuyện của phần vẽ.
 */
export function fleetComposition(machines: MachineView[], now = Date.now()): Composition {
  const counts = new Map<CompositionSegment['key'], number>()
  let counted = 0
  let unverified = 0
  let archived = 0

  for (const machine of machines) {
    if (machine.identity.archived) { archived += 1; continue }
    if (machine.identity.verification.status !== 'verified') { unverified += 1; continue }
    counted += 1
    const key = compositionBucket(machine, now)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const segments = order.map((segment) => {
    const count = counts.get(segment.key) ?? 0
    return { ...segment, count, percent: counted === 0 ? 0 : Math.round((count / counted) * 100) }
  })
  return { segments, counted, unverified, archived }
}
