#!/bin/bash
# Nạp token rồi chạy bridge. Token nằm ĐÚNG MỘT CHỖ (~/dahao-gateway/bridge-tokens.env, chmod 600)
# thay vì nhân bản vào plist — plist nằm trong thư mục ai cũng liệt kê được.
set -euo pipefail
APP="$HOME/dahao-gateway"
set -a; . "$APP/bridge-tokens.env"; set +a
export BRIDGE_CONFIG="$APP/bridge.config.dahao-mqtt.json"

# launchd chỉ cho PATH=/usr/bin:/bin:/usr/sbin:/sbin — node KHÔNG nằm trong đó.
# `command -v node` trả rỗng, `exec ""` chết câm với "exec: : not found".
# Nên tìm node theo đường dẫn tuyệt đối, và báo lỗi ra hẳn nếu không thấy.
NODE=""
for ung in "$HOME/node/bin/node" /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node || true)"; do
  [ -n "$ung" ] && [ -x "$ung" ] && { NODE="$ung"; break; }
done
[ -n "$NODE" ] || { echo "!! Không tìm thấy node. Đã thử: ~/node/bin, /opt/homebrew/bin, /usr/local/bin, PATH." >&2; exit 127; }

# Bridge bind vào IP Tailscale. Lúc máy vừa khởi động, giao diện Tailscale có thể chưa lên
# -> listen EADDRNOTAVAIL -> launchd KeepAlive quay vòng chết liên tục. Chờ địa chỉ xuất hiện.
DIA="$(python3 -c "import json;print(json.load(open('$BRIDGE_CONFIG'))['host'])")"
case "$DIA" in
  127.0.0.1|localhost|0.0.0.0|::1) ;;
  *)
    for i in $(seq 1 60); do
      ifconfig | grep -q "inet $DIA " && break
      [ "$i" = 60 ] && { echo "!! Địa chỉ $DIA không có trên máy sau 60s (Tailscale chưa lên?)." >&2; exit 1; }
      sleep 1
    done ;;
esac

exec "$NODE" "$APP/bridge/index.mjs"
