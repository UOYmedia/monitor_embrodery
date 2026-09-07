TRAM GATEWAY DAHAO  —  cai len Mac Mini (IP tailnet 07/09/2026: 100.105.80.93)
!! IP tailnet KHONG co dinh — 04/09/2026 no doi va bridge/Grafana/tunnel chet cung luc.
   Lay dia chi dang co bang: tailscale ip -4
=========================================================
broker.py  : broker MQTT 3865, giai ma "state" tu may A15, forward vao bridge
bridge/    : API + WebSocket + phuc vu dashboard (dist/)
Ket qua    : dashboard chay 24/7, tu bat lai khi crash/khoi dong (launchd),
             chong ngu (caffeinate), truy cap tu xa qua Tailscale.

CHAY TREN MINI (mo Terminal tren Mac Mini, dan tung lenh):
  1)  cd ~/Downloads && tar xzf dahao-gateway.tar.gz && cd deploy-mini
  2)  bash install.sh
  3)  Mo dia chi in ra o cuoi (http://100.105.80.93:8790)

YEU CAU TREN MINI: da cai Node.js LTS + python3 (macOS co san python3).
  Neu chua co Node: tai https://nodejs.org (ban LTS) roi chay lai buoc 2.

SAU KHI CAI — tren may theu A15 (dat 1 lan):
  C44 Server IP = IP LAN cua Mini (thuong 192.168.7.203)
  C41 Port      = 3865
  Roi khoi dong lai may. Xong: may se tu bao so mui ve Mini.

GO CAI (neu can):
  launchctl unload ~/Library/LaunchAgents/com.dahao.*.plist
  rm ~/Library/LaunchAgents/com.dahao.*.plist
