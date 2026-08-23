#!/bin/bash
# Một lệnh làm cả ba bước, đúng thứ tự an toàn. Chạy trên Mac Mini.
#
#   ./lam-tat-ca.sh
#
# Bước 1 mở trình duyệt để bạn cấp quyền — đó là bước duy nhất không tự động được.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  echo "==> Bước 1/3: đăng nhập Cloudflare (trình duyệt sẽ mở; chọn vùng phonh.io.vn)"
  cloudflared tunnel login
else
  echo "==> Bước 1/3: đã có chứng chỉ, bỏ qua"
fi
[ -f "$HOME/.cloudflared/cert.pem" ] || { echo "!! Chưa cấp quyền xong. DỪNG."; exit 1; }

echo
echo "==> Bước 2/3: siết quyền bridge (single-admin -> token)"
echo "    Bước này sửa cấu hình và launchd của bridge ĐANG CHẠY."
echo "    Nó tự sao lưu, tự kiểm 401/200, và tự lùi nếu không đạt."
read -r -p "    Tiếp tục? [y/N] " tra
[ "$tra" = "y" ] || [ "$tra" = "Y" ] || { echo "    Dừng theo yêu cầu."; exit 0; }
"$HERE/siet-quyen.sh"

echo
echo "==> Bước 3/3: bật tunnel"
"$HERE/bat-tunnel.sh"
