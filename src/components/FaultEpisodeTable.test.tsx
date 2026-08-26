/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FaultEpisodeTable } from './FaultEpisodeTable'
import type { BridgeApi } from '../services/bridgeApi'
import type { FaultEpisode } from '../types/fleet'

/**
 * Bộ test giao diện đầu tiên của repo — ba ca L‑27/28/29 của `PRD_TUYEN_A15_BAN_GIAO.md`.
 *
 * Vì sao phải dựng DOM thật thay vì chỉ test `lib/faultEpisodes.ts`: cả ba ca đều nói về **thứ
 * hiện lên màn hình**, và một hàm thuần trả về đúng chữ vẫn có thể bị JSX đặt nhầm cột, bọc vào
 * một thẻ bị CSS ẩn, hay ghi đè bằng một `formatDuration` gọi thẳng. Chốt ở đây là `textContent`
 * của đúng ô người ta nhìn.
 */

// React 19 kiểm cờ này trước khi cho `act()` chạy. `@testing-library/react` chỉ tự đặt nó khi bộ
// test bày `beforeAll`/`afterAll` ra làm biến toàn cục — repo này không bật `globals` của vitest
// nên phải đặt tay. Thiếu nó thì test vẫn xanh nhưng React cảnh báo ở mỗi lần render.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Cũng vì `globals` tắt: RTL không tự gắn được `afterEach(cleanup)`, nên hai ca liên tiếp sẽ
// render chồng lên nhau trong cùng một `document` và mọi truy vấn "getBy" đều thấy hai bản.
afterEach(cleanup)

function lanLoi(overrides: Partial<FaultEpisode> = {}): FaultEpisode {
  return {
    episodeId: 'ep-1',
    machineId: 'm-1',
    siteId: 'xuong-1',
    batDau: '2026-08-25T08:00:00.000Z',
    ketThuc: '2026-08-25T08:12:30.000Z',
    thoiLuongGiay: 750,
    dangMo: false,
    lyDoDong: 'controller-bao-trang-thai-khac',
    chuaBietVi: null,
    trangThaiSau: 'running',
    ma: 'E12',
    moTa: 'Đứt chỉ kim 3',
    previousEpisodeId: null,
    batDauUocChung: false,
    mocDangNgo: false,
    ghiLuc: '2026-08-25T08:12:30.100Z',
    daMoLai: false,
    soLanMoLai: 0,
    moLaiLuc: null,
    moLaiBoi: null,
    lyDoMoLai: null,
    cauChu: 'Controller báo máy rời trạng thái lỗi.',
    ...overrides,
  }
}

/** Bridge giả: chỉ đủ cái component gọi. Không mock giao thức Dahao ở đây — nó nằm tầng dưới. */
function apiGia(episodes: FaultEpisode[], truncated = false, tongCong = episodes.length): BridgeApi {
  return {
    machineFaults: () => Promise.resolve({ machineId: 'm-1', episodes, truncated, tongCong }),
  } as unknown as BridgeApi
}

async function cacHang(): Promise<HTMLElement[]> {
  const table = await screen.findByRole('table')
  return Array.from(table.querySelectorAll('tbody tr'))
}

function o(hang: HTMLElement, cot: number): string {
  return hang.querySelectorAll('td')[cot]?.textContent ?? ''
}

const COT_LOI = 0
const COT_TU = 1
const COT_DEN = 2
const COT_KEO_DAI = 3

