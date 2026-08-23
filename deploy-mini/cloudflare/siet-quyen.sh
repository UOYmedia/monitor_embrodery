#!/bin/bash
# Chuyển bridge từ single-admin sang token. TỰ KIỂM và TỰ LÙI nếu không đạt.
#
# Vì sao bắt buộc trước khi mở tunnel: single-admin coi MỌI người gọi là admin — ghép máy,
# lưu trữ máy, quét mạng, nhập số sản lượng (số đó ra tiền lương khoán).
set -euo pipefail
APP="$HOME/dahao-gateway"; LA="$HOME/Library/LaunchAgents"; HERE="$(cd "$(dirname "$0")" && pwd)"
DIA="$(python3 -c "import json;d=json.load(open('$APP/bridge.config.dahao-mqtt.json'));print(d['host']+':'+str(d['port']))")"

echo "==> Sao lưu"
cp "$APP/bridge.config.dahao-mqtt.json" "$APP/bridge.config.dahao-mqtt.json.pre-token.bak"
[ -f "$LA/com.dahao.bridge.plist" ] && cp "$LA/com.dahao.bridge.plist" "$LA/com.dahao.bridge.plist.pre-token.bak"

lui() {
  echo "!! KHÔNG ĐẠT — đang lùi về bản cũ"
  cp "$APP/bridge.config.dahao-mqtt.json.pre-token.bak" "$APP/bridge.config.dahao-mqtt.json"
  [ -f "$LA/com.dahao.bridge.plist.pre-token.bak" ] && cp "$LA/com.dahao.bridge.plist.pre-token.bak" "$LA/com.dahao.bridge.plist"
  launchctl unload "$LA/com.dahao.bridge.plist" 2>/dev/null || true
  launchctl load "$LA/com.dahao.bridge.plist"
  echo "!! Đã lùi. KHÔNG được bật tunnel."
  exit 1
}

echo "==> Đặt cấu hình token + wrapper"
[ -f "$APP/bridge-tokens.env" ] || { echo "!! Thiếu $APP/bridge-tokens.env"; exit 1; }
cp "$HERE/bridge.config.public.json" "$APP/bridge.config.dahao-mqtt.json"
cp "$HERE/chay-bridge.sh" "$APP/chay-bridge.sh"; chmod 700 "$APP/chay-bridge.sh"
cp "$HERE/com.dahao.bridge.token.plist" "$LA/com.dahao.bridge.plist"

echo "==> Nạp lại bridge"
launchctl unload "$LA/com.dahao.bridge.plist" 2>/dev/null || true
launchctl load "$LA/com.dahao.bridge.plist"
for i in $(seq 1 40); do curl -sf -o /dev/null "http://$DIA/api/health" && break || true; done

echo "==> Kiểm: KHÔNG token phải bị từ chối"
KHONG=$(curl -s -o /dev/null -w "%{http_code}" "http://$DIA/api/v2/fleet" || echo 000)
set -a; . "$APP/bridge-tokens.env"; set +a
CO=$(curl -s -o /dev/null -w "%{http_code}" -H "authorization: Bearer $BRIDGE_TOKEN_VIEWER" "http://$DIA/api/v2/fleet" || echo 000)
echo "    không token -> $KHONG (cần 401)"
echo "    có token    -> $CO (cần 200)"
[ "$KHONG" = "401" ] && [ "$CO" = "200" ] || lui

echo "==> ĐẠT. Bridge đã ở chế độ token. Giờ mới được bật tunnel."
