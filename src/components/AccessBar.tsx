import { useState } from 'react'
import type { SessionSummary } from '../types/fleet'

const roleLabels: Record<string, string> = {
  viewer: 'Người xem / quản đốc',
  technician: 'Kỹ thuật viên',
  admin: 'Quản trị',
}

/**
 * Access token entry — deliberately not a login form.
 *
 * There is no user database, no password and no "remember me". The bridge issues tokens
 * out of band (a config file an admin controls); this box only carries one to the API for
 * the length of the tab session. Anything more would be a fake login pretending to be
 * security. TODO(phase-2): replace with OIDC/SSO once an identity provider exists.
 */
export function AccessBar({ session, onToken }: { session: SessionSummary | null; onToken: (token: string | null) => void }) {
  const [value, setValue] = useState('')

  if (session?.authMode === 'single-admin') {
    return (
      // Một dòng, không xuống dòng: đây là chú thích cố định, mà mỗi 20 px chiều cao ở header
      // đúng bằng nửa hàng máy bị đẩy khỏi màn hình. Câu đầy đủ nằm trong tooltip và trong docs.
      <div className="access-bar access-bar-slim" title="Bridge không kiểm tra danh tính trong chế độ single-admin: mọi truy cập từ LAN đều có toàn quyền quản trị. Chỉ dùng trên mạng xưởng tin cậy, không mở ra Internet.">
        <span className="badge badge-role">{roleLabels[session.role ?? ''] ?? session.role}</span>
        <span className="reading-meta">
          <code>single-admin</code>: mọi truy cập LAN đều là <strong>{session.actor}</strong> · chỉ dùng trên mạng tin cậy
        </span>
      </div>
    )
  }

  if (session?.authenticated) {
    return (
      <div className="access-bar">
        <span className="badge badge-role">{roleLabels[session.role ?? ''] ?? session.role}</span>
        <span className="reading-meta">Đang đăng nhập bằng token của <strong>{session.actor}</strong>. Token chỉ nằm trong bộ nhớ tab này.</span>
        <button type="button" className="ghost" onClick={() => onToken(null)}>Thoát</button>
      </div>
    )
  }

  return (
    <form
      className="access-bar"
      onSubmit={(event) => { event.preventDefault(); onToken(value.trim() || null); setValue('') }}
    >
      <label htmlFor="access-token">Access token</label>
      <input
        id="access-token"
        type="password"
        value={value}
        autoComplete="off"
        placeholder="Token do quản trị viên cấp"
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" disabled={!value.trim()}>Dùng token</button>
      <span className="reading-meta">Chưa có token: chỉ xem được trang trống. Token không được lưu vào trình duyệt.</span>
    </form>
  )
}
