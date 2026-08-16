import type { AuditEntry, AuditPage, AuditRetention, BridgeHealth, MachineView, ProductionReport, ScanResult, SessionSummary } from '../types/fleet'

/**
 * REST client for the bridge.
 *
 * The browser never talks to a controller: every call here goes to the bridge, which is
 * same-origin by default. The access token lives in memory only — never in localStorage,
 * sessionStorage, a cookie or a URL — so closing the tab ends the session.
 */

export class BridgeApiError extends Error {
  status: number
  field: string | null
  correlationId: string | null

  constructor(message: string, { status, field = null, correlationId = null }: { status: number; field?: string | null; correlationId?: string | null }) {
    super(message)
    this.name = 'BridgeApiError'
    this.status = status
    this.field = field
    this.correlationId = correlationId
  }
}

/**
 * Vì sao mỗi mẫu có một `status` chứ không phải một `boolean`: "chưa cấu hình thư viện", "không
 * có file tên này" và "nhiều mẫu trùng tên rút gọn" dẫn tới ba việc phải làm khác hẳn nhau —
 * sửa config, chép file vào thư viện, hay đổi tên mẫu cho khỏi trùng. Một chữ "không có ảnh"
 * gộp cả ba lại thì người vận hành không biết phải sửa gì.
 */
export type DesignStatus = 'found' | 'missing' | 'ambiguous' | 'unreadable' | 'disabled' | 'invalid-name'

export interface DesignEntry {
  status: DesignStatus
  /** Tên file thật trong thư viện — khác tên controller báo khi khớp theo tiền tố. */
  matchedFile?: string
  /** True khi phải cắt `~` để khớp: ảnh đúng "một cách hợp lý", chưa phải khớp tuyệt đối. */
  viaPrefix?: boolean
  reason?: string | null
  candidates?: string[] | null
}

export interface DesignIndexResponse {
  library: { enabled: boolean; files: number; error: string | null }
  entries: Record<string, DesignEntry>
}

export interface MachineInput {
  id?: string
  assetTag: string
  name: string
  siteId: string
  zone: string
  model?: string | null
  serial?: string | null
  ipAddress: string
  macAddress?: string | null
  adapter: string
  adapterConfig?: Record<string, unknown>
  note?: string | null
  pricePer1000Stitches?: number | null
  verification?: { confirmed: boolean; evidence: 'mac' | 'serial' | 'assetTag' }
}

export class BridgeApi {
  baseUrl: string
  private token: string | null = null

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  /** In-memory only, deliberately: a token in storage would outlive the operator's shift. */
  setToken(token: string | null) {
    this.token = token && token.trim() ? token.trim() : null
  }

  get hasToken(): boolean {
    return this.token !== null
  }

  get websocketUrl(): string {
    const base = this.baseUrl || window.location.origin
    const url = new URL(base)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = '/ws'
    url.search = ''
    return url.toString()
  }

