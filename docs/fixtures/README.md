# Fixture phát triển

Dữ liệu trong thư mục này là **mẫu để phát triển và kiểm thử**, không phải dữ liệu đọc từ
máy thêu thật. Không nạp chúng vào giao diện như dữ liệu trực tiếp và không dùng chúng để
minh hoạ năng lực của hệ thống với khách hàng.

Xem `docs/adapter-contract.md` để biết ý nghĩa từng trường.

`telemetry-dahao-screen.json` là ngoại lệ đáng chú ý: các con số về **mẫu thêu** trong đó chép
lại đúng màn hình một controller Dahao thật tại xưởng (mẫu số 80 `4127~.DST`, 46.453 mũi, 11 lần
đổi màu, X `[-141.3, 138.5]`, Y `[-109.3, 193.8]`, giới hạn khung 1500 × 700, bộ nhớ 81/800).
Phần telemetry vận hành (`rpm`, `currentStitch`, `odometer`, `threadBreakWindow`) vẫn là số bịa
cho kiểm thử — máy thật lúc chụp ảnh chưa nối mạng nên không đọc được các trường đó.

