#!/bin/bash
# Cai "tram gateway Dahao" len Mac Mini: broker MQTT (giai ma state A15) + bridge (API + dashboard).
# Tu bat lai khi crash/dang nhap (launchd KeepAlive) + chong ngu (caffeinate). KHONG can sudo.
# Chay TREN Mini:  bash install.sh
set -euo pipefail

APP="$HOME/dahao-gateway"
BRIDGE_PORT="${BRIDGE_PORT:-8790}"
LA="$HOME/Library/LaunchAgents"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> Thu muc cai: $APP"
mkdir -p "$APP" "$LA" "$APP/logs"

# 1) Kiem tra cong cu
command -v node >/dev/null || { echo "!! CHUA CO node. Cai Node.js LTS (https://nodejs.org) roi chay lai."; exit 1; }
command -v python3 >/dev/null || { echo "!! CHUA CO python3."; exit 1; }
echo "==> node $(node -v) | python3 $(python3 -V 2>&1 | awk '{print $2}')"

# 2) Chep ma nguon (bundle da giai nen canh install.sh)
echo "==> Chep ma nguon vao $APP"
rsync -a --delete "$HERE/bridge/"       "$APP/bridge/"
# Khong con dist/: bridge chay THUAN API (uiPath=null), giao dien do ben khac dung.
rsync -a          "$HERE/node_modules/" "$APP/node_modules/" 2>/dev/null || true
cp "$HERE/broker.py" "$APP/broker.py"
mkdir -p "$APP/bridge-data"
# store: khong de neu da co (giu lich su may)
[ -f "$APP/bridge-data/fleet-store.dahao-mqtt.json" ] || cp "$HERE/fleet-store.dahao-mqtt.json" "$APP/bridge-data/fleet-store.dahao-mqtt.json"

# 3) pycryptodome cho broker
if ! python3 -c "import Crypto" 2>/dev/null; then
  echo "==> Cai pycryptodome (pip --user)"
  python3 -m pip install --user --quiet pycryptodome || { echo "!! Cai pycryptodome that bai. Chay: python3 -m pip install --user pycryptodome"; exit 1; }
fi

# 4) ws (neu bundle khong kem node_modules)
if [ ! -d "$APP/node_modules/ws" ]; then
  echo "==> Cai ws"
  ( cd "$APP" && npm init -y >/dev/null 2>&1 || true; npm install ws --silent )
fi

# 5) Tu do Tailscale IP de bind (chi lo qua tailnet)
TS="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
[ -x "$TS" ] || TS="$(command -v tailscale || echo '')"
TSIP="$([ -n "$TS" ] && $TS ip -4 2>/dev/null | head -1 || true)"
BIND_HOST="${TSIP:-127.0.0.1}"
echo "==> Bridge bind: $BIND_HOST:$BRIDGE_PORT  (Tailscale IP: ${TSIP:-<khong do duoc, dung loopback>})"

# 6) Sinh config bridge (bind Tailscale IP; ingest broker cuc bo 1600; phuc vu dashboard tu ./dist)
cat > "$APP/bridge.config.dahao-mqtt.json" <<JSON
{
  "_comment": "Tram gateway Dahao tren Mac Mini. broker.py giai ma state A15 -> forward vao 127.0.0.1:1600. Bridge phuc vu API+dashboard qua Tailscale. single-admin: MOI client toi duoc coi la admin -> chi mo trong tailnet rieng.",
  "host": "$BIND_HOST",
  "port": $BRIDGE_PORT,
  "logLevel": "info",
  "sites": [{ "id": "xuong-a15", "name": "Xuong A15", "timeZone": "Asia/Ho_Chi_Minh",
              "allowedCidrs": ["127.0.0.0/8"], "freshSeconds": 30, "staleSeconds": 90 }],
  "poll": { "intervalMs": 15000, "concurrency": 4, "timeoutMs": 2500 },
  "scan": { "allowLoopback": true, "allowPublicRanges": false, "maxHosts": 256, "timeoutMs": 350 },
  "ingest": { "enabled": true, "host": "127.0.0.1", "port": 1600, "capture": false,
              "maxFramesPerMinute": 600, "idleTimeoutMs": 300000 },
  "auth": { "mode": "single-admin", "localActor": "gateway" },
  "allowedOrigins": ["http://$BIND_HOST:$BRIDGE_PORT", "http://localhost:5173", "http://127.0.0.1:5173"],
  "dataPath": "./bridge-data/fleet-store.dahao-mqtt.json",
  "auditPath": "./bridge-data/audit-dahao-mqtt.jsonl",
  "productionPath": "./bridge-data/production-dahao-mqtt.json",
  "uiPath": "./dist"
}
JSON

# 7) launchd agents (RunAtLoad + KeepAlive = tu bat lai khi crash/dang nhap lai)
NODE="$(command -v node)"; PY="$(command -v python3)"

cat > "$LA/com.dahao.broker.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.dahao.broker</string>
  <key>ProgramArguments</key><array><string>$PY</string><string>$APP/broker.py</string></array>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$APP/logs/broker.out</string>
  <key>StandardErrorPath</key><string>$APP/logs/broker.err</string>
</dict></plist>
PL

cat > "$LA/com.dahao.bridge.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.dahao.bridge</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$APP/bridge/index.mjs</string></array>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>EnvironmentVariables</key><dict><key>BRIDGE_CONFIG</key><string>$APP/bridge.config.dahao-mqtt.json</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$APP/logs/bridge.out</string>
  <key>StandardErrorPath</key><string>$APP/logs/bridge.err</string>
</dict></plist>
PL

cat > "$LA/com.dahao.caffeinate.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.dahao.caffeinate</string>
  <key>ProgramArguments</key><array><string>/usr/bin/caffeinate</string><string>-dimsu</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
</dict></plist>
PL

# 8) Nap lai (idempotent)
for L in com.dahao.broker com.dahao.bridge com.dahao.caffeinate; do
  launchctl unload "$LA/$L.plist" 2>/dev/null || true
  launchctl load  "$LA/$L.plist"
  echo "==> da nap $L"
done

sleep 3
echo; echo "==================== XONG ===================="
echo "API (thuan API, khong co giao dien):  http://$BIND_HOST:$BRIDGE_PORT/api/health"
echo "Trang thai:"
launchctl list | grep dahao || true
echo "Log:  $APP/logs/{broker,bridge}.{out,err}"
echo
echo ">> NHO tren may theu A15: dat C44 Server IP = IP LAN cua Mini (thuong 192.168.7.203), C41 Port = 3865, roi khoi dong lai may."
echo ">> Neu muon song qua ca khi CHUA dang nhap: bat Tu dang nhap (System Settings > Users > Automatic login)."