  get socketProtocols(): string[] | undefined {
    return this.token ? ['bearer', this.token] : undefined
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/v2${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const correlationId = response.headers.get('x-correlation-id')
    const text = await response.text()
    let parsed: unknown = null
    if (text) {
      try { parsed = JSON.parse(text) } catch { parsed = null }
    }
    if (!response.ok) {
      const payload = parsed as { error?: string; field?: string | null } | null
      throw new BridgeApiError(payload?.error ?? `Bridge trả về HTTP ${response.status}.`, { status: response.status, field: payload?.field ?? null, correlationId })
    }
    return parsed as T
  }

  session() { return this.request<SessionSummary>('GET', '/session') }
  health() { return this.request<BridgeHealth>('GET', '/health') }
  fleet() { return this.request<{ machines: MachineView[] }>('GET', '/fleet') }
  /**
   * Nhật ký kiểm toán, có lọc.
   *
   * Trả về cả `truncated` chứ không chỉ danh sách: màn hình phải nói được "còn nữa" thay vì
   * để người đọc tưởng khoảng trống là không có ai làm gì.
   */
  audit(query: { limit?: number; from?: string; to?: string; actor?: string; action?: string; result?: string } = {}) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '' && value !== 'all') params.set(key, String(value))
    }
    if (!params.has('limit')) params.set('limit', '200')
    return this.request<AuditPage>('GET', `/audit?${params.toString()}`)
  }

  /** Hạn giữ nhật ký + hiện trạng file trên đĩa. Chỉ đọc: không có đường sửa từ trình duyệt. */
  auditRetention() { return this.request<AuditRetention>('GET', '/audit/retention') }
  production(query: { from?: string; to?: string; siteId?: string; machineId?: string } = {}) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value && value !== 'all') params.set(key, value)
    }
    const search = params.toString()
    return this.request<ProductionReport>('GET', `/production${search ? `?${search}` : ''}`)
  }

  machineAudit(machineId: string, limit = 50) { return this.request<{ entries: AuditEntry[] }>('GET', `/machines/${encodeURIComponent(machineId)}/audit?limit=${limit}`) }

  /** Tra một loạt tên mẫu trong thư viện của xưởng: có ảnh hay không, và nếu không thì vì sao. */
  designs(files: string[]) {
    return this.request<DesignIndexResponse>('GET', `/designs?files=${encodeURIComponent(files.join(','))}`)
  }

  /**
   * Tải SVG ảnh mẫu về dạng chữ, không dùng thẳng `<img src="/api/…">`.
   *
   * Ở chế độ `auth.mode: "token"`, thẻ `<img>` không mang được header `Authorization`, nên mọi
   * ảnh sẽ 401 và ô nào cũng thành hình vỡ. Tải bằng `fetch` rồi bọc thành blob giữ nguyên
   * đường xác thực, mà vẫn hiển thị qua `<img>` — SVG trong `<img>` không chạy được script.
   */
  async designSvg(file: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/v2/designs/thumbnail?file=${encodeURIComponent(file)}`, {
      headers: {
        accept: 'image/svg+xml',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
    })
    if (!response.ok) {
      throw new BridgeApiError(`Bridge không trả được ảnh mẫu (HTTP ${response.status}).`, {
        status: response.status,
        correlationId: response.headers.get('x-correlation-id'),
      })
    }
    return response.text()
  }

  scan(input: { siteId: string; cidr: string; ports: number[] }) {
    // The bridge refuses to emit a single packet without this explicit acknowledgement.
    return this.request<ScanResult>('POST', '/scan', { ...input, acknowledgeScanWarning: true })
  }

  pair(machines: MachineInput[]) { return this.request<{ machines: MachineView[] }>('POST', '/machines', { machines }) }
  update(id: string, input: Partial<MachineInput>) { return this.request<{ machine: MachineView }>('PATCH', `/machines/${encodeURIComponent(id)}`, input) }
  archive(id: string, archived: boolean) { return this.request<{ machine: MachineView }>('POST', `/machines/${encodeURIComponent(id)}/archive`, { archived }) }
  probe(id: string) { return this.request<{ ipAddress: string; port: number; open: boolean; checkedAt: string }>('POST', `/machines/${encodeURIComponent(id)}/probe`) }

  acknowledge(id: string, alertId: string, note: string | null, acknowledged = true) {
    return this.request<{ machine: MachineView }>('POST', `/machines/${encodeURIComponent(id)}/alerts/${encodeURIComponent(alertId)}/acknowledge`, { note, acknowledged })
  }

  completeMaintenance(id: string, planId: string, note: string | null) {
    return this.request<{ machine: MachineView }>('POST', `/machines/${encodeURIComponent(id)}/maintenance/${encodeURIComponent(planId)}/complete`, { note })
  }

  setMaintenance(id: string, maintenance: unknown[]) {
    return this.request<{ machine: MachineView }>('PUT', `/machines/${encodeURIComponent(id)}/maintenance`, { maintenance })
  }
}
