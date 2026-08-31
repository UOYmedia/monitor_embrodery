#!/bin/bash
# Nạp mật khẩu admin rồi chạy Grafana. Mật khẩu nằm ĐÚNG MỘT CHỖ
# (~/dahao-gateway/quan-sat/grafana-admin.env, chmod 600) thay vì nhân bản vào
# plist — plist nằm trong thư mục ai cũng liệt kê được. Cùng cách với chay-bridge.sh.
set -euo pipefail
QS="$HOME/dahao-gateway/quan-sat"
[ -f "$QS/grafana-admin.env" ] && { set -a; . "$QS/grafana-admin.env"; set +a; }

GRAFANA="/opt/homebrew/opt/grafana/bin/grafana"
HOMEPATH="/opt/homebrew/opt/grafana/share/grafana"
[ -x "$GRAFANA" ] || { echo "!! Không thấy $GRAFANA — brew install grafana chưa xong?" >&2; exit 127; }

# Grafana bind vào IP Tailscale. Lúc máy vừa khởi động, giao diện Tailscale có thể chưa lên
# -> listen EADDRNOTAVAIL -> launchd KeepAlive quay vòng chết liên tục. Chờ địa chỉ xuất hiện.
# (Đúng lỗi đã cắn phải với bridge; xem chay-bridge.sh.)
DIA="$(sed -n 's/^http_addr *= *//p' "$QS/native/grafana.ini" | head -1)"
for _ in $(seq 1 60); do
  ifconfig 2>/dev/null | grep -q "inet $DIA" && break
  echo "… chờ địa chỉ $DIA xuất hiện trên giao diện mạng"
  sleep 2
done

exec "$GRAFANA" server \
  --config "$QS/native/grafana.ini" \
  --homepath "$HOMEPATH" \
  --packaging=brew
