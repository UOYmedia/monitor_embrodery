import { emptyFilter } from './fleet'
import type { FleetFilter, SortKey } from './fleet'

/**
 * Trạng thái màn hình nằm trong URL, để chia sẻ được bằng cách dán link.
 *
 * Lý do rất cụ thể: quản đốc gọi kỹ thuật "máy MT-07 đang lỗi" thì việc mô tả bằng lời mất
 * một phút và vẫn sai; dán một cái link thì bên kia mở ra đúng cái đang nhìn. Cũng nhờ vậy
 * mà F5 hoặc mất điện chốc lát không đưa người dùng về màn hình mặc định.
 *
 * Chỉ những gì khác mặc định mới được ghi vào URL — URL sạch thì người ta mới dám dán.
 * Không có gì nhạy cảm ở đây: id máy, tên khu vực và từ khoá tìm kiếm, không token, không
 * IP nào mà người xem chưa có quyền thấy.
 */

export type Tab = 'fleet' | 'production' | 'andon' | 'pairing' | 'audit'

/** Mọi tab đã viết xong. Danh sách này không đổi; `tabs` bên dưới mới là cái đang bật. */
export const allTabs: Tab[] = ['fleet', 'production', 'andon', 'pairing', 'audit']

/**
 * Tab đang bật, theo thứ tự hiện trên thanh và theo phím tắt `1..n`.
 *
 * Ba tab còn lại tắt: bớt chỗ bấm nhầm, header ngắn lại một dòng. Code của chúng còn nguyên —
 * bật lại chỉ là thêm tên vào mảng này, không phải viết lại gì. Tab bị tắt mà ai đó còn giữ link
 * cũ (`?tab=audit`) thì `decodeView` đưa về Tổng quan chứ không mở một màn hình không có đường
 * quay ra.
 *
 * `production` bật từ 18/08/2026. Lúc tắt nó thì lý do đúng: không máy nào đọc được bộ đếm mũi
 * nên màn hình sản lượng chỉ là một cái bảng rỗng, và một tab dẫn tới bảng rỗng thì tệ hơn là
 * không có tab. Bây giờ đã có đường nhập tay, nên nó có số thật để cộng — mà tổng cả xưởng và cột
 * tiền khoán thì không màn hình chi tiết từng máy nào thay được: chốt lương là việc so các máy với
 * nhau. Không có số nữa thì tắt lại, một từ.
 *
 * Bảng andon treo TV vẫn chạy: nó là địa chỉ riêng `?andon=1`, không phải một tab.
 */
export const tabs: Tab[] = ['fleet', 'production']

/**
 * Hai cách bày cùng một danh sách máy, cùng bộ lọc, cùng thứ tự, cùng panel chi tiết.
 *
 *  - `cards`: mỗi máy một ô vuông, **sản phẩm đang chạy** là chữ to nhất trong ô. Đây là câu
 *    hỏi thường trực ở xưởng ("máy này đang thêu cái gì, xong chưa"), và ô vuông trả lời được
 *    từ xa vài mét. Mặc định.
 *  - `table`: dày hơn — 19 máy trên màn 1080 so với 8–10 ô vuông. Xưởng nhiều máy hoặc lúc
 *    cần so cột với nhau thì đổi sang bảng.
 */
export type FleetLayout = 'cards' | 'table'

export interface ViewState {
  tab: Tab
  machineId: string | null
  filter: FleetFilter
  sortKey: SortKey
  sortDirection: 'asc' | 'desc'
  layout: FleetLayout
}

export const defaultView: ViewState = {
  tab: 'fleet',
  machineId: null,
  filter: emptyFilter,
  sortKey: 'attention',
  sortDirection: 'asc',
  layout: 'cards',
}

const sortKeys: SortKey[] = ['attention', 'name', 'assetTag', 'zone', 'lastSeen', 'progress', 'maintenance']

/** Khoá ngắn trong URL ↔ trường của bộ lọc. Ngắn để URL còn đọc được bằng mắt. */
const filterKeys: Record<string, keyof FleetFilter> = {
  q: 'search',
  site: 'siteId',
  zone: 'zone',
  conn: 'connection',
  st: 'status',
  ad: 'adapter',
  sev: 'severity',
  ver: 'verification',
  esc: 'escalation',
  nhom: 'tone',
}

export function encodeFilter(filter: FleetFilter): string {
  const parts: string[] = []
  for (const [short, field] of Object.entries(filterKeys)) {
    const value = filter[field]
    if (typeof value === 'string' && value !== emptyFilter[field]) parts.push(`${short}:${value}`)
  }
  if (filter.attention) parts.push('attention')
  if (filter.includeArchived) parts.push('archived')
  return parts.join(';')
}

/**
 * URL do người khác dán tới, nên mọi giá trị đều bị coi là không đáng tin: khoá lạ bị bỏ,
 * giá trị lạ giữ nguyên chuỗi (bộ lọc sẽ không khớp máy nào, hơn là làm hỏng màn hình).
 */
export function decodeFilter(raw: string | null): FleetFilter {
  if (!raw) return emptyFilter
  const filter: FleetFilter = { ...emptyFilter }
  for (const part of raw.split(';')) {
    if (part === 'attention') { filter.attention = true; continue }
    if (part === 'archived') { filter.includeArchived = true; continue }
    const at = part.indexOf(':')
    if (at <= 0) continue
    const field = filterKeys[part.slice(0, at)]
    if (!field) continue
    const value = part.slice(at + 1)
    if (typeof emptyFilter[field] === 'string') Object.assign(filter, { [field]: value })
  }
  return filter
}

export function encodeView(view: ViewState): string {
  const params = new URLSearchParams()
  if (view.tab !== defaultView.tab) params.set('tab', view.tab)
  if (view.machineId) params.set('machine', view.machineId)
  const filter = encodeFilter(view.filter)
  if (filter) params.set('filter', filter)
  if (view.sortKey !== defaultView.sortKey || view.sortDirection !== defaultView.sortDirection) {
    params.set('sort', `${view.sortKey}:${view.sortDirection}`)
  }
  if (view.layout !== defaultView.layout) params.set('xem', view.layout === 'table' ? 'bang' : 'o')
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function decodeView(search: string): ViewState {
  const params = new URLSearchParams(search)
  const tab = params.get('tab')
  const [sortKey, sortDirection] = (params.get('sort') ?? '').split(':')
  return {
    tab: tabs.includes(tab as Tab) ? (tab as Tab) : defaultView.tab,
    machineId: params.get('machine'),
    filter: decodeFilter(params.get('filter')),
    sortKey: sortKeys.includes(sortKey as SortKey) ? (sortKey as SortKey) : defaultView.sortKey,
    sortDirection: sortDirection === 'desc' ? 'desc' : 'asc',
    // `xem=bang` là giá trị duy nhất đổi được cách bày; mọi thứ khác (kể cả `xem=` rỗng hay
    // `xem=xyz` do người ta sửa tay trên thanh địa chỉ) rơi về mặc định thay vì màn hình trắng.
    layout: params.get('xem') === 'bang' ? 'table' : defaultView.layout,
  }
}
