#!/bin/bash
# Bật Cloudflare Tunnel. CHẠY SAU `cloudflared tunnel login` và SAU `siet-quyen.sh`.
set -euo pipefail
APP="$HOME/dahao-gateway"; LA="$HOME/Library/LaunchAgents"; HERE="$(cd "$(dirname "$0")" && pwd)"
TEN=dahao-gateway; HOST=redthread.phonh.io.vn
DIA="$(python3 -c "import json;d=json.load(open('$APP/bridge.config.dahao-mqtt.json'));print(d['host']+':'+str(d['port']))")"

# ĐIỀU KIỆN DỪNG CỨNG: chưa siết quyền thì không được mở ra Internet.
MODE=$(python3 -c "import json;print(json.load(open('$APP/bridge.config.dahao-mqtt.json'))['auth']['mode'])")
[ "$MODE" = "token" ] || { echo "!! auth.mode=$MODE. Chạy siet-quyen.sh trước. DỪNG."; exit 1; }
[ -f "$HOME/.cloudflared/cert.pem" ] || { echo "!! Chưa đăng nhập. Chạy: cloudflared tunnel login"; exit 1; }

ID=$(cloudflared tunnel list --output json | python3 -c "
import json,sys
t=[x for x in json.load(sys.stdin) if x['name']=='$TEN']
print(t[0]['id'] if t else '')")
if [ -z "$ID" ]; then
  echo "==> Tạo tunnel $TEN"; cloudflared tunnel create "$TEN"
  ID=$(cloudflared tunnel list --output json | python3 -c "
import json,sys; print([x for x in json.load(sys.stdin) if x['name']=='$TEN'][0]['id'])")
fi
echo "==> Tunnel id: $ID"
cloudflared tunnel route dns "$TEN" "$HOST" || echo "   (bản ghi DNS đã có — bỏ qua)"

sed -e "s|<TUNNEL-ID>|$ID|g" -e "s|http://127.0.0.1:8790|http://$DIA|" "$HERE/config.yml" > "$APP/cloudflare-config.yml"
cp "$HERE/com.dahao.tunnel.plist" "$LA/com.dahao.tunnel.plist"
launchctl unload "$LA/com.dahao.tunnel.plist" 2>/dev/null || true
launchctl load "$LA/com.dahao.tunnel.plist"

echo "==> Chờ tunnel lên"
for i in $(seq 1 60); do
  MA=$(curl -s -o /dev/null -w "%{http_code}" "https://$HOST/api/health" || echo 000)
  [ "$MA" = "200" ] && { echo "==> XONG: https://$HOST/api/health -> 200"; exit 0; }
done
echo "!! Chưa lên (mã cuối: ${MA:-?}). Xem $APP/logs/tunnel.err"; exit 1
