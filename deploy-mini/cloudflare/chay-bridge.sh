#!/bin/bash
# Nạp token rồi chạy bridge. Token nằm ĐÚNG MỘT CHỖ (~/dahao-gateway/bridge-tokens.env, chmod 600)
# thay vì nhân bản vào plist — plist nằm trong thư mục ai cũng liệt kê được.
set -euo pipefail
APP="$HOME/dahao-gateway"
set -a; . "$APP/bridge-tokens.env"; set +a
export BRIDGE_CONFIG="$APP/bridge.config.dahao-mqtt.json"
exec "$(command -v node)" "$APP/bridge/index.mjs"
