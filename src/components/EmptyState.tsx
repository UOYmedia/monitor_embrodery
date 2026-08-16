/**
 * The default screen of a fresh install.
 *
 * It stays empty on purpose. Filling it with demo machines would teach an operator to
 * trust numbers that came from nowhere, so instead it explains how to get real ones.
 */
export function EmptyState({ canPair, canRead, bridgeReachable }: { canPair: boolean; canRead: boolean; bridgeReachable: boolean }) {
  if (!canRead) {
    // An empty screen because the token may not read the fleet is a different fact from an
    // empty screen because nothing is paired. Saying "chưa có máy" here would be a lie.
    return (
      <section className="empty-state">
        <h2>Chưa có quyền xem đội máy</h2>
        <p>
          {bridgeReachable
            ? 'Bridge đang phản hồi nhưng token hiện tại không có quyền fleet:read. Nhập access token do quản trị viên cấp ở góc trên bên phải.'
            : 'Chưa liên lạc được với bridge. Kiểm tra dịch vụ bridge, host/port và đường mạng LAN.'}
        </p>
        <p>Danh sách máy, chỉ số và nhật ký chỉ hiển thị sau khi token được xác thực. Token không được lưu vào trình duyệt.</p>
      </section>
    )
  }
  return (
    <section className="empty-state">
      <h2>Chưa có máy nào trong đội</h2>
      <p>
        Dashboard này chỉ hiển thị dữ liệu đọc được từ máy thật. Không có số liệu mẫu, không có máy demo:
        màn hình trống nghĩa là chưa ghép máy nào, không phải mất dữ liệu.
      </p>
      <ol>
        <li>
          <strong>Chạy bridge trong LAN của xưởng.</strong>{' '}
          {bridgeReachable ? 'Bridge đang phản hồi.' : 'Hiện chưa liên lạc được với bridge — kiểm tra dịch vụ và cấu hình host/port.'}
        </li>
        <li>Khai báo nhà xưởng và dải mạng được phép quét trong <code>bridge.config.json</code>.</li>
        <li>
          {canPair
            ? 'Mở mục “Quét mạng & ghép máy”, xác nhận cảnh báo quét, rồi đối chiếu từng máy tại xưởng trước khi ghép.'
            : 'Nhờ kỹ thuật viên quét mạng và ghép máy — vai trò hiện tại chỉ được xem.'}
        </li>
        <li>Máy dùng adapter <code>manual</code> vẫn hiện trong danh sách nhưng mọi thông số là “Chưa đọc được từ controller” cho tới khi có adapter giao thức thật.</li>
      </ol>
    </section>
  )
}
