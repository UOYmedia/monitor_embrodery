import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { AccessBar } from './components/AccessBar'
import { AndonBoard } from './components/AndonBoard'
import { AuditPanel } from './components/AuditPanel'
import { ConnectionBanner } from './components/ConnectionBanner'
import { EmptyState } from './components/EmptyState'
import { ErrorBoundary } from './components/ErrorBoundary'
import { FleetBar } from './components/FleetBar'
import { FleetCards } from './components/FleetCards'
import { FleetFilters } from './components/FleetFilters'
import { FleetTable } from './components/FleetTable'
import { KpiBar } from './components/KpiBar'
import { MachineDetail } from './components/MachineDetail'
import { PairingPanel } from './components/PairingPanel'
import { ProductionPanel } from './components/ProductionPanel'
import { useDesignIndex } from './hooks/useDesignIndex'
import { useFleetData } from './hooks/useFleetData'
import { andonHeartbeat } from './lib/andon'
import { ageFleet, applyFilter, distinctZones, sortMachines, summarize } from './lib/fleet'
import type { FleetFilter, SortKey } from './lib/fleet'
import { formatTime } from './lib/format'
import { decodeView, encodeView, tabs } from './lib/urlState'
import type { Tab } from './lib/urlState'
import type { AdapterKind } from './types/fleet'

const tabLabels: Record<Tab, string> = {
  fleet: 'Tổng quan đội máy',
  production: 'Sản lượng ca',
  andon: 'Bảng andon',
  pairing: 'Quét mạng & ghép máy',
  audit: 'Nhật ký kiểm toán',
}

/** Three different reasons the header may have no count, kept apart instead of collapsed. */
function headerScope(fleet: ReturnType<typeof useFleetData>): string {
  if (fleet.health) return `${fleet.health.counts.machines} máy đã ghép`
  if (fleet.session === null) return 'chưa liên lạc được bridge'
  return 'chưa có quyền xem đội máy'
}

/**
 * `?andon=1` opens the wall board alone, for the TV browser in kiosk mode: no tabs, no
 * filters bar, nothing an operator walking past could click into a different screen.
 */
function isKiosk(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('andon') === '1'
}