describe('L‑27 · bảng lần lỗi: lỗi gì · từ · đến · kéo dài', () => {
  it('ba trường hợp "chưa biết" hiện thành CHỮ, không một chữ số nào ở ô kéo dài', async () => {
    render(<FaultEpisodeTable api={apiGia([
      lanLoi({
        episodeId: 'ep-mat-tin-hieu', batDau: '2026-08-25T08:00:00.000Z',
        thoiLuongGiay: null, lyDoDong: 'chua-biet', chuaBietVi: 'mat-tin-hieu',
        cauChu: 'Chưa biết — mất tín hiệu máy giữa chừng, im lặng không phải là hết lỗi.',
      }),
      lanLoi({
        episodeId: 'ep-nhap-tay', batDau: '2026-08-25T07:00:00.000Z',
        thoiLuongGiay: null, lyDoDong: 'chua-biet', chuaBietVi: 'nhap-tay',
        cauChu: 'Chưa biết — có người gõ tay, không phải controller báo hết lỗi.',
      }),
      lanLoi({
        episodeId: 'ep-khoi-dong-lai', batDau: '2026-08-25T06:00:00.000Z',
        thoiLuongGiay: null, lyDoDong: 'chua-biet', chuaBietVi: 'dong-bang-khoi-dong-lai',
        cauChu: 'Chưa biết — bridge khởi động lại giữa chừng, không quan sát được lúc kết thúc.',
      }),
    ])} machineId="m-1" timeZone="UTC" />)

    const hang = await cacHang()
    expect(hang).toHaveLength(3)

    for (const tr of hang) {
      const keoDai = o(tr, COT_KEO_DAI)
      expect(keoDai).toContain('Chưa biết')
      // Chốt thật của L‑27. `0 phút`, `0s`, `0` — bất kỳ chữ số nào ở ô này cũng sẽ được đọc
      // thành một phép đo, mà đúng cái đang thiếu là phép đo.
      expect(keoDai).not.toMatch(/\d/)
    }

    expect(o(hang[0], COT_KEO_DAI)).toContain('mất tín hiệu')
    expect(o(hang[1], COT_KEO_DAI)).toContain('có người gõ tay')
    expect(o(hang[2], COT_KEO_DAI)).toContain('bridge khởi động lại')

    // Và mốc ở cột "đến" phải tự khai nó là mốc gì — cùng một con số, hai nghĩa trái ngược.
    for (const tr of hang) {
      expect(o(tr, COT_DEN)).toContain('Mốc mất dấu, không phải mốc hết lỗi')
    }
  })

  it('nhưng một khoảng ĐO ĐƯỢC vẫn hiện thành số, kèm mốc thật ở hai cột trước', async () => {
    render(<FaultEpisodeTable api={apiGia([lanLoi()])} machineId="m-1" timeZone="UTC" />)
    const [tr] = await cacHang()

    expect(o(tr, COT_KEO_DAI)).toContain('12p 30s')
    // Chỉ chốt GIỜ, không chốt cách viết ngày: dấu ngăn và thứ tự ngày/tháng là việc của `Intl`
    // và của bảng ICU đi kèm từng bản Node — chốt nó ở đây là đem một test giao diện đi canh một
    // thứ mình không sở hữu, và nó sẽ đỏ vào một ngày chẳng liên quan gì tới bảng lần lỗi.
    expect(o(tr, COT_TU)).toMatch(/08:00:00/)
    expect(o(tr, COT_DEN)).toMatch(/08:12:30/)
    expect(o(tr, COT_DEN)).toContain('Controller báo hết lỗi')
  })

  it('lần lỗi đang mở nói "Đang lỗi", không đưa ra con số nào và không có mốc kết thúc', async () => {
    render(<FaultEpisodeTable api={apiGia([
      lanLoi({ dangMo: true, ketThuc: null, thoiLuongGiay: null, lyDoDong: null, cauChu: 'Đang lỗi — chưa thấy controller báo trạng thái khác.' }),
    ])} machineId="m-1" timeZone="UTC" />)
    const [tr] = await cacHang()

    expect(o(tr, COT_KEO_DAI)).toContain('Đang lỗi')
    expect(o(tr, COT_KEO_DAI)).not.toMatch(/\d/)
    expect(o(tr, COT_DEN)).toContain('Chưa kết thúc')
  })

  it('mốc bắt đầu ước chừng hiện "ít nhất từ", không hiện như một mốc chắc chắn', async () => {
    render(<FaultEpisodeTable api={apiGia([lanLoi({ batDauUocChung: true })])} machineId="m-1" timeZone="UTC" />)
    const [tr] = await cacHang()
    expect(o(tr, COT_TU)).toContain('ít nhất từ')
  })

  it('không có lần lỗi nào thì nói rõ là bình thường, không nổ thành lỗi hệ thống', async () => {
    render(<FaultEpisodeTable api={apiGia([])} machineId="m-1" timeZone="UTC" />)
    expect(await screen.findByText(/câu trả lời bình thường/)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('L‑28 · mã lỗi in nguyên văn, không dịch, không bảng tra', () => {
  it('chuỗi hiển thị khớp từng byte với events[].code', async () => {
    // Sáu mã cố tình khó: hoa/thường, khoảng trắng thừa, dấu gạch, chữ Hán, hệ 16, số 0 đứng đầu.
    // Bất kỳ phép "chuẩn hoá" nào lọt vào giao diện đều làm hỏng ít nhất một trong sáu.
    const cacMa = ['E12', 'e12', ' E12 ', 'E-12/断线 03', '0x1F', '007']
    render(<FaultEpisodeTable api={apiGia(
      cacMa.map((ma, i) => lanLoi({
        episodeId: `ep-${i}`,
        ma,
        moTa: null,
        batDau: `2026-08-25T0${i}:00:00.000Z`,
      })),
    )} machineId="m-1" timeZone="UTC" />)

    const hang = await cacHang()
    expect(hang).toHaveLength(cacMa.length)
    // Bảng sắp theo `batDau` giảm dần ở bridge; ở đây mảng vào sao thì ra vậy, nên so theo thứ tự.
    hang.forEach((tr, i) => {
      const el = tr.querySelectorAll('td')[COT_LOI].querySelector('.fault-code')
      expect(el?.textContent).toBe(cacMa[i])
    })
  })

  it('máy không gửi mã thì nói thẳng là không có mã, không bịa chữ vào chỗ của mã', async () => {
    render(<FaultEpisodeTable api={apiGia([lanLoi({ ma: null, moTa: null })])} machineId="m-1" timeZone="UTC" />)
    const [tr] = await cacHang()
    expect(o(tr, COT_LOI)).toContain('Máy không gửi mã lỗi')
    expect(tr.querySelector('.fault-code')).toBeNull()
  })
})

describe('L‑29 · lần lỗi đã reopen hiện là "đã mở lại", kèm lý do', () => {
  it('hiện dấu mở lại kèm ai · lúc nào · vì sao', async () => {
    render(<FaultEpisodeTable api={apiGia([lanLoi({
      daMoLai: true, soLanMoLai: 2,
      moLaiLuc: '2026-08-25T09:00:00.000Z', moLaiBoi: 'phong',
      lyDoMoLai: 'Tưởng sửa xong, máy lại dừng ngay sau đó.',
    })])} machineId="m-1" timeZone="UTC" />)
    const [tr] = await cacHang()

    const oLoi = o(tr, COT_LOI)
    expect(oLoi).toContain('đã mở lại')
    expect(oLoi).toContain('2 lần')
    expect(oLoi).toContain('phong')
    expect(oLoi).toContain('Tưởng sửa xong, máy lại dừng ngay sau đó.')
    expect(oLoi).toMatch(/09:00:00/)
  })

  it('không xoá dấu vết bản cũ: mã, mốc và thời lượng ban đầu vẫn nằm nguyên trên dòng đó', async () => {
    render(<FaultEpisodeTable api={apiGia([lanLoi({
      ma: 'E12', thoiLuongGiay: 750,
      batDau: '2026-08-25T08:00:00.000Z', ketThuc: '2026-08-25T08:12:30.000Z',
      daMoLai: true, soLanMoLai: 1,
      moLaiLuc: '2026-08-25T09:00:00.000Z', moLaiBoi: 'phong',
      lyDoMoLai: 'Tưởng sửa xong, máy lại dừng ngay sau đó.',
    })])} machineId="m-1" timeZone="UTC" />)
    const [tr] = await cacHang()

    expect(tr.querySelector('.fault-code')?.textContent).toBe('E12')
    expect(o(tr, COT_TU)).toMatch(/08:00:00/)
    expect(o(tr, COT_DEN)).toMatch(/08:12:30/)
    expect(o(tr, COT_KEO_DAI)).toContain('12p 30s')
    expect(o(tr, COT_LOI)).toContain('đã mở lại')
  })

  it('mở lại đúng một lần thì không in "1 lần" thừa ra', async () => {
    render(<FaultEpisodeTable api={apiGia([lanLoi({
      daMoLai: true, soLanMoLai: 1, moLaiLuc: '2026-08-25T09:00:00.000Z',
      moLaiBoi: 'phong', lyDoMoLai: 'Máy dừng lại ngay sau đó.',
    })])} machineId="m-1" timeZone="UTC" />)
    const [tr] = await cacHang()
    expect(o(tr, COT_LOI)).toContain('đã mở lại')
    expect(o(tr, COT_LOI)).not.toContain('1 lần')
  })
})

describe('bảng bị cắt bớt', () => {
  it('nói rõ đang hiện bao nhiêu trong tổng bao nhiêu', async () => {
    render(<FaultEpisodeTable api={apiGia([lanLoi()], true, 412)} machineId="m-1" timeZone="UTC" />)
    await cacHang()
    expect(screen.getByText(/trong tổng 412 lần đã ghi/)).toBeTruthy()
  })
})