/** Gõ vào ô nhập thì phím tắt phải im — nếu không, tìm "j" sẽ nhảy hàng thay vì gõ chữ. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export default function App() {
  const fleet = useFleetData()
  const [kiosk] = useState(isKiosk)
  const [view, setView] = useState(() => decodeView(typeof window === 'undefined' ? '' : window.location.search))
  const { tab, machineId: selectedId, filter, sortKey, sortDirection, layout } = view
  const searchRef = useRef<HTMLInputElement>(null)

  const patchView = useCallback((next: Partial<typeof view>) => setView((current) => ({ ...current, ...next })), [])
  const setFilter = useCallback((next: FleetFilter) => patchView({ filter: next, machineId: null }), [patchView])
  const setSelectedId = useCallback((next: string | null) => patchView({ machineId: next }), [patchView])
  const setTab = useCallback((next: Tab) => patchView({ tab: next }), [patchView])

  // Re-aged once per tick for the whole fleet; unchanged machines keep their object
  // identity so memoised rows do not re-render.
  const aged = useMemo(() => ageFleet(fleet.machines, fleet.nowMs), [fleet.machines, fleet.nowMs])
  const scoped = useMemo(
    () => (filter.siteId === 'all' ? aged : aged.filter((machine) => machine.identity.siteId === filter.siteId)),
    [aged, filter.siteId],
  )
  const kpi = useMemo(() => summarize(scoped), [scoped])

  // Tra ảnh mẫu theo `aged` chứ không theo `visible`: gõ vào ô tìm kiếm không nên sinh ra
  // một loạt request mới, và mẫu đã tra rồi thì lọc qua lọc lại vẫn còn ảnh.
  const designFiles = useMemo(
    () => aged.map((machine) => machine.telemetry?.job?.value.fileName ?? '').filter(Boolean),
    [aged],
  )
  const designs = useDesignIndex(fleet.api, designFiles)
  const visible = useMemo(() => sortMachines(applyFilter(aged, filter), sortKey, sortDirection), [aged, filter, sortKey, sortDirection])
  const zones = useMemo(() => distinctZones(aged, filter.siteId), [aged, filter.siteId])
  const adapters = useMemo(
    () => [...new Set(aged.map((machine) => machine.identity.adapter))].sort() as AdapterKind[],
    [aged],
  )

  const selected = selectedId ? aged.find((machine) => machine.identity.id === selectedId) ?? null : null
  const activeSite = fleet.sites.find((site) => site.id === (selected?.identity.siteId ?? filter.siteId)) ?? null
  const timeZone = activeSite?.timeZone
  const scopeLabel = filter.siteId === 'all' ? 'toàn bộ nhà xưởng' : (activeSite?.name ?? filter.siteId)

  // URL đi theo màn hình, nhưng bằng replaceState: mỗi lần gõ một chữ trong ô tìm kiếm mà
  // đẩy một mục vào history thì nút Back của trình duyệt thành vô dụng.
  useEffect(() => {
    if (kiosk || typeof window === 'undefined') return
    const next = `${window.location.pathname}${encodeView(view)}`
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', next)
  }, [kiosk, view])

  // Phím tắt cho người đứng ở xưởng: `/` tìm, `1..5` đổi tab, `j/k` đi trong danh sách,
  // `Esc` đóng panel. Không có phím tắt nào gây ra thay đổi dữ liệu.
  useEffect(() => {
    if (kiosk) return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Escape') {
        if (isTyping(event.target) && event.target instanceof HTMLInputElement) { event.target.blur(); return }
        setSelectedId(null)
        return
      }
      if (isTyping(event.target)) return

      if (event.key === '/') { event.preventDefault(); setTab('fleet'); searchRef.current?.focus(); return }
      const digit = Number(event.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= tabs.length) { setTab(tabs[digit - 1]); return }
      if (tab !== 'fleet' || visible.length === 0) return

      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault()
        const at = visible.findIndex((machine) => machine.identity.id === selectedId)
        const step = event.key === 'j' ? 1 : -1
        const next = at === -1 ? (step === 1 ? 0 : visible.length - 1) : Math.min(Math.max(at + step, 0), visible.length - 1)
        setSelectedId(visible[next].identity.id)
        return
      }
      if (event.key === 'Enter' && selectedId === null) setSelectedId(visible[0].identity.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [kiosk, selectedId, setSelectedId, setTab, tab, visible])

  if (kiosk) {
    return (
      <div className="app app-kiosk">
        <ConnectionBanner
          status={fleet.socketStatus}
          detail={fleet.socketDetail}
          lastMessageAt={fleet.lastMessageAt}
          loadError={fleet.loadError}
          timeZone={timeZone}
        />
        <ErrorBoundary label="Bảng andon">
          <AndonBoard machines={aged} sites={fleet.sites} api={fleet.api} nowMs={fleet.nowMs} kiosk />
        </ErrorBoundary>
        <p className="reading-meta">{andonHeartbeat(fleet.lastMessageAt, timeZone)}</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Giám sát máy thêu Dahao</h1>
          <p className="app-sub">
            Bảng điều khiển chỉ đọc · {headerScope(fleet)}
            {fleet.health?.lastPollAt ? ` · lượt đọc gần nhất ${formatTime(fleet.health.lastPollAt, timeZone)}` : ''}
          </p>
        </div>
        <AccessBar session={fleet.session} onToken={fleet.setToken} />

        {/* Tabs nằm trong header, không phải một dải riêng bên dưới: hai dải viền chồng nhau
            tốn 106 px chiều dọc mà không nói thêm điều gì — bằng hai hàng máy rưỡi.

            Còn đúng một tab thì cả thanh biến mất: một cái tab không chuyển đi đâu được là
            32 px chiều dọc để nói một điều mà tiêu đề trang đã nói rồi. */}
        {tabs.length > 1 && (
          <nav className="tabs" aria-label="Khu vực chính">
            {tabs.map((key, index) => (
              <button
                key={key}
                type="button"
                className={tab === key ? 'tab tab-active' : 'tab'}
                aria-current={tab === key}
                title={`Phím tắt ${index + 1}`}
                onClick={() => setTab(key)}
              >
                {tabLabels[key]}
              </button>
            ))}
          </nav>
        )}
      </header>

      <ConnectionBanner
        status={fleet.socketStatus}
        detail={fleet.socketDetail}
        lastMessageAt={fleet.lastMessageAt}
        loadError={fleet.loadError}
        timeZone={timeZone}
      />

      {fleet.health?.migrationWarnings.map((warning) => (
        <div key={warning} className="banner banner-warning" role="status"><strong>Migration:</strong><span>{warning}</span></div>
      ))}

      {tab === 'fleet' && (
        <main className={selected ? 'fleet-layout fleet-layout-detail' : 'fleet-layout'}>
          <div className="fleet-main">
            <ErrorBoundary label="Chỉ số tổng quan">
              <KpiBar kpi={kpi} scope={scopeLabel} filter={filter} total={scoped.length} onFilter={setFilter} />
            </ErrorBoundary>
            {/* Thanh vẽ theo `scoped`, không theo `visible`: nó là bức tranh toàn xưởng. Vẽ
                theo danh sách đã lọc thì lọc "chỉ máy lỗi" sẽ ra một thanh đỏ 100%, đọc như
                cả xưởng đang cháy. */}
            <ErrorBoundary label="Thành phần đội máy">
              <FleetBar machines={scoped} nowMs={fleet.nowMs} filter={filter} onFilter={setFilter} />
            </ErrorBoundary>
            <ErrorBoundary label="Bộ lọc">
              <FleetFilters
                filter={filter}
                sites={fleet.sites}
                zones={zones}
                adapters={adapters}
                sortKey={sortKey}
                sortDirection={sortDirection}
                resultCount={visible.length}
                totalCount={aged.length}
                layout={layout}
                searchRef={searchRef}
                onFilter={setFilter}
                onSort={(key, direction) => patchView({ sortKey: key as SortKey, sortDirection: direction })}
                onLayout={(next) => patchView({ layout: next })}
              />
            </ErrorBoundary>
            <ErrorBoundary label="Danh sách máy">
              {aged.length === 0
                ? <EmptyState canPair={fleet.can('machine:pair')} canRead={fleet.can('fleet:read')} bridgeReachable={fleet.session !== null} />
                : layout === 'cards'
                  ? (
                    <FleetCards
                      machines={visible}
                      selectedId={selectedId}
                      timeZone={timeZone}
                      nowMs={fleet.nowMs}
                      api={fleet.api}
                      designs={designs}
                      onSelect={setSelectedId}
                    />
                  )
                  : (
                    <FleetTable
                      machines={visible}
                      selectedId={selectedId}
                      timeZone={timeZone}
                      nowMs={fleet.nowMs}
                      onSelect={setSelectedId}
                    />
                  )}
            </ErrorBoundary>
            <p className="shortcut-hint reading-meta">
              Phím tắt: <kbd>/</kbd> tìm máy
              {tabs.length > 1 && <> · <kbd>1</kbd>–<kbd>{tabs.length}</kbd> đổi tab</>}
              {' '}· <kbd>j</kbd>/<kbd>k</kbd> đi trong danh sách · <kbd>Esc</kbd> đóng chi tiết.
              Địa chỉ trên thanh trình duyệt luôn khớp màn hình đang xem, sao chép để gửi cho người khác.
            </p>
          </div>

          {selected && (
            <ErrorBoundary label={`Chi tiết ${selected.identity.name}`}>
              <MachineDetail
                machine={selected}
                api={fleet.api}
                can={fleet.can}
                site={fleet.sites.find((site) => site.id === selected.identity.siteId) ?? null}
                timeZone={timeZone}
                nowMs={fleet.nowMs}
                onMachine={fleet.applyMachine}
                onClose={() => setSelectedId(null)}
              />
            </ErrorBoundary>
          )}
        </main>
      )}

      {tab === 'production' && (
        <main>
          <ErrorBoundary label="Sản lượng ca">
            <ProductionPanel api={fleet.api} sites={fleet.sites} timeZone={timeZone} />
          </ErrorBoundary>
        </main>
      )}

      {tab === 'andon' && (
        <main>
          <ErrorBoundary label="Bảng andon">
            <AndonBoard machines={aged} sites={fleet.sites} api={fleet.api} nowMs={fleet.nowMs} />
          </ErrorBoundary>
          <p className="reading-meta">
            Treo lên TV xưởng bằng địa chỉ <code>{'…/?andon=1'}</code> — trang đó chỉ có bảng andon, không có tab nào khác.
          </p>
        </main>
      )}

      {tab === 'pairing' && (
        <main>
          <ErrorBoundary label="Quét mạng & ghép máy">
            <PairingPanel
              api={fleet.api}
              sites={fleet.sites}
              canScan={fleet.can('scan:run')}
              canPair={fleet.can('machine:pair')}
              timeZone={timeZone}
              // The rows arrive with the response; health carries the fleet counters in the
              // header, so it has to be refetched or the header keeps the pre-pairing total.
              onPaired={(machines) => { machines.forEach(fleet.applyMachine); void fleet.reload(); setTab('fleet') }}
            />
          </ErrorBoundary>
        </main>
      )}

      {tab === 'audit' && (
        <main>
          <ErrorBoundary label="Nhật ký kiểm toán">
            <AuditPanel api={fleet.api} timeZone={timeZone} />
          </ErrorBoundary>
        </main>
      )}

      <footer className="app-footer reading-meta">
        Dashboard chỉ đọc: không có lệnh điều khiển máy và không có đường truyền file thiết kế.
        Việc nạp mẫu vẫn thực hiện thủ công bằng USB tại máy.
      </footer>
    </div>
  )
}
